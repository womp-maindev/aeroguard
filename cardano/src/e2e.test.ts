// Full x402 round trip without the network: the buyer signs a real Cardano transaction with the reference SDK signer,
// the server's facilitator verifies and submits it. Only Blockfrost is a local fixture (as in cardano-foundation/x402-cardano-demo).
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';
import express from 'express';
import { decodeCardanoTransaction } from '@x402/cardano';
import { decodePaymentRequiredHeader } from '@x402/core/http';
import { decodePaymentResponseHeader } from '@x402/fetch';
import { NETWORK, payingFetch, walletFor } from './cardano.ts';
import { createApp, localFacilitator } from './server.ts';

// Public test phrases, fictional funds.
const BUYER = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const SELLER = 'test test test test test test test test test test test junk';

const listen = async (app: express.Express, t: TestContext) => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

const protocol = {
  min_fee_a: 44, min_fee_b: 155381, pool_deposit: '500000000', key_deposit: '2000000', max_tx_size: 16384,
  max_val_size: '5000', max_block_size: 90112, coins_per_utxo_size: '4310', collateral_percent: 150, max_collateral_inputs: 3,
};

const fakeBlockfrost = async (t: TestContext, payer: string) => {
  const fundingHash = 'b'.repeat(64);
  const state = { spent: false, txHash: '', submits: 0, unhandled: [] as string[] };
  const amount = [{ unit: 'lovelace', quantity: '100000000' }];
  const output = () => ({ address: payer, output_index: 0, amount, data_hash: null, inline_datum: null,
    reference_script_hash: null, collateral: false, consumed_by_tx: state.spent ? state.txHash : null });
  const bf = express();
  bf.get('/epochs/latest/parameters', (_q, r) => { r.json(protocol); });
  bf.get(`/addresses/${payer}/utxos`, (_q, r) => { r.json(state.spent ? [] : [{ ...output(), tx_hash: fundingHash, tx_index: 0, block: 'c'.repeat(64) }]); });
  bf.get(`/txs/${fundingHash}/utxos`, (_q, r) => { r.json({ hash: fundingHash, inputs: [], outputs: [output()] }); });
  bf.get('/txs/:hash', (q, r) => {
    if (q.params.hash !== state.txHash) { r.status(404).json({ status_code: 404, error: 'Not Found', message: 'Transaction not found' }); return; }
    r.json({ hash: state.txHash, block_height: 100, valid_contract: true });
  });
  bf.get('/blocks/latest', (_q, r) => { r.json({ height: 101 }); });
  bf.post('/utils/txs/evaluate/utxos', express.json(), (_q, r) => { r.json({ result: { EvaluationResult: {} } }); });
  bf.post('/tx/submit', express.raw({ type: '*/*' }), (q, r) => {
    state.submits++;
    state.txHash = decodeCardanoTransaction(Buffer.from(q.body).toString('base64')).txHash;
    state.spent = true;
    r.json(state.txHash);
  });
  bf.use((q, r) => { state.unhandled.push(`${q.method} ${q.path}`); r.status(501).json({ error: 'unhandled' }); });
  return { state, provider: { baseUrl: await listen(bf, t), projectId: 'offline-fixture' } };
};

test('unpaid request gets a 402 tADA offer; unknown flights are refused for free', async (t) => {
  const payTo = walletFor(SELLER).getAddress();
  const { provider } = await fakeBlockfrost(t, walletFor(BUYER).getAddress());
  const origin = await listen(await createApp({ facilitator: localFacilitator(provider, 50), payTo }), t);

  const offer = await fetch(`${origin}/verdict?flight=IB1314&date=2026-10-30`);
  assert.equal(offer.status, 402);
  const required = decodePaymentRequiredHeader(offer.headers.get('PAYMENT-REQUIRED')!);
  const accept = required.accepts[0]!;
  assert.equal(accept.network, NETWORK);
  assert.equal(accept.payTo, payTo);
  assert.equal(accept.amount, '2000000');
  assert.equal(accept.asset, 'lovelace');

  assert.equal((await fetch(`${origin}/verdict?flight=XX999&date=2026-10-30`)).status, 404);
  assert.equal((await fetch(`${origin}/verdict?flight=IB1314`)).status, 400);
});

test('an agent pays 2 tADA and receives the Airnode-signed verdict', async (t) => {
  const buyer = walletFor(BUYER);
  const { state, provider } = await fakeBlockfrost(t, buyer.getAddress());
  const payTo = walletFor(SELLER).getAddress();
  const origin = await listen(await createApp({ facilitator: localFacilitator(provider, 50), payTo }), t);

  const res = await payingFetch(walletFor(BUYER, provider))(`${origin}/verdict?flight=IB1314&date=2026-10-30`);
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify({ body, unhandled: state.unhandled }));

  const receipt = decodePaymentResponseHeader(res.headers.get('PAYMENT-RESPONSE')!);
  assert.equal(receipt.success, true);
  assert.equal(receipt.transaction, state.txHash);
  assert.equal(state.submits, 1);
  assert.equal(body.paidWith.txHash, state.txHash);

  assert.equal(body.verdict.status, 'Expected');
  assert.equal(body.verify.signerRecovered, '0x83FE2E8F24E66520B1902C3507De4F471248f2Ec');
  assert.equal(body.evidence.requestHash, '0x782dcb07ea17581332987058650693af56cf1150a2734228ac3dc8347840c54c');
});
