import assert from 'node:assert/strict';import {test} from 'node:test';import {parseJob} from './aeroguard.mjs';
test('parses cover job',()=>{const j=parseJob('Cover LH 1234 on 2026-10-31 for 3 aUSD, pay 0x1111111111111111111111111111111111111111');assert.deepEqual([j.flight,j.date,j.coverage,j.mode],['LH1234','2026-10-31',3,'cover']);});
test('parses verdict job',()=>{assert.equal(parseJob('Was KL1395 delayed? 2026-10-30').mode,'verdict');});
