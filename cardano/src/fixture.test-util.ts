// A local stand-in for Blockfrost preprod, after cardano-foundation/x402-cardano-demo tests/provider-fixture.ts.
// Real signing, real transactions; only the chain is local. Funds and phrases are fictional.
import type { AddressInfo } from 'node:net';
import type { TestContext } from 'node:test';
import express from 'express';
import { decodeCardanoTransaction } from '@x402/cardano';

export const BUYER = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
export const SELLER = 'test test test test test test test test test test test junk';

export const listen = async (app: express.Express, t: TestContext) => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

const protocol = {
  min_fee_a: 44, min_fee_b: 155381, pool_deposit: '500000000', key_deposit: '2000000', max_tx_size: 16384,
  max_val_size: '5000', max_block_size: 90112, coins_per_utxo_size: '4310', collateral_percent: 150, max_collateral_inputs: 3,
};

/** Each funded address owns one 100 tADA UTxO until a submitted transaction spends it. */
export const fakeBlockfrost = async (t: TestContext, funded: string[]) => {
  const state = { submitted: [] as { hash: string; bytes: Buffer }[], spent: new Map<string, string>(), unhandled: [] as string[] };
  const fundingHash = (i: number) => (i + 10).toString(16).repeat(64).slice(0, 64);
  const output = (address: string) => {
    const i = funded.indexOf(address);
    return { address, tx_hash: fundingHash(i), tx_index: 0, output_index: 0, amount: [{ unit: 'lovelace', quantity: '100000000' }],
      block: 'c'.repeat(64), data_hash: null, inline_datum: null, reference_script_hash: null, collateral: false, consumed_by_tx: state.spent.get(address) ?? null };
  };
  const utxo = (address: string) => (funded.includes(address) && !state.spent.has(address) ? output(address) : undefined);
  const bf = express();
  bf.get('/epochs/latest/parameters', (_q, r) => { r.json(protocol); });
  bf.get('/addresses/:address/utxos', (q, r) => { const u = utxo(q.params.address); r.json(u ? [u] : []); });
  bf.get('/txs/:hash/utxos', (q, r) => {
    const i = funded.findIndex((_a, n) => fundingHash(n) === q.params.hash);
    if (i < 0) { r.status(404).json({ status_code: 404, error: 'Not Found', message: 'not found' }); return; }
    const a = funded[i]!;
    r.json({ hash: q.params.hash, inputs: [], outputs: [output(a)] });
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
    // Spend whichever funded UTxO the transaction consumed.
    funded.forEach((a, i) => { if (bytes.includes(Buffer.from(fundingHash(i), 'hex'))) state.spent.set(a, txHash); });
    r.json(txHash);
  });
  bf.use((q, r) => { state.unhandled.push(`${q.method} ${q.path}`); r.status(404).json({ status_code: 404, error: 'Not Found', message: `unhandled ${q.path}` }); });
  return { state, provider: { baseUrl: await listen(bf, t), projectId: 'offline-fixture' } };
};
