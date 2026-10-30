# AeroGuard — Devfolio submission

**Tagline:** Your flight is late, you're already paid. Flight-delay cover that settles itself on data signed by the AeroDataBox Airnode on API3 AirnodeHub.

**Tracks:** API3 — Any API in your contract · Cardano (one project in two tracks, confirmed by the organizers). This text covers the API3 part; the Cardano part is described in its own section of the submission.

## The problem

Flight delays are common, and getting compensation is slow. A traveller fills in forms, uploads evidence, waits weeks and often pays a claims agency a large share. Parametric cover removes the claim: if trustworthy data says the flight landed late, the money moves. Two questions decide whether that works:

1. **Can the contract trust the data?** If anyone can say "my flight was 4 hours late", the pool is drained.
2. **Who presses the button?** If the insurer has to trigger the payout, the claim process is back.

## What we built

- **`FlightDelayCover.sol`** on Base Sepolia ([`0x2570…0a80`](https://sepolia.basescan.org/address/0x257054204c4Cd43846C4553eBe6D709841980a80), source verified). It sells cover and pays it out using only AeroDataBox responses signed by the AirnodeHub Airnode `0x83FE…f2Ec`.
- **Signed data at both ends.** A policy is bought with a fresh signed *pre-departure* status, and it is settled with a signed *arrival* or *cancellation*. The scheduled arrival is read from the signature, not from the buyer.
- **An autonomous keeper** (`keeper/`). It pays for signed data over **x402** (0.05 aUSD per call), decides when a lookup is worth its cost, and settles policies with no human involved. It is scheduled in GitHub Actions every ~15 min (best-effort) and also runs as a plain `npm run keeper` loop. Anyone can run it, because `settle` gives the caller no special power.
- **Private policies.** Commit–reveal hides which flight is insured until settlement.
- **A judge toolkit.** A tamper CLI runs forgeries against the deployed contract, a dashboard has an in-browser Security Inspector, and a local rehearsal needs no funds.
- **Live on testnet with real data.** 4 policies on real flights from Munich on 30 Oct 2026, each bought with a real signed AeroDataBox proof.

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
- **Liquidity providers** who fund the pool. Their capital is only paid out on signed evidence, and it can only be locked by cover that was bought before the outcome was known.
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

### Data we wanted but couldn't find on AirnodeHub
- **A second, independent flight source** (for example OpenSky or FlightAware), so that payouts need 2-of-2 agreement between Airnodes. That would remove the single-source assumption.
- **The cause of the delay and whether there were extraordinary circumstances**, to model EU261 eligibility and cover the gap that EU261 leaves.
- **Historical on-time statistics per route and airline**, to price the premium by risk instead of a flat 8 %.
- **Airline compensation and refund records**, to avoid paying twice when the airline already compensated.
- **Weather and airport disruption feeds** (NOTAMs, ATC strikes), for early warnings and cover for whole airports.

## Links
- Repo: https://github.com/womp-maindev/aeroguard
- Contract: https://sepolia.basescan.org/address/0x257054204c4Cd43846C4553eBe6D709841980a80
- x402 payment for signed data: https://sepolia.basescan.org/tx/0x76d334da55c86bbf61d37762f8ee843f4920bc874477a82d06852247b4e2054f
- Policy #1 purchase with a signed proof: https://sepolia.basescan.org/tx/0xbfd3ae73074ff63a3ef5f7e56b211d1ffb7223e2db944d0cc38ed069d1958b8d
- Keeper runs: https://github.com/womp-maindev/aeroguard/actions/workflows/keeper.yml
- Threat model: [`contracts/README.md`](https://github.com/womp-maindev/aeroguard/blob/main/contracts/README.md#threat-model)
- Video: see [`docs/VIDEO.md`](https://github.com/womp-maindev/aeroguard/blob/main/docs/VIDEO.md) (the link is added after recording)
