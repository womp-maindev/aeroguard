// AeroGuard's flight verdict, built only from signed AeroDataBox Airnode responses that are already on disk.
// The AeroDataBox quota is shared by every team, so this service never calls the Airnode itself.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { recoverSigner, type SignedResponse } from '../../keeper/src/airnode-v2.ts';
import { AERODATABOX_AIRNODE, buildRequest, type Kind, normalizeFlight, readVerdict, requestHashFor } from '../../keeper/src/flight.ts';

// FlightDelayCover on Base Sepolia accepts exactly these responses in buyPolicy/settle.
export const COVER = { chain: 'base-sepolia', chainId: 84532, address: '0x257054204c4Cd43846C4553eBe6D709841980a80' } as const;

// Committed evidence first, then whatever the keeper has cached locally.
export const EVIDENCE_DIRS = [
  new URL('../evidence/', import.meta.url).pathname,
  new URL('../../keeper/.cache/', import.meta.url).pathname,
];

// Committed evidence files also carry `flight` and `date`, so /flights can list them.
type Evidence = SignedResponse & { paymentTx?: string; flight?: string; date?: string };

const loadEvidence = (dirs: string[]) => {
  const byHash = new Map<string, Evidence>();
  for (const dir of dirs.filter(existsSync)) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      try {
        const r = JSON.parse(readFileSync(join(dir, file), 'utf8'));
        if (r.requestHash && r.signature && !byHash.has(r.requestHash)) byHash.set(r.requestHash, r);
      } catch { /* not a signed response */ }
    }
  }
  return byHash;
};

export const isValidQuery = (flight: unknown, date: unknown): flight is string =>
  typeof flight === 'string' && /^[A-Za-z0-9 ]{3,10}$/.test(flight) && typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date);

// A final arrival proof beats a pre-departure status proof.
export const findEvidence = (flight: string, date: string, dirs = EVIDENCE_DIRS) => {
  const all = loadEvidence(dirs);
  for (const kind of ['arrival', 'status'] as Kind[]) {
    const r = all.get(requestHashFor(flight, date, kind));
    if (r) return { kind, response: r };
  }
  return undefined;
};

export const kindOfData = (data: string): Kind => ('actual' in JSON.parse(data) ? 'arrival' : 'status');

export const listEvidence = (dirs = EVIDENCE_DIRS) =>
  [...loadEvidence(dirs).values()].map((r) => ({
    flight: r.flight, date: r.date, kind: kindOfData(r.data), requestHash: r.requestHash, data: r.data, timestamp: r.timestamp,
  }));

export const buildVerdict = async (flight: string, date: string, dirs = EVIDENCE_DIRS) => {
  const found = findEvidence(flight, date, dirs);
  if (!found) return undefined;
  const { kind, response } = found;
  const signer = await recoverSigner(response);
  if (signer.toLowerCase() !== AERODATABOX_AIRNODE.toLowerCase()) throw new Error(`Evidence for ${flight} is signed by ${signer}`);
  const { airnode, requestHash, timestamp, data, signature } = response;
  return {
    flight: normalizeFlight(flight),
    date,
    kind,
    verdict: readVerdict(response),
    // Pass these five fields unchanged to FlightDelayCover (or any AirnodeV2Attestation.verify) as the proof.
    evidence: { airnode, requestHash, timestamp, data, signature },
    request: buildRequest(flight, date, kind),
    verify: {
      rule: 'ecrecover(toEthSignedMessageHash(keccak256(abi.encodePacked(requestHash, timestamp, data)))) == airnode',
      signerRecovered: signer,
      contract: COVER,
      evidenceBoughtOnBaseSepolia: response.paymentTx,
    },
  };
};
