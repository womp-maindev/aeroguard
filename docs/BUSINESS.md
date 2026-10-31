# Business case and ROI of the API3 part

What AeroGuard is for, who pays for it, and what the AirnodeHub integration costs and returns. Every number is either measured on Base Sepolia, taken from AirnodeHub's price list, or labelled as an assumption with its source.

## The use case

**Embedded flight-delay cover, sold at checkout and paid without a claim.** A travel app, online travel agency or corporate travel tool adds "cover this flight" to the booking. The traveller pays a small premium. If AeroDataBox, through its AirnodeHub Airnode, signs that the flight arrived 2 h or more late, or was cancelled, the contract pays the traveller automatically. Nobody fills in a form, uploads a boarding pass or waits for an adjuster.

**It complements EU261 instead of competing with it.** EU261 pays €250 to €600 for delays of 3 h or more on flights it covers, but only after a claim, and not when the airline cites extraordinary circumstances (weather, air traffic control strikes) or for many non-EU carriers. AeroGuard pays on the signed outcome alone: from 2 h, whatever the cause, on any flight AeroDataBox tracks.

| Who | Pays | Gets |
|---|---|---|
| **Traveller** | the premium (8 % of cover in this prototype) | money within about 30 min of a qualifying landing, at the keeper's first check; no claim, no agency fee |
| **Travel app / agent** (distribution) | nothing upfront; integrates one `buyPolicy` call | a product to sell at checkout and a distribution margin, with no claims department |
| **Pool / underwriter** (capital) | the coverage it reserves | premiums, and payouts only on Airnode-signed evidence for cover bought before the outcome was known |
| **Keeper** (anyone) | 0.05 aUSD per signed lookup, plus gas | in production, a settlement fee; today it is run by us |
| **API3 / the Airnode operator** | — | paid x402 calls for every policy sold and settled |

## Today's claim process vs. AeroGuard

| | Claim-based (EU261 or classic travel cover) | AeroGuard |
|---|---|---|
| Who starts it | the traveller, after the trip | nobody: the keeper checks after the scheduled arrival |
| Evidence | forms, boarding passes, booking records | one AeroDataBox response signed by the Airnode, checked on-chain |
| Time to money | weeks to months, longer if the airline refuses | minutes after the keeper's first check, 30 min after the scheduled arrival |
| Middlemen | claim agencies keep about **31–35 %** of the payout (AirHelp reports 35 % including VAT, EUclaim 31 %) [1][2] | none: the payout goes to the stored holder |
| Fraud surface | forged documents, staged claims | a forged response fails the signature check; a real response for another flight fails the request check (see the tamper test) |
| Uptake | estimates of eligible passengers who actually claim range from about 2 % to about a third (claims-company figures, no official statistic) [3] | 100 % of qualifying policies, because nobody has to claim |

## Unit economics of the API3 part

### Measured costs (Base Sepolia, 30 Oct 2026)

