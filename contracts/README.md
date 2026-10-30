# AeroGuard contracts

`FlightDelayCover` is parametric flight-delay cover. Signed AeroDataBox data, signed by the AeroDataBox Airnode on AirnodeHub (`0x83FE2E8F24E66520B1902C3507De4F471248f2Ec`), is used **at both ends**:

- **Purchase:** the buyer attaches a fresh signed status response proving the flight has not left yet. Its signed `scheduled` field becomes the policy's scheduled arrival.
- **Settlement:** a signed arrival or cancellation response decides the payout.

Nobody files a claim and nobody approves one.

```
forge test --use /usr/local/bin/solc --offline            # 52 pass, 1 skipped until the live settlement is captured
forge test --use /usr/local/bin/solc --offline --gas-report
forge coverage --use /usr/local/bin/solc --offline --ir-minimum --report summary
```

## Payout

| Signed outcome | Payout |
|---|---|
| `status = Canceled` (status projection) | 100% |
| `Arrived`, `actual - scheduled >= 180 min` | 100% |
| `Arrived`, `>= 120 min` | 50% |
| `Arrived`, `< 120 min` | 0 (closed) |
| no qualifying evidence by `scheduledArrival + 3 days` | anyone may `expire`, coverage is released |

## Public and private policies

- `buyPolicy(flight, date, coverage, holder, cardanoJobRef, timestamp, data, signature)`: `timestamp`, `data` and `signature` are the **purchase proof**, an AeroDataBox status-projection response (`{"scheduled":…,"status":…}`) signed for `requestHashFor(flight, date, false)`. The proof must meet all of these conditions:
  - It is at most 15 minutes old (`PURCHASE_MAX_AGE`) and not from the future.
  - The status is pre-departure: `Expected`, `Unknown`, `CheckIn` or `Boarding`. `Delayed`, `GateClosed`, `Departed`, `EnRoute`, `Arrived`, `Canceled`, `CanceledUncertain`, `Diverted` and everything else is rejected.
  - `block.timestamp + minLeadTime <= scheduled`.

  `scheduledArrival` is **read from the signed proof** and is not a caller input. Settlement must then show exactly the same `scheduled` (tolerance 0). The flight and date are stored, and both request hashes are derived on-chain.
- `minLeadTime` defaults to 2 hours and can be changed with `setMinLeadTime` (owner, emits `MinLeadTimeUpdated`). **0 is for demos only.** It lets anyone buy cover minutes before landing.
- `buyPrivatePolicy(commitment, coverage, holder, cardanoJobRef, scheduledArrival)`: only `commitment = keccak256(abi.encode(flight, date, salt))` (see `commitmentFor`) is stored. The flight, the date and both request hashes stay empty, and the `PrivatePolicyBought` event has no flight information. `settlePrivate(id, flight, date, salt, requestHash, timestamp, data, signature)` opens the commitment, checks the characters of the flight and date, derives the request hashes exactly as `buyPolicy` does, and then runs **the same internal `_settle`** as `settle`. Until that settlement, nobody watching the chain learns which flight is insured.
  - Still public: `holder`, `coverage`, `premium` and `scheduledArrival`. The keeper rounds `scheduledArrival` to the hour. Settlement tolerates **±1 hour** (`SCHEDULE_TOLERANCE`) against the signed value, and the purchase must also meet `block.timestamp + minLeadTime <= scheduledArrival`.
  - **Residual risk (honest):** a purchase proof cannot be checked without revealing the flight. A private buyer could therefore insure a flight that is already visibly delayed. The only limits are that the purchase must come at least `minLeadTime` before a scheduled arrival that is within ±1 hour of the real one. In production, the buyer would add a ZK proof that the committed flight's signed status was pre-departure at purchase. Until then, cap private coverage or restrict private buys to the agent.
  - `salt` must be 32 random bytes. With a guessable salt, anyone can brute-force the commitment against a day's flight list.
  - Once `settlePrivate` has been broadcast, the flight is public, even if that call reverts.

## Threat model

