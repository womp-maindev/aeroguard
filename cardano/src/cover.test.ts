// The Aiken flight cover end to end: real transactions, real Plutus execution (Aiken's UPLC evaluator), only the chain
// is a local Blockfrost fixture. Final outcomes are signed by a public test key; the live Airnode proof is pre-departure.
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { Client, preprod } from '@evolution-sdk/evolution';
import type { Hex } from 'viem';
import { walletFor } from './cardano.ts';
import { blueprintHash, coverHash, coverUtxo, keyHashOf, openCover, type Outcome, type Policy, reclaimCover, settleCover } from './cover.ts';
import { BUYER, fakeBlockfrost, SELLER } from './fixture.test-util.ts';
import { testVectors, type Vector } from './vectors.ts';

const vectors = Object.fromEntries((await testVectors()).map((v) => [v.name, v])) as Record<string, Vector>;
// Rejections must come from executing the validator, not from building or the fixture.
const SCRIPT_FAILED = { message: /Script evaluation failed/ };
const proofOf = (v: Vector) => ({ timestamp: v.timestamp, status: v.status, actual: v.actual, signature: v.signature as Hex });

const setup = async (t: TestContext, airnode = vectors.test_canceled!.pubkey, deadline = 1_800_000_000_000n) => {
  const insurerAddr = walletFor(SELLER).getAddress();
  const holderAddr = walletFor(BUYER).getAddress();
  const chain = await fakeBlockfrost(t, [insurerAddr, holderAddr]);
  const client = (mnemonic: string) => Client.make(preprod).withBlockfrost(chain.provider).withSeed({ mnemonic });
  const policy: Policy = {
    holder: keyHashOf(holderAddr), insurer: keyHashOf(insurerAddr), airnode: airnode as Hex,
    arrivalRequest: vectors.test_arrived_200!.requestHash as Hex, statusRequest: vectors.test_canceled!.requestHash as Hex,
    scheduled: '2026-10-30 21:25Z', cover: 10_000_000n, deadline, maxAge: 3_600_000n,
  };
  const insurer = client(SELLER);
  const holder = client(BUYER);
  const openTx = await openCover(insurer, policy);
  return { ...chain, policy, insurer, holder, utxo: coverUtxo(openTx, policy) };
};

const settle = async (t: TestContext, v: Vector, outcome: Outcome, edit: Partial<ReturnType<typeof proofOf>> = {}, airnode?: string) => {
  const c = await setup(t, airnode ?? v.pubkey);
  const tx = await settleCover(c.holder, c.utxo, c.policy, { ...proofOf(v), ...edit }, outcome);
  return { ...c, tx };
};

test('the off-chain script is the compiled Aiken validator', () => {
  assert.equal(coverHash, blueprintHash);
  assert.equal(coverHash, '107d68180f4399c12060b76c4869e9790aeffc9957c7ef44fb2447c7');
});

test('a 200 min delay pays the holder in full', async (t) => {
  const { tx, state } = await settle(t, vectors.test_arrived_200!, 'full');
  assert.equal(state.submitted.length, 2);
  assert.equal(state.submitted[1]!.hash, tx);
});

test('a cancellation pays the holder in full', async (t) => {
  const { state } = await settle(t, vectors.test_canceled!, 'full');
  assert.equal(state.submitted.length, 2);
});

test('a 130 min delay splits the cover', async (t) => {
  const { state } = await settle(t, vectors.test_arrived_130!, 'half');
  assert.equal(state.submitted.length, 2);
});

test('a 30 min delay returns the cover to the insurer', async (t) => {
  const { state } = await settle(t, vectors.test_arrived_30!, 'none');
  assert.equal(state.submitted.length, 2);
});

test('the script rejects a holder payout on a 30 min delay', async (t) => {
  await assert.rejects(settle(t, vectors.test_arrived_30!, 'full'), SCRIPT_FAILED);
});

test('the script rejects an edited arrival time', async (t) => {
  await assert.rejects(settle(t, vectors.test_arrived_30!, 'full', { actual: vectors.test_arrived_200!.actual }), SCRIPT_FAILED);
});

test('the script rejects a proof signed by another key', async (t) => {
  await assert.rejects(settle(t, vectors.test_arrived_200!, 'full', {}, vectors.real_airnode_status!.pubkey), SCRIPT_FAILED);
});

test('the live Airnode pre-departure proof verifies but cannot settle (not final)', async (t) => {
  const real = vectors.real_airnode_status!;
  const c = await setup(t, real.pubkey);
  const policy = { ...c.policy, statusRequest: real.requestHash as Hex };
  const openTx = await openCover(c.insurer, policy);
  await assert.rejects(settleCover(c.holder, coverUtxo(openTx, policy), policy, proofOf(real), 'full'), SCRIPT_FAILED);
});

test('the insurer reclaims an unsettled cover after the deadline', async (t) => {
  const c = await setup(t, vectors.test_canceled!.pubkey, BigInt(Date.now() - 3_600_000));
  const tx = await reclaimCover(c.insurer, c.utxo, c.policy);
  assert.equal(c.state.submitted.at(-1)!.hash, tx);
});

test('the insurer cannot reclaim before the deadline', async (t) => {
  const c = await setup(t, vectors.test_canceled!.pubkey, BigInt(Date.now() + 3_600_000));
  await assert.rejects(reclaimCover(c.insurer, c.utxo, c.policy), /has not passed yet/);
});

// Runs once the keeper has bought a final answer (npm run import-evidence): the real Airnode signature settles a cover.
const finals = await (await import('./vectors.ts')).realFinals();
if (!finals.length) test('a real final Airnode answer settles a cover by the rule', { skip: 'no final Airnode answer in evidence/ yet' }, () => {});
for (const final of finals) test(`the real final Airnode answer for ${final.flight} settles a cover by the rule`, async (t) => {
  const { payoutOf } = await import('./onchain.ts');
  const { v, scheduled } = final;
  const c = await setup(t, v.pubkey);
  const policy = { ...c.policy, arrivalRequest: v.requestHash as Hex, statusRequest: v.requestHash as Hex, scheduled };
  const openTx = await openCover(c.insurer, policy);
  const outcome = payoutOf(v.status, scheduled, v.actual) as Outcome;
  const tx = await settleCover(c.holder, coverUtxo(openTx, policy), policy, proofOf(v), outcome);
  assert.equal(c.state.submitted.at(-1)!.hash, tx);
});
