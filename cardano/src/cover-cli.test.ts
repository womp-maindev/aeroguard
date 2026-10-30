// From x402 to the Cardano contract: the verdict body an agent buys is exactly what settles the Aiken cover.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Address, Client, preprod } from '@evolution-sdk/evolution';
import type { Hex } from 'viem';
import { requestHashFor } from '../../keeper/src/flight.ts';
import { payingFetch, walletFor } from './cardano.ts';
import { policyFor, proofFromVerdict } from './cover-cli.ts';
import { coverAddress, coverUtxo, openCover, type Outcome, settleCover } from './cover.ts';
import { BUYER, fakeBlockfrost, listen, SELLER } from './fixture.test-util.ts';
import { AERODATABOX_AIRNODE_PUBKEY } from './onchain.ts';
import { buyVerdict } from './buy.ts';
import { createApp, localFacilitator } from './server.ts';
import { testVectors } from './vectors.ts';

test('the cover address is the blueprint script on preprod', () => {
  assert.equal(Address.toBech32(coverAddress()), 'addr_test1wpvdsv4yqqsw08dzf4a5gjz9lunlugkv6jse7k6sjuwl5fchwmjh4');
});

test('a policy for a live flight binds the AeroDataBox Airnode and its exact requests', () => {
  const p = policyFor({ flight: 'IB1314', date: '2026-10-30', scheduled: '2026-10-30 21:25Z', holder: walletFor(BUYER).getAddress(),
    insurer: walletFor(SELLER).getAddress(), lovelace: 5_000_000n, deadline: 1n });
  assert.equal(p.airnode, AERODATABOX_AIRNODE_PUBKEY);
  assert.equal(p.statusRequest, '0x782dcb07ea17581332987058650693af56cf1150a2734228ac3dc8347840c54c');
  assert.equal(p.arrivalRequest, requestHashFor('IB1314', '2026-10-30', 'arrival'));
});

test('a verdict bought over x402 is turned into a proof; the live one is not final yet', async (t) => {
  const { provider } = await fakeBlockfrost(t, [walletFor(BUYER).getAddress()]);
  const origin = await listen(await createApp({ facilitator: localFacilitator(provider, 50), payTo: walletFor(SELLER).getAddress() }), t);
  const { body } = await buyVerdict({ server: origin, flight: 'IB1314', date: '2026-10-30', pay: payingFetch(walletFor(BUYER, provider)) });
  const { scheduled, outcome, proof } = proofFromVerdict(body);
  assert.equal(scheduled, '2026-10-30 21:25Z');
  assert.equal(outcome, 'not-final');
  assert.equal(proof.signature, body.evidence.signature);
});

test('a final verdict body settles the cover through the script', async (t) => {
  const v = (await testVectors()).find((x) => x.name === 'test_arrived_200')!;
  const body = { evidence: { timestamp: String(v.timestamp), data: v.data, signature: v.signature as Hex } };
  const { provider } = await fakeBlockfrost(t, [walletFor(SELLER).getAddress(), walletFor(BUYER).getAddress()]);
  const client = (m: string) => Client.make(preprod).withBlockfrost(provider).withSeed({ mnemonic: m });
  const policy = { ...policyFor({ flight: 'IB1314', date: '2026-10-30', scheduled: '2026-10-30 21:25Z', holder: walletFor(BUYER).getAddress(),
    insurer: walletFor(SELLER).getAddress(), lovelace: 5_000_000n, deadline: 1_800_000_000_000n }), airnode: v.pubkey as Hex };
  const openTx = await openCover(client(SELLER), policy);
  const { outcome, proof } = proofFromVerdict(body);
  assert.equal(outcome, 'full');
  const tx = await settleCover(client(BUYER), coverUtxo(openTx, policy), policy, proof, outcome as Outcome);
  assert.match(tx, /^[0-9a-f]{64}$/);
});
