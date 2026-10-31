import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { walletFor } from './cardano.ts';
import { BUYER, listen, SELLER } from './fixture.test-util.ts';
import { preflight } from './preflight.ts';

const env = { BLOCKFROST_PROJECT_ID: 'preprodTEST', BUYER_MNEMONIC: BUYER, SELLER_MNEMONIC: SELLER };

const blockfrost = async (t: Parameters<typeof listen>[1], lovelace: string | null, status = 200) => {
  const bf = express();
  bf.get('/', (_q, r) => { if (status !== 200) { r.status(status).json({}); return; } r.json({ url: 'https://blockfrost.io/', version: '0.1' }); });
  bf.get('/addresses/:a', (_q, r) => { if (lovelace === null) { r.status(404).json({}); return; } r.json({ amount: [{ unit: 'lovelace', quantity: lovelace }] }); });
  return listen(bf, t);
};
const failed = (checks: { name: string; ok: boolean }[]) => checks.filter((c) => !c.ok).map((c) => c.name);

test('a ready environment passes every check', async (t) => {
  const checks = await preflight(env, { baseUrl: await blockfrost(t, '10000000000') });
  assert.deepEqual(failed(checks), []);
  assert.equal(checks.find((c) => c.name === 'Buyer wallet')!.detail, walletFor(BUYER).getAddress());
});

test('missing or wrong keys are reported with a fix', async (t) => {
  const checks = await preflight({ ...env, BLOCKFROST_PROJECT_ID: 'mainnetX', SELLER_MNEMONIC: BUYER }, { baseUrl: await blockfrost(t, '0') });
  assert.deepEqual(failed(checks), ['Blockfrost key', 'Seller address']);
  assert.ok(checks.every((c) => c.ok || c.fix));
});

test('an unfunded buyer and a rejected key are caught before paying', async (t) => {
  assert.deepEqual(failed(await preflight(env, { baseUrl: await blockfrost(t, null) })), ['Buyer balance']);
  assert.deepEqual(failed(await preflight(env, { baseUrl: await blockfrost(t, '1', 403) })), ['Blockfrost reachable']);
  assert.deepEqual(failed(await preflight(env, { baseUrl: await blockfrost(t, '10000000000'), flight: 'XX1' })), ['Signed evidence']);
});

test('with ANCHOR=true an unfunded seller is caught', async (t) => {
  const funded = await blockfrost(t, '10000000000');
  assert.deepEqual(failed(await preflight({ ...env, ANCHOR: 'true' }, { baseUrl: funded })), []);
  const bf = express();
  const buyer = walletFor(BUYER).getAddress();
  bf.get('/', (_q, r) => { r.json({ url: 'https://blockfrost.io/' }); });
  bf.get('/addresses/:a', (q, r) => { if (q.params.a !== buyer) { r.status(404).json({}); return; } r.json({ amount: [{ unit: 'lovelace', quantity: '10000000000' }] }); });
  assert.deepEqual(failed(await preflight({ ...env, ANCHOR: 'true' }, { baseUrl: await listen(bf, t) })), ['Seller balance']);
});
