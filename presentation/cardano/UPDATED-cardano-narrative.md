# AeroGuard × Cardano — presentation narrative (for Lovable)

**One line:** AI agents pay per request on Cardano for flight outcomes a smart contract can verify, and pay only for results that pass the check.

Tone: confident, concrete, no hype. One idea per slide. Large numbers, short sentences. Brand: light "sky" background with drifting paper planes, graphite text, orange accent (#E4572E), blue highlight (#2F5FD9). Fonts: Kelly Slab (headings), Jost (body).

Title slide footer: Team: **Mihail** <sub>(WompSolutions)</sub> · **Eskender Assefa**

---

## 1 · The problem, and why it still isn't solved

**Headline:** Agents are about to move money on answers they can't check.

**Story.** A flight lands three hours late. Somewhere, an AI agent (a travel app, an expense tool, a claims service) has to decide: rebook, reimburse or pay out. To decide, it needs one fact: *did this flight land late?*

**Today, that fact is broken in three ways:**
1. **Agents can't buy it.** Flight-data APIs sell monthly plans behind API keys and sign-up forms. An autonomous agent can't register, and a one-off check costs a subscription.
2. **Nobody can verify it.** The answer is plain JSON. Whoever relays it could have changed it, so it can't safely move money inside a smart contract.
3. **The money still waits for humans.** Without trusted data, compensation runs on claims.

**Facts and figures**
- **1 in 6** European flights is delayed by more than 30 minutes.
- EU261 pays **up to €600**, but only from **3 hours** late and **only after a claim**.
- Claim agencies keep **31–35 %** of the payout.
- Only **2–33 %** of eligible passengers ever claim.
- Parametric flight cover has been tried before: **AXA fizzy launched in 2017 and shut down in 2019**. It ran on data that you had to trust a company for, and it had no protection against insuring a flight that was already late.

**Why it's still unsolved:** the missing piece was never a smart contract. It was *data that pays for itself per request and proves itself on-chain*. Both arrived only now: signed first-party data (API3 Airnodes) and machine payments over HTTP (**x402 on Cardano**).

---

## 2 · Our solution, and why it solves the problem uniquely

**Headline:** The agent pays only for a result a contract can check.

**How it works (4 steps)**
1. **Ask.** A claims agent asks our verdict service: `GET /verdict?flight=IB1314&date=2026-10-30`.
2. **402.** The service answers **HTTP 402 Payment Required**: *pay 2 tADA* (1 tADA for a live status, 2 tADA for a final arrival). No account, no API key.
3. **Pay.** The agent's wallet signs a Cardano transaction (spend cap: tADA only, at most 5 tADA). Our facilitator checks the amount, recipient and validity window and submits it.
4. **Verdict + proof.** The agent receives the verdict (status, delay, final or not) **plus the AeroDataBox Airnode's signature** over exactly that data.

**Why it's unique**
- **Pay only for verified work.** Unknown flight: a **free 404**, never a charge. Replaying a payment returns the same answer and never charges twice.
- **Payment tied to the result on Cardano itself.** Our **Aiken (Plutus V3) escrow** holds the cover and releases it **only** on a signed final outcome: ≥ 3 h late or cancelled pays 100 %, ≥ 2 h pays 50 %, anything else returns to the insurer.
- **The bytes the agent buys are the bytes that settle.** The verdict bought over x402 is exactly the redeemer that settles the escrow.
- **One signature, two chains.** The same signed answer settles our live contract on Base Sepolia **and** the Aiken escrow on Cardano (tested on those real signatures; the escrow is not deployed yet). No bridge, no relayer.
- **An agent hires an agent.** Our budgeted claims agent hires the verdict agent and pays only for final proofs whose signature checks. Through our **MCP tool**, any LLM agent (e.g. Claude Desktop) can do the same in one call.

**Proof it's real**
- **Paid on Cardano preprod:** tx `e2ef922b…` (2 tADA, final verdict for IB1314). [Cardanoscan](https://preprod.cardanoscan.io/transaction/e2ef922be71ba61da9431f1a5f56f4c56f5d61348c4945194cf390dd0acd7864)
- **53** TypeScript tests and **44** Aiken tests, including **real AeroDataBox Airnode signatures** and forgeries.
- The four flights of 30 Oct landed early or < 2 h late. Their signed `Arrived` answers closed the policies on Base, and **the same signatures settle the Aiken cover the same way** (no payout, cover back to the insurer). Paying the holder with them is rejected.

---

## 3 · Business case, ROI and USPs

**Headline:** Buy a fact once, sell it to every agent that needs it.

**Business model**
- **Pay-per-answer, no accounts.** Agents pay per verdict in ADA or a stablecoin (USDM supported).
- **Margin compounds.** A final arrival never changes. We buy each signed answer once upstream (about **$0.05** over x402) and resell it to every agent that asks. From the second sale on, it's margin.
- **Price by finality.** A live status costs less than a final, settlement-grade proof (1 vs 2 tADA on testnet).

**ROI for the customer**
| | Claim-based today | With AeroGuard |
|---|---|---|
| Time to money | weeks to months | minutes after landing |
| Middleman cut | 31–35 % | 0 % |
| Data cost per policy | n/a | **~$0.07** when ten policies share a flight |
| Who gets paid | the 2–33 % who claim | every policy holder |

**Customers**
- EU261 claim firms and travel insurers: settle on proof instead of paperwork.
- Corporate travel and expense tools: reimburse automatically.
- Agent marketplaces (e.g. Masumi), where agents hire other agents for verifiable tasks.

**USPs**
1. First-party signed data checked **on Cardano** (Plutus has no `ecrecover`; we rebuild the signed bytes and use the secp256k1 builtin).
2. Payment tied to the result: escrow pays only on a verified final outcome.
3. No proof, no charge: unknown flights are free.
4. Portable truth: one signature, the same verdict on two chains.
5. Agent-native: x402 and MCP, no keys, no sign-up.

---

## 4 · Architecture

**Headline:** Every arrow that carries flight data carries a signature.

```
AeroDataBox ──signs──▶ API3 Airnode (AirnodeHub)
                              │  signed response {requestHash, timestamp, data, signature}
                              ▼
        Keeper (Base) ── buys over x402 ──┐
                                           ▼
 Claims agent ──GET /verdict──▶ Verdict service (x402, Cardano preprod)
      ▲            402: pay 2 tADA  │  facilitator verifies + submits (Blockfrost)
      └──── verdict + signature ◀───┘
                    │
        ┌───────────┴────────────┐
        ▼                        ▼
 Aiken escrow (Cardano)     FlightDelayCover (Base Sepolia)
 verifyEcdsaSecp256k1 +     ecrecover + request hash
 keccak_256 → pay by rule   → pay by rule
```

**Components**
- **Verdict service:** `@x402/express` + `@x402/cardano` 2.26.0 (`exact` scheme), in-process facilitator, Blockfrost. Free discovery (`/flights`, `/sales`, `/.well-known/x402`).
- **Agents:** buyer agent (spend cap), budgeted claims agent, MCP server (`list_flights`, `get_flight_verdict`, `buy_flight_cover`).
- **Aiken escrow:** Plutus V3; checks signer, request, freshness (not stale, not from the future, signed after the landing it reports) and finality; pays by rule; guarded against double satisfaction. About **0.46 M mem / 0.19 B CPU** per settlement.
- **Cross-chain link:** `GET /policy` sells a Base policy for tADA and writes `keccak256("cardano:<payment tx>")` into the policy (`cardanoJobRef`).
- **Optional anchor:** sold proofs written into Cardano tx metadata (labels 674 + 8402).

---

## 5 · Edge cases and limitations (honest slide)

**Handled**
- Unknown flight → free 404, never a charge.
- Payment replay → same answer, never charged twice.
- Edited proof, wrong signer, wrong flight → escrow and contract reject.
- Old proof, proof "from the future", "Arrived" signed before the landing → rejected.
- One payout trying to settle two covers → blocked (double-satisfaction guard).
- Failed Base purchase after a Cardano payment → recorded as "refund due"; no policy is ever bought without a settled payment.

**Open, with the production fix**
| Limitation | Next step |
|---|---|
| Aiken escrow is built and tested on real signatures, **not yet deployed live on preprod** | Deploy and run open → settle with today's flights |
| `/policy` (tADA buys a Base policy) is tested offline (11 tests), not run live | Live run with a funded keeper |
| Refunds are recorded, not sent automatically | Automatic tADA refund transaction |
| One data source (AeroDataBox) | Second Airnode, 2-of-2 agreement |
| Testnet only | Mainnet with ADA/USDM pricing |
| No Masumi registration yet | List the verdict agent on Masumi |

---

## 6 · What's next

**Headline:** From one flight to any event an Airnode can sign.

1. **Now → 1 month:** deploy the Aiken escrow on preprod, then mainnet; hosted facilitator; automatic refunds.
2. **Distribution:** list the verdict agent on **Masumi** so other agents discover and hire it; MCP for every LLM agent.
3. **Capital:** insurer pools and an LP vault on Cardano, with risk-priced premiums from route statistics.
4. **Trust:** a second flight source (2-of-2 Airnodes) before paying out.
5. **Markets:** rail delays, weather, any event an Airnode can sign. Same escrow shape.

**Closing line:** *Agents should pay only for truth a contract can check. On Cardano, now they can.*

**Links**
- Repo: https://github.com/womp-maindev/aeroguard
- Live site: https://womp-maindev.github.io/aeroguard/#cardano
- Video (2:20): https://womp-maindev.github.io/aeroguard/media/cardano.mp4
- Paid tx: https://preprod.cardanoscan.io/transaction/e2ef922be71ba61da9431f1a5f56f4c56f5d61348c4945194cf390dd0acd7864

Team: **Mihail** <sub>(WompSolutions)</sub> · **Eskender Assefa**
