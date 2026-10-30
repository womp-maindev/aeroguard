import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DENSE_UNTIL, due, expirable, FIRST_CHECK, MAX_CHECKS, migrate, record, SETTLEMENT_WINDOW, TAIL_UNTIL } from './schedule.ts';

const S = Date.parse('2026-10-30T21:25:00Z') / 1000; // policy #1, IB1314
const min = 60;
const h = 3600;

/** Runs the keeper's decision at each time, returns what it looked up and when (relative to S, minutes). */
const simulate = (times: number[], state = migrate(undefined)) => {
  const looks: { at: number; kind: 'early' | 'after' }[] = [];
  for (const now of times) {
    const kind = due(now, S, state);
    if (!kind) continue;
    record(now, kind, state);
    looks.push({ at: (now - S) / min, kind });
  }
  return { looks, state };
};
const cron15 = (from: number, to: number) => Array.from({ length: (to - from) / (15 * min) + 1 }, (_, i) => S + from + i * 15 * min);

test('bug repro: early look at 19:10 no longer exhausts the tries before a late landing', () => {
  // the 19:10 UTC manual run (S − 2 h 15) then a 15-min cron all night
  const { looks } = simulate([S - 135 * min, ...cron15(-120 * min, TAIL_UNTIL + h)]);
  const early = looks.filter((l) => l.kind === 'early');
  const after = looks.filter((l) => l.kind === 'after').map((l) => l.at);
  assert.equal(early.length, 1, 'one early look only');
  assert.equal(early[0]!.at, -135);
  assert.equal(after[0], FIRST_CHECK / min, 'first counted check 30 min after scheduled arrival');
  // every 30 min up to scheduled + 6 h: a flight landing 3 h 20 late is seen within 30 min
  for (let i = 1; after[i]! <= DENSE_UNTIL / min; i++) assert.equal(after[i]! - after[i - 1]!, 30);
  assert.ok(after.some((t) => t > 200 && t <= 230), 'landing at S+3h20 is checked by S+3h50');
  assert.ok(after.some((t) => t >= 330 && t <= DENSE_UNTIL / min), 'still checking at S+5h30..6h');
  assert.ok(after.at(-1)! <= TAIL_UNTIL / min && after.at(-1)! > 20 * 60, 'tail continues towards S+24h');
  assert.ok(after.length <= MAX_CHECKS);
});

test('nothing before scheduled − 3 h or after scheduled + 24 h', () => {
  assert.equal(due(S - 3 * h - 1, S, migrate(undefined)), undefined);
  assert.equal(due(S + TAIL_UNTIL + 1, S, migrate(undefined)), undefined);
  assert.equal(due(S + TAIL_UNTIL + 1, S, migrate(undefined), true), undefined, 'even forced');
});

test('manual runs at arbitrary moments make the right call', () => {
  const s = migrate(undefined);
  assert.equal(due(S - 2 * h, S, s), 'early');
  record(S - 2 * h, 'early', s);
  assert.equal(due(S - 1 * h, S, s), undefined, 'no second pre-arrival look');
  assert.equal(due(S + 10 * min, S, s), undefined, 'too early after arrival');
  assert.equal(due(S + 31 * min, S, s), 'after');
  record(S + 31 * min, 'after', s);
  assert.equal(due(S + 40 * min, S, s), undefined, '9 min after the last check');
  assert.equal(due(S + 57 * min, S, s), 'after', '26 min after the last check');
  assert.equal(due(S + 40 * min, S, s, true), 'after', 'force ignores the rhythm');
});

test('a run that starts after arrival skips the early look', () => {
  assert.equal(due(S + 2 * h, S, migrate(undefined)), 'after');
});

test('old v1 counters (tries/next) never block checks', () => {
  for (const tries of [1, 6, 99]) {
    const s = migrate({ tries, next: S + 10 * h, last: 'EnRoute, 0 min late' });
    assert.equal(due(S - 1 * h, S, s), undefined, `tries=${tries}: early look already done`);
    assert.equal(due(S + FIRST_CHECK, S, s), 'after', `tries=${tries}: first check is due`);
  }
  assert.deepEqual(migrate({ v: 2, checks: 3, lastAt: S }), { v: 2, checks: 3, lastAt: S });
});

test('hard cap on paid lookups even with a run every minute', () => {
  const every = Array.from({ length: (TAIL_UNTIL + 4 * h) / min }, (_, i) => S - 4 * h + i * min);
  const { looks } = simulate(every);
  assert.ok(looks.filter((l) => l.kind === 'after').length <= MAX_CHECKS);
  assert.equal(looks.filter((l) => l.kind === 'early').length, 1);
});

test('expire only after the contract settlement window, never during the lookup schedule', () => {
  assert.equal(expirable(S + TAIL_UNTIL, S), false);
  assert.equal(expirable(S + SETTLEMENT_WINDOW, S), false, 'contract requires block.timestamp > until');
  assert.equal(expirable(S + SETTLEMENT_WINDOW + 1, S), true);
});
