// AeroGuard core: resolve → quote → buy → watch → fetch signed evidence → settle.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Hex } from 'viem';
import { allPolicies, buyPolicy, coverAddress, expirePolicy, explorerTx, revertReason, settle } from './chain.ts';
import { fetchSignedFlight, normalizeFlight, readVerdict, type Verdict } from './flight.ts';
import { type Attempt, due, expirable, MAX_CHECKS, migrate, nextCheckAt, record } from './schedule.ts';
import { createPayingFetch } from './x402.ts';

export interface LogLine {
  at: string;
  level: 'info' | 'pay' | 'chain' | 'warn';
  msg: string;
  link?: string;
}
export const log: LogLine[] = [];
export const say = (level: LogLine['level'], msg: string, link?: string) => {
  const l = { at: new Date().toISOString(), level, msg, link };
  log.push(l);
  if (log.length > 500) log.shift();
  console.log(`[${l.at.slice(11, 19)}] ${level.padEnd(5)} ${msg}${link ? ` ${link}` : ''}`);
};

const payer = () => {
  const k = process.env.X402_PAYER_PK || process.env.KEEPER_PK || process.env.AGENT_PK;
  if (!k) throw new Error('Set KEEPER_PK in .env — it needs aUSD on Base Sepolia');
  return createPayingFetch(k as Hex);
};

/** One paid lookup (status projection, always answerable) → scheduled arrival + current status. */
export const resolveFlight = async (flight: string, date: string) => {
  flight = normalizeFlight(flight);
  const r = await fetchSignedFlight(flight, date, 'status', payer(), 10 * 60); // contract accepts proofs ≤15 min old
  if (!r) throw new Error(`AeroDataBox has no ${flight} on ${date}`);
  if (r.paymentTx) say('pay', `bought schedule for ${flight} ${date} via x402 (0.05 aUSD)`, explorerTx(r.paymentTx));
  const v = readVerdict(r);
  return { flight, date, scheduled: v.scheduled, scheduledArrival: Math.floor(Date.parse(v.scheduled.replace(' ', 'T')) / 1000), status: v.status, evidence: r };
};

/** Full verdict: tries the arrival projection (needs revisedTime), falls back to status (cancellations). */
export const verdict = async (flight: string, date: string, maxCacheAgeSec = 10 * 60) => {
  const f = payer();
  const arr = await fetchSignedFlight(flight, date, 'arrival', f, maxCacheAgeSec);
  if (arr) {
    if (arr.paymentTx) say('pay', `bought signed arrival for ${flight} via x402`, explorerTx(arr.paymentTx));
    return { kind: 'arrival' as const, evidence: arr, verdict: readVerdict(arr) };
  }
  const st = await fetchSignedFlight(flight, date, 'status', f, maxCacheAgeSec);
  if (!st) throw new Error('no data');
  if (st.paymentTx) say('pay', `bought signed status for ${flight} via x402`, explorerTx(st.paymentTx));
  return { kind: 'status' as const, evidence: st, verdict: readVerdict(st) };
};

export const cover = async (a: { flight: string; date: string; holder: Hex; coverage?: bigint; orderId?: string }) => {
  const r = await resolveFlight(a.flight, a.date);
  if (!['Expected', 'Unknown', 'CheckIn', 'Boarding'].includes(r.status))
    throw new Error(`${r.flight} is ${r.status}; cover can only be bought before departure (the contract checks the signed status)`);
  const res = await buyPolicy({ ...a, flight: r.flight, coverage: a.coverage ?? 2_000_000n, proof: r.evidence });
  say('chain', `policy #${res.policyId} for ${r.flight} ${a.date} (sched ${r.scheduled})`, explorerTx(res.txHash));
  return { ...res, flight: r.flight, date: a.date, scheduled: r.scheduled, status: r.status };
};

// ---------------------------------------------------------------- keeper (autonomous loop)

