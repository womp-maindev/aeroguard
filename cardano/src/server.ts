// Pay-per-request flight verdicts over x402 on Cardano preprod, after the x402-express template.
// GET /verdict?flight=IB1314&date=2026-10-30 answers 402 with a tADA (or tUSDM) price; paid, it returns the signed verdict.
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { decodeCardanoTransaction, slotToPosixMs, toFacilitatorCardanoSigner, USDM_PREPROD_ASSET } from '@x402/cardano';
import { ExactCardanoScheme as FacilitatorScheme } from '@x402/cardano/exact/facilitator';
import { ExactCardanoScheme as ServerScheme } from '@x402/cardano/exact/server';
import { decodePaymentSignatureHeader } from '@x402/core/http';
import { x402Facilitator } from '@x402/core/facilitator';
import { type FacilitatorClient, type HTTPRequestContext, type HTTPTransportContext, HTTPFacilitatorClient, type VerifyContext, x402ResourceServer } from '@x402/core/server';
import { paymentMiddleware } from '@x402/express';
import { blockfrost, NETWORK, sellerAddress, txLink } from './cardano.ts';
import { confirmExpiry, PaymentOperations, type Sale, SalesLog } from './payments.ts';
import { buildVerdict, EVIDENCE_DIRS, findEvidence, isValidQuery, listEvidence, tierOf } from './verdict.ts';

// A final proof (arrived or cancelled) settles a claim and is worth more than a live one. Lovelace and tUSDM units.
export const PRICES = {
  live: { lovelace: process.env.LIVE_PRICE_LOVELACE || '1000000', usdm: '50000' },
  final: { lovelace: process.env.FINAL_PRICE_LOVELACE || '2000000', usdm: '100000' },
};
const QUERY_KEYS = new Set(['flight', 'date', 'requestId']);

// The facilitator only verifies and broadcasts the buyer's signed transaction: it holds no keys and no funds.
export const localFacilitator = (provider: { baseUrl: string; projectId: string }, confirmationTimeoutMs = 75_000): FacilitatorClient => {
  const chain = toFacilitatorCardanoSigner({ network: NETWORK, provider: { blockfrost: provider }, awaitConfirmation: false });
  const f = new x402Facilitator().register(NETWORK, new FacilitatorScheme(chain, { confirmationTimeoutMs }));
  return {
    verify: (payload, requirements) => f.verify(payload, requirements),
    settle: async (payload, requirements) => confirmExpiry(await f.settle(payload, requirements), chain),
    getSupported: async () => f.getSupported() as Awaited<ReturnType<FacilitatorClient['getSupported']>>,
  };
};

export interface AppOptions {
  facilitator: FacilitatorClient;
  payTo: string;
  l1Confirmations?: number;
  evidenceDirs?: string[];
  usdmAsset?: string;
  sales?: SalesLog;
  // Called once per settled sale, e.g. to anchor the verdict on chain. Errors are logged, never shown to the buyer.
  onSale?: (sale: Sale) => Promise<Partial<Sale> | void>;
}

