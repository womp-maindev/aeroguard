// Test vectors for the Aiken validator: the real Airnode signature, plus final outcomes signed by a public test key
// (Anvil account #0) because no final arrival proof exists yet. `npm run vectors` writes onchain/lib/aeroguard/vectors.ak.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { encodePacked, type Hex, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { SignedResponse } from '../../keeper/src/airnode-v2.ts';
import { requestHashFor } from '../../keeper/src/flight.ts';
import { AERODATABOX_AIRNODE_PUBKEY, compressedSigner, payoutOf, projectedData } from './onchain.ts';

const TEST_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const SCHEDULED = '2026-10-30 21:25Z';
// Test answers are signed at 06:00Z on 31 Oct, after every landing they report (as a real final answer is).
const TIMESTAMP = 1793426400n;

export interface Vector { name: string; pubkey: string; requestHash: string; timestamp: bigint; status: string; actual?: string; data: string; signature: string }

const sign = async (name: string, status: string, actual?: string, timestamp = TIMESTAMP): Promise<Vector> => {
  const account = privateKeyToAccount(TEST_KEY);
  const requestHash = requestHashFor('IB1314', '2026-10-30', actual === undefined ? 'status' : 'arrival');
  const data = projectedData(SCHEDULED, status, actual);
  const signature = await account.signMessage({ message: { raw: keccak256(encodePacked(['bytes32', 'uint256', 'bytes'], [requestHash, timestamp, toHex(data)])) } });
  const r: SignedResponse = { airnode: account.address, requestHash, timestamp: String(timestamp), data, signature };
  return { name, pubkey: await compressedSigner(r), requestHash, timestamp, status, actual, data, signature };
};

export const testVectors = async (): Promise<Vector[]> => {
  const real = JSON.parse(readFileSync(new URL('../evidence/IB1314-2026-10-30-status.json', import.meta.url), 'utf8')) as SignedResponse;
  const parsed = JSON.parse(real.data) as { scheduled: string; status: string };
  // A live arrival-projection answer the keeper bought for policy #1 (published on keeper-data).
  const arrival = JSON.parse(readFileSync(new URL('../evidence/IB1314-2026-10-30-arrival-1793387403.json', import.meta.url), 'utf8')) as SignedResponse;
  const a = JSON.parse(arrival.data) as { actual: string; status: string };
  return [
    { name: 'real_airnode_status', pubkey: await compressedSigner(real), requestHash: real.requestHash, timestamp: BigInt(real.timestamp),
      status: parsed.status, data: real.data, signature: real.signature },
    { name: 'real_airnode_arrival', pubkey: await compressedSigner(arrival), requestHash: arrival.requestHash, timestamp: BigInt(arrival.timestamp),
      status: a.status, actual: a.actual, data: arrival.data, signature: arrival.signature },
    await sign('test_arrived_200', 'Arrived', '2026-10-31 00:45Z'),
    await sign('test_arrived_130', 'Arrived', '2026-10-30 23:35Z'),
    await sign('test_arrived_30', 'Arrived', '2026-10-30 21:55Z'),
    await sign('test_canceled', 'Canceled'),
    // Signed at 22:40Z but reporting a landing at 00:45Z: observed too early to prove it.
    await sign('test_arrived_early', 'Arrived', '2026-10-31 00:45Z', 1793400000n),
  ];
};

const bytes = (h: string) => `#"${h.replace(/^0x/, '')}"`;
const text = (s: string) => `"${s}"`;

export interface FinalAnswer { flight: string; scheduled: string; v: Vector }

/** The newest final (Arrived / Canceled) answer the real Airnode signed, if the keeper has bought one yet. */
export const realFinal = async (dir = new URL('../evidence/', import.meta.url)): Promise<FinalAnswer | undefined> => {
  const finals = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const r = JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as SignedResponse & { flight?: string };
    const d = JSON.parse(r.data) as { scheduled: string; status: string; actual?: string };
    if (payoutOf(d.status, d.scheduled, d.actual) === 'not-final') continue;
    const pubkey = await compressedSigner(r);
    if (pubkey !== AERODATABOX_AIRNODE_PUBKEY) continue;
    finals.push({ flight: r.flight ?? '?', scheduled: d.scheduled, v: { name: 'real_final', pubkey, requestHash: r.requestHash,
      timestamp: BigInt(r.timestamp), status: d.status, actual: d.actual, data: r.data, signature: r.signature } });
  }
  return finals.sort((a, b) => Number(b.v.timestamp - a.v.timestamp))[0];
};

