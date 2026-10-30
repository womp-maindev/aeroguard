// Merges this run's keeper log and every AirnodeHub-signed response the keeper holds into keeper.json, which the
// keeper workflow commits to the keeper-data branch and the dashboard reads on GitHub Pages (no keeper API needed).
//   node keeper/src/publish.ts <path/to/keeper.json>
// Signed responses are public by nature (anyone can verify them) and cost quota to get, so they are kept forever,
// deduplicated by signature; runs are capped.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_RUNS = 300;

const out = process.argv[2];
if (!out) throw new Error('usage: node keeper/src/publish.ts <keeper.json>');
const cache = fileURLToPath(new URL('../.cache/', import.meta.url));
const read = (f: string) => JSON.parse(readFileSync(f, 'utf8'));
const jsonIn = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => join(dir, f)) : []);

type Signed = { requestHash: string; signature: string; data: string; timestamp: string | number; [k: string]: unknown };
const prev = existsSync(out) ? read(out) : {};
const evidence = new Map<string, Signed>((prev.evidence ?? []).map((e: Signed) => [e.signature, e]));
// response cache (<requestHash>.json) and settlement evidence (evidence/*.json, which add policy, outcome and tx)
for (const f of [...jsonIn(cache).filter((f) => /\/0x[0-9a-f]{64}\.json$/i.test(f)), ...jsonIn(join(cache, 'evidence'))]) {
  const e = read(f) as Signed;
  if (e.requestHash && e.signature && typeof e.data === 'string') evidence.set(e.signature, { ...evidence.get(e.signature), ...e });
}

const runLog = process.env.KEEPER_RUN_LOG && existsSync(process.env.KEEPER_RUN_LOG) ? read(process.env.KEEPER_RUN_LOG) : [];
const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
const run = {
  startedAt: process.env.RUN_STARTED_AT || runLog[0]?.at || new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  event: process.env.GITHUB_EVENT_NAME ?? 'local',
  url: GITHUB_RUN_ID ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}` : undefined,
  log: runLog,
};

writeFileSync(
  out,
  JSON.stringify(
    {
      updatedAt: run.finishedAt,
      contract: process.env.FLIGHT_COVER_ADDRESS,
      runs: [...(prev.runs ?? []), run].slice(-MAX_RUNS),
      evidence: [...evidence.values()].sort((a, b) => Number(a.timestamp) - Number(b.timestamp)),
    },
    null,
    2,
  ) + '\n',
);
console.log(`keeper.json: ${run.log.length} log lines this run, ${evidence.size} signed responses`);
