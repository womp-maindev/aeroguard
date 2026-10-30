import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keccak256, toHex } from 'viem';
import { readVerdict, requestHashFor } from './flight.ts';

test('request hash matches FlightDelayCover.requestHashFor (same string the contract hashes)', () => {
  const s = '["flightStatusOnDate",[["dateLocal","2026-10-30"],["searchBy","number"],["searchParam","LH1234"]],[["actual","/0/arrival/revisedTime/utc"],["scheduled","/0/arrival/scheduledTime/utc"],["status","/0/status"]]]';
  assert.equal(requestHashFor('LH 1234', '2026-10-30', 'arrival'), keccak256(toHex(s)));
});

test('verdict mirrors contract tiers', () => {
  const v = readVerdict({ data: '{"actual":"2026-10-30 17:20Z","scheduled":"2026-10-30 14:05Z","status":"Arrived"}' } as never);
  assert.equal(v.delayMinutes, 195);
  assert.equal(v.final, true);
});
