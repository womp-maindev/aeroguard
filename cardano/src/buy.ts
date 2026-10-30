// An agent buys one flight verdict: pays tADA on Cardano preprod over x402, prints the tx and records it in EVIDENCE.md.
import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { decodePaymentRequiredHeader } from '@x402/core/http';
import { decodePaymentResponseHeader } from '@x402/fetch';
import { blockfrost, env, payingFetch, txLink, walletFor } from './cardano.ts';

export const EVIDENCE_MD = new URL('../EVIDENCE.md', import.meta.url);

export const recordEvidence = (body: { flight: string; date: string; verdict: { status: string; delayMinutes?: number } }, tx: string, file: URL | string = EVIDENCE_MD) => {
  const v = body.verdict;
  appendFileSync(file,
    `| ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC | ${body.flight} ${body.date} | ${v.status}${v.delayMinutes !== undefined ? `, +${v.delayMinutes} min` : ''} | [${tx.slice(0, 16)}…](${txLink(tx)}) |\n`);
};

/** The unpaid request: what the server asks for (the 402 offer), for people watching the exchange. */
export const showOffer = async (server: string, flight: string, date: string, log = console.log) => {
  const res = await fetch(`${server}/verdict?flight=${encodeURIComponent(flight)}&date=${date}`);
  const header = res.headers.get('PAYMENT-REQUIRED');
  if (res.status !== 402 || !header) { log(`HTTP ${res.status}: ${await res.text()}`); return undefined; }
  const offer = decodePaymentRequiredHeader(header);
  for (const a of offer.accepts) {
    const amount = a.asset === 'lovelace' ? `${Number(a.amount) / 1e6} tADA` : `${Number(a.amount) / 1e6} tUSDM`;
    log(`  402 → pay ${amount} on ${a.network} to ${a.payTo.slice(0, 20)}… (${a.scheme}, valid ${a.maxTimeoutSeconds}s)`);
  }
  return offer;
};

/** One paid request. Throws with the server's reason when the payment does not settle. */
export const buyVerdict = async (o: { server: string; flight: string; date: string; pay: typeof fetch }) => {
  const url = `${o.server}/verdict?flight=${encodeURIComponent(o.flight)}&date=${o.date}`;
  const res = await o.pay(url);
  const header = res.headers.get('PAYMENT-RESPONSE');
  const receipt = header ? decodePaymentResponseHeader(header) : undefined;
  const body = await res.json().catch(() => undefined);
  if (!res.ok || !receipt?.success) throw new Error(`HTTP ${res.status}: ${JSON.stringify(receipt ?? body)}`);
  return { url, body, receipt, tx: receipt.transaction };
};

if (import.meta.filename === process.argv[1]) {
  const { values } = parseArgs({
    options: {
      flight: { type: 'string', default: 'IB1314' },
      date: { type: 'string', default: '2026-10-30' },
      server: { type: 'string', default: process.env.SERVER_URL || 'http://localhost:4021' },
      record: { type: 'boolean', default: true },
    },
  });
  const wallet = walletFor(env('BUYER_MNEMONIC'), blockfrost());
  console.log(`buyer ${wallet.getAddress()}`);
  try {
    await showOffer(values.server!, values.flight!, values.date!);
    const { body, receipt, tx } = await buyVerdict({ server: values.server!, flight: values.flight!, date: values.date!, pay: payingFetch(wallet) });
    console.log(JSON.stringify(body, null, 2));
    console.log(`\npaid on ${receipt.network}: ${tx}\n${txLink(tx)}`);
    if (values.record) { recordEvidence(body, tx); console.log('recorded in cardano/EVIDENCE.md'); }
  } catch (e) {
    console.error(`failed: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}
