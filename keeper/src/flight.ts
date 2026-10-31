// AeroDataBox via its AirnodeHub Airnode: request shapes, hashes and signed fetches.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Hex } from 'viem';
import { type AirnodeV2Request, deriveRequestHash, fetchSignedResponse, type SignedResponse, verifySignedResponse } from './airnode-v2.ts';
import { readPaymentSettlement } from './x402.ts';

export const AERODATABOX_URL = 'https://airnode-aerodatabox.fly.dev/';
export const AERODATABOX_AIRNODE = '0x83FE2E8F24E66520B1902C3507De4F471248f2Ec' as const;

// MUST stay identical to FlightDelayCover.sol ARRIVAL_PROJECTION / STATUS_PROJECTION.
export const ARRIVAL_PROJECTION = {
  actual: '/0/arrival/revisedTime/utc',
  scheduled: '/0/arrival/scheduledTime/utc',
  status: '/0/status',
};
export const STATUS_PROJECTION = { scheduled: '/0/arrival/scheduledTime/utc', status: '/0/status' };

export type Kind = 'arrival' | 'status';

export const normalizeFlight = (f: string) => f.replace(/\s+/g, '').toUpperCase();

export const buildRequest = (flight: string, date: string, kind: Kind): AirnodeV2Request => ({
  operation: 'flightStatusOnDate',
  parameters: { searchBy: 'number', searchParam: normalizeFlight(flight), dateLocal: date },
  responseProjection: kind === 'arrival' ? ARRIVAL_PROJECTION : STATUS_PROJECTION,
});

export const requestHashFor = (flight: string, date: string, kind: Kind): Hex =>
  deriveRequestHash(buildRequest(flight, date, kind));

// --- disk cache: the AeroDataBox quota (~2,000 lookups) is shared by every team, so never ask twice.
const CACHE_DIR = fileURLToPath(new URL('../.cache/', import.meta.url));
const cachePath = (h: string) => join(CACHE_DIR, `${h}.json`);
export const readCache = (h: string): CachedResponse | undefined =>
  existsSync(cachePath(h)) ? JSON.parse(readFileSync(cachePath(h), 'utf8')) : undefined;
const writeCache = (h: string, v: CachedResponse) => {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath(h), JSON.stringify(v, null, 2));
};

export interface CachedResponse extends SignedResponse {
  fetchedAt: number;
  paymentTx?: string;
}

export interface PaidCall {
  kind: Kind;
  flight: string;
  date: string;
  paymentTx?: string;
  ok: boolean;
  error?: string;
  at: number;
}
export const spendLog: PaidCall[] = [];

/** Buys one signed flight status via x402. Returns undefined when the Airnode can't answer this projection
 *  (e.g. a cancelled flight has no revisedTime → 400). maxCacheAge lets callers reuse a recent answer. */
// ---- FIXTURE MODE (FR-09): deterministic responses signed by a LOCAL test key, same shape + same contract path.
// Only works against a contract deployed with that test key as `airnode` (local anvil demo). On the real deployment
// the contract rejects them with NotSignedByAirnode — which is itself a live demonstration of the signer check.
type FixtureFlight = { status: string; scheduled: string; actual?: string; before?: string };
const fixtureFlights = (): Record<string, FixtureFlight> => {
  // FIXTURE_FLIGHTS: the rehearsal passes a copy shifted to a day that is still ahead of the local chain's clock
  const f = process.env.FIXTURE_FLIGHTS || fileURLToPath(new URL('../fixtures/flights.json', import.meta.url));
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
};
const signFixture = async (flight: string, date: string, kind: Kind): Promise<CachedResponse | undefined> => {
  const { privateKeyToAccount } = await import('viem/accounts');
  const { encodePacked, keccak256, toHex } = await import('viem');
  let rec = fixtureFlights()[`${normalizeFlight(flight)}@${date}`];
  if (!rec) throw new Error(`no fixture for ${flight}@${date}`);
  // before scheduled arrival the fixture flight is still pre-departure (purchase phase)
  const early = Date.now() < Date.parse(rec.scheduled.replace(' ', 'T')) - 3600_000;
  if (early) rec = { ...rec, status: rec.before ?? 'Expected', actual: undefined };
  if (kind === 'arrival' && !rec.actual) return undefined; // mirrors the Airnode's 400 on a missing pointer
  const obj: Record<string, string> = kind === 'arrival' ? { actual: rec.actual!, scheduled: rec.scheduled, status: rec.status } : { scheduled: rec.scheduled, status: rec.status };
  const data = JSON.stringify(obj); // keys already in code point order
  const requestHash = requestHashFor(flight, date, kind);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const acct = privateKeyToAccount(process.env.FIXTURE_SIGNER_PK as Hex);
  const signature = await acct.signMessage({ message: { raw: keccak256(encodePacked(['bytes32', 'uint256', 'bytes'], [requestHash, BigInt(timestamp), toHex(data)])) } });
  spendLog.push({ kind, flight, date, ok: true, at: Date.now(), paymentTx: 'fixture' });
  return { airnode: acct.address, requestHash, timestamp, data, signature, fetchedAt: Number(timestamp), paymentTx: undefined };
};
export const fixtureMode = () => process.env.FIXTURE_MODE === 'true';

export const fetchSignedFlight = async (
  flight: string,
  date: string,
  kind: Kind,
  payingFetch: typeof fetch,
  maxCacheAgeSec = 0,
): Promise<CachedResponse | undefined> => {
  if (fixtureMode()) return signFixture(flight, date, kind);
  const request = buildRequest(flight, date, kind);
  const hash = deriveRequestHash(request);
  const cached = readCache(hash);
  if (cached && Date.now() / 1000 - Number(cached.timestamp) <= maxCacheAgeSec) return cached;

  let paymentTx: string | undefined;
  const recordingFetch: typeof fetch = async (input, init) => {
    const res = await payingFetch(input, init);
    paymentTx = (readPaymentSettlement(res) as { transaction?: string } | undefined)?.transaction;
    return res;
  };
  try {
    const signed = await fetchSignedResponse(AERODATABOX_URL, request, recordingFetch);
    await verifySignedResponse(signed, AERODATABOX_AIRNODE, hash);
    const out: CachedResponse = { ...signed, fetchedAt: Math.floor(Date.now() / 1000), paymentTx };
    writeCache(hash, out);
    spendLog.push({ kind, flight, date, paymentTx, ok: true, at: Date.now() });
    return out;
  } catch (e) {
    spendLog.push({ kind, flight, date, paymentTx, ok: false, error: String(e).slice(0, 300), at: Date.now() });
    if (String(e).includes(' 400')) return undefined;
    throw e;
  }
};

export interface Verdict {
  status: string;
  scheduled: string;
  actual?: string;
  delayMinutes?: number;
  cancelled: boolean;
  final: boolean;
}

/** Same rule as the contract, off-chain, so the keeper only spends gas on evidence that will pay. */
export const readVerdict = (r: SignedResponse): Verdict => {
  const d = JSON.parse(r.data) as { status: string; scheduled: string; actual?: string };
  const toMs = (s: string) => Date.parse(s.replace(' ', 'T'));
  const cancelled = d.status === 'Canceled';
  const delayMinutes = d.actual ? Math.max(0, Math.round((toMs(d.actual) - toMs(d.scheduled)) / 60000)) : undefined;
  return { ...d, delayMinutes, cancelled, final: d.status === 'Arrived' || cancelled };
};
