// The Aiken flight cover on preprod. The insurer (SELLER wallet) opens a cover; anyone settles it with the verdict an
// agent bought over x402; the insurer reclaims it after the deadline. Opened covers are logged in evidence/covers.jsonl.
//
//   npm run cover -- open    --flight IB1314 --date 2026-10-30 --holder addr_test1... [--ada 5] [--hours 48]
//   npm run cover -- settle  --open <txHash> --verdict verdict.json     (the JSON body GET /verdict returned)
//   npm run cover -- reclaim --open <txHash>
//   npm run cover -- list
import { fileURLToPath } from 'node:url';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { Address, Client, preprod } from '@evolution-sdk/evolution';
import type { Hex } from 'viem';
import { requestHashFor } from '../../keeper/src/flight.ts';
import { blockfrost, env, txLink } from './cardano.ts';
import { coverAddress, coverUtxo, keyHashOf, openCover, type Outcome, type Policy, reclaimCover, settleCover } from './cover.ts';
import { AERODATABOX_AIRNODE_PUBKEY, payoutOf } from './onchain.ts';
import { findEvidence } from './verdict.ts';

const LOG = process.env.COVERS_LOG || fileURLToPath(new URL('../evidence/covers.jsonl', import.meta.url));
const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));

interface Opened { openTx: string; flight: string; date: string; policy: Record<keyof Policy, string> }
const opened = (): Opened[] => (existsSync(LOG) ? readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const policyOf = (o: Opened): Policy =>
  ({ ...o.policy, cover: BigInt(o.policy.cover), deadline: BigInt(o.policy.deadline), maxAge: BigInt(o.policy.maxAge) } as Policy);

/** A verdict body from GET /verdict, turned into the redeemer fields and the payout it implies. */
export const proofFromVerdict = (body: { evidence: { timestamp: string; data: string; signature: Hex } }) => {
  const d = JSON.parse(body.evidence.data) as { scheduled: string; status: string; actual?: string };
  return {
    scheduled: d.scheduled,
    outcome: payoutOf(d.status, d.scheduled, d.actual),
    proof: { timestamp: BigInt(body.evidence.timestamp), status: d.status, actual: d.actual, signature: body.evidence.signature },
  };
};

// A half payout splits the cover into two outputs, each of which must stay above the ~1 ADA minimum UTxO.
export const MIN_COVER_LOVELACE = 3_000_000n;

export const policyFor = (o: { flight: string; date: string; scheduled: string; holder: string; insurer: string; lovelace: bigint; deadline: bigint;
  maxAge?: bigint }): Policy => ({
  holder: keyHashOf(o.holder), insurer: keyHashOf(o.insurer), airnode: AERODATABOX_AIRNODE_PUBKEY,
  arrivalRequest: requestHashFor(o.flight, o.date, 'arrival'), statusRequest: requestHashFor(o.flight, o.date, 'status'),
  scheduled: o.scheduled, cover: o.lovelace, deadline: o.deadline, maxAge: o.maxAge ?? 3_600_000n,
});

if (import.meta.filename === process.argv[1]) {
  const [command] = process.argv.slice(2);
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: {
      flight: { type: 'string' }, date: { type: 'string' }, holder: { type: 'string' }, scheduled: { type: 'string' },
      ada: { type: 'string', default: '5' }, hours: { type: 'string', default: '48' }, 'max-age-min': { type: 'string', default: '60' },
      open: { type: 'string' }, verdict: { type: 'string' },
    },
  });
  const client = (mnemonic: string) => Client.make(preprod).withBlockfrost(blockfrost()).withSeed({ mnemonic });
  const find = (tx?: string) => opened().find((o) => o.openTx === tx) ?? (() => { throw new Error(`No cover opened in ${tx}; see: npm run cover -- list`); })();

  if (command === 'open') {
    const insurer = client(env('SELLER_MNEMONIC'));
    const flight = values.flight ?? 'IB1314';
    const date = values.date ?? '2026-10-30';
    // The scheduled arrival must be exactly what the Airnode signs; take it from evidence unless given.
    const scheduled = values.scheduled ?? (JSON.parse(findEvidence(flight, date)?.response.data ?? '{}') as { scheduled?: string }).scheduled;
    if (!scheduled || !values.holder) throw new Error('Need --holder and --scheduled (or signed evidence for the flight)');
    const policy = policyFor({ flight, date, scheduled, holder: values.holder, insurer: Address.toBech32(await insurer.address()),
      lovelace: BigInt(Math.round(Number(values.ada) * 1e6)), deadline: BigInt(Date.now() + Number(values.hours) * 3_600_000),
      maxAge: BigInt(Number(values['max-age-min']) * 60_000) });
    if (policy.cover < MIN_COVER_LOVELACE) throw new Error(`--ada must be at least ${Number(MIN_COVER_LOVELACE) / 1e6}: a half payout splits it in two outputs`);
    const openTx = await openCover(insurer, policy);
    appendFileSync(LOG, json({ openTx, flight, date, policy }) + '\n');
    console.log(`cover opened at ${Address.toBech32(coverAddress())}\n${txLink(openTx)}`);
  } else if (command === 'settle') {
    const o = find(values.open);
    const policy = policyOf(o);
    const { scheduled, outcome, proof } = proofFromVerdict(JSON.parse(readFileSync(values.verdict!, 'utf8')));
    if (scheduled !== policy.scheduled) throw new Error(`Verdict is for ${scheduled}, cover for ${policy.scheduled}`);
    if (outcome === 'not-final') throw new Error('The verdict is not final yet (no arrival or cancellation); buy a later one');
    const tx = await settleCover(client(env('BUYER_MNEMONIC')), coverUtxo(o.openTx, policy), policy, proof, outcome as Outcome);
    console.log(`settled (${outcome})\n${txLink(tx)}`);
  } else if (command === 'reclaim') {
    const o = find(values.open);
    const policy = policyOf(o);
    const tx = await reclaimCover(client(env('SELLER_MNEMONIC')), coverUtxo(o.openTx, policy), policy);
    console.log(`reclaimed\n${txLink(tx)}`);
  } else {
    for (const o of opened()) console.log(`${o.openTx}  ${o.flight} ${o.date}  ${Number(o.policy.cover) / 1e6} tADA  deadline ${new Date(Number(o.policy.deadline)).toISOString()}`);
  }
}
