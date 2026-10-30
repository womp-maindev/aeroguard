// Full x402 round trip without the network: the buyer signs a real Cardano transaction with the reference SDK signer,
// the server's facilitator verifies and submits it. Only Blockfrost is a local fixture.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { decodePaymentRequiredHeader } from '@x402/core/http';
import { decodePaymentResponseHeader } from '@x402/fetch';
import { NETWORK, payingFetch, walletFor } from './cardano.ts';
import { BUYER, fakeBlockfrost, listen, SELLER } from './fixture.test-util.ts';
import { SalesLog } from './payments.ts';
import { createApp, localFacilitator, PRICES } from './server.ts';

const VERDICT = '/verdict?flight=IB1314&date=2026-10-30';

const setup = async (t: TestContext, extra: Partial<Parameters<typeof createApp>[0]> = {}) => {
  const buyer = walletFor(BUYER).getAddress();
  const payTo = walletFor(SELLER).getAddress();
  const chain = await fakeBlockfrost(t, [buyer]);
  const dir = mkdtempSync(join(tmpdir(), 'aeroguard-sales-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sales = new SalesLog(join(dir, 'sales.jsonl'));
  const origin = await listen(await createApp({ facilitator: localFacilitator(chain.provider, 50), payTo, sales, ...extra }), t);
  return { ...chain, origin, payTo, sales, pay: payingFetch(walletFor(BUYER, chain.provider)) };
};

test('unpaid request gets a 402 offer in tADA and tUSDM, priced by evidence kind', async (t) => {
  const { origin, payTo } = await setup(t);
  const offer = await fetch(origin + VERDICT);
  assert.equal(offer.status, 402);
  const [ada, usdm] = decodePaymentRequiredHeader(offer.headers.get('PAYMENT-REQUIRED')!).accepts;
  assert.equal(ada!.network, NETWORK);
  assert.equal(ada!.payTo, payTo);
  assert.equal(ada!.asset, 'lovelace');
  // IB1314 only has a pre-departure status proof, so it sells at the status price.
  assert.equal(ada!.amount, PRICES.status.lovelace);
  assert.equal(usdm!.amount, PRICES.status.usdm);
  assert.match(usdm!.asset, /^[0-9a-f]{56}\.0014df10/);
});

test('bad or unknown requests are refused before any payment', async (t) => {
  const { origin } = await setup(t);
  assert.equal((await fetch(`${origin}/verdict?flight=XX999&date=2026-10-30`)).status, 404);
  assert.equal((await fetch(`${origin}/verdict?flight=IB1314`)).status, 400);
  assert.equal((await fetch(`${origin}${VERDICT}&extra=1`)).status, 400);
  assert.equal((await fetch(`${origin}${VERDICT}&requestId=bad id`)).status, 400);
});

test('discovery endpoints are free', async (t) => {
  const { origin } = await setup(t);
  const flights = await (await fetch(`${origin}/flights`)).json();
  assert.deepEqual(flights.map((f: { flight: string; kind: string }) => [f.flight, f.kind]), [['IB1314', 'status']]);
  const wk = await (await fetch(`${origin}/.well-known/x402`)).json();
  assert.equal(wk.resources[0].path, '/verdict');
  assert.equal(wk.resources[0].network, NETWORK);
});

test('an agent pays 1 tADA and receives the Airnode-signed verdict; the sale is logged', async (t) => {
  const { origin, state, sales, pay } = await setup(t);
  const res = await pay(origin + VERDICT);
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify({ body, unhandled: state.unhandled }));

  const receipt = decodePaymentResponseHeader(res.headers.get('PAYMENT-RESPONSE')!);
  assert.equal(receipt.success, true);
  assert.equal(state.submitted.length, 1);
  assert.equal(receipt.transaction, state.submitted[0]!.hash);
  assert.equal(body.paidWith.txHash, receipt.transaction);
  assert.equal(body.paidWith.amount, PRICES.status.lovelace);

  assert.equal(body.verdict.status, 'Expected');
  assert.equal(body.verify.signerRecovered, '0x83FE2E8F24E66520B1902C3507De4F471248f2Ec');
  assert.equal(body.evidence.requestHash, '0x782dcb07ea17581332987058650693af56cf1150a2734228ac3dc8347840c54c');

  const [sale] = sales.all();
  assert.equal(sale?.tx, receipt.transaction);
  assert.equal(sale?.flight, 'IB1314');
  assert.equal(sale?.kind, 'status');
  const listed = await (await fetch(`${origin}/sales`)).json();
  assert.match(listed[0].explorer, /^https:\/\/preprod\.cardanoscan\.io\/transaction\/[0-9a-f]{64}$/);
});

test('every verdict is paid separately: no free answers after a sale', async (t) => {
  const { origin, state, pay, sales } = await setup(t);
  assert.equal((await pay(origin + VERDICT)).status, 200);
  // Paying once does not unlock the resource for anyone else.
  assert.equal((await fetch(origin + VERDICT)).status, 402);
  // A second operation needs a second payment from a fresh UTxO.
  assert.equal((await pay(`${origin}${VERDICT}&requestId=again`)).status, 200);
  assert.equal(state.submitted.length, 2);
  assert.notEqual(state.submitted[0]!.hash, state.submitted[1]!.hash);
  assert.equal(sales.all().length, 2);
});

test('the sale hook runs after settlement and its result is logged', async (t) => {
  let hooked = '';
  const { origin, sales, pay } = await setup(t, { onSale: async (s) => { hooked = s.tx; return { anchorTx: 'a'.repeat(64) }; } });
  const res = await pay(origin + VERDICT);
  assert.equal(res.status, 200);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(hooked, sales.all()[0]?.tx);
  assert.equal(sales.all()[0]?.anchorTx, 'a'.repeat(64));
});

test('replaying the same signed payment returns the same answer, never a second operation', async (t) => {
  const { origin, state, provider, sales } = await setup(t);
  let signature = '';
  const recording: typeof fetch = async (input, init) => {
    const header = new Request(input, init).headers.get('PAYMENT-SIGNATURE');
    if (header) signature = header;
    return fetch(input, init);
  };
  const res = await payingFetch(walletFor(BUYER, provider), recording)(origin + VERDICT);
  assert.equal(res.status, 200);
  const first = await res.json();
  assert.ok(signature);

  const again = await fetch(origin + VERDICT, { headers: { 'PAYMENT-SIGNATURE': signature } });
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), first);

  const other = await fetch(`${origin}${VERDICT}&requestId=other`, { headers: { 'PAYMENT-SIGNATURE': signature } });
  assert.notEqual(other.status, 200);
  assert.equal(state.submitted.length, 1);
  assert.equal(sales.all().length, 1);
});
