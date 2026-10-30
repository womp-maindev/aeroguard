// Pay-per-request flight verdicts over x402 on Cardano preprod, after the x402-express template.
// GET /verdict?flight=IB1314&date=2026-10-30 answers 402 with a tADA price; paid, it returns the signed verdict.
import { fileURLToPath } from 'node:url';
import express from 'express';
import { decodeCardanoTransaction, toFacilitatorCardanoSigner } from '@x402/cardano';
import { ExactCardanoScheme as FacilitatorScheme } from '@x402/cardano/exact/facilitator';
import { ExactCardanoScheme as ServerScheme } from '@x402/cardano/exact/server';
import { decodePaymentSignatureHeader } from '@x402/core/http';
import { x402Facilitator } from '@x402/core/facilitator';
import { type FacilitatorClient, HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server';
import { paymentMiddleware } from '@x402/express';
import { blockfrost, NETWORK, PRICE_LOVELACE, sellerAddress, txLink } from './cardano.ts';
import { buildVerdict, EVIDENCE_DIRS, findEvidence, isValidQuery, listEvidence } from './verdict.ts';

// The facilitator only verifies and broadcasts the buyer's signed transaction: it holds no keys and no funds.
export const localFacilitator = (provider: { baseUrl: string; projectId: string }, confirmationTimeoutMs = 75_000): FacilitatorClient => {
  const chain = toFacilitatorCardanoSigner({ network: NETWORK, provider: { blockfrost: provider }, awaitConfirmation: false });
  const f = new x402Facilitator().register(NETWORK, new FacilitatorScheme(chain, { confirmationTimeoutMs }));
  return {
    verify: (payload, requirements) => f.verify(payload, requirements),
    settle: (payload, requirements) => f.settle(payload, requirements),
    getSupported: async () => f.getSupported() as Awaited<ReturnType<FacilitatorClient["getSupported"]>>,
  };
};

export const createApp = async (o: { facilitator: FacilitatorClient; payTo: string; price?: string; l1Confirmations?: number; evidenceDirs?: string[] }) => {
  const dirs = o.evidenceDirs ?? EVIDENCE_DIRS;
  const server = new x402ResourceServer(o.facilitator).register(NETWORK, new ServerScheme());
  server.onVerifyFailure(async ({ error }) => console.warn(`[verify] ${error.message}`));
  server.onSettleFailure(async ({ error }) => console.warn(`[settle] ${error.message}`));
  const routes = {
    'GET /verdict': {
      accepts: {
        scheme: 'exact',
        network: NETWORK,
        payTo: o.payTo,
        price: { amount: o.price ?? PRICE_LOVELACE, asset: 'lovelace' },
        maxTimeoutSeconds: 600,
        extra: { assetTransferMethod: 'default', areFeesSponsored: false, confirmationPolicy: { l1Confirmations: o.l1Confirmations ?? 0 } },
      },
      description: 'AeroGuard flight verdict with an Airnode-signed proof any EVM contract can verify',
      mimeType: 'application/json',
    },
  } as const;

  const app = express();
  app.enable('case sensitive routing');
  app.enable('strict routing');
  app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.get('/health', (_req, res) => { res.json({ status: 'ok', network: NETWORK, payTo: o.payTo }); });
  // Free: which flights have evidence. Nobody pays for a flight we cannot answer.
  app.get('/flights', (_req, res) => { res.json(listEvidence(dirs)); });
  app.get('/verdict', (req, res, next) => {
    const { flight, date } = req.query;
    if (!isValidQuery(flight, date)) { res.status(400).json({ error: 'Use /verdict?flight=IB1314&date=2026-10-30' }); return; }
    if (!findEvidence(flight, date as string, dirs)) { res.status(404).json({ error: `No signed evidence for ${flight} on ${date}; see /flights` }); return; }
    next();
  });
  app.use(paymentMiddleware(routes as never, server));
  app.get('/verdict', async (req, res, next) => {
    try {
      const payment = decodePaymentSignatureHeader(req.get('PAYMENT-SIGNATURE')!);
      const { txHash } = decodeCardanoTransaction(String(payment.payload.transaction));
      const body = await buildVerdict(String(req.query.flight), String(req.query.date), dirs);
      res.json({ ...body, paidWith: { network: NETWORK, txHash, explorer: txLink(txHash) } });
    } catch (e) { next(e); }
  });
  return app;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.FACILITATOR_URL?.trim();
  const facilitator = url ? new HTTPFacilitatorClient({ url, timeoutMs: 120_000 }) : localFacilitator(blockfrost());
  const payTo = sellerAddress();
  const app = await createApp({ facilitator, payTo, l1Confirmations: Number(process.env.L1_CONFIRMATIONS ?? 0) });
  const port = Number(process.env.PORT || 4021);
  app.listen(port, () => console.log(`AeroGuard x402 (Cardano preprod): http://localhost:${port}/verdict?flight=IB1314&date=2026-10-30  payTo ${payTo}`));
}
