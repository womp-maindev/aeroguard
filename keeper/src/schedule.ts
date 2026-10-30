// When is a paid AeroDataBox lookup worth it? Pure functions of (now, scheduled arrival, past attempts), so a keeper
// run at any moment — cron, a manual workflow_dispatch, a laptop — makes the same decision from the same state.
//
//   scheduled − 3 h ........ one early look (cancellations are known early); never counted against the limit
//   scheduled + 30 min ..... first real check, then every 30 min until scheduled + 6 h (delays that pay are 2–3 h+)
//   scheduled + 6 h ........ every 3 h until scheduled + 24 h (very late landings still pay in full)

export const EARLY_LOOK = 3 * 3600;
export const FIRST_CHECK = 30 * 60;
export const DENSE_UNTIL = 6 * 3600;
export const DENSE_EVERY = 30 * 60;
export const TAIL_UNTIL = 24 * 3600;
export const TAIL_EVERY = 3 * 3600;
/** A run a few minutes early still counts: cron jitter, a 15-min cron hitting a 30-min rhythm, manual runs. */
export const SLACK = 5 * 60;
/** Hard cap on post-arrival lookups per policy (the AeroDataBox quota is shared by every team). */
export const MAX_CHECKS = 20;

export interface Attempt {
  v: 2;
  /** the pre-arrival look for cancellations happened */
  early?: boolean;
  /** post-arrival lookups so far */
  checks: number;
  /** unix seconds of the last post-arrival lookup */
  lastAt?: number;
  last?: string;
}

/** v1 state (`{tries, next}`) counted pre-arrival looks against a limit of 6; keep only "an early look happened". */
export const migrate = (s: unknown): Attempt => {
  if (s && typeof s === 'object' && (s as Attempt).v === 2) return s as Attempt;
  const tries = (s as { tries?: number } | undefined)?.tries ?? 0;
  return { v: 2, checks: 0, ...(tries > 0 && { early: true }) };
};

/** Earliest time the next lookup is due, or undefined when the keeper is done with this policy. */
export const nextCheckAt = (scheduled: number, a: Attempt): number | undefined => {
  if (a.checks >= MAX_CHECKS) return undefined;
  if (a.lastAt === undefined) return a.early ? scheduled + FIRST_CHECK : scheduled - EARLY_LOOK;
  const gap = a.lastAt - scheduled < DENSE_UNTIL ? DENSE_EVERY : TAIL_EVERY;
  const at = Math.max(a.lastAt + gap - SLACK, scheduled + FIRST_CHECK);
  return at - scheduled > TAIL_UNTIL ? undefined : at;
};

/** 'early' = the one pre-arrival look, 'after' = a counted post-arrival check, undefined = nothing to do now. */
export const due = (now: number, scheduled: number, a: Attempt, force = false): 'early' | 'after' | undefined => {
  const since = now - scheduled;
  if (since < -EARLY_LOOK || since > TAIL_UNTIL || a.checks >= MAX_CHECKS) return undefined;
  if (!force) {
    const at = nextCheckAt(scheduled, a);
    if (at === undefined || now < at) return undefined;
  }
  return since < FIRST_CHECK ? 'early' : 'after';
};

/** Records a lookup that is about to be paid for. */
export const record = (now: number, kind: 'early' | 'after', a: Attempt) => {
  if (kind === 'early') a.early = true;
  else {
    a.checks++;
    a.lastAt = now;
  }
};
