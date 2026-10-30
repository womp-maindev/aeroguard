# Live pitch — API3 track (2 min)

About 280 words, so it fits at a calm pace. Have the screen ready: dashboard on `http://localhost:8787`, Basescan tab with the contract, a terminal in `keeper/`.

## Script

**0:00 — Problem (20 s)**
> Your flight lands three hours late. To get money, you fill in forms, upload boarding passes, wait weeks, and a claims agency keeps a third. AeroGuard removes the claim: if signed flight data says you landed late, you are already paid.

**0:20 — What it is (25 s)**
> AeroGuard is flight-delay cover on Base Sepolia. The contract pays out only on AeroDataBox responses signed by its Airnode on API3 AirnodeHub. A keeper buys that signed data over x402 for five cents a call, and settles. Nobody files a claim and nobody approves one.

**0:45 — The API3 part (35 s)** *(show the contract's request-hash code, then the policy #1 purchase tx)*
> The signed data is the whole decision. The contract rebuilds the AirnodeHub request hash itself from the policy's flight and date, so a genuine response about a different flight does not count. We use signed data at both ends. To buy cover, you attach a fresh signed status saying the flight hasn't left yet, and the scheduled arrival is read from that signature. So nobody insures a flight that is already late, and nobody lies about the schedule.

**1:20 — Proof (30 s)** *(README "Live evidence" → a settlement tx, then the tamper table; terminal already showing `npm run rehearse` output)*
> These are four real policies on last night's flights from Munich, bought with signed proofs. Our keeper settled them on its own. Here is a payout. Before landing, we attacked policy #1 on the deployed contract with a real Airnode response. Edit one value: NotSignedByAirnode. Another flight: WrongRequest. An attacker key: rejected. A genuine but old response: Stale. And here is the same run locally, in two seconds: only the valid, final response pays.

> Do **not** run `npm run tamper` on policies #1–#4 live: once a policy is settled, every attempt answers `NotActive` before any oracle check. The live on-chain proof is the recorded table; the live terminal demo is `anvil --chain-id 84532 & npm run rehearse`.

**1:50 — Close (10 s)**
> Same contract shape works for rail, weather or any event an Airnode can sign. Thank you.

## Q&A

**"Why trust AeroDataBox / the Airnode?"**
The signature proves the AeroDataBox Airnode returned exactly this data for exactly this request at this time. It does not prove AeroDataBox is right about the world, and we say so. We reduce the risk in three ways: we only pay on a final status (`Arrived` or `Canceled`), the response must be signed after the landing it reports, and it must be fresh. The next step is 2-of-2 agreement with a second Airnode, but we could not find a second flight source on AirnodeHub.

**"What if a key is compromised or rotated?"**
The Airnode address is immutable. A rotated key means active policies can only expire after 3 days and release their capital. A new deployment trusts the new key. Nobody can swap the signer under live policies.

**"Is the pool solvent?"**
Every sale checks `freeCapital() >= coverage` after the premium is paid in. `reserved` tracks the coverage of all active policies, and the owner can only withdraw `balance − reserved` ([test](../contracts/test/FlightDelayCover.t.sol#L261)). Selling cover the pool cannot back reverts with `Insolvent` ([test](../contracts/test/FlightDelayCover.t.sol#L235)). The parameters the owner sets only apply to new policies. The flat 8 % premium is a hackathon simplification; real pricing needs route statistics.

**"Why can anyone call settle? Isn't that dangerous?"**
It is what makes the cover claim-free. `settle` has no discretion: the payout is computed from signed fields and always goes to the stored holder. A caller can only provide evidence, and the contract rejects any evidence that is not right. Each policy settles exactly once (`NotActive` on the second try). If our keeper goes down, anyone can settle, including the traveller.

**"Can a keeper pick a favourable response?"**
Only among genuine, fresh, final responses for this exact flight. Once a flight has landed, those all say the same thing. Responses that are old, early or not final are rejected.

**"Private policies: what's the risk?"**
Only a commitment `keccak256(flight, date, salt)` is stored, so nobody can see which flight is insured. The cost is that the purchase proof cannot be checked without revealing the flight. A private buyer is then only limited by the 2 h lead time and a ±1 h schedule window, so they could insure a flight that is already visibly delayed. We document this. The fix is a ZK proof that the committed flight was pre-departure at purchase. Until then: cap private coverage or sell it only through the agent.

**"The AeroDataBox quota is shared by all teams. How do you avoid burning it?"**
- One signed response settles every policy on that flight. The request hash is the same, so it is the same truth.
- The keeper waits until 30 min after the scheduled arrival. It takes one early look 3 h before, for cancellations, and makes at most 6 paid lookups per policy.
- Responses are cached on disk.
- All tests and the rehearsal use captured fixtures (`contracts/test/fixtures`, `keeper/fixtures`), so CI never calls the API.

**"Why Base Sepolia, why x402?"**
AirnodeHub's x402 payments use aUSD on Base Sepolia, so the data and the contract sit on the same chain. With x402, an autonomous agent pays per call without an API key or an account, and it needs no ETH for the payment, because the facilitator submits the transfer. That is what a keeper needs.