/** A self-contained Aiken test module: a cover settled by this final answer, by the contract's rule. */
export const finalTestModule = ({ flight, scheduled, v }: FinalAnswer, origin: string) => {
  const payout = payoutOf(v.status, scheduled, v.actual);
  const ok = payout === 'full' ? 'pay(holder, cover)' : payout === 'half' ? 'pay(holder, cover / 2), pay(insurer, cover / 2)' : 'pay(insurer, cover)';
  const wrong = payout === 'none' ? 'pay(holder, cover)' : 'pay(insurer, cover)';
  const actual = v.actual === undefined ? 'None' : `Some(${text(v.actual)})`;
  return `//// Generated by \`npm run vectors\` from ${origin}. Do not edit.
//// ${flight}: the real AeroDataBox Airnode signed "${v.data.replace(/"/g, "'")}" → payout ${payout}.

use aeroguard/cover.{Policy, Settle, settles}
use aeroguard/proof
use cardano/address.{from_verification_key}
use cardano/assets.{from_lovelace}
use aiken/interval.{Finite, Interval, IntervalBound}
use cardano/transaction.{InlineDatum, Output, OutputReference, Transaction, placeholder}

const airnode: ByteArray = ${bytes(v.pubkey)}

const request: ByteArray = ${bytes(v.requestHash)}

const holder: ByteArray = #"00000000000000000000000000000000000000000000000000000001"

const insurer: ByteArray = #"00000000000000000000000000000000000000000000000000000002"

const cover: Int = 10_000_000

const own: OutputReference =
  OutputReference {
    transaction_id: #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    output_index: 0,
  }

fn policy() -> Policy {
  Policy {
    holder,
    insurer,
    airnode,
    arrival_request: request,
    status_request: request,
    scheduled: ${text(scheduled)},
    cover,
    deadline: 1_800_000_000_000,
    max_age: 3_600_000,
  }
}

fn settle() {
  Settle(${v.timestamp}, ${text(v.status)}, ${actual}, ${bytes(v.signature.slice(0, 2 + 128))})
}

fn pay(to: ByteArray, amount: Int) -> Output {
  Output {
    address: from_verification_key(to),
    value: from_lovelace(amount),
    datum: InlineDatum(own),
    reference_script: None,
  }
}

fn tx(outputs: List<Output>) -> Transaction {
  Transaction {
    ..placeholder,
    outputs: outputs,
    validity_range: Interval {
      lower_bound: IntervalBound { bound_type: Finite(${v.timestamp * 1000n}), is_inclusive: True },
      upper_bound: IntervalBound { bound_type: Finite(${v.timestamp * 1000n + 600_000n}), is_inclusive: True },
    },
  }
}

test real_final_signature_verifies() {
  proof.verify(
    airnode,
    request,
    ${v.timestamp},
    proof.projected_data(${text(scheduled)}, ${text(v.status)}, ${actual}),
    ${bytes(v.signature.slice(0, 2 + 128))},
  )
}

test real_final_settles_by_the_rule() {
  settles(policy(), settle(), own, tx([${ok}]))
}

test real_final_wrong_payout_fails() fail {
  settles(policy(), settle(), own, tx([${wrong}]))
}
`;
};

if (import.meta.filename === process.argv[1]) {
  const vs = await testVectors();
  const out = [
    '//// Generated by `npm run vectors` (cardano/src/vectors.ts). Do not edit.',
    '//// real_airnode_*: the AeroDataBox Airnode on AirnodeHub (live answers for IB1314). test_*: Anvil account #0, a public test key.',
    '',
    `pub const scheduled: ByteArray = ${text(SCHEDULED)}`,
    '',
    ...vs.flatMap((v) => [
      `pub const ${v.name}_pubkey: ByteArray = ${bytes(v.pubkey)}`,
      `pub const ${v.name}_request: ByteArray = ${bytes(v.requestHash)}`,
      `pub const ${v.name}_timestamp: Int = ${v.timestamp}`,
      `pub const ${v.name}_status: ByteArray = ${text(v.status)}`,
      ...(v.actual ? [`pub const ${v.name}_actual: ByteArray = ${text(v.actual)}`] : []),
      // r‖s only: Plutus takes 64 bytes; v is only needed for recovery, which Plutus does not have.
      `pub const ${v.name}_signature: ByteArray = ${bytes(v.signature.slice(0, 2 + 128))}`,
      '',
    ]),
  ].join('\n');
  writeFileSync(new URL('../onchain/lib/aeroguard/vectors.ak', import.meta.url), out);
  console.log(`wrote ${vs.length} vectors`);
  const final = await realFinal();
  if (final) {
    writeFileSync(new URL('../onchain/lib/aeroguard/real_final_test.ak', import.meta.url), finalTestModule(final, 'cardano/evidence'));
    console.log(`wrote real_final_test.ak: ${final.flight} ${final.v.status} (${payoutOf(final.v.status, final.scheduled, final.v.actual)})`);
  } else console.log('no final Airnode answer yet; real_final_test.ak not written');
}
