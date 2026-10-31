// Builds data.js for player.html from real sources only:
//   keeper.json      the keeper's published log + signed responses (branch keeper-data), path = argv[2]
//   ../../keeper/fixtures/IB1314-status-proof.json   policy #1's real signed purchase proof
//   forge-test.txt   real `forge test` output      rehearse.txt   real `npm run rehearse` output (anvil)
const fs = require('fs');
const path = require('path');
const here = (p) => path.join(__dirname, p);
const kd = JSON.parse(fs.readFileSync(process.argv[2] || here('keeper.json'), 'utf8'));
const proof = JSON.parse(fs.readFileSync(here('../../keeper/fixtures/IB1314-status-proof.json'), 'utf8'));

// The 11 live policies (purchase txs from docs/EVIDENCE.md).
const POLICIES = [
  [1, 'IB1314', 'MUC → MAD', '2026-10-30', '21:25Z'], [2, 'LH1816', 'MUC → BCN', '2026-10-30', '21:55Z'],
  [3, 'EI357', 'MUC → DUB', '2026-10-30', '21:55Z'], [4, 'BA955', 'MUC → LHR', '2026-10-30', '21:50Z'],
  [5, 'LH1866', 'MUC → FCO', '2026-10-31', '10:20Z'], [6, 'LH2472', 'MUC → LHR', '2026-10-31', '10:25Z'],
  [7, 'EI352', 'DUB → MUC', '2026-10-31', '09:10Z'], [8, 'LH1810', 'MUC → BCN', '2026-10-31', '10:00Z'],
  [9, 'LH1814', 'MUC → BCN', '2026-10-31', '16:35Z'], [10, 'LH1868', 'MUC → FCO', '2026-10-31', '12:15Z'],
  [11, 'LH2476', 'MUC → LHR', '2026-10-31', '15:50Z'],
].map(([id, flight, route, date, sched]) => ({ id, flight, route, date, sched, outcome: null }));

const hhmm = (iso) => iso.slice(11, 19) + 'Z';
for (const run of kd.runs) for (const l of run.log) {
  const m = l.msg.match(/^policy #(\d+) (settled|expired)\s*(\w*)[:,]?\s*(.*)$/);
  if (!m) continue;
  const p = POLICIES.find((x) => x.id === Number(m[1]));
  if (p) p.outcome = { kind: m[2], status: m[3] || 'Expired', detail: m[4], at: l.at, link: l.link || '' };
}

// Keeper terminal: every run that bought data or settled, newest last (at most ~22 lines shown).
const keeper = [];
for (const run of kd.runs) {
  const busy = run.log.filter((l) => !/nothing due/.test(l.msg));
  if (!busy.length) continue;
  keeper.push({ run: `${run.startedAt.slice(0, 10)} ${hhmm(run.startedAt)} · ${run.event === 'schedule' ? 'scheduled' : 'manual'} run`, url: run.url,
    lines: busy.map((l) => ({ at: hhmm(l.at), level: l.level, msg: l.msg, tx: l.link ? l.link.split('/tx/')[1] : '' })) });
}

// forge test: suite headers, every LiveReplay test, a few hardening tests, the summary.
const forge = [];
let suite = '';
const pickHard = /Signature|Stranger|Reentr|Exactly180|MaxAge/;
for (const raw of fs.readFileSync(here('forge-test.txt'), 'utf8').split('\n')) {
  const line = raw.replace(/\s*\((gas|μ|µ)[^)]*\)\s*$/, '').replace(/\s+$/, '');
  if (/^Ran \d+ tests? for/.test(line)) { suite = line; forge.push({ k: 'suite', s: line.replace(/^Ran (\d+) tests? for test\/(\S+):\S+/, '$2 · $1 tests') }); continue; }
  if (/^\[PASS\]/.test(line)) {
    const name = line.replace('[PASS] ', '');
    if (/LiveReplay|Fixtures/.test(suite) || (/Hardening/.test(suite) && pickHard.test(name)) || (/FlightDelayCover/.test(suite) && /Tamper|Payout|Cancel/.test(name)))
      forge.push({ k: 'pass', s: name });
    continue;
  }
  if (/^Suite result/.test(line)) forge.push({ k: 'res', s: line.replace(/; finished.*/, '') });
  if (/^Ran \d+ test suites/.test(line)) forge.push({ k: 'sum', s: line.replace(/ in [\d.]+m?s \([^)]*\)/, '') });
}

const rehearse = fs.readFileSync(here('rehearse.txt'), 'utf8').split('\n')
  .filter((l) => l.trim() && !/^>/.test(l))
  .map((l) => l.replace(/0x[0-9a-f]{64}/gi, (h) => h.slice(0, 10) + '…').replace(/0x[0-9a-fA-F]{40}/g, (a) => a.slice(0, 8) + '…' + a.slice(-4)));

fs.writeFileSync(here('data.js'), 'window.D=' + JSON.stringify({ policies: POLICIES, keeper, forge, rehearse, proof,
  contract: kd.contract, keeperUpdated: kd.updatedAt }, null, 1) + ';\n');
const settled = POLICIES.filter((p) => p.outcome).length;
console.log(`data.js: ${settled}/11 policies settled, ${keeper.length} keeper runs, ${forge.length} forge lines, ${rehearse.length} rehearsal lines`);
