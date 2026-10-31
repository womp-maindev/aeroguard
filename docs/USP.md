# Why AeroGuard: the edge over a team that builds the same thing

The challenge requirements (an AirnodeHub integration, an on-chain check of signer, request and freshness, and the four-case tamper test) are the entry ticket, not the edge. Flight-delay cover on AeroDataBox is one of the most obvious ideas for this track, so assume several teams build it. This is what separates AeroGuard from a project with the same features.

## The USP in one sentence

> **In AeroGuard, signed data gates both the sale and the payout, and you can verify that yourself, from your own wallet, on the live contract.**

Pitch version: *"Everyone can pay out on signed data. We also sell on it, so nobody can insure a flight that's already late."*

## The insight most teams miss

A parametric product that only checks data at **payout** has a hole at **purchase**. If anyone can buy cover at any time, the cheapest strategy is to buy it for a flight you already know is late. The pool is then drained by people with perfectly genuine, perfectly signed evidence. Signature checks don't help, because the data is real; the timing of the purchase is the problem.

AeroGuard closes it on-chain. `buyPolicy` only accepts a **fresh (≤ 15 min) AeroDataBox status signed by the Airnode** for that exact flight and date, and only while the flight is **pre-departure** (`Expected / Unknown / CheckIn / Boarding`). The **scheduled arrival is read from that signature**, not from the buyer, and must be at least 2 h away. Settlement must then show the **same signed schedule**. So:
- nobody can insure a flight that is already delayed, cancelled or landed (`NotBuyable`);
- nobody can lie about the schedule to inflate the delay (`ScheduleMismatch`);
- nobody can buy minutes before landing, when the outcome is all but known (`TooCloseToArrival`).

This is the difference between "built an oracle consumer" and "understood insurance".

## Typical team vs. AeroGuard

| | Typical team | AeroGuard |
|---|---|---|
| **When signed data is used** | only at payout | **at both ends**: sale and payout ([purchase-proof tests](../contracts/test/FlightDelayCover.t.sol)) |
| **Request binding** | a hash computed off-chain and stored | **built on-chain** from the policy's flight and date, and checked byte for byte against a real AirnodeHub capture ([`Fixture_RealAeroDataBoxCapture`](../contracts/test/Fixtures.t.sol)) |
| **Who triggers the payout** | the user clicks "claim" | **no claim**: an autonomous keeper pays for data over x402, decides when a lookup is worth it, and settles. One signed outcome settles every policy on that flight. This is the track's bonus criterion |
| **Proof** | a demo video | real policies on real flights, x402 receipts, the tamper test on the deployed contract with real responses, all live policies replayed in Solidity, 94 tests, a rehearsal run by CI on every push ([evidence](EVIDENCE.md)) |
| **Can the judge check it?** | watches our screen | **attacks it**: real transactions from their own wallet, their own pasted response, an in-browser Inspector, a one-click rehearsal of every outcome |
| **Business reasoning** | "insurance is a big market" | **measured** cost per policy, $0.07 to $0.18 (2 to 5 % of the premium) ([business case](BUSINESS.md)) |
| **Honesty** | limits unstated | trust assumptions and [known limitations](../README.md#known-limitations) with production fixes |
| **Feedback for API3** | none | concrete, from real friction: missing pointers return 400 (a second projection was needed for cancellations), on-chain request hashes need JSON-safe input, no signed source observation time |

## Why a copy is still weaker

A team that matches the feature list still has to (1) discover *why* the purchase proof matters, (2) produce live evidence on real flights with real x402 payments, (3) replay that evidence in Solidity, and (4) build a way for judges to break it themselves. Those take real flights, real time and real debugging, not just code.

## Where a same-looking team could beat us, and our answer

| Their possible edge | Our answer |
|---|---|
| A **real live payout** (none of our live flights was 2 h late) | Say it plainly: the signed arrival closed each policy, which is still data driving an on-chain state change. Show every payout tier in the rehearsal. Buy more live policies on the day to give a payout a chance ([README](../README.md#known-limitations)) |
| A smoother **wallet purchase** in the browser | Lead with what can't be copied quickly: the purchase proof, and judges attacking the live contract themselves |
| A tighter pitch | Open with the insight, not the feature list |

## Beyond the hackathon

- **Capital efficiency:** shared settlement makes verification cheaper per policy as volume grows.
- **Distribution:** one contract call lets any travel app embed it at checkout.
- **Expansion:** the same contract shape works for rail, weather or any event an Airnode can sign.
