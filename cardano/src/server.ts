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
import { keccak256, toHex } from 'viem';
import { blockfrost, NETWORK, sellerAddress, txLink } from './cardano.ts';
import { confirmExpiry, type Order, OrdersLog, PaymentOperations, type Sale, SalesLog } from './payments.ts';
import { buildVerdict, EVIDENCE_DIRS, findEvidence, isValidQuery, listEvidence, tierOf } from './verdict.ts';

// A final proof (arrived or cancelled) settles a claim and is worth more than a live one. Lovelace and tUSDM units.
export const PRICES = {
  live: { lovelace: process.env.LIVE_PRICE_LOVELACE || '1000000', usdm: '50000' },
  final: { lovelace: process.env.FINAL_PRICE_LOVELACE || '2000000', usdm: '100000' },
};
const QUERY_KEYS = new Set(['flight', 'date', 'requestId']);
const POLICY_KEYS = new Set(['flight', 'date', 'holder', 'coverage', 'requestId']);
const MIN_LOVELACE = 1_000_000n; // a Cardano output below ~1 ADA is not valid
// FlightDelayCover accepts these signed statuses at purchase.
const PRE_DEPARTURE = new Set(['Expected', 'Unknown', 'CheckIn', 'Boarding']);

/** Sells FlightDelayCover policies on Base Sepolia for tADA. `buy` runs only after the Cardano payment settled. */
export interface PolicyDesk {
  premium(coverage: bigint): Promise<bigint>; // aUSD units, the contract's quote()
  buy(a: { flight: string; date: string; holder: `0x${string}`; coverage: bigint; orderId: string }): Promise<{ policyId: bigint; txHash: string; explorer: string }>;
  lovelacePerUnit: bigint; // exchange rate: lovelace per aUSD unit (1e-6 aUSD)
  maxCoverage: bigint;
}

/** The order id the policy carries on Base (cardanoJobRef = keccak256 of it), so either chain points to the other. */
export const orderIdFor = (cardanoTx: string) => `cardano:${cardanoTx}`;
export const orderRefFor = (cardanoTx: string) => keccak256(toHex(orderIdFor(cardanoTx)));
export const policyLovelace = (premium: bigint, rate: bigint) => (premium * rate > MIN_LOVELACE ? premium * rate : MIN_LOVELACE);

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
  // Enables GET /policy: tADA buys a FlightDelayCover policy on Base Sepolia.
  desk?: PolicyDesk;
  orders?: OrdersLog;
}

