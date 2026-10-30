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
1. The unpaid request returns HTTP 402: 1 tADA for a pre-departure proof, 2 tADA for a final arrival proof (tUSDM also
   offered). Discovery is free: `/flights`, `/sales`, `/.well-known/x402`; unknown flights get a free 404.
2. The agent's wallet builds and signs a Cardano transaction (spend-capped: tADA only, max 5 tADA per request) and
   retries with `PAYMENT-SIGNATURE`; it never broadcasts.
3. The facilitator verifies amount, recipient and validity window, submits the transaction and waits for the block.
4. The agent receives the verdict (status, delay, final or not) **plus** the AeroDataBox Airnode's signed response.
   AeroGuard's `FlightDelayCover` contract (live on Base Sepolia) and any `AirnodeV2Attestation.verify` accept that
   proof unchanged; a single edited byte fails the signature check. Replaying a payment returns the same answer and
   never buys a second one.
5. Optional: the seller anchors each sold proof in Cardano tx metadata (labels 674 + 8402).

**A Cardano contract that verifies the same proof.** `cardano/onchain` is an Aiken (Plutus V3) flight cover validator:
a UTxO holding the cover is released only by an Airnode proof that the flight is final, paying the holder by the same
rule as the EVM contract (cancelled or ≥ 180 min: full, ≥ 120 min: half, else back to the insurer). Plutus has no
`ecrecover`, so it checks `verifyEcdsaSecp256k1Signature` against the Airnode's compressed key over
`keccak_256(prefix ‖ keccak_256(requestHash ‖ timestamp ‖ data))`, rebuilding the signed bytes instead of parsing
JSON. 26 Aiken tests pass, including **real** AeroDataBox Airnode signatures (a pre-departure status and a live
arrival answer bought by our keeper) and forgeries; payouts are tagged
with the policy input against double satisfaction. A settlement costs ≈ 0.46M mem / 0.19B cpu. The off-chain side
(open / settle / reclaim) builds real transactions and executes the validator with Aiken's UPLC evaluator before
submitting; **the verdict body an agent buys over x402 is exactly the redeemer that settles the cover.**

**Agents.** `npm run agent` is a claims agent with a budget: free catalog check, buys only final proofs, decides by
the contract rule, logs each Cardano receipt. `npm run mcp` exposes `list_flights` (free) and `get_flight_verdict`
(paid) as MCP tools for LLM agents.

**Real data, no extra quota.** The service resells the signed answers our keeper already bought for the four live
policies (imported from the keeper's published `keeper-data`, each signature re-checked); a live answer costs 1 tADA,
a final one 2 tADA.

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
- **Evolution SDK** for mnemonic wallets, transaction building and the metadata anchor transaction.
- **Aiken** v1.1.24 + stdlib v2.2.0, Plutus V3 builtins `keccak_256` and `verifyEcdsaSecp256k1Signature`.
- **MCP** (`@modelcontextprotocol/sdk`) so LLM agents can pay per request.
- **Cardano preprod** testnet, Cardano faucet, Cardanoscan for receipts.

## Real-use path
1. Mainnet: switch `cardano:preprod` → `cardano:mainnet`, price in ADA or USDM (the SDK supports native tokens).
2. Hosted facilitator instead of the in-process one; deeper `l1Confirmations` for larger payments.
3. List the endpoint as a Masumi agent so other agents discover and hire it; add the arrival proof feed from our keeper.
4. Deploy the Aiken flight cover on preprod/mainnet with an off-chain builder for buy/settle/reclaim, a pool of
   covers per insurer, and an LP vault; the same validator pays out on the same proof the agents buy.

## Video segment (≈30 s)
> **[screen: terminal, `npm run server` left, `npm run buy` right]**
> "Flight data today means API keys and monthly plans: agents can't sign up, and contracts can't trust the JSON.
> AeroGuard sells one verdict per request on Cardano.
> The agent asks for IB1314 — the server answers 402: one tADA. **[402 offer appears]**
> Its wallet signs a Cardano transaction, capped at five ADA, and retries. The facilitator checks it and puts it on
> preprod. **[tx hash + Cardanoscan link; cut to Cardanoscan page]**
> Back comes the verdict and the Airnode's signature — the same proof our Aiken contract checks on Cardano with
> Plutus' secp256k1 builtin. **[aiken check: 23 passed]**
> Agents pay per request on Cardano for flight outcomes any contract can verify."
