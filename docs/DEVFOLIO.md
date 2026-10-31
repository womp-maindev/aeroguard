# AeroGuard — Devfolio submission

**Tagline:** Your flight is late, you're already paid. Flight-delay cover that can only be **bought** and only **pays** on data signed by the AeroDataBox Airnode on API3 AirnodeHub, so nobody can insure a flight that's already late.

**Tracks:** API3 — Any API in your contract · Cardano (one project in two tracks, confirmed by the organizers). This text covers the API3 part; the Cardano part is described in its own section of the submission.

## The problem

Flight delays are common, and getting compensation is slow. A traveller fills in forms, uploads evidence, waits weeks and often pays a claims agency a large share. Parametric cover removes the claim: if trustworthy data says the flight landed late, the money moves. Two questions decide whether that works:

1. **Can the contract trust the data?** If anyone can say "my flight was 4 hours late", the pool is drained.
2. **Who presses the button?** If the insurer has to trigger the payout, the claim process is back.

## What we built

- **`FlightDelayCover.sol`** on Base Sepolia ([`0x2570…0a80`](https://sepolia.basescan.org/address/0x257054204c4Cd43846C4553eBe6D709841980a80), source verified). It sells cover and pays it out using only AeroDataBox responses signed by the AirnodeHub Airnode `0x83FE…f2Ec`.
- **Signed data at both ends.** A policy is bought with a fresh signed *pre-departure* status, and it is settled with a signed *arrival* or *cancellation*. The scheduled arrival is read from the signature, not from the buyer.
- **An autonomous keeper** (`keeper/`). It pays for signed data over **x402** (0.05 aUSD per call), decides when a lookup is worth its cost, and settles: nobody files or approves a claim. It runs as a plain `npm run keeper` loop or as passes in GitHub Actions (scheduled best-effort: on 30 Oct GitHub's scheduler did not fire at first, so the first passes were started by hand; it first fired on its own at 22:55Z on 30 Oct, and again at 02:14Z on 31 Oct (both runs successful), though less often than the cron asks). Anyone can run it, because `settle` gives the caller no special power.
- **Private policies.** Commit–reveal hides which flight is insured until settlement.
- **A judge toolkit.** A tamper CLI runs forgeries against the deployed contract, a dashboard has an in-browser Security Inspector, and a local rehearsal needs no funds.
- **Live on testnet with real data.** 4 policies on real flights from Munich on 30 Oct 2026, each bought with a real signed AeroDataBox proof.

## Why AeroGuard

> **In AeroGuard, signed data gates both the sale and the payout, and you can verify that yourself, from your own wallet, on the live contract.**

A parametric product that only checks data at payout has a hole at purchase: the cheapest strategy is to buy cover for a flight you already know is late, with perfectly genuine signed evidence. AeroGuard only sells cover against a fresh Airnode-signed status showing the flight hasn't left, reads the schedule from that signature, and requires the same signed schedule at settlement. Add a claim-free autonomous keeper that pays for data over x402, live evidence on real flights replayed in Solidity, and a way for judges to attack the deployed contract from their own wallet. Details: [docs/USP.md](https://github.com/womp-maindev/aeroguard/blob/main/docs/USP.md).

## From data display to economic logic

A common pattern is to fetch data, pass it to a contract, and show it on a frontend: the contract stores a value, and nothing depends on it. AeroGuard closes a full economic loop instead:
1. **Cover is sold** against a signed pre-departure status. The premium is paid into the pool, and the coverage is held back.
2. **The outcome is verified on-chain** from a signed AeroDataBox arrival or cancellation.
3. **The payout follows automatically**: 100 % at 3 h late or cancelled, 50 % at 2 h, to the stored holder, with no claim.

The verified data isn't something to look at; it is the only thing that can move capital. Remove the Airnode signature and the contract has nothing it can safely pay on. **No signature, no money moves.**

## How it works

```
Traveller / travel app
  │ buyPolicy(flight, date, coverage, holder, signed STATUS response ≤15 min old)
  ▼
FlightDelayCover
  purchase: right signer · request hash derived on-chain from flight+date · fresh
            · status ∈ {Expected, Unknown, CheckIn, Boarding} · scheduled arrival ≥ 2 h away
  settle:   right signer · same derived request · ≤ maxAge old · not from the future
            · final status (Arrived / Canceled) · signed after the landing it reports
            · same signed schedule as at purchase
  payout:   cancelled or ≥ 180 min late → 100 % · ≥ 120 min → 50 % · otherwise 0
  ▲
  │ keeper: 30 min after the scheduled arrival, buys a signed arrival via x402,
  │         simulates settle, then sends it. The payout always goes to the stored holder.
```

The contract builds the AirnodeHub request hash itself, `keccak256(JSON.stringify([operation, sortedParams, sortedProjection]))`, from the policy's own flight and date. Even the agent that sold the policy cannot settle it with data about another flight, day or projection. A real AirnodeHub capture is checked byte for byte in Solidity ([`Fixture_RealAeroDataBoxCapture`](https://github.com/womp-maindev/aeroguard/blob/main/contracts/test/Fixtures.t.sol#L105)).

Two small projections keep the signed payload tiny:
- **arrival** `{actual, scheduled, status}`: proves the delay;
- **status** `{scheduled, status}`: proves a cancellation (a cancelled flight has no revised time) and serves as the purchase proof.

## API3 / AirnodeHub

### Who relies on the data
- **Travellers**, who are paid without filing a claim.
- **Travel apps and agents** that resell the cover. They cannot settle with the wrong flight, even by mistake.
- **Whoever funds the pool.** Today that is the owner: `fundPool` is open to anyone, but in this prototype only the owner can withdraw. The capital is only paid out on signed evidence, and it can only be locked by cover that was bought before the outcome was known.
- **Keepers**, anyone who calls `settle`. They need no trust and get no discretion.

### What breaks if the data is forged
| Forgery | Without signed data | AeroGuard's answer |
|---|---|---|
| "My flight was 4 h late" | the pool is drained by fake claims | `NotSignedByAirnode` ([test](https://github.com/womp-maindev/aeroguard/blob/main/contracts/test/FlightDelayCover.t.sol#L129)) |
| A genuine response for another flight or day | a late flight pays every policy | `WrongRequest` ([test](https://github.com/womp-maindev/aeroguard/blob/main/contracts/test/FlightDelayCover.t.sol#L151)) |
| An old response from before the delay was revised | outcome picked from history | `Stale` ([test](https://github.com/womp-maindev/aeroguard/blob/main/contracts/test/FlightDelayCover.t.sol#L140)) |
| "Arrived" signed before the landing it reports | early, wrong verdict | `ObservedTooEarly` ([test](https://github.com/womp-maindev/aeroguard/blob/main/contracts/test/FlightDelayCover.t.sol#L224)) |
| Insure a flight that is already delayed | adverse selection drains the pool | `NotBuyable` ([test](https://github.com/womp-maindev/aeroguard/blob/main/contracts/test/FlightDelayCover.t.sol#L287)) |
| Lie about the schedule at purchase | delay computed against a fake baseline | scheduled time read from the signature; `ScheduleMismatch` at settlement ([test](https://github.com/womp-maindev/aeroguard/blob/main/contracts/test/FlightDelayCover.t.sol#L373)) |

An honest traveller can also be hurt by forged data, for example a fake "on time" response that closes their policy. The same checks protect them.

### Trust assumptions
- The signature proves that **the AeroDataBox Airnode returned exactly this data for exactly this request at this time**. It does not prove that AeroDataBox is right about the real world. We picked a recognised aviation data source and only pay on a final status.
- The Airnode address is immutable in the contract. If the key rotates, active policies can only expire, and a new deployment is needed.
- The pool owner sets the premium and limits for **new** policies only. The owner can never withdraw capital that backs active policies (`withdrawFree` takes only `balance − reserved`, [test](https://github.com/womp-maindev/aeroguard/blob/main/contracts/test/FlightDelayCover.t.sol#L261)).
- The keeper is not trusted. Anyone can call `settle`, and the money always goes to the stored holder.
- Private policies: the purchase proof cannot be checked without revealing the flight. A private buyer is therefore limited only by the lead time and a ±1 h schedule window. This is documented, and the production fix is a ZK proof of the purchase-time status.

### Known limitations
Each one needs a contract change, so none is applied to the live deployment, which holds the evidence. Production fixes are in the [README](https://github.com/womp-maindev/aeroguard/blob/main/README.md#known-limitations).
- **The purchase proof reads the status, not the revised times.** A flight still showing `Expected` with a late revised departure could be insured.
- **Multi-leg flights and repeated flight numbers.** The projection reads the first leg AeroDataBox returns.
- **Diverted flights.** They don't settle, and only expire.
- **Schedule changes, and policies with no evidence within 3 days.** Both expire, and the premium is kept.
- **No exposure cap per flight.**
- **No live payout yet.** None of the 4 live flights was 2 h late. The signed arrival still decided each on-chain outcome, and the payout tiers are shown by the tests and the rehearsal.

### Data we wanted but couldn't find on AirnodeHub
- **A second source of scheduled *and* actual arrival times**, so that payouts need 2-of-2 agreement between Airnodes and the single-source assumption goes away. AirnodeHub has the OpenSky Network (ADS-B tracking), but it has no schedules and no gate times. It is keyed by ICAO callsign (`DLH1814`, not `LH1814`), and its per-airport arrival lists are built overnight. It can cross-check *when* an aircraft landed, which is our next step, but it cannot decide a delay on its own.
- **A first-party flight-status Airnode.** The AeroDataBox listing is a third-party attestation: its operator does not own the source. An Airnode run by the data provider or an airline would move the trust closer to the source.
- **The cause of the delay and whether there were extraordinary circumstances**, to model EU261 eligibility and cover the gap that EU261 leaves.
- **Route and airport delay statistics**, to price the premium by risk instead of a flat 8 %. AeroDataBox offers them, but its AirnodeHub listing serves only the cheapest operations: "airport delay statistics, route statistics and flight alert webhooks are not served".
- **Airline compensation and refund records**, to avoid paying twice when the airline already compensated.
- **Actual operational disruptions** (air traffic control strikes, airport closures, NOTAMs), for early warnings and cover for whole airports. AirnodeHub has weather, including CustomWeather's weather-based delay *forecasts* per airport, but nothing on strikes, closures or NOTAMs.

### Feedback for API3 from building on AirnodeHub
- **Missing JSON pointers.** A projection pointer that is missing makes the Airnode answer 400. A cancelled flight has no revised arrival time, so we need a second projection (`status`) just to prove a cancellation. An option to return `null` for a missing pointer would let one signed response cover both outcomes.
- **Request hash on-chain.** To check *which* question was answered, the contract re-derives `keccak256(JSON.stringify([operation, sortedParams, sortedProjection]))`. Doing that in Solidity forced us to forbid every character that JSON would escape. An ABI-encoded request-hash variant would be cheaper and safe for any input.
- **Observation time.** The signature timestamp says when the Airnode signed, not when the source last updated. We added our own `ObservedTooEarly` checks; a signed `observedAt` from the source would make that exact.
- **Signer rotation.** The signer address is immutable in our contract. An on-chain registry or rotation event for Airnode signers would let live contracts follow a key change instead of expiring.
- **What worked very well:** x402 per call with no account. The payment tx in the `PAYMENT-RESPONSE` header gives every signed response an auditable on-chain receipt ([docs/EVIDENCE.md](https://github.com/womp-maindev/aeroguard/blob/main/docs/EVIDENCE.md)).

## Business case and ROI of the API3 part

**Use case:** embedded flight-delay cover that travel apps and agents sell at checkout, paid automatically on a signed outcome. It complements EU261, which needs a claim, starts at 3 h, and excludes extraordinary circumstances. AeroGuard pays from 2 h, whatever the cause.

| | Claim-based today | AeroGuard |
|---|---|---|
| Time to money | weeks to months | minutes after the keeper's first check, 30 min after the scheduled arrival |
| Middlemen | claim agencies keep about 31–35 % of the payout (AirHelp 35 % incl. VAT, EUclaim 31 %) | none |
| Uptake | claims-company estimates of eligible passengers who claim range from about 2 % to about a third | every qualifying policy pays, because nobody has to claim |

**What the API3 part costs, measured on Base Sepolia:**
- Gas: `buyPolicy` 309,460 gas and `settle` about 125,700 gas, together under $0.01.
- Data: $0.05 per signed AeroDataBox lookup over x402.
- One signed outcome settles every policy on a flight, and the live flights needed 2–3 lookups each.

So a policy costs about **$0.18** when it is alone on its flight, or **$0.07** when ten share it. For $50 cover at an 8 % premium, that is **4.6 % or 1.8 % of the premium**. That is the price of fraud-resistant, instant settlement, the job a claims team does in a classic product. For API3, demand scales with policies: as an illustration, 10,000 policies a day is about 15,000 paid calls, or $750 a day for one data operation.

Full analysis, with assumptions, the worst case and sources: [docs/BUSINESS.md](https://github.com/womp-maindev/aeroguard/blob/main/docs/BUSINESS.md).

## Links
- Evidence for every policy, signed response and x402 payment: https://github.com/womp-maindev/aeroguard/blob/main/docs/EVIDENCE.md
- All 4 policies settled by the keeper on Airnode-signed "Arrived" responses (every flight landed early or < 2 h late → no payout, premiums stay in the pool): #1 https://sepolia.basescan.org/tx/0xf0aa5db2e08a9b9aa7298c92853642b39d7ff330fe3e42cd8b441aa136246b44 · #2 https://sepolia.basescan.org/tx/0x5270aa58d63db79af041e74bb40115a801381f28caca028d90c285280594c535 · #3 https://sepolia.basescan.org/tx/0x5a5e4fc750464b0f4043aa2318da55705ae0eb94603adf17d417068de4f2ff9a · #4 https://sepolia.basescan.org/tx/0x973e29d8195ce6bfe7bde0b749b308cfe1e8200e2465c849810a0a01dd01c7ee
- Repo: https://github.com/womp-maindev/aeroguard
- Contract: https://sepolia.basescan.org/address/0x257054204c4Cd43846C4553eBe6D709841980a80
- x402 payment for signed data: https://sepolia.basescan.org/tx/0x76d334da55c86bbf61d37762f8ee843f4920bc874477a82d06852247b4e2054f
- Policy #1 purchase with a signed proof: https://sepolia.basescan.org/tx/0xbfd3ae73074ff63a3ef5f7e56b211d1ffb7223e2db944d0cc38ed069d1958b8d
- Keeper runs: https://github.com/womp-maindev/aeroguard/actions/workflows/keeper.yml
- Threat model: [`contracts/README.md`](https://github.com/womp-maindev/aeroguard/blob/main/contracts/README.md#threat-model)
- Video: see [`docs/VIDEO.md`](https://github.com/womp-maindev/aeroguard/blob/main/docs/VIDEO.md) (the link is added after recording)