| Attack | Check | Revert |
|---|---|---|
| Edit a signed value (for example a later `actual`) | EIP-191 recover over `keccak256(requestHash, timestamp, data)` must equal the immutable `airnode` | `NotSignedByAirnode(signer)` |
| Response signed by any other key | same | `NotSignedByAirnode(signer)` |
| Genuine response for another flight, date, operation or projection | `requestHash` must equal a hash **derived on-chain** from the policy's flight and date (`requestHashFor`), never taken from the caller | `WrongRequest(hash)` |
| Private: reveal another flight or date, or guess the salt | `commitmentFor(flight, date, salt) == commitmentOf[id]` | `BadCommitment()` |
| Private: commit to a flight string that needs JSON escaping, so the hash is not AirnodeHub's | `_checkFlight` / `_checkDate` when the commitment is opened | `BadFlight()` / `BadDate()` |
| Settle a private policy through `settle` (no stored hash), or the reverse | stored hash ≠ 0 / commitment ≠ 0 | `PrivatePolicy(id)` / `NotPrivate(id)` |
| Old response (for example from before a delay was revised) | `timestamp + maxAge >= block.timestamp` (`maxAge` is frozen per policy when it is bought) | `Stale(ts)` |
| Timestamp in the future | `timestamp <= block.timestamp + 60s` | `FromTheFuture(ts)` |
| Source observation time: "Arrived at 17:20" signed at 15:00 | `timestamp >= actual` | `ObservedTooEarly` |
| Early cancellation snapshot | `timestamp + 1 day >= scheduled` | `ObservedTooEarly` |
| Non-final status (`Delayed`, `Expected`, …) | `Arrived` (arrival projection) or `Canceled` (status projection) required | `NotFinal(status)` |
| Duplicate execution | **per policy**: only `Active` policies settle, and the status moves out of `Active` before the transfer | `NotActive(id)` |
| **Pool drain: buy cover for a flight already known to be delayed, cancelled or landed** | public: purchase proof signed by the Airnode, status ∈ {Expected, Unknown, CheckIn, Boarding} | `NotBuyable(status)` |
| Old purchase proof (taken while the flight still looked fine) | proof `timestamp + 15 min >= block.timestamp`, and not more than 60 s in the future | `Stale(ts)` / `FromTheFuture(ts)` |
| Purchase proof for another flight or date, the arrival projection, or an edited proof | proof verified against `requestHashFor(flight, date, false)` derived on-chain | `NotSignedByAirnode(signer)` |
| Buy just before arrival (when the delay is all but known) | `block.timestamp + minLeadTime <= scheduled` (both kinds) | `TooCloseToArrival(scheduled, earliest)` |
| Bogus `scheduledArrival` to dodge expiry or lock capital | public: taken from the signed proof, and settlement needs an exact match. Private: ≤ now + 400 days at purchase and within ±1 hour of the signed value at settlement | `ScheduleMismatch(signed, stored)` / `BadSchedule()` |
| Sell cover the pool cannot pay | `freeCapital() >= coverage` after the premium is in, and `reserved` tracks the coverage of active policies | `Insolvent` |
| Owner drains the cover backing active policies | `withdrawFree` only takes `balance - reserved`. `setParams` only affects new policies | `Insolvent` |
| Reentrancy through the token | `nonReentrant` on buy and settle functions. The state is written before `safeTransfer` | — |

**Deliberate decision: duplicate execution is counted per policy, and one flight outcome settles all of that flight's policies.** The same flight and date give the same request hash and so the same truth. One signed AeroDataBox response therefore settles **every** policy on that flight, each exactly once. There is no global "response used" mapping: such a mapping would make every extra traveller on the same flight need another paid lookup from the shared quota, and it would protect nothing that the status machine does not already protect. `Settled.responseId = keccak256(signature)` only labels the evidence.

## Trust assumptions

- The signature proves **the AeroDataBox Airnode answered this exact request with this exact data at this time**. It does **not** prove that the answer is true about the real world. A wrong AeroDataBox answer pays out (or fails to pay out) wrongly.
- The `airnode` address is immutable. If the Airnode rotates its key, active policies can only expire, and a new deployment is needed.
- The pool's capital and parameters are controlled by one owner key (hackathon scope). The owner cannot touch reserved capital or change the terms of policies already bought.
- **Adverse selection** is enforced on-chain for public policies, by the signed pre-departure proof plus `minLeadTime`. A delay that becomes known after a fresh "Expected" proof and more than `minLeadTime` before arrival is ordinary insurance risk, and the premium prices it. For private policies, see the residual risk above.
- **A schedule change by the airline is not paid.** A public policy needs the signed `scheduled` at settlement to equal the one at purchase. If the airline moves the timetable, the policy cannot settle and expires. The premium is lost, and there is no payout for that kind of change.

## Gas (optimizer on, `--gas-report`)

