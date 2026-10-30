// An agent buys one flight verdict: pays tADA on Cardano preprod over x402, prints the tx and records it in EVIDENCE.md.
import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { decodePaymentResponseHeader } from '@x402/fetch';
import { blockfrost, env, payingFetch, txLink, walletFor } from './cardano.ts';

const { values } = parseArgs({
  options: {
    flight: { type: 'string', default: 'IB1314' },
    date: { type: 'string', default: '2026-10-30' },
    server: { type: 'string', default: process.env.SERVER_URL || 'http://localhost:4021' },
    record: { type: 'boolean', default: true },
  },
});

const wallet = walletFor(env('BUYER_MNEMONIC'), blockfrost());
const url = `${values.server}/verdict?flight=${encodeURIComponent(values.flight!)}&date=${values.date}`;

console.log(`buyer ${wallet.getAddress()}\nGET ${url}`);
const res = await payingFetch(wallet)(url);
const header = res.headers.get('PAYMENT-RESPONSE');
const receipt = header ? decodePaymentResponseHeader(header) : undefined;
const body = await res.json().catch(() => undefined);
if (!res.ok || !receipt?.success) {
  console.error(`failed: HTTP ${res.status}`, JSON.stringify(receipt ?? body, null, 2));
  process.exit(1);
}

const tx = receipt.transaction;
console.log(JSON.stringify(body, null, 2));
console.log(`\npaid on ${receipt.network}: ${tx}\n${txLink(tx)}`);
if (values.record) {
  const v = body.verdict;
  appendFileSync(
    new URL('../EVIDENCE.md', import.meta.url),
    `| ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC | ${body.flight} ${body.date} | ${v.status}${v.delayMinutes !== undefined ? `, +${v.delayMinutes} min` : ''} | [${tx.slice(0, 16)}…](${txLink(tx)}) |\n`,
  );
  console.log('recorded in cardano/EVIDENCE.md');
}
