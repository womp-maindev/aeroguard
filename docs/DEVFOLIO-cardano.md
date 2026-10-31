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
1. The unpaid request returns HTTP 402: 1 tADA while the flight's latest signed answer is not final, 2 tADA once it is (tUSDM also
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
JSON. 44 Aiken tests pass, including **real** AeroDataBox Airnode signatures (a pre-departure status and a live
arrival answer bought by our keeper), forgeries and the same freshness rules as the EVM contract (stale, from the future,
observed before the landing); payouts are tagged
with the policy input against double satisfaction. A settlement costs ≈ 0.46M mem / 0.19B cpu. The off-chain side
(open / settle / reclaim) builds real transactions and executes the validator with Aiken's UPLC evaluator before
submitting; **the verdict body an agent buys over x402 is exactly the redeemer that settles the cover.**

**Cardano pays for cover on Base.** `GET /policy` sells a real `FlightDelayCover` policy on Base Sepolia for tADA: the
price is the contract's own quote, and only after the Cardano payment settles does the server buy the policy, writing
`keccak256("cardano:<payment tx>")` into the policy's `cardanoJobRef` field. The two chains point to each other; a
failed purchase is recorded as a refund due, and no policy is ever bought without a settled payment (tested).

**Agents.** `npm run agent` is a claims agent with a budget: free catalog check, buys only final proofs, decides by
the contract rule, logs each Cardano receipt. `npm run mcp` exposes `list_flights` (free) and `get_flight_verdict`
(paid) as MCP tools for LLM agents.

**An agent hires an agent, and pays only for checked work.** The claims agent (the buyer) hires the verdict agent (our
x402 service) and pays only for a final proof that passes the signature check. The Aiken escrow ties the money to the
result: the cover moves only on that signed answer. No evidence means a free 404, so nobody pays for work that was not
done.

**One signed answer, the same verdict on two chains.** The four policies of 30 Oct all landed within the threshold. The keeper's
signed `Arrived` answers closed them on Base Sepolia with no payout; the very same signatures, verified with Plutus V3
builtins, settle the Aiken cover the same way, and paying the holder with them is rejected.

| Policy | Flight | Signed landing | Base Sepolia (`FlightDelayCover`) | Cardano (Aiken cover, same signature) |
|---|---|---|---|---|
| #1 | IB1314 | 21:00Z, 25 min early | `ClosedNoPayout` [0xf0aa5db2…](https://sepolia.basescan.org/tx/0xf0aa5db2e08a9b9aa7298c92853642b39d7ff330fe3e42cd8b441aa136246b44) | no payout, cover back to insurer |
| #2 | LH1816 | 22:06Z, 11 min late | `ClosedNoPayout` [0x5270aa58…](https://sepolia.basescan.org/tx/0x5270aa58d63db79af041e74bb40115a801381f28caca028d90c285280594c535) | no payout, cover back to insurer |
| #3 | EI357 | 21:26Z, 29 min early | `ClosedNoPayout` [0x5a5e4fc7…](https://sepolia.basescan.org/tx/0x5a5e4fc750464b0f4043aa2318da55705ae0eb94603adf17d417068de4f2ff9a) | no payout, cover back to insurer |
| #4 | BA955 | 21:47Z, 3 min early | `ClosedNoPayout` [0x973e29d8…](https://sepolia.basescan.org/tx/0x973e29d8195ce6bfe7bde0b749b308cfe1e8200e2465c849810a0a01dd01c7ee) | no payout, cover back to insurer |

**Real data, no extra quota.** The service resells the signed answers our keeper already bought for the four live
policies (imported from the keeper's published `keeper-data`, each signature re-checked); a live answer costs 1 tADA,
a final one 2 tADA.

**Paid on Cardano preprod:** an agent paid 2 tADA over x402 for the final IB1314 verdict, tx [`e2ef922b…`](https://preprod.cardanoscan.io/transaction/e2ef922be71ba61da9431f1a5f56f4c56f5d61348c4945194cf390dd0acd7864) (all paid requests: [`cardano/EVIDENCE.md`](../cardano/EVIDENCE.md)). Code in [`cardano/`](../cardano/).

## What runs live vs. what is tested offline
| Part | Status |
|---|---|
| x402 paid `GET /verdict` on Cardano preprod | **live**: tx `e2ef922b…` (2 tADA, final IB1314 verdict), recorded in `cardano/EVIDENCE.md` |
| Signed evidence | **real**: AeroDataBox Airnode answers bought by our keeper; four final landings settled the live Base policies |
| Aiken flight cover | **tested**: 44 `aiken check` tests incl. the real signatures; off-chain transactions executed locally with Aiken's UPLC evaluator. Live run on preprod: pending. It is one command, `sh cardano/live-cover.sh now`: pay for a verdict over x402, open a cover, settle it with that verdict. Its txs go to `cardano/COVER-EVIDENCE.md` |
| `GET /policy` (tADA buys a Base policy) | **tested offline** (11 tests); not run live |
| Metadata anchor (`ANCHOR=true`) | **tested offline**; not run live |
| MCP tools for LLM agents | **tested** in-process and over stdio; for a live demo with Claude Desktop see `presentation/cardano/DEMO.md` |
| Tests | `cardano`: 53/53 · `aiken check`: 44/44 |

## Business case
- Pay per answer, no account: a claims agent pays per verdict (preprod: 1–2 tADA; mainnet pricing to be set), only for flights it needs.
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
4. Deploy the Aiken flight cover on preprod, then mainnet, with a pool of covers per insurer and an LP vault. The validator
   and its off-chain open / settle / reclaim are built and tested (executed locally with Aiken's UPLC evaluator) but not
   deployed yet.

## Video
**Cardano track video (2:20, voiced):** https://github.com/womp-maindev/aeroguard/blob/main/web/media/cardano.mp4 (also https://womp-maindev.github.io/aeroguard/media/cardano.mp4). Overview of both tracks (1:47): https://github.com/womp-maindev/aeroguard/blob/main/web/media/demo.mp4

Ready-made clips (1080p, no sound) in [`cardano/video/`](../cardano/video/); timings and voice-over ideas in [`SHOTLIST.md`](../cardano/video/SHOTLIST.md).

## Video segment (≈30 s)
> **[screen: terminal, `npm run server` left, `npm run buy` right]**
> "Flight data today means API keys and monthly plans: agents can't sign up, and contracts can't trust the JSON.
> AeroGuard sells one verdict per request on Cardano.
> The agent asks for IB1314 — the server answers 402: one tADA. **[402 offer appears]**
> Its wallet signs a Cardano transaction, capped at five ADA, and retries. The facilitator checks it and puts it on
> preprod. **[tx hash + Cardanoscan link; cut to Cardanoscan page]**
> Back comes the verdict and the Airnode's signature — the same proof our Aiken contract checks on Cardano with
> Plutus' secp256k1 builtin. **[aiken check: 44 passed]**
> Agents pay per request on Cardano for flight outcomes any contract can verify."