| Item | Measured | Cost |
|---|---|---|
| `buyPolicy` (signature check, JSON parse, policy storage) | 309,460 gas at 0.006 gwei, [policy #1](https://sepolia.basescan.org/tx/0xbfd3ae73074ff63a3ef5f7e56b211d1ffb7223e2db944d0cc38ed069d1958b8d) | 1.86 × 10⁻⁶ ETH ≈ **$0.006** |
| `settle` (signature check, JSON parse, payout) | ≈ 125,700 gas at 0.006 gwei, [policy #1](https://sepolia.basescan.org/tx/0xf0aa5db2e08a9b9aa7298c92853642b39d7ff330fe3e42cd8b441aa136246b44) | 7.5 × 10⁻⁷ ETH ≈ **$0.002** |
| Data fee for posting the transaction to Ethereum | both transactions | below 10⁻⁸ ETH, negligible |
| Signed AeroDataBox lookup (`flightStatusOnDate`) | AirnodeHub price list, paid over x402 | **$0.05** per call |

The dollar figures assume ETH at $3,000. At ten times the gas price, the on-chain cost of a whole policy is still under $0.10.

### Lookups per policy
- **Purchase:** one signed status per policy, the purchase proof.
- **Settlement:** shared by every policy on the same flight and date, because they have the same request hash. The keeper takes one early look 3 h before arrival (for cancellations), then checks from 30 min after the scheduled arrival. The 4 live policies needed **2–3 lookups per flight** ([docs/EVIDENCE.md](EVIDENCE.md)). The hard cap is 20 lookups plus the early look.

So the data and gas cost of one policy is:

```
cost ≈ $0.05 (purchase proof) + $0.05 × settlement lookups ÷ policies on that flight + ≈ $0.008 gas
```

| Policies on the flight | Typical (2.5 settlement lookups) | Worst case (21 lookups) |
|---|---|---|
| 1 | **$0.18** | $1.11 |
| 10 | **$0.07** | $0.16 |

### Cost as a share of the premium (8 % premium)

| Cover | Premium | 1 policy on the flight | 10 policies on the flight | Worst case, 1 policy |
|---|---|---|---|---|
| $20 | $1.60 | 11.4 % | 4.4 % | 69 % |
| $50 | $4.00 | 4.6 % | 1.8 % | 28 % |
| $100 | $8.00 | 2.3 % | 0.9 % | 14 % |

**Reading it:** at realistic cover sizes, the whole verification layer (signed data, on-chain checks and payout) costs a few percent of the premium. That is the job a claims team does in a classic product, and a claim agency charges about a third of the payout for it on the traveller's side. Two design choices keep the worst case in check: one signed outcome settles every policy on a flight, and the keeper's schedule caps paid lookups per policy. A production version would add a minimum cover size, or price the data cost into the premium.

### What the API3 part returns

- **To the insurer or app:** fraud-resistant, instant settlement at a cost of cents. There is no need to run and audit its own oracle, and no conflict of interest from signing its own outcomes: the data comes from the AeroDataBox Airnode, and the contract checks it. x402 means no API key and no contract with the data vendor. Every signed response comes with an on-chain payment receipt, which gives a free audit trail ([docs/EVIDENCE.md](EVIDENCE.md)).
- **To the traveller:** about 30 minutes instead of weeks, and the full payout instead of payout minus 31–35 %.
- **To API3 and the Airnode operator:** demand that scales with policies sold. *Illustration, not a forecast:* 10,000 policies a day on 2,000 flights (5 per flight) is 10,000 purchase proofs plus about 5,000 settlement lookups, about 15,000 paid calls a day. At $0.05 that is about $750 a day, or about $270,000 a year, for one product on one data operation.

### Assumptions and limits of this analysis
- The 8 % premium is a hackathon simplification. Real pricing needs per-route delay statistics, which we could not find on AirnodeHub (see the Devfolio "data we wanted").
- We do not model claim frequency. Eurocontrol reported 16.5 % of European flights delayed more than 30 minutes in September 2025 [4], but we found no reliable 2 h+ figure, so the expected-loss side is left to an underwriter.
- ETH at $3,000 and Base gas at 0.006 gwei are assumptions; the formulas above make the dependence explicit.
- Testnet only: no real money moves, and none of this is insurance or financial advice. A real product needs regulatory review.

## Sources
1. AirHelp, "AirHelp vs EUclaim", https://www.airhelp.com/en/blog/airhelp-vs-euclaim-best-flight-compensation-company/ (35 % fee including VAT).
2. AirHelp UK, "AirHelp vs EUclaim (UK)", https://www.airhelp.co.uk/blog/airhelp-vs-euclaim-best-flight-compensation-company-in-the-uk/ (EUclaim 31 % plus per-person file fees).
3. Claims-company estimates of passengers who claim, from under 2 % to about a third: Travel Weekly, https://travelweekly.co.uk/in-depth/flight-delay-compensation-unclaimed-by-70-of-passengers ; Connexion, https://connexionfrance.com/news/airline-passengers-losing-billions-in-compensation/511191 . These come from interested parties; there is no official statistic.
4. Eurocontrol, monthly network operations report for September 2025 (flights delayed more than 30 min, all causes: 16.5 %, down from 19.7 %), published on https://www.eurocontrol.int . Taken from a search excerpt of the report; check the report itself before quoting it on stage.
5. AirnodeHub listing for AeroDataBox (`flightStatusOnDate`, $0.05 per call over x402), https://airnodehub.api3.org/llms-full.txt
