// tADA buys a FlightDelayCover policy on Base: priced from the contract quote, bought only after the Cardano payment
// settles, linked both ways through cardanoJobRef = keccak256("cardano:<tx>"). The Base side is a recording stand-in here;
// the live desk is the keeper's own cover() (tested in keeper/ and the anvil rehearsal).
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { decodePaymentRequiredHeader } from '@x402/core/http';
import { keccak256, toHex } from 'viem';
import { orderRef } from '../../keeper/src/chain.ts';
import { payingFetch, walletFor } from './cardano.ts';
import { BUYER, fakeBlockfrost, listen, PINNED_EVIDENCE, SELLER } from './fixture.test-util.ts';
import { OrdersLog } from './payments.ts';
import { buyPolicy } from './buy-policy.ts';
import { createApp, localFacilitator, orderIdFor, orderRefFor, type PolicyDesk, policyLovelace } from './server.ts';

const HOLDER = '0x000000000000000000000000000000000000bEEF';
const url = (origin: string, extra = '') => `${origin}/policy?flight=LH1234&date=2026-10-31&holder=${HOLDER}&coverage=500000${extra}`;

const setup = async (t: TestContext, fail = false, settleFails = false, extra: { dirs?: string[]; orders?: OrdersLog; premiumBps?: () => bigint; onSettle?: () => void } = {}) => {
  const bought: Parameters<PolicyDesk['buy']>[0][] = [];
  const desk: PolicyDesk = {
    premium: async (c) => (c * (extra.premiumBps?.() ?? 800n)) / 10_000n, // FlightDelayCover premiumBps = 800
    buy: async (a) => {
      bought.push(a);
      if (fail) throw new Error('LH1234 is Departed; cover can only be bought before departure');
      return { policyId: 7n, txHash: '0xbase', explorer: 'https://sepolia.basescan.org/tx/0xbase' };
    },
    lovelacePerUnit: 50n,
    maxCoverage: 2_000_000n,
  };
  const { provider, state } = await fakeBlockfrost(t, [walletFor(BUYER).getAddress()]);
  const orders = extra.orders ?? new OrdersLog();
  const real = localFacilitator(provider, 50);
  const facilitator = settleFails
    ? { ...real, settle: async (p: never, r: never) => ({ ...(await real.verify(p, r)), success: false, errorReason: 'settlement_failed', transaction: '', network: 'cardano:preprod' }) as never }
    : { ...real, settle: async (p: never, r: never) => { extra.onSettle?.(); return real.settle(p, r); } };
  const origin = await listen(await createApp({ facilitator, payTo: walletFor(SELLER).getAddress(),
    evidenceDirs: extra.dirs ?? PINNED_EVIDENCE, desk, orders }), t);
  return { origin, state, bought, orders, provider, pay: payingFetch(walletFor(BUYER, provider)) };
};
const settled = async (origin: string, tx: string) => {
  for (let i = 0; i < 50; i++) {
    const o = await (await fetch(`${origin}/orders/${tx}`)).json();
    if (o.status !== 'buying') return o;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('order never left buying');
};

test('the order id is the one the keeper hashes into cardanoJobRef', () => {
  const tx = 'ab'.repeat(32);
  assert.equal(orderRefFor(tx), orderRef(orderIdFor(tx)));
  assert.equal(orderRefFor(tx), keccak256(toHex(`cardano:${tx}`)));
  assert.equal(policyLovelace(40_000n, 50n), 2_000_000n);
  assert.equal(policyLovelace(1n, 50n), 1_000_000n); // never below a valid Cardano output
});

test('the 402 prices the policy from the contract quote, in tADA', async (t) => {
  const { origin } = await setup(t);
  const offer = await fetch(url(origin));
  assert.equal(offer.status, 402);
  const [ada] = decodePaymentRequiredHeader(offer.headers.get('PAYMENT-REQUIRED')!).accepts;
  // 0.5 aUSD cover × 8 % = 0.04 aUSD = 40000 units × 50 lovelace = 2 tADA
  assert.equal(ada!.amount, '2000000');
  assert.equal(ada!.asset, 'lovelace');
});

test('bad holder, coverage or extra parameters are refused for free', async (t) => {
  const { origin, state } = await setup(t);
  for (const bad of [
    `${origin}/policy?flight=LH1234&date=2026-10-31&holder=0x123&coverage=500000`,
    `${origin}/policy?flight=LH1234&date=2026-10-31&holder=${HOLDER}&coverage=0`,
    `${origin}/policy?flight=LH1234&date=2026-10-31&holder=${HOLDER}&coverage=2000001`,
    url(origin, '&x=1'),
  ]) assert.equal((await fetch(bad)).status, 400, bad);
  assert.equal(state.submitted.length, 0);
});

test('paying in tADA buys the policy on Base after settlement, linked by cardanoJobRef', async (t) => {
  const { origin, state, bought, pay } = await setup(t);
  const res = await pay(url(origin));
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  const tx = state.submitted[0]!.hash;
  assert.equal(body.order, tx);
  assert.equal(body.orderRef, orderRefFor(tx));
  const order = await settled(origin, tx);
  assert.equal(order.status, 'bought');
  assert.equal(order.policyId, '7');
  assert.equal(order.premium, '40000');
  assert.deepEqual(bought, [{ flight: 'LH1234', date: '2026-10-31', holder: HOLDER.toLowerCase(), coverage: 500000n, orderId: `cardano:${tx}` }]);
});

test('a failed Base purchase is recorded as a refund due', async (t) => {
  const { origin, state, pay } = await setup(t, true);
  assert.equal((await pay(url(origin))).status, 200);
  const order = await settled(origin, state.submitted[0]!.hash);
  assert.equal(order.status, 'failed');
  assert.equal(order.refundDue, true);
  assert.match(order.error, /before departure/);
});

test('replaying the payment never buys a second policy', async (t) => {
  const { origin, state, bought, provider } = await setup(t);
  let signature = '';
  const recording: typeof fetch = async (input, init) => {
    const h = new Request(input, init).headers.get('PAYMENT-SIGNATURE');
    if (h) signature = h;
    return fetch(input, init);
  };
  const first = await payingFetch(walletFor(BUYER, provider), recording)(url(origin));
  assert.equal(first.status, 200);
  const body = await first.json();
  await settled(origin, state.submitted[0]!.hash);
  const again = await fetch(url(origin), { headers: { 'PAYMENT-SIGNATURE': signature } });
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), body);
  assert.notEqual((await fetch(url(origin, '&requestId=second'), { headers: { 'PAYMENT-SIGNATURE': signature } })).status, 200);
  assert.equal(bought.length, 1);
  assert.equal(state.submitted.length, 1);
});