// KEEPER_STATE_FILE lets a throwaway chain (the anvil rehearsal) keep its own state: anvil redeploys at the same address.
const statePath = () => process.env.KEEPER_STATE_FILE || new URL('../.cache/keeper-state.json', import.meta.url).pathname;
const loadState = (): Record<string, unknown> => (existsSync(statePath()) ? JSON.parse(readFileSync(statePath(), 'utf8')) : {});
const saveState = (s: Record<string, Attempt>) => {
  mkdirSync(dirname(statePath()), { recursive: true });
  writeFileSync(statePath(), JSON.stringify(s, null, 2));
};

// The signed response that settled a policy, in the contracts/test/fixtures format, so the payout can be replayed in
// Solidity and checked by anyone. The Actions workflow prints these files and uploads them as an artifact.
const saveEvidence = (id: bigint, e: Record<string, unknown>) => {
  const dir = join(dirname(statePath()), 'evidence');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${coverAddress().slice(0, 10)}-policy-${id}.json`), JSON.stringify(e, (_, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
};

const hhmm = (t: number) => new Date(t * 1000).toISOString().slice(11, 16);

/** One pass: look up and settle every Active policy whose check is due (see schedule.ts). `force` ignores the rhythm. */
export const keeperTick = async ({ force = false } = {}) => {
  const raw = loadState();
  const state: Record<string, Attempt> = {};
  for (const [k, v] of Object.entries(raw)) state[k] = migrate(v);
  const now = Math.floor(Date.now() / 1000);
  for (const p of await allPolicies()) {
    if (p.status !== 1) continue; // Active only
    const sched = Number(p.scheduledArrival);
    if (expirable(now, sched)) {
      try {
        say('chain', `policy #${p.id} expired after the settlement window, coverage released`, explorerTx(await expirePolicy(p.id)));
      } catch (e) {
        say('warn', `policy #${p.id}: expire failed: ${revertReason(e)}`);
      }
      continue;
    }
    // a private policy stores no flight: only its holder can reveal it (settlePrivate); never pay for a blank lookup
    if (!p.flight) continue;
    const key = `${coverAddress()}:${p.id}`;
    const a = (state[key] ??= migrate(undefined));
    const kind = due(now, sched, a, force);
    if (!kind) {
      const at = nextCheckAt(sched, a);
      say('info', `policy #${p.id} ${p.flight}: nothing due${at === undefined ? ', keeper done with it' : `, next check ≥ ${hhmm(at)}Z`}`);
      continue;
    }
    record(now, kind, a);
    try {
      const what = kind === 'early' ? 'early look for a cancellation' : `check ${a.checks}/${MAX_CHECKS}`;
      say('info', `policy #${p.id}: ${p.flight} ${p.date} sched ${hhmm(sched)}Z, ${what}`);
      const v = await verdict(p.flight, p.date, 600); // one paid lookup serves every policy on that flight
      a.last = describe(v.verdict);
      if (!v.verdict.final) {
        const at = nextCheckAt(sched, a);
        say('info', `policy #${p.id}: ${a.last} — not final${at === undefined ? '' : `, next check ≥ ${hhmm(at)}Z`}`);
        continue;
      }
      const res = await settle(p.id, v.evidence);
      saveEvidence(p.id, { policyId: p.id, flight: p.flight, date: p.date, kind: v.kind, ...v.evidence, timestamp: Number(v.evidence.timestamp), settleTx: res.txHash, outcome: res.status, payout: res.payout, delayMinutes: res.delayMinutes });
      say('chain', `policy #${p.id} settled ${res.status}: ${a.last}, payout ${Number(res.payout) / 1e6} aUSD`, explorerTx(res.txHash));
    } catch (e) {
      say('warn', `policy #${p.id}: ${revertReason(e)}`);
    } finally {
      saveState(state);
    }
  }
};

export const describe = (v: Verdict) =>
  v.cancelled ? 'cancelled' : v.delayMinutes !== undefined ? `${v.status}, ${v.delayMinutes} min late` : v.status;

export const runKeeper = async (everySec = 60) => {
  say('info', `keeper started, tick every ${everySec}s`);
  for (;;) {
    try {
      await keeperTick();
    } catch (e) {
      say('warn', `tick failed: ${revertReason(e)}`);
    }
    await new Promise((r) => setTimeout(r, everySec * 1000));
  }
};
