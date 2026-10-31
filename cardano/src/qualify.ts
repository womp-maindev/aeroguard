// One command for the qualifying run: preflight, start the paid endpoint, pay for one verdict on Cardano preprod,
// record the tx in EVIDENCE.md and print the Cardanoscan link. `npm run qualify [-- --flight IB1314 --date 2026-10-30]`
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { blockfrost, BLOCKFROST_URL, env, payingFetch, sellerAddress, txLink, walletFor } from './cardano.ts';
import { SalesLog } from './payments.ts';
import { printChecks, preflight } from './preflight.ts';
import { buyVerdict, recordEvidence, showOffer } from './buy.ts';
import { createApp, localFacilitator } from './server.ts';

const { values } = parseArgs({
  options: {
    flight: { type: 'string', default: 'IB1314' },
    date: { type: 'string', default: '2026-10-30' },
  },
});

console.log('1/4 preflight');
if (!printChecks(await preflight(process.env, { baseUrl: BLOCKFROST_URL, flight: values.flight, date: values.date }))) process.exit(1);

console.log('\n2/4 starting the paid endpoint (in-process facilitator over Blockfrost)');
// Overridable so the test run does not touch the committed evidence.
const sales = new SalesLog(process.env.SALES_LOG || fileURLToPath(new URL('../evidence/sales.jsonl', import.meta.url)));
const app = await createApp({ facilitator: localFacilitator(blockfrost()), payTo: sellerAddress(), sales });
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((r) => server.once('listening', r));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

try {
  console.log(`\n3/4 paying for ${values.flight} ${values.date} (this waits for the block, ~20–60 s)`);
  const challenge = await showOffer(origin, values.flight!, values.date!);
  const wallet = walletFor(env('BUYER_MNEMONIC'), blockfrost());
  console.log('  wallet signs a Cardano transaction (never broadcasts it) and retries with PAYMENT-SIGNATURE');
  const { body, tx } = await buyVerdict({ server: origin, flight: values.flight!, date: values.date!, pay: payingFetch(wallet) });
  recordEvidence(body, tx, process.env.EVIDENCE_MD || undefined);
  // The dashboard's Cardano panel shows a recorded run from web/data/cardano-run.json ({ challenge, response }).
  const runFile = process.env.RUN_JSON || fileURLToPath(new URL('../../web/data/cardano-run.json', import.meta.url));
  mkdirSync(dirname(runFile), { recursive: true });
  writeFileSync(runFile, JSON.stringify({ challenge, response: body, tx, explorer: txLink(tx), at: new Date().toISOString() }, null, 2) + '\n');
  console.log(`\n4/4 done: ${body.flight} ${body.date} → ${body.verdict.status}; Airnode signer ${body.verify.signerRecovered}`);
  console.log(`tx   ${tx}\nlink ${txLink(tx)}\nrecorded in cardano/EVIDENCE.md, cardano/evidence/sales.jsonl and web/data/cardano-run.json — commit all three.`);
} catch (e) {
  console.error(`\npayment failed: ${e instanceof Error ? e.message : e}`);
  console.error('Retry the same command once; if it repeats, send this output.');
  process.exitCode = 1;
} finally {
  server.closeAllConnections();
  server.close();
}
