# Architecture and data flow: the API3 part

How a signed AeroDataBox response moves from the Airnode to a payout, and who checks what. The picture version is [`docs/img/architecture.svg`](img/architecture.svg). This page is the detailed map behind it, checked against the code. The Cardano part (paying for cover in tADA, linked per policy by `cardanoJobRef`) sits outside this map, and the API3 path doesn't depend on it.

## 1. Components and where they run

```
 ┌──────────────── OFF-CHAIN ─────────────────────────────────────────────────────────────┐
 │                                                                                          │
 │  AeroDataBox (flight data API)                                                           │
 │        ▲  upstream call                                                                  │
 │  AeroDataBox Airnode on API3 AirnodeHub  ── signs every response (EIP-191)               │
 │  signer 0x83FE…f2Ec · flightStatusOnDate · 0.05 aUSD/call over x402                      │
 │        ▲  POST {operation, parameters, projection} · 402 → x402 payment → 200 + signed   │
 │        │                                                                                 │
 │  Keeper (keeper/src, TypeScript + viem) ── no special power on-chain                     │
 │    flight.ts     builds the request, derives its hash, caches responses, fixture mode    │
 │    x402.ts       paying fetch (the payer key signs the aUSD payment)                     │
 │    airnode-v2.ts fetch + verify the signature off-chain before use                       │
 │    schedule.ts   decides WHEN a paid lookup is worth it                                  │
 │    keeper.ts     cover() = buy · keeperTick() = settle / expire · state file             │
 │    chain.ts      contract ABI, simulate-then-send                                        │
 │    api.ts        HTTP for the dashboard: /health /policies /cover /verdict /tamper       │
 │                  /log /rehearse/*                                                        │
 │    cli.ts        status · buy · proof · tick · tamper · keeper                           │
 │  Runs as: GitHub Actions (keeper.yml, cron + manual) · npm run keeper · npm run api      │
 │        │                                                                                 │
 │  Dashboard (web/index.html + wallet.js + rehearsal.js, static, no build)                 │
 │    reads the chain directly (eth_call to a public RPC) · Inspector checks signatures     │
 │    in the browser · tamper lab = eth_call (+ state override) · wallet panel = real txs   │
 │    · keeper log from the keeper-data branch (or the snapshot shipped with the page)      │
 └──────────────────────────────────────────┬───────────────────────────────────────────────┘
                                            │ transactions / eth_call
 ┌──────────────── ON-CHAIN: Base Sepolia (chain id 84532) ─────────────────────────────────┐
 │  FlightDelayCover 0x2570…0a80  (owner = keeper wallet; Airnode address immutable)        │
 │    uses the API3 starter libraries: AirnodeV2Attestation (recover the signer) ·          │
 │    ProjectedJson (read signed JSON fields) · IsoTimestamp (parse "2026-10-31 16:35Z")    │
 │  aUSD token 0xbeA3…1808  (premiums in, payouts out, and the x402 payments)               │
 └──────────────────────────────────────────────────────────────────────────────────────────┘
```

## 2. The signed payload: what crosses every boundary

**The request.** The contract derives it itself from the policy's flight and date:
```
["flightStatusOnDate",
 [["dateLocal","2026-10-31"],["searchBy","number"],["searchParam","LH1814"]],
 [["scheduled","/0/arrival/scheduledTime/utc"],["status","/0/status"]]]        ← status projection
requestHash = keccak256(that exact string)
```
There are two projections per policy:
- **status** `{scheduled, status}`, for the purchase proof and to prove a cancellation;
- **arrival** `{actual, scheduled, status}`, to prove the delay.

The contract stores both hashes when the policy is bought. `settle` takes a `requestHash` argument, but accepts only one of those two stored hashes (`WrongRequest` otherwise); a schedule or a delay never comes from the caller. The same construction exists in three places: Solidity (`requestHashFor`), the keeper (`flight.ts`) and the dashboard. The Solidity one is tested byte for byte against a real AirnodeHub capture ([`Fixture_RealAeroDataBoxCapture`](../contracts/test/Fixtures.t.sol)).

**The response.** This is policy #9's real purchase proof, read back from its `buyPolicy` calldata with `npm run cli -- proof <tx>`:
```
timestamp  1793403503                                              (when the Airnode signed)
data       {"scheduled":"2026-10-31 16:35Z","status":"Expected"}   (the exact signed bytes)
signature  0x3cbf…fefa1b  = EIP-191 over keccak256(requestHash ‖ timestamp ‖ data)
```

## 3. Flow A: purchase ("signed data at the sale")

```
Buyer / agent ─▶ keeper cover(flight, date, holder, coverage)
   1. keeper ─▶ Airnode: status projection   ◀─ 402 Payment Required
   2. keeper signs an aUSD payment (x402) ─▶ the facilitator settles it on Base Sepolia
   3. Airnode ─▶ signed {scheduled, status}   (cached ≤ 10 min; the contract accepts ≤ 15 min)
   4. keeper verifies the signature off-chain, and refuses if the flight already left
   5. keeper ─▶ buyPolicy(flight, date, coverage, holder, ref, timestamp, data, signature)
FlightDelayCover:
   ✓ flight/date characters safe (no JSON escaping)
   ✓ signer == Airnode, for requestHashFor(flight, date, status)   → NotSignedByAirnode
   ✓ fresh (≤ 15 min), not from the future                         → Stale / FromTheFuture
   ✓ status ∈ {Expected, Unknown, CheckIn, Boarding}               → NotBuyable
   ✓ signed scheduled arrival ≥ now + 2 h                          → TooCloseToArrival
   ✓ premium paid in, free capital ≥ coverage                      → Insolvent
   → stores the policy {holder, scheduledArrival FROM THE SIGNATURE, both request hashes,
     maxAge, coverage}; reserved += coverage; emits PolicyBought
```

