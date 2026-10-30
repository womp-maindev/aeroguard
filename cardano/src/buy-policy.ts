// An agent buys flight cover on Base Sepolia and pays the premium in tADA on Cardano over x402. The policy carries
// cardanoJobRef = keccak256("cardano:<payment tx>"), so the Base policy and the Cardano payment point to each other.
//   npm run buy-policy -- --flight LH1234 --date 2026-11-01 --holder 0x… [--coverage 500000] [--server http://localhost:4021]
import { parseArgs } from 'node:util';
import { decodePaymentResponseHeader } from '@x402/fetch';
import { showOfferAt } from './buy.ts';
import { blockfrost, env, payingFetch, txLink, walletFor } from './cardano.ts';

export const buyPolicy = async (o: { server: string; flight: string; date: string; holder: string; coverage: string; pay: typeof fetch;
  pollMs?: number; timeoutMs?: number; log?: (s: string) => void }) => {
  const log = o.log ?? console.log;
  const url = `${o.server}/policy?flight=${encodeURIComponent(o.flight)}&date=${o.date}&holder=${o.holder}&coverage=${o.coverage}`;
  await showOfferAt(url, log);
  const res = await o.pay(url);
  const header = res.headers.get('PAYMENT-RESPONSE');
  const receipt = header ? decodePaymentResponseHeader(header) : undefined;
  const body = await res.json().catch(() => undefined);
  if (!res.ok || !receipt?.success) throw new Error(`HTTP ${res.status}: ${JSON.stringify(receipt ?? body)}`);
  log(`  paid on Cardano: ${txLink(receipt.transaction)}\n  cardanoJobRef ${body.orderRef}\n  buying the policy on Base Sepolia…`);
  const deadline = Date.now() + (o.timeoutMs ?? 300_000);
  for (;;) {
    const order = await (await fetch(`${o.server}${body.poll}`)).json();
    if (order.status === 'bought' || order.status === 'failed') return { receipt, order };
    if (Date.now() > deadline) throw new Error(`order ${receipt.transaction} still ${order.status}; poll ${o.server}${body.poll}`);
    await new Promise((r) => setTimeout(r, o.pollMs ?? 5_000));
  }
};

if (import.meta.filename === process.argv[1]) {
  const { values } = parseArgs({
    options: {
      flight: { type: 'string' }, date: { type: 'string' }, holder: { type: 'string' },
      coverage: { type: 'string', default: '500000' },
      server: { type: 'string', default: process.env.SERVER_URL || 'http://localhost:4021' },
    },
  });
  if (!values.flight || !values.date || !values.holder) throw new Error('Need --flight, --date (YYYY-MM-DD) and --holder 0x…');
  const wallet = walletFor(env('BUYER_MNEMONIC'), blockfrost());
  const { order } = await buyPolicy({ server: values.server!, flight: values.flight, date: values.date, holder: values.holder,
    coverage: values.coverage!, pay: payingFetch(wallet) });
  if (order.status === 'bought') console.log(`policy #${order.policyId} on Base Sepolia: ${order.explorer}`);
  else { console.error(`policy purchase failed (${order.error}); refund due for ${order.tx}`); process.exitCode = 1; }
}
