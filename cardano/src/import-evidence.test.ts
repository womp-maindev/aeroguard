import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { SignedResponse } from '../../keeper/src/airnode-v2.ts';
import { importEvidence } from './import-evidence.ts';
import { findEvidence, listEvidence, tierOf } from './verdict.ts';

const EVIDENCE = new URL('../evidence/', import.meta.url).pathname;
const real = readdirSync(EVIDENCE).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(EVIDENCE, f), 'utf8')) as SignedResponse);
const flights = JSON.parse(readFileSync(new URL('../claims.json', import.meta.url), 'utf8'));

test('keeper responses are imported only when the Airnode signed them for a known flight', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'aeroguard-import-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const forged = { ...real[0]!, data: real[0]!.data.replace(/"status":"[A-Za-z]+"/, '"status":"Canceled"') };
  const unknown = { ...real[0]!, requestHash: `0x${'0'.repeat(64)}` as const };
  const { saved, skipped } = await importEvidence([...real, forged, unknown], flights, dir);
  assert.equal(saved.length, real.length);
  assert.deepEqual(skipped.map((s) => s.split(':')[1]!.trim()).sort(), ['not signed by the Airnode', 'unknown request']);
  // Idempotent.
  assert.equal((await importEvidence(real, flights, dir)).saved.length, 0);
});

test('the live catalog: the four policies of 30 Oct (and any imported since), the newest signed answer per request wins', () => {
  const listed = listEvidence([EVIDENCE]);
  const flightsListed = new Set(listed.map((l) => l.flight));
  for (const f of ['BA955', 'EI357', 'IB1314', 'LH1816']) assert.ok(flightsListed.has(f), f);
  const ib = findEvidence('IB1314', '2026-10-30', [EVIDENCE])!;
  assert.equal(ib.kind, 'arrival');
  // Two IB1314 arrival answers were bought; the later one (Approaching) replaces EnRoute.
  const statuses = real.filter((r) => r.requestHash === ib.response.requestHash).map((r) => [Number(r.timestamp), JSON.parse(r.data).status]);
  const newest = statuses.sort((a, b) => b[0] - a[0])[0]![1];
  assert.equal(JSON.parse(ib.response.data).status, newest);
  for (const l of listed) assert.equal(l.tier, ['Arrived', 'Canceled'].includes(l.status) ? 'final' : 'live');
  assert.equal(tierOf(ib.response), ['Arrived', 'Canceled'].includes(newest) ? 'final' : 'live');
});