export const createApp = async (o: AppOptions) => {
  const dirs = o.evidenceDirs ?? EVIDENCE_DIRS;
  const sales = o.sales ?? new SalesLog();
  const usdm = o.usdmAsset || USDM_PREPROD_ASSET;
  const payments = new PaymentOperations();
  const server = new x402ResourceServer(o.facilitator).register(NETWORK, new ServerScheme());

  const queryOf = (url: string) => {
    const q = new URL(url, 'http://local').searchParams;
    return { flight: q.get('flight') ?? '', date: q.get('date') ?? '', requestId: q.get('requestId') ?? undefined };
  };
  const tierFor = (ctx: HTTPRequestContext) => {
    const { flight, date } = queryOf(ctx.adapter.getUrl());
    const found = findEvidence(flight, date, dirs);
    return found ? tierOf(found.response) : 'final';
  };
  // One payment buys one (flight, date, requestId) operation; a resumed request with the same payment gets the same answer.
  const identity = (context: { paymentPayload: unknown; requirements: unknown; transportContext?: unknown }) => {
    const request = (context.transportContext as HTTPTransportContext).request;
    const { flight, date, requestId } = queryOf(request.adapter.getUrl());
    const tx = decodeCardanoTransaction(String((context.paymentPayload as { payload: { transaction: string } }).payload.transaction));
    const operation = `GET /verdict?flight=${flight.toUpperCase()}&date=${date}:${requestId || tx.txHash}`;
    const fingerprint = createHash('sha256').update(JSON.stringify([context.paymentPayload, context.requirements])).digest('hex');
    return { tx, operation, fingerprint, flight, date };
  };

  server.onBeforeVerify(async (context: VerifyContext) => {
    try {
      const { tx, operation, fingerprint } = identity(context);
      const result = payments.verified(tx.txHash, operation, fingerprint);
      // A resumed request must reach settle(), which owns confirmation polling and expiry.
      if (result) return { skip: true as const, result };
    } catch { /* let the official verifier explain malformed payments */ }
  });
  server.onAfterVerify(async (context) => {
    if (!context.result.isValid) {
      console.warn(`[verify] ${context.result.invalidReason ?? 'invalid_payment'}${context.result.invalidMessage ? `: ${context.result.invalidMessage}` : ''}`);
      return;
    }
    try {
      const { tx, operation, fingerprint } = identity(context);
      const reason = payments.claim(tx.txHash, operation, tx.ttlSlot === undefined ? 0 : slotToPosixMs(NETWORK, tx.ttlSlot));
      if (reason) return { abort: true as const, reason };
      payments.rememberVerification(tx.txHash, fingerprint, context.result);
    } catch {
      return { abort: true as const, reason: 'invalid_payment_operation' };
    }
  });
  server.onAfterSettle(async (context) => {
    // A resumed request settles the same transaction again: log and anchor it only once.
    if (!context.result.success || sales.has(context.result.transaction)) return;
    try {
      const { flight, date } = identity(context);
      const found = findEvidence(flight, date, dirs);
      const sale: Sale = {
        at: new Date().toISOString(), tx: context.result.transaction, network: context.result.network,
        flight: flight.toUpperCase(), date, kind: found?.kind ?? 'unknown', requestHash: found?.response.requestHash ?? '',
        amount: context.requirements.amount, asset: context.requirements.asset, payer: context.result.payer,
      };
      sales.add(sale);
      if (o.onSale) {
        void o.onSale(sale).then((patch) => { if (patch) sales.update(sale.tx, patch); })
          .catch((e) => console.warn(`[sale hook] ${e instanceof Error ? e.message : e}`));
      }
    } catch (e) { console.warn(`[sales] ${e instanceof Error ? e.message : e}`); }
  });
  server.onVerifyFailure(async ({ error }) => console.warn(`[verify] ${error.message}`));
  server.onSettleFailure(async ({ error }) => console.warn(`[settle] ${error.message}`));

  const option = (asset: 'lovelace' | 'usdm') => ({
    scheme: 'exact',
    network: NETWORK,
    payTo: o.payTo,
    price: (ctx: HTTPRequestContext) => ({ amount: PRICES[tierFor(ctx)][asset], asset: asset === 'lovelace' ? 'lovelace' : usdm }),
    maxTimeoutSeconds: 600,
    extra: { assetTransferMethod: 'default', areFeesSponsored: false, confirmationPolicy: { l1Confirmations: o.l1Confirmations ?? 0 } },
  });
  const routes = {
    'GET /verdict': {
      accepts: [option('lovelace'), option('usdm')],
      description: 'AeroGuard flight verdict with an Airnode-signed proof any contract can verify',
      mimeType: 'application/json',
      settlementFailedResponseBody: (_c: unknown, result: { errorReason?: string }) =>
        ({ contentType: 'application/json', body: { error: result.errorReason ?? 'settlement_failed' } }),
    },
  };

  const app = express();
  app.enable('case sensitive routing');
  app.enable('strict routing');
  app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.get('/health', (_req, res) => { res.json({ status: 'ok', network: NETWORK, payTo: o.payTo }); });

  // Free discovery for agents: what is sold, for how much, and how to verify it.
  const flights = () => listEvidence(dirs).map((e) => ({ ...e, price: { ...PRICES[e.tier], usdmAsset: usdm } }));
  app.get('/flights', (_req, res) => { res.json(flights()); });
  app.get('/sales', (_req, res) => { res.json(sales.all().map((s) => ({ ...s, explorer: txLink(s.tx) }))); });
  app.get('/.well-known/x402', (_req, res) => {
    res.json({
      x402Version: 2,
      service: 'AeroGuard flight verdicts',
      resources: [{
        method: 'GET', path: '/verdict', query: { flight: 'IATA flight number, e.g. IB1314', date: 'local date YYYY-MM-DD', requestId: 'optional, [A-Za-z0-9-]{1,100}' },
        network: NETWORK, scheme: 'exact', assets: ['lovelace', usdm], prices: PRICES,
        returns: 'verdict + AeroDataBox Airnode-signed evidence {airnode, requestHash, timestamp, data, signature}',
        verify: 'ecrecover(toEthSignedMessageHash(keccak256(abi.encodePacked(requestHash, timestamp, data)))) == airnode',
      }],
      catalog: '/flights',
      sales: '/sales',
    });
  });

  // Validation before the payment gate: nobody pays for a flight we cannot prove.
  app.get('/verdict', (req, res, next) => {
    const { flight, date, requestId } = req.query;
    if (Object.keys(req.query).some((k) => !QUERY_KEYS.has(k)) || !isValidQuery(flight, date)
      || (requestId !== undefined && (typeof requestId !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(requestId)))) {
      res.status(400).json({ error: 'Use /verdict?flight=IB1314&date=2026-10-30[&requestId=...]' }); return;
    }
    if (!findEvidence(flight, date as string, dirs)) { res.status(404).json({ error: `No signed evidence for ${flight} on ${date}; see /flights` }); return; }
    next();
  });
  app.use(paymentMiddleware(routes as never, server));
  app.get('/verdict', async (req, res, next) => {
    try {
      const payment = decodePaymentSignatureHeader(req.get('PAYMENT-SIGNATURE')!);
      const { txHash } = decodeCardanoTransaction(String(payment.payload.transaction));
      const body = await payments.result(txHash, async () => ({
        ...(await buildVerdict(String(req.query.flight), String(req.query.date), dirs)),
        paidWith: { network: NETWORK, txHash, explorer: txLink(txHash), amount: payment.accepted.amount, asset: payment.accepted.asset },
      }));
      res.json(body);
    } catch (e) { next(e); }
  });
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[server]', error instanceof Error ? error.message : error);
    res.status(500).json({ error: 'The server could not process this request. Retry the same payment.' });
  });
  return app;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.FACILITATOR_URL?.trim();
  const facilitator = url ? new HTTPFacilitatorClient({ url, timeoutMs: 120_000 }) : localFacilitator(blockfrost());
  const payTo = sellerAddress();
  const sales = new SalesLog(new URL('../evidence/sales.jsonl', import.meta.url).pathname);
  const onSale = process.env.ANCHOR === 'true' ? (await import('./anchor.ts')).anchorSale : undefined;
  const app = await createApp({ facilitator, payTo, sales, onSale, l1Confirmations: Number(process.env.L1_CONFIRMATIONS ?? 0), usdmAsset: process.env.USDM_ASSET?.trim() });
  const port = Number(process.env.PORT || 4021);
  app.listen(port, () => console.log(`AeroGuard x402 (Cardano preprod): http://localhost:${port}/verdict?flight=IB1314&date=2026-10-30  payTo ${payTo}${onSale ? '  (anchoring sales on chain)' : ''}`));
}
