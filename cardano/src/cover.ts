// Off-chain side of the Aiken flight cover (onchain/validators/flight_cover.ak): open a cover UTxO, settle it with an
// Airnode proof, or reclaim it after the deadline. Script execution is checked locally with Aiken's UPLC evaluator.
import { readFileSync } from 'node:fs';
import { createAikenEvaluator } from '@evolution-sdk/aiken-uplc';
import { Address, Assets, Data, InlineDatum, KeyHash, PlutusV3, ScriptHash, TransactionHash, UTxO } from '@evolution-sdk/evolution';
import type { Hex } from 'viem';
import { toHex } from 'viem';

type SigningClient = ReturnType<ReturnType<ReturnType<typeof import('@evolution-sdk/evolution').Client.make>['withBlockfrost']>['withSeed']>;

const blueprint = JSON.parse(readFileSync(new URL('../onchain/plutus.json', import.meta.url), 'utf8')) as {
  validators: { title: string; compiledCode: string; hash: string }[];
};
const spend = blueprint.validators.find((v) => v.title === 'flight_cover.flight_cover.spend')!;

export const coverScript = new PlutusV3.PlutusV3({ bytes: Buffer.from(spend.compiledCode, 'hex') });
export const coverHash = ScriptHash.toHex(ScriptHash.fromScript(coverScript));
export const blueprintHash = spend.hash;
export const coverAddress = (networkId = 0) => new Address.Address({ networkId, paymentCredential: ScriptHash.fromScript(coverScript) });

export interface Policy {
  holder: string; // payment key hash, hex
  insurer: string;
  airnode: Hex; // 33-byte compressed secp256k1 key
  arrivalRequest: Hex;
  statusRequest: Hex;
  scheduled: string; // "YYYY-MM-DD HH:MMZ"
  cover: bigint; // lovelace
  deadline: bigint; // POSIX ms
}

export interface Proof { timestamp: bigint; status: string; actual?: string; signature: Hex }

const b = (hex: string) => Data.bytearray(hex.replace(/^0x/, ''));
const s = (text: string) => Data.bytearray(toHex(text).slice(2));

export const policyDatum = (p: Policy) => Data.constr(0n, [
  b(p.holder), b(p.insurer), b(p.airnode), b(p.arrivalRequest), b(p.statusRequest), s(p.scheduled), Data.int(p.cover), Data.int(p.deadline),
]);

// r ‖ s only: Plutus verifies 64-byte signatures and has no use for the recovery byte.
export const settleRedeemer = (proof: Proof) => Data.constr(0n, [
  Data.int(proof.timestamp), s(proof.status),
  proof.actual === undefined ? Data.constr(1n, []) : Data.constr(0n, [s(proof.actual)]),
  b(proof.signature.slice(0, 2 + 128)),
]);
export const reclaimRedeemer = Data.constr(1n, []);

// Payouts carry the spent cover's OutputReference, so one output cannot settle two covers (double satisfaction).
export const payoutTag = (utxo: UTxO.UTxO) =>
  new InlineDatum.InlineDatum({ data: Data.constr(0n, [b(TransactionHash.toHex(utxo.transactionId)), Data.int(utxo.index)]) });

export const keyHashOf = (bech32: string) => {
  const credential = Address.fromBech32(bech32).paymentCredential;
  return Buffer.from(credential.hash).toString('hex');
};
// Enterprise address of a key; the validator checks only the payment credential.
export const keyAddress = (keyHash: string, networkId = 0) => new Address.Address({ networkId, paymentCredential: KeyHash.fromHex(keyHash) });

/** The insurer locks the cover amount at the script with the policy as inline datum. */
export const openCover = async (insurer: SigningClient, p: Policy) => {
  const signed = await insurer.newTx()
    .payToAddress({ address: coverAddress(), assets: Assets.fromLovelace(p.cover), datum: new InlineDatum.InlineDatum({ data: policyDatum(p) }) })
    .build();
  return TransactionHash.toHex(await signed.signAndSubmit());
};

/** The cover output of the open transaction, as the next transaction spends it. */
export const coverUtxo = (openTx: string, p: Policy, index = 0n) => new UTxO.UTxO({
  transactionId: TransactionHash.fromHex(openTx), index, address: coverAddress(), assets: Assets.fromLovelace(p.cover),
  datumOption: new InlineDatum.InlineDatum({ data: policyDatum(p) }), scriptRef: undefined,
});

export type Outcome = 'full' | 'half' | 'none';

/** Anyone may settle with a valid final proof; the payout follows FlightDelayCover's rule. */
export const settleCover = async (submitter: SigningClient, utxo: UTxO.UTxO, p: Policy, proof: Proof, outcome: Outcome) => {
  const tag = payoutTag(utxo);
  const holderShare = outcome === 'full' ? p.cover : outcome === 'half' ? p.cover / 2n : 0n;
  let tx = submitter.newTx()
    .collectFrom({ inputs: [utxo], redeemer: settleRedeemer(proof), label: 'settle' })
    .attachScript({ script: coverScript });
  if (holderShare > 0n) tx = tx.payToAddress({ address: keyAddress(p.holder), assets: Assets.fromLovelace(holderShare), datum: tag });
  if (p.cover - holderShare > 0n) tx = tx.payToAddress({ address: keyAddress(p.insurer), assets: Assets.fromLovelace(p.cover - holderShare), datum: tag });
  const signed = await tx.build({ evaluator: createAikenEvaluator });
  return TransactionHash.toHex(await signed.signAndSubmit());
};

/** After the deadline the insurer takes an unsettled cover back. */
export const reclaimCover = async (insurer: SigningClient, utxo: UTxO.UTxO, p: Policy, nowMs = BigInt(Date.now())) => {
  const signed = await insurer.newTx()
    .collectFrom({ inputs: [utxo], redeemer: reclaimRedeemer, label: 'reclaim' })
    .attachScript({ script: coverScript })
    .addSigner({ keyHash: KeyHash.fromHex(p.insurer) })
    .setValidity({ from: nowMs - 60_000n, to: nowMs + 600_000n })
    .build({ evaluator: createAikenEvaluator });
  return TransactionHash.toHex(await signed.signAndSubmit());
};
