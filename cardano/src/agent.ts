// A claims agent: it reads the free catalog, buys only the verdicts it needs within a budget, pays per request on
// Cardano and decides each claim by the same rule as FlightDelayCover. Every decision carries a proof and a receipt.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { decodePaymentResponseHeader } from '@x402/fetch';
import { blockfrost, env, payingFetch, txLink, walletFor } from './cardano.ts';

// FlightDelayCover.HALF_PAYOUT_DELAY / FULL_PAYOUT_DELAY.
export const HALF_MIN = 120;
export const FULL_MIN = 180;

export interface Claim { flight: string; date: string; ref?: string }
export interface Verdict { status: string; delayMinutes?: number; cancelled: boolean; final: boolean }
export type Decision = 'pay-full' | 'pay-half' | 'reject' | 'wait';

export const decide = (v: Verdict): Decision => {
  if (!v.final) return 'wait';
  if (v.cancelled || (v.delayMinutes ?? 0) >= FULL_MIN) return 'pay-full';
  if ((v.delayMinutes ?? 0) >= HALF_MIN) return 'pay-half';
  return 'reject';
};

interface Listing { flight?: string; date?: string; kind: 'status' | 'arrival'; price: { lovelace: string } }

export interface AgentOptions {
  server: string;
  claims: Claim[];
  budgetLovelace: bigint;
  // Pre-departure proofs cannot settle a claim; skip them unless asked.
  includeStatus?: boolean;
  pay: typeof fetch;
  log?: (line: string) => void;
}

export const runAgent = async (o: AgentOptions) => {
  const log = o.log ?? console.log;
  const catalog = (await (await fetch(`${o.server}/flights`)).json()) as Listing[];
  const find = (c: Claim) => catalog.find((l) => l.flight === c.flight.toUpperCase() && l.date === c.date);
  let spent = 0n;
  const report = [];
  for (const claim of o.claims) {
    const listing = find(claim);
    const row = { ...claim, decision: 'wait' as Decision, reason: '', verdict: undefined as Verdict | undefined, tx: undefined as string | undefined, proof: undefined as unknown };
    if (!listing) { row.reason = 'no signed evidence yet (free check)'; report.push(row); log(`${claim.flight} ${claim.date}: ${row.reason}`); continue; }
    if (listing.kind === 'status' && !o.includeStatus) { row.reason = 'only a pre-departure proof exists; not worth buying yet'; report.push(row); log(`${claim.flight} ${claim.date}: ${row.reason}`); continue; }
    const price = BigInt(listing.price.lovelace);
    if (spent + price > o.budgetLovelace) { row.reason = `budget: ${spent + price} > ${o.budgetLovelace} lovelace`; report.push(row); log(`${claim.flight} ${claim.date}: skipped, ${row.reason}`); continue; }

    const requestId = `claim-${(claim.ref ?? `${claim.flight}-${claim.date}`).replace(/[^A-Za-z0-9-]/g, '-')}`.slice(0, 100);
    const res = await o.pay(`${o.server}/verdict?flight=${encodeURIComponent(claim.flight)}&date=${claim.date}&requestId=${requestId}`);
    const header = res.headers.get('PAYMENT-RESPONSE');
    const receipt = header ? decodePaymentResponseHeader(header) : undefined;
    if (!res.ok || !receipt?.success) { row.reason = `purchase failed: HTTP ${res.status} ${receipt?.errorReason ?? ''}`.trim(); report.push(row); log(`${claim.flight} ${claim.date}: ${row.reason}`); continue; }
    spent += price;
    const body = await res.json();
    row.verdict = body.verdict;
    row.decision = decide(body.verdict);
    row.reason = body.verdict.final ? `${body.verdict.status}, delay ${body.verdict.delayMinutes ?? 0} min` : `${body.verdict.status}, not final`;
    row.tx = receipt.transaction;
    row.proof = body.evidence;
    report.push(row);
    log(`${claim.flight} ${claim.date}: ${row.decision} (${row.reason})  paid ${price} lovelace  ${txLink(receipt.transaction)}`);
  }
  log(`spent ${spent} of ${o.budgetLovelace} lovelace`);
  return { spent, report };
};

if (import.meta.filename === process.argv[1]) {
  const { values } = parseArgs({
    options: {
      server: { type: 'string', default: process.env.SERVER_URL || 'http://localhost:4021' },
      claims: { type: 'string', default: new URL('../claims.json', import.meta.url).pathname },
      budget: { type: 'string', default: process.env.AGENT_BUDGET_LOVELACE || '10000000' },
      'include-status': { type: 'boolean', default: false },
    },
  });
  const wallet = walletFor(env('BUYER_MNEMONIC'), blockfrost());
  console.log(`claims agent ${wallet.getAddress()}  budget ${values.budget} lovelace`);
  const { report } = await runAgent({
    server: values.server!, claims: JSON.parse(readFileSync(values.claims!, 'utf8')) as Claim[], budgetLovelace: BigInt(values.budget!),
    includeStatus: values['include-status'], pay: payingFetch(wallet),
  });
  console.table(report.map(({ flight, date, decision, reason, tx }) => ({ flight, date, decision, reason, tx: tx?.slice(0, 16) })));
}