| Function | Gas |
|---|---|
| `buyPolicy` (including purchase-proof signature check + JSON parse) | 316,095 |
| `buyPrivatePolicy` | 191,650 |
| `settle` (signature check + JSON parse + payout) | median 154,030, max 158,842 |
| `settlePrivate` (adds opening the commitment and storing 2 hashes) | 211,677 on the happy path |
| `expire` | 32,567 |
| Deployment | 3,967,103 (18,503 bytes) |

Coverage: `FlightDelayCover.sol` has 98.8% line and 86.8% branch coverage.

## Fixtures

`test/Fixtures.t.sol` replays captured responses. The format of `test/fixtures/*.json` is:

```json
{ "flight": "LH1234", "date": "2026-10-30", "kind": "arrival",
  "airnode": "0x83FE…", "requestHash": "0x…", "timestamp": 1793381400,
  "data": "{\"actual\":\"…\",\"scheduled\":\"…\",\"status\":\"Arrived\"}", "signature": "0x…" }
```

- `sample-signed-arrival.json` is **synthetic** (signed with the test key `0xA11CE`). It tests the loader and settles end to end.
- `aerodatabox-arrival.json` is a **real** AirnodeHub capture. Drop it in and the test checks the following: the signer recovers to `0x83FE…f2Ec`, `requestHash == requestHashFor(flight, date, kind == "arrival")`, and one edited byte is rejected. If the status is final, it also opens a policy through a test-only `CoverHarness` (which skips the purchase proof, since a captured settlement response has no matching purchase response) and settles it end to end. The test is skipped while the file is missing. `data` must be the exact signed string.

## Tests (53)

- Payout and happy paths: `RequestHashMatchesAirnodeHubScheme`, `FullPayoutAfter3hDelay`, `HalfPayoutAfter2hDelay`, `NoPayoutWhenOnTime`, `FullPayoutWhenCancelled`, and `testFuzz_PayoutTiers` (1000 runs).
- API3 tamper tests: `Tamper1_RejectEditedValue`, `Tamper2_RejectTooOld`, `Tamper3_RejectOtherRequest`, `Tamper4_RejectUnexpectedSigner`.
- Hardening: `SameEvidenceSettlesEveryPolicyOnThatFlightOnce`, `RejectSettlingTwice`, `RejectFutureTimestamp`, `RejectNotYetLanded`, `RejectObservationBeforeLanding`, `InsolventPoolBlocksPurchase`, `RejectFlightNeedingJsonEscape`, `ExpireAfterWindow`, `OwnerCannotWithdrawReservedCapital`.
- Purchase proof: `Buy_StoresSignedScheduledArrival`, `Buy_AcceptsEveryPreDepartureStatus`, `Buy_RejectOutcomeAlreadyKnown` (Delayed, Arrived, Canceled, CanceledUncertain, Diverted, Departed, EnRoute, GateClosed), `Buy_RejectStaleProof`, `Buy_RejectFutureProof`, `Buy_RejectProofForOtherFlightOrProjection`, `Buy_RejectEditedProof`, `Buy_RejectWrongSignerProof`, `Buy_RejectTooCloseToArrival`, `Buy_MinLeadTimeIsOwnerSetting`, `RejectSettleEvidenceWithOtherSchedule`.
- Private policies: `Private_StoresNoFlightInfo`, `Private_HappyPathFullPayout`, `Private_CancelledPaysFull`, `Private_RejectWrongSalt`, `Private_RejectOtherFlightReveal`, `Private_RejectPublicSettleAndViceVersa`, `Private_RejectZeroCommitment`, `Private_RejectBadFlightCharsEvenIfCommitted`, `Private_Tamper1..4`, `Private_RejectSettlingTwice`, `Private_RejectBeyondHorizon`, `Private_RejectTooCloseToArrival`, `Private_AcceptScheduleWithin1h`, `Private_RejectScheduleBeyond1h`, `Private_ExpiresLikePublic`.
- Fixtures: `Fixture_SyntheticSampleLoadsAndSettles`, `Fixture_RealAeroDataBoxCapture` (real AirnodeHub capture, LH400).
- Live replay of policy #1 (`test/LiveReplay.t.sol`), on the exact Airnode signatures used on Base Sepolia, through the real `buyPolicy` and `settle` with the deploy-script parameters (no harness, no test signer): `Live_IB1314_BoughtWithRealSignedProof`, `Live_IB1314_PurchaseProofCannotSettle` (`NotFinal(Expected)`, then `Stale(1793378516)` as on-chain), `Live_IB1314_SettlesLikeOnChain` (skipped until the keeper's real settlement response is committed as `test/fixtures/IB1314-settlement.json`; then it must reproduce the on-chain outcome and payout).
