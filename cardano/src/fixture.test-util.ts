// A local stand-in for Blockfrost preprod, after cardano-foundation/x402-cardano-demo tests/provider-fixture.ts.
// Real signing, real transactions; only the chain is local. Funds and phrases are fictional.
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { TestContext } from 'node:test';
import express from 'express';
import { Transaction, TransactionHash } from '@evolution-sdk/evolution';
import { decodeCardanoTransaction } from '@x402/cardano';

export const BUYER = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
export const SELLER = 'test test test test test test test test test test test junk';

// Tests sell a fixed evidence set (the live IB1314 pre-departure proof), so new evidence never changes their answers.
export const PINNED_EVIDENCE = [fileURLToPath(new URL('../test-evidence/', import.meta.url))];

export const listen = async (app: express.Express, t: TestContext) => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

const protocol = {
  min_fee_a: 44, min_fee_b: 155381, pool_deposit: '500000000', key_deposit: '2000000', max_tx_size: 16384,
  max_val_size: '5000', max_block_size: 90112, coins_per_utxo_size: '4310', collateral_percent: 150, max_collateral_inputs: 3,
  // Conway values for script transactions; the PlutusV3 cost model is Aiken's default (the ledger's).
  price_mem: '0.0577', price_step: '0.0000721', max_tx_ex_mem: '14000000', max_tx_ex_steps: '10000000000',
  min_fee_ref_script_cost_per_byte: '15',
  cost_models_raw: { PlutusV3: (JSON.parse(readFileSync(new URL('./plutus-v3-cost-model.json', import.meta.url), 'utf8')) as { costs: number[] }).costs },
};

export const fakeBlockfrost = async (t: TestContext, funded: string[]) => {
  // Each funded address owns two UTxOs (one to spend, one left for collateral), keyed by funding tx hash.
  const state = { submitted: [] as { hash: string; bytes: Buffer }[], spent: new Map<string, string>(), unhandled: [] as string[] };
  const fundingHash = (i: number, n: number) => (i + 10).toString(16).repeat(63).slice(0, 63) + String(n);
  const all = funded.flatMap((address, i) => [0, 1].map((n) => ({ address, hash: fundingHash(i, n), lovelace: n === 0 ? '100000000' : '20000000' })));
  const output = (u: (typeof all)[number]) => ({ address: u.address, tx_hash: u.hash, tx_index: 0, output_index: 0,
    amount: [{ unit: 'lovelace', quantity: u.lovelace }], block: 'c'.repeat(64), data_hash: null, inline_datum: null,
    reference_script_hash: null, collateral: false, consumed_by_tx: state.spent.get(u.hash) ?? null });
  const bf = express();
  bf.get('/', (_q, r) => { r.json({ url: 'https://blockfrost.io/', version: 'fixture' }); });
  bf.get('/addresses/:address', (q, r) => {
    const mine = all.filter((u) => u.address === q.params.address && !state.spent.has(u.hash));
    if (!mine.length) { r.status(404).json({ status_code: 404, error: 'Not Found', message: 'not found' }); return; }
    r.json({ address: q.params.address, amount: [{ unit: 'lovelace', quantity: String(mine.reduce((n, u) => n + BigInt(u.lovelace), 0n)) }] });
  });
  bf.get('/epochs/latest/parameters', (_q, r) => { r.json(protocol); });
  bf.get('/addresses/:address/utxos', (q, r) => {
    r.json(all.filter((u) => u.address === q.params.address && !state.spent.has(u.hash)).map(output));
  });
  bf.get('/txs/:hash/utxos', (q, r) => {
    const u = all.find((x) => x.hash === q.params.hash);
    if (!u) { r.status(404).json({ status_code: 404, error: 'Not Found', message: 'not found' }); return; }
    r.json({ hash: q.params.hash, inputs: [], outputs: [output(u)] });
  });
  bf.get('/txs/:hash', (q, r) => {
    if (!state.submitted.some((s) => s.hash === q.params.hash)) { r.status(404).json({ status_code: 404, error: 'Not Found', message: 'Transaction not found' }); return; }
    r.json({ hash: q.params.hash, block_height: 100, valid_contract: true });
  });
  bf.get('/blocks/latest', (_q, r) => { r.json({ height: 101, slot: 100_000_000, time: Math.floor(Date.now() / 1000) }); });
  bf.post('/utils/txs/evaluate/utxos', express.json(), (_q, r) => { r.json({ result: { EvaluationResult: {} } }); });
  bf.post('/tx/submit', express.raw({ type: '*/*' }), (q, r) => {
    const bytes = Buffer.from(q.body);
    const { txHash } = decodeCardanoTransaction(bytes.toString('base64'));
    state.submitted.push({ hash: txHash, bytes });
    // Spend the transaction's inputs; collateral stays unspent because scripts passed.
    for (const input of Transaction.fromCBORBytes(bytes).body.inputs) state.spent.set(TransactionHash.toHex(input.transactionId), txHash);
    r.json(txHash);
  });
  bf.use((q, r) => { state.unhandled.push(`${q.method} ${q.path}`); r.status(404).json({ status_code: 404, error: 'Not Found', message: `unhandled ${q.path}` }); });
  return { state, provider: { baseUrl: await listen(bf, t), projectId: 'offline-fixture' } };
};
