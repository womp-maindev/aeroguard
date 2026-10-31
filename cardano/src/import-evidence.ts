// Imports the signed Airnode responses the keeper publishes (keeper-data/keeper.json) into cardano/evidence/, so this
// service sells what the keeper already bought, never calling AeroDataBox again. Each response is checked before saving:
// its signer must be the AeroDataBox Airnode and its request hash must match a known flight.
//
//   git fetch origin keeper-data && git show origin/keeper-data:keeper.json > /tmp/keeper.json
//   npm run import-evidence -- /tmp/keeper.json
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { recoverSigner, type SignedResponse } from '../../keeper/src/airnode-v2.ts';
import { AERODATABOX_AIRNODE, type Kind, requestHashFor } from '../../keeper/src/flight.ts';

export interface Claimable { flight: string; date: string }

export const importEvidence = async (responses: SignedResponse[], flights: Claimable[], dir: string) => {
  const index = new Map<string, { flight: string; date: string; kind: Kind }>();
  for (const { flight, date } of flights) {
    for (const kind of ['arrival', 'status'] as Kind[]) index.set(requestHashFor(flight, date, kind), { flight, date, kind });
  }
  const saved: string[] = [];
  const skipped: string[] = [];
  for (const r of responses) {
    const match = index.get(r.requestHash);
    if (!match) { skipped.push(`${r.requestHash.slice(0, 10)}: unknown request`); continue; }
    if ((await recoverSigner(r)).toLowerCase() !== AERODATABOX_AIRNODE.toLowerCase()) { skipped.push(`${match.flight}: not signed by the Airnode`); continue; }
    const name = `${match.flight}-${match.date}-${match.kind}-${r.timestamp}.json`;
    const file = `${dir}/${name}`;
    if (existsSync(file)) continue;
    const { airnode, requestHash, timestamp, data, signature } = r;
    const extra = r as SignedResponse & { paymentTx?: string; fetchedAt?: number };
    writeFileSync(file, JSON.stringify({ flight: match.flight, date: match.date, airnode, requestHash, timestamp, data, signature,
      fetchedAt: extra.fetchedAt, paymentTx: extra.paymentTx }, null, 2) + '\n');
    saved.push(`${name}  ${JSON.parse(data).status}`);
  }
  return { saved, skipped };
};

if (import.meta.filename === process.argv[1]) {
  const source = process.argv[2];
  if (!source) throw new Error('Usage: npm run import-evidence -- <keeper.json>');
  const keeper = JSON.parse(readFileSync(source, 'utf8')) as { evidence: SignedResponse[] };
  const flights = JSON.parse(readFileSync(new URL('../claims.json', import.meta.url), 'utf8')) as Claimable[];
  const { saved, skipped } = await importEvidence(keeper.evidence, flights, fileURLToPath(new URL('../evidence', import.meta.url)));
  for (const s of saved) console.log(`+ ${s}`);
  for (const s of skipped) console.log(`- ${s}`);
  console.log(`${saved.length} new, ${skipped.length} skipped`);
}
