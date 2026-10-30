import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { walletFor } from './cardano.ts';
import { BUYER, fakeBlockfrost, PINNED_EVIDENCE, SELLER } from './fixture.test-util.ts';

test('npm run qualify: preflight, serve, pay, record — as a separate process', async (t) => {
  const { state, provider } = await fakeBlockfrost(t, [walletFor(BUYER).getAddress()]);
  const dir = mkdtempSync(join(tmpdir(), 'aeroguard-qualify-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { stdout } = await promisify(execFile)(process.execPath, [new URL('./qualify.ts', import.meta.url).pathname], {
    env: { ...process.env, BLOCKFROST_BASE_URL: provider.baseUrl, BLOCKFROST_PROJECT_ID: 'preprodFIXTURE', BUYER_MNEMONIC: BUYER,
      SELLER_MNEMONIC: SELLER, EVIDENCE_DIR: PINNED_EVIDENCE[0], EVIDENCE_MD: join(dir, 'EVIDENCE.md'), SALES_LOG: join(dir, 'sales.jsonl') },
    timeout: 60_000,
  });
  assert.equal(state.submitted.length, 1, stdout);
  const tx = state.submitted[0]!.hash;
  assert.match(stdout, new RegExp(`link https://preprod\\.cardanoscan\\.io/transaction/${tx}`));
  assert.match(readFileSync(join(dir, 'EVIDENCE.md'), 'utf8'), new RegExp(`IB1314 2026-10-30 \\| Expected \\| \\[${tx.slice(0, 16)}`));
  assert.equal(JSON.parse(readFileSync(join(dir, 'sales.jsonl'), 'utf8').trim()).tx, tx);
});
