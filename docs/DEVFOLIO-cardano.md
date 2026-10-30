# AeroGuard: Cardano track (Devfolio text)

**One line.** Agents pay per request on Cardano for flight outcomes any contract can verify.

## Who it's for
- **AI travel and expense agents** that must decide on a flight outcome (rebook, claim, reimburse) and need an answer
  they can prove, not a screenshot.
- **Parametric insurers and claim processors** (EU261 delay compensation, travel cover, B2B SLA refunds) that settle on
  a delay or a cancellation.
- **Smart contracts** that pay out on real-world events and need data they can check on chain.

## Problem
Flight data APIs sell monthly plans with API keys: an autonomous agent cannot sign up, and a one-off check costs a
subscription. Worse, the answer is just JSON: the buyer has to trust whoever relays it, so it cannot move money in a
contract. Insurers and claim services end up rebuilding the same trusted-oracle back office.

## What we built
`GET /verdict?flight=IB1314&date=2026-10-30` on Cardano preprod via x402:
1. The unpaid request returns HTTP 402 with a price of 2 tADA.
2. The agent's wallet builds and signs a Cardano transaction (spend-capped: tADA only, max 5 tADA per request) and
   retries with `PAYMENT-SIGNATURE`; it never broadcasts.
3. The facilitator verifies amount, recipient and validity window, submits the transaction and waits for the block.
4. The agent receives the verdict (status, delay, final or not) **plus** the AeroDataBox Airnode's signed response.
   AeroGuard's `FlightDelayCover` contract (live on Base Sepolia) and any `AirnodeV2Attestation.verify` accept that
   proof unchanged; a single edited byte fails the signature check.

Evidence: tx hash(es) in [`cardano/EVIDENCE.md`](../cardano/EVIDENCE.md), code in [`cardano/`](../cardano/).

## Business case
- Pay per answer, no account: a claims agent pays ~0.2–1 ADA per verdict on mainnet, only for flights it needs.
- Margin: one upstream signed lookup (cached) is resold to many buyers; a final arrival never changes, so the cost
  is paid once and every later sale is margin.
- Customers: EU261 claim firms, travel insurers, corporate travel tools, and agent
  marketplaces such as Masumi where agents hire other agents.
- Unknown flights return a free 404: nobody pays for an answer we cannot prove.

## Cardano tools used
- **x402 on Cardano**: `@x402/cardano` 2.26.0 `exact` scheme, `@x402/express` middleware, `@x402/core` client/server/
  facilitator, following the official x402-express template and `cardano-foundation/x402-cardano-demo`.
- **Blockfrost** (preprod) as chain provider for UTxOs, protocol parameters, evaluation and submission.
- **Evolution SDK** (via `@x402/cardano`) for mnemonic wallets and transaction building.
- **Cardano preprod** testnet, Cardano faucet, Cardanoscan for receipts.

## Real-use path
1. Mainnet: switch `cardano:preprod` → `cardano:mainnet`, price in ADA or USDM (the SDK supports native tokens).
2. Hosted facilitator instead of the in-process one; deeper `l1Confirmations` for larger payments.
3. List the endpoint as a Masumi agent so other agents discover and hire it; add the arrival proof feed from our keeper.
4. On-chain consumer on Cardano: a Plutus/Aiken validator checking the Airnode secp256k1 signature
   (`verifyEcdsaSecp256k1Signature` builtin) so a Cardano policy can pay out on the same proof.

## Video segment (≈30 s)
> **[screen: terminal, `npm run server` left, `npm run buy` right]**
> "Flight data today means API keys and monthly plans: agents can't sign up, and contracts can't trust the JSON.
> AeroGuard sells one verdict per request on Cardano.
> The agent asks for IB1314 — the server answers 402: two tADA. **[402 offer appears]**
> Its wallet signs a Cardano transaction, capped at five ADA, and retries. The facilitator checks it and puts it on
> preprod. **[tx hash + Cardanoscan link; cut to Cardanoscan page]**
> Back comes the verdict and the Airnode's signature — the same proof our insurance contract verifies on chain.
> Agents pay per request on Cardano for flight outcomes any contract can verify."