## 4. Flow B: settlement ("signed data at the payout")

```
keeper tick (GitHub Actions / npm run keeper / anyone)
   reads the Active policies from chain
   schedule.ts: an early look 3 h before arrival (cancellations), then every 30 min from
                +30 min to +6 h, every 3 h to +24 h, at most 20 paid lookups per policy
   1. Airnode: ARRIVAL projection (x402); 400 if there is no revised time yet, or cancelled
   2. if none: STATUS projection (proves "Canceled")
   3. final? (Arrived / Canceled); otherwise wait for the next check
   4. simulate settle (eth_call), and only then send it
   5. settle(id, requestHash, timestamp, data, signature); one response settles every
      policy on that flight
FlightDelayCover:
   ✓ policy Active                                            → NotActive
   ✓ requestHash is one of the policy's two stored hashes     → WrongRequest
   ✓ signer == Airnode                                        → NotSignedByAirnode
   ✓ ≤ maxAge old, ≤ 60 s in the future                       → Stale / FromTheFuture
   ✓ signed scheduled == stored scheduled                     → ScheduleMismatch
   ✓ Arrived (arrival projection) or Canceled (status)        → NotFinal
   ✓ signed after the landing it reports                      → ObservedTooEarly
   → the status changes first (PaidFull / PaidHalf / ClosedNoPayout), reserved −= coverage,
     then aUSD goes to the STORED holder; emits Settled(delay, payout, responseId)
   ≥ 180 min late or cancelled → 100 % · ≥ 120 min → 50 % · otherwise 0
   No final evidence by scheduled arrival + 3 days → anyone may expire(); coverage released
```

## 5. Flow C: verification by judges and auditors

```
Dashboard ── eth_call settle() with a forgery ─▶ deployed contract ─▶ decoded revert
          ── the same with a state override (status = Active), for settled policies
          ── wallet panel: the same forgery as a REAL transaction (fixed gas) ─▶ a failed tx
             on Basescan; or the judge's own pasted response
          ── Inspector: recovers the signer and recomputes the request hash, in the browser
CLI       ── npm run tamper · npm run cli -- proof <buy tx> (the purchase proof, from calldata)
Foundry   ── 94 tests: tamper cases, boundaries, a real capture, all live policies replayed
Rehearsal ── the same contract and keeper on a local anvil, with a test signer and a fast clock
```

## 6. Money flows (testnet aUSD, no real value)

```
buyer / agent ──premium (8 %)──▶ pool (FlightDelayCover)   reserved += coverage
pool ──────────── payout (0 / 50 / 100 %) ──▶ stored holder  reserved −= coverage
keeper ─────────── 0.05 aUSD per lookup (x402) ──▶ Airnode operator
owner ──────────── fundPool ──▶ pool        withdrawFree ◀── only balance − reserved
gas (test ETH): buyPolicy ≈ 309k gas, settle ≈ 126k gas (measured; see docs/BUSINESS.md)
```

## 7. Trust boundaries

| Boundary | What is trusted | What enforces it |
|---|---|---|
| AeroDataBox → Airnode | that AeroDataBox reports the real flight correctly (the one assumption we can't remove) | final status only; signed after the landing it reports; fresh |
| Airnode → anyone | nothing: the signature is checked | `AirnodeV2Attestation` against an **immutable** signer |
| Keeper → contract | nothing: it only brings evidence | the contract derives the request hashes itself, and pays only the stored holder |
| Buyer → contract | nothing: the schedule comes from the signature | purchase proof, pre-departure status, 2 h lead time |
| Owner → pool | only the parameters of new policies | `withdrawFree` is limited to `balance − reserved` |
| Dashboard → user | nothing: it is a viewer | everything it shows can be re-checked on-chain |

## 8. Where each piece lives

| Concern | Code |
|---|---|
| Policy rules, checks, payout | [`contracts/src/FlightDelayCover.sol`](../contracts/src/FlightDelayCover.sol) |
| Signature, JSON fields, timestamps | [`AirnodeV2Attestation.sol`](../contracts/src/AirnodeV2Attestation.sol), [`ProjectedJson.sol`](../contracts/src/ProjectedJson.sol), [`IsoTimestamp.sol`](../contracts/src/IsoTimestamp.sol) (from the API3 starter) |
| Requests, hashing, cache, fixtures | [`keeper/src/flight.ts`](../keeper/src/flight.ts), [`airnode-v2.ts`](../keeper/src/airnode-v2.ts) |
| Payments | [`keeper/src/x402.ts`](../keeper/src/x402.ts) |
| When to look; buy, settle, expire | [`schedule.ts`](../keeper/src/schedule.ts), [`keeper.ts`](../keeper/src/keeper.ts), [`chain.ts`](../keeper/src/chain.ts) |
| Interfaces | [`api.ts`](../keeper/src/api.ts), [`cli.ts`](../keeper/src/cli.ts), [`web/index.html`](../web/index.html), [`wallet.js`](../web/wallet.js), [`rehearsal.js`](../web/rehearsal.js) |
| Evidence | [`docs/EVIDENCE.md`](EVIDENCE.md), the `keeper-data` branch, [`contracts/test/fixtures/`](../contracts/test/fixtures) |
| Limits of this design | [README → Known limitations](../README.md#known-limitations) |
