import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Hex } from 'viem';
import { requestHashFor } from '../../keeper/src/flight.ts';
import { addressOf, compressedSigner, messageHash, minutesOf, payoutOf, plutusVerify, projectedData } from './onchain.ts';
import { testVectors } from './vectors.ts';

const real = JSON.parse(readFileSync(new URL('../evidence/IB1314-2026-10-30-status.json', import.meta.url), 'utf8'));

test('the real Airnode signature verifies with Plutus primitives (no ecrecover)', async () => {
  const pubkey = await compressedSigner(real);
  assert.equal(pubkey.length, 2 + 66);
  assert.equal(addressOf(pubkey), real.airnode);
  // The validator rebuilds the data from typed fields instead of parsing JSON.
  assert.equal(projectedData('2026-10-30 21:25Z', 'Expected'), real.data);
  assert.equal(real.requestHash, requestHashFor('IB1314', '2026-10-30', 'status'));
  const msg = messageHash(real.requestHash, BigInt(real.timestamp), real.data);
  assert.ok(plutusVerify(pubkey, msg, real.signature));
  // Any edit breaks it: data, request, timestamp.
  assert.ok(!plutusVerify(pubkey, messageHash(real.requestHash, BigInt(real.timestamp), projectedData('2026-10-30 21:25Z', 'Arrived')), real.signature));
  assert.ok(!plutusVerify(pubkey, messageHash(requestHashFor('IB1314', '2026-10-30', 'arrival'), BigInt(real.timestamp), real.data), real.signature));
  assert.ok(!plutusVerify(pubkey, messageHash(real.requestHash, BigInt(real.timestamp) + 1n, real.data), real.signature));
});

test('time parsing and payout rule match FlightDelayCover', () => {
  assert.equal(minutesOf('1970-01-01 00:00Z'), 0);
  assert.equal(minutesOf('2026-10-30 21:25Z'), Date.parse('2026-10-30T21:25Z') / 60000);
  assert.equal(minutesOf('2024-02-29 23:59Z'), Date.parse('2024-02-29T23:59Z') / 60000);
  assert.equal(minutesOf('2026-11-01 00:05Z') - minutesOf('2026-10-31 23:50Z'), 15);
  assert.equal(payoutOf('Expected', '2026-10-30 21:25Z'), 'not-final');
  assert.equal(payoutOf('Canceled', '2026-10-30 21:25Z'), 'full');
  assert.equal(payoutOf('Arrived', '2026-10-30 21:25Z', '2026-10-31 00:25Z'), 'full');
  assert.equal(payoutOf('Arrived', '2026-10-30 21:25Z', '2026-10-30 23:25Z'), 'half');
  assert.equal(payoutOf('Arrived', '2026-10-30 21:25Z', '2026-10-30 23:24Z'), 'none');
});

test('every Aiken test vector verifies, with the signer it claims', async () => {
  for (const v of await testVectors()) {
    const ok = plutusVerify(v.pubkey as Hex, messageHash(v.requestHash as Hex, v.timestamp, v.data), v.signature as Hex);
    assert.equal(ok, true, v.name);
    assert.equal(addressOf(v.pubkey as Hex), v.name.startsWith('real_') ? '0x83FE2E8F24E66520B1902C3507De4F471248f2Ec' : '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', v.name);
  }
});