test('no policy is bought when the Cardano payment does not settle', async (t) => {
  const { origin, bought, pay } = await setup(t, false, true);
  const res = await pay(url(origin));
  assert.notEqual(res.status, 200);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(bought.length, 0);
});

test('npm run buy-policy: pay, then follow the order until the Base policy exists', async (t) => {
  const { origin, pay } = await setup(t);
  const { order } = await buyPolicy({ server: origin, flight: 'LH1234', date: '2026-10-31', holder: HOLDER, coverage: '500000', pay, pollMs: 10, log: () => {} });
  assert.equal(order.status, 'bought');
  assert.equal(order.explorer, 'https://sepolia.basescan.org/tx/0xbase');
});

test('flights in the past or already past the gate are refused before payment', async (t) => {
  const { origin } = await setup(t, false, false, { dirs: [new URL('../evidence/', import.meta.url).pathname] });
  assert.equal((await fetch(`${origin}/policy?flight=LH1234&date=2020-01-01&holder=${HOLDER}&coverage=500000`)).status, 409);
  // The keeper's latest signed answer for IB1314 is past the gate (en route / approaching / landed).
  const res = await fetch(`${origin}/policy?flight=IB1314&date=2026-10-30&holder=${HOLDER}&coverage=500000`);
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /only before departure/);
});

test('if the contract quote rose after the 402, nothing is bought and a refund is due', async (t) => {
  let bps = 800n;
  // The quote moves while the payment is being settled, after the buyer accepted the offer.
  const { origin, state, bought, pay } = await setup(t, false, false, { premiumBps: () => bps, onSettle: () => { bps = 900n; } });
  assert.equal((await pay(url(origin))).status, 200);
  const order = await settled(origin, state.submitted[0]!.hash);
  assert.equal(order.status, 'failed');
  assert.equal(order.refundDue, true);
  assert.match(order.error, /quote moved/);
  assert.equal(bought.length, 0);
});

test('an order left buying by a restart is flagged for a manual check', async (t) => {
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(`${tmpdir()}/aeroguard-orders-`);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(`${dir}/orders.jsonl`, JSON.stringify({ tx: 'c'.repeat(64), orderRef: '0xabc', status: 'buying' }) + '\n');
  const { origin } = await setup(t, false, false, { orders: new OrdersLog(`${dir}/orders.jsonl`) });
  const order = await (await fetch(`${origin}/orders/${'c'.repeat(64)}`)).json();
  assert.equal(order.status, 'failed');
  assert.equal(order.refundDue, true);
  assert.match(order.error, /cardanoJobRef 0xabc/);
});