export const createApp = async (o: AppOptions) => {
  const dirs = o.evidenceDirs ?? EVIDENCE_DIRS;
  const sales = o.sales ?? new SalesLog();
  const orders = o.orders ?? new OrdersLog();
  const usdm = o.usdmAsset || USDM_PREPROD_ASSET;
  const payments = new PaymentOperations();
  const server = new x402ResourceServer(o.facilitator).register(NETWORK, new ServerScheme());

  const queryOf = (url: string) => {
    const u = new URL(url, 'http://local');
    const q = u.searchParams;
    return { path: u.pathname, flight: q.get('flight') ?? '', date: q.get('date') ?? '', requestId: q.get('requestId') ?? undefined,
      holder: (q.get('holder') ?? '').toLowerCase(), coverage: q.get('coverage') ?? '' };
  };
  const premiumFor = async (ctx: HTTPRequestContext) => o.desk!.premium(BigInt(queryOf(ctx.adapter.getUrl()).coverage));
  const tierFor = (ctx: HTTPRequestContext) => {
    const { flight, date } = queryOf(ctx.adapter.getUrl());
    const found = findEvidence(flight, date, dirs);
    return found ? tierOf(found.response) : 'final';
  };
  // One payment buys one (flight, date, requestId) operation; a resumed request with the same payment gets the same answer.
  const identity = (context: { paymentPayload: unknown; requirements: unknown; transportContext?: unknown }) => {
    const request = (context.transportContext as HTTPTransportContext).request;
    const q = queryOf(request.adapter.getUrl());
    const tx = decodeCardanoTransaction(String((context.paymentPayload as { payload: { transaction: string } }).payload.transaction));
    const what = q.path === '/policy' ? `&holder=${q.holder}&coverage=${q.coverage}` : '';
    const operation = `GET ${q.path}?flight=${q.flight.toUpperCase()}&date=${q.date}${what}:${q.requestId || tx.txHash}`;
    const fingerprint = createHash('sha256').update(JSON.stringify([context.paymentPayload, context.requirements])).digest('hex');
    return { tx, operation, fingerprint, ...q };
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
    if (!context.result.success) return;
    const q = identity(context);
    if (q.path === '/policy') { openOrder(context.result.transaction, q, context.requirements); return; }
    // A resumed request settles the same transaction again: log and anchor it only once.
    if (sales.has(context.result.transaction)) return;
    try {
      const { flight, date } = q;
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
  // The Cardano payment is final: only now buy the policy on Base. A failure is recorded as a refund due, never hidden.
  // The order is recorded synchronously, before any await, so a second settle of the same payment can never buy again.
  const openOrder = (tx: string, q: ReturnType<typeof queryOf>, req: { amount: string; asset: string }) => {
    if (orders.has(tx)) return;
    const coverage = BigInt(q.coverage);
    orders.add({
      at: new Date().toISOString(), tx, orderRef: orderRefFor(tx), flight: q.flight.toUpperCase(), date: q.date, holder: q.holder,
      coverage: q.coverage, premium: '', amount: req.amount, asset: req.asset, status: 'buying',
    });
    void (async () => {
      // The contract quote may have moved since the 402: never pay more aUSD than the tADA received covers.
      const premium = await o.desk!.premium(coverage);
      orders.update(tx, { premium: String(premium) });
      if (req.asset !== 'lovelace' || policyLovelace(premium, o.desk!.lovelacePerUnit) > BigInt(req.amount)) {
        throw new Error(`quote moved: premium ${premium} aUSD units now costs more than the ${req.amount} ${req.asset} paid`);
      }
      const r = await o.desk!.buy({ flight: q.flight.toUpperCase(), date: q.date, holder: q.holder as `0x${string}`, coverage, orderId: orderIdFor(tx) });
      orders.update(tx, { status: 'bought', policyId: String(r.policyId), policyTx: r.txHash, explorer: r.explorer });
    })().catch((e) => {
      console.warn(`[policy] ${tx}: ${e instanceof Error ? e.message : e}`);
      orders.update(tx, { status: 'failed', error: String(e instanceof Error ? e.message : e).slice(0, 300), refundDue: true });
    });
  };
  // (3) A restart while buying leaves the outcome unknown: flag it for a manual check instead of letting it hang.
  for (const order of orders.all().filter((x) => x.status === 'buying')) {
    orders.update(order.tx, { status: 'failed', refundDue: true,
      error: `server restarted during the purchase: check Base for a policy with cardanoJobRef ${order.orderRef} before refunding` });
  }

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
  const policyOption = {
    scheme: 'exact',
    network: NETWORK,
    payTo: o.payTo,
    price: async (ctx: HTTPRequestContext) => ({ amount: String(policyLovelace(await premiumFor(ctx), o.desk!.lovelacePerUnit)), asset: 'lovelace' }),
    maxTimeoutSeconds: 600,
    extra: { assetTransferMethod: 'default', areFeesSponsored: false, confirmationPolicy: { l1Confirmations: o.l1Confirmations ?? 0 } },
  };
  const routes = {
    ...(o.desk ? { 'GET /policy': {
      accepts: [policyOption],
      description: 'FlightDelayCover policy on Base Sepolia, premium paid in tADA; bought after the Cardano payment settles',
      mimeType: 'application/json',
      settlementFailedResponseBody: (_c: unknown, result: { errorReason?: string }) =>
        ({ contentType: 'application/json', body: { error: result.errorReason ?? 'settlement_failed' } }),
    } } : {}),
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
  app.get('/orders/:tx', (req, res) => {
    const order = orders.get(req.params.tx);
    if (!order) { res.status(404).json({ error: 'No order for this Cardano transaction (yet)' }); return; }
    res.json({ ...order, cardanoExplorer: txLink(order.tx) });
  });
  app.get('/.well-known/x402', (_req, res) => {
    res.json({
      x402Version: 2,
      service: 'AeroGuard flight verdicts',
      resources: [{
        method: 'GET', path: '/verdict', query: { flight: 'IATA flight number, e.g. IB1314', date: 'local date YYYY-MM-DD', requestId: 'optional, [A-Za-z0-9-]{1,100}' },
        network: NETWORK, scheme: 'exact', assets: ['lovelace', usdm], prices: PRICES,
        returns: 'verdict + AeroDataBox Airnode-signed evidence {airnode, requestHash, timestamp, data, signature}',
        verify: 'ecrecover(toEthSignedMessageHash(keccak256(abi.encodePacked(requestHash, timestamp, data)))) == airnode',
      }, ...(o.desk ? [{
        method: 'GET', path: '/policy', query: { flight: 'IATA flight number', date: 'YYYY-MM-DD', holder: 'EVM address that receives the payout',
          coverage: `aUSD units, ≤ ${o.desk.maxCoverage}` },
        network: NETWORK, scheme: 'exact', assets: ['lovelace'], price: 'contract premium × rate, at least 1 tADA',
        returns: 'order; the FlightDelayCover policy is bought on Base Sepolia after the payment settles (poll /orders/:tx)',
        link: 'policy.cardanoJobRef = keccak256("cardano:<Cardano tx hash>")',
      }] : [])],
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
  app.get('/policy', (req, res, next) => {
    if (!o.desk) { res.status(404).json({ error: 'Policy sales are not enabled on this server' }); return; }
    const { flight, date, holder, coverage, requestId } = req.query;
    const ok = !Object.keys(req.query).some((k) => !POLICY_KEYS.has(k)) && isValidQuery(flight, date)
      && typeof holder === 'string' && /^0x[0-9a-fA-F]{40}$/.test(holder)
      && typeof coverage === 'string' && /^[1-9]\d{0,18}$/.test(coverage) && BigInt(coverage) <= o.desk.maxCoverage
      && (requestId === undefined || (typeof requestId === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(requestId)));
    if (!ok) { res.status(400).json({ error: `Use /policy?flight=LH1234&date=YYYY-MM-DD&holder=0x…&coverage=1..${o.desk.maxCoverage} (aUSD units)` }); return; }
    // Free checks before charging: a flight dated before yesterday (UTC, any time zone) or one our signed evidence
    // already shows past the gate cannot be insured. The contract's own checks still apply after payment.
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    if ((date as string) < yesterday) { res.status(409).json({ error: `${flight} on ${date} is in the past` }); return; }
    const known = findEvidence(flight as string, date as string, dirs);
    const status = known && (JSON.parse(known.response.data) as { status: string }).status;
    if (status && !PRE_DEPARTURE.has(status)) { res.status(409).json({ error: `${flight} on ${date} is ${status}; cover is sold only before departure` }); return; }
    next();
  });
  app.use(paymentMiddleware(routes as never, server));
  app.get('/policy', async (req, res, next) => {
    try {
      const payment = decodePaymentSignatureHeader(req.get('PAYMENT-SIGNATURE')!);
      const { txHash } = decodeCardanoTransaction(String(payment.payload.transaction));
      res.json(await payments.result(txHash, async () => ({
        order: txHash, orderRef: orderRefFor(txHash), status: 'paid',
        next: 'The policy is bought on Base Sepolia once this payment is final; poll the order.',
        poll: `/orders/${txHash}`,
        paidWith: { network: NETWORK, txHash, explorer: txLink(txHash), amount: payment.accepted.amount, asset: payment.accepted.asset },
      })));
    } catch (e) { next(e); }
  });
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

/** The live desk: the keeper's own purchase path (buys a fresh signed status proof, then buyPolicy with the order id). */
const keeperDesk = async (): Promise<PolicyDesk> => {
  const chain = await import('../../keeper/src/chain.ts');
  const keeper = await import('../../keeper/src/keeper.ts');
  return {
    premium: (coverage) => chain.publicClient().readContract({ address: chain.coverAddress(), abi: chain.coverAbi, functionName: 'quote', args: [coverage] }) as Promise<bigint>,
    buy: async (a) => {
      const r = await keeper.cover(a);
      return { policyId: r.policyId, txHash: r.txHash, explorer: chain.explorerTx(r.txHash) };
    },
    // Demo rate for testnets: 1 aUSD = 10 tADA. Override with LOVELACE_PER_AUSD_UNIT.
    lovelacePerUnit: BigInt(process.env.LOVELACE_PER_AUSD_UNIT || '10'),
    maxCoverage: BigInt(process.env.MAX_COVERAGE || '2000000'),
  };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.FACILITATOR_URL?.trim();
  const facilitator = url ? new HTTPFacilitatorClient({ url, timeoutMs: 120_000 }) : localFacilitator(blockfrost());
  const payTo = sellerAddress();
  const sales = new SalesLog(fileURLToPath(new URL('../evidence/sales.jsonl', import.meta.url)));
  const onSale = process.env.ANCHOR === 'true' ? (await import('./anchor.ts')).anchorSale : undefined;
  const desk = process.env.KEEPER_PK && process.env.FLIGHT_COVER_ADDRESS ? await keeperDesk() : undefined;
  const orders = new OrdersLog(fileURLToPath(new URL('../evidence/orders.jsonl', import.meta.url)));
  const app = await createApp({ facilitator, payTo, sales, onSale, desk, orders, l1Confirmations: Number(process.env.L1_CONFIRMATIONS ?? 0), usdmAsset: process.env.USDM_ASSET?.trim() });
  const port = Number(process.env.PORT || 4021);
  app.listen(port, () => console.log(`AeroGuard x402 (Cardano preprod): http://localhost:${port}/verdict?flight=IB1314&date=2026-10-30  payTo ${payTo}${onSale ? '  (anchoring sales on chain)' : ''}${desk ? '  (selling Base policies for tADA)' : ''}`));
}
