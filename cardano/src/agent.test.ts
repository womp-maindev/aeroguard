import assert from 'node:assert/strict';
import { test } from 'node:test';
import { payingFetch, walletFor } from './cardano.ts';
import { decide, runAgent } from './agent.ts';
import { BUYER, fakeBlockfrost, listen, SELLER } from './fixture.test-util.ts';
import { createApp, localFacilitator, PRICES } from './server.ts';

test('decide mirrors FlightDelayCover thresholds', () => {
  assert.equal(decide({ status: 'Expected', cancelled: false, final: false }), 'wait');
  assert.equal(decide({ status: 'Canceled', cancelled: true, final: true }), 'pay-full');
  assert.equal(decide({ status: 'Arrived', delayMinutes: 180, cancelled: false, final: true }), 'pay-full');
  assert.equal(decide({ status: 'Arrived', delayMinutes: 120, cancelled: false, final: true }), 'pay-half');
  assert.equal(decide({ status: 'Arrived', delayMinutes: 119, cancelled: false, final: true }), 'reject');
});

test('the agent checks the free catalog, respects its budget and pays only for what it needs', async (t) => {
  const { provider, state } = await fakeBlockfrost(t, [walletFor(BUYER).getAddress()]);
  const origin = await listen(await createApp({ facilitator: localFacilitator(provider, 50), payTo: walletFor(SELLER).getAddress() }), t);
  const claims = [{ flight: 'IB1314', date: '2026-10-30' }, { flight: 'LH1816', date: '2026-10-30' }];
  const pay = payingFetch(walletFor(BUYER, provider));
  const quiet = () => {};

  // Only a pre-departure proof exists: nothing is bought.
  const skipped = await runAgent({ server: origin, claims, budgetLovelace: 10_000_000n, pay, log: quiet });
  assert.equal(skipped.spent, 0n);
  assert.equal(state.submitted.length, 0);

  // A budget below the price: nothing is bought.
  const poor = await runAgent({ server: origin, claims, budgetLovelace: 1n, includeStatus: true, pay, log: quiet });
  assert.equal(poor.spent, 0n);

  const { spent, report } = await runAgent({ server: origin, claims, budgetLovelace: 10_000_000n, includeStatus: true, pay, log: quiet });
  assert.equal(spent, BigInt(PRICES.status.lovelace));
  assert.equal(state.submitted.length, 1);
  assert.equal(report[0]!.decision, 'wait');
  assert.equal(report[0]!.tx, state.submitted[0]!.hash);
  assert.match(report[1]!.reason, /no signed evidence/);
});
