// AeroGuard job: turn a Sokosumi task description into a cover policy or a verified flight verdict.
// The heavy lifting (x402 data purchase, Base Sepolia contract) lives in ../agent, reached over its HTTP API.
const API = process.env.AEROGUARD_API ?? 'http://127.0.0.1:8787';

const FLIGHT = /\b([A-Z0-9]{2}\s?\d{1,4}[A-Z]?)\b/i;
const DATE = /\b(20\d\d-\d\d-\d\d)\b/;
const ADDR = /\b(0x[a-fA-F0-9]{40})\b/;

export function parseJob(text, today = new Date()) {
  const flight = text.replace(DATE, ' ').replace(ADDR, ' ').match(FLIGHT)?.[1]?.replace(/\s/g, '').toUpperCase();
  let date = text.match(DATE)?.[1];
  if (!date && /tomorrow|morgen|завтра/i.test(text)) date = new Date(today.getTime() + 864e5).toISOString().slice(0, 10);
  if (!date) date = today.toISOString().slice(0, 10);
  const holder = text.match(ADDR)?.[1];
  const coverage = Number(text.match(/(\d+(?:\.\d+)?)\s*(?:aUSD|USD|\$)/i)?.[1] ?? 2);
  const wantsCover = /cover|insur|protect|policy|versicher|страх/i.test(text);
  const mode = holder && (wantsCover || !/verdict|status|was .*(late|delay)|delayed\?/i.test(text)) ? 'cover' : 'verdict';
  return { flight, date, holder, coverage, mode };
}

async function call(path, init) {
  const r = await fetch(API + path, init);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? `AeroGuard API ${r.status}`);
  return j;
}

export async function runJob(text, cardanoJobId) {
  const job = parseJob(text);
  if (!job.flight) return 'I need a flight number (e.g. "LH1234 on 2026-10-31"). For cover, also give a Base Sepolia payout address (0x…).';
  if (job.mode === 'cover') {
    const p = await call('/cover', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...job, cardanoJobId }) });
    return [
      `✅ AeroGuard cover is active for ${p.flight} on ${p.date} (scheduled arrival ${p.scheduled} UTC, current status: ${p.status}).`,
      `Policy #${p.policyId} pays ${job.coverage} aUSD × (50% if ≥2h late, 100% if ≥3h late or cancelled) to ${job.holder}.`,
      `No claim needed: the AeroGuard keeper buys AeroDataBox data signed by its AirnodeHub Airnode after landing, and the FlightDelayCover contract pays only if the signer, request and freshness checks pass.`,
      `Policy tx: https://sepolia.basescan.org/tx/${p.txHash}`,
      `Source: AeroDataBox via AirnodeHub (API3). Limits: Base Sepolia testnet, test aUSD; the signature proves the Airnode's answer, not that AeroDataBox is right.`,
    ].join('\n');
  }
  const v = await call(`/verdict?flight=${encodeURIComponent(job.flight)}&date=${job.date}`);
  return [
    `✈️ ${job.flight} on ${job.date}: ${v.summary}.`,
    `Signed evidence (AeroDataBox Airnode ${v.evidence.airnode}, signed ${new Date(Number(v.evidence.timestamp) * 1000).toISOString()}):`,
    '```json', JSON.stringify(v.evidence, null, 2), '```',
    `Any EVM contract can check it with AirnodeV2Attestation.verify(signer, requestHash, timestamp, data, signature).`,
  ].join('\n');
}
