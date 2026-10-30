// AeroGuard agent core: resolve → quote → buy → (keeper) fetch signed evidence → settle.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Hex } from 'viem';
import { allPolicies, buyPolicy, explorerTx, revertReason, settle } from './chain.ts';
import { fetchSignedFlight, normalizeFlight, readVerdict, type Verdict } from './flight.ts';
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
  const k = process.env.X402_PAYER_PK || process.env.AGENT_PK;
  if (!k) throw new Error('Set X402_PAYER_PK (or AGENT_PK) in .env — it needs aUSD on Base Sepolia');
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

export const cover = async (a: { flight: string; date: string; holder: Hex; coverage?: bigint; cardanoJobId?: string }) => {
  const r = await resolveFlight(a.flight, a.date);
  if (!['Expected', 'Unknown', 'CheckIn', 'Boarding'].includes(r.status))
    throw new Error(`${r.flight} is ${r.status}; cover can only be bought before departure (the contract checks the signed status)`);
  const res = await buyPolicy({ ...a, flight: r.flight, coverage: a.coverage ?? 2_000_000n, proof: r.evidence });
  say('chain', `policy #${res.policyId} for ${r.flight} ${a.date} (sched ${r.scheduled})`, explorerTx(res.txHash));
  return { ...res, flight: r.flight, date: a.date, scheduled: r.scheduled, status: r.status };
};

// ---------------------------------------------------------------- keeper (autonomous loop)

const STATE = new URL('../.cache/keeper-state.json', import.meta.url).pathname;
type Attempt = { tries: number; next: number; last?: string };
const loadState = (): Record<string, Attempt> => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {});
const saveState = (s: Record<string, Attempt>) => {
  mkdirSync(new URL('../.cache/', import.meta.url).pathname, { recursive: true });
  writeFileSync(STATE, JSON.stringify(s, null, 2));
};

const FIRST_CHECK = 30 * 60; // after scheduled arrival
const RETRY = 45 * 60;
const MAX_TRIES = 6; // quota discipline: at most 6 paid lookups per policy

export const keeperTick = async () => {
  const state = loadState();
  const now = Math.floor(Date.now() / 1000);
  for (const p of await allPolicies()) {
    if (p.status !== 1) continue; // Active only
    const key = p.id.toString();
    const s = (state[key] ??= { tries: 0, next: Number(p.scheduledArrival) + FIRST_CHECK });
    // cancellations can be known early: one cheap look 3h before arrival
    if (s.tries === 0 && now < s.next && now > Number(p.scheduledArrival) - 3 * 3600) s.next = now;
    if (now < s.next || s.tries >= MAX_TRIES) continue;
    s.tries++;
    s.next = now + RETRY;
    try {
      say('info', `policy #${key}: checking ${p.flight} ${p.date} (try ${s.tries}/${MAX_TRIES})`);
      const v = await verdict(p.flight, p.date, 600); // one paid lookup serves every policy on that flight
      s.last = describe(v.verdict);
      if (!v.verdict.final) {
        say('info', `policy #${key}: ${s.last} — not final, next look in ${RETRY / 60} min`);
        continue;
      }
      const res = await settle(p.id, v.evidence);
      say('chain', `policy #${key} settled ${res.status}: ${s.last}, payout ${Number(res.payout) / 1e6} aUSD`, explorerTx(res.txHash));
    } catch (e) {
      say('warn', `policy #${key}: ${revertReason(e)}`);
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
