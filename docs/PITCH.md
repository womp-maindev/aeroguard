# Live pitch — API3 track (2 min)

AeroGuard is **one project entered in two tracks: API3 and Cardano** (confirmed by the organizers). This is the API3 version of the pitch: the oracle, the contract and the keeper. Say it in one sentence at the start so the API3 judges know the Cardano part exists and is judged separately.

About 280 words, so it fits at a calm pace. Have the screen ready as in [Run of show](#run-of-show-one-setup-every-proof): dashboard on `http://localhost:8787` (keeper API with `REHEARSE=on`, rehearsal already run once), Basescan tab with the contract, a terminal in `keeper/`.

## Script

**0:00 — Problem (20 s)**
> *(One line first: "AeroGuard is in the API3 and Cardano tracks; this is the API3 part.")* Your flight lands three hours late. To get money, you fill in forms, upload boarding passes, wait weeks, and a claims agency keeps a third. AeroGuard removes the claim: if signed flight data says you landed late, you are already paid.

**0:20 — What it is, and why it is different (30 s)**
> AeroGuard is flight-delay cover on Base Sepolia. Everyone can pay out on signed data. We also sell on it: cover can only be bought with an AeroDataBox status, signed by its Airnode on API3 AirnodeHub, that says the flight hasn't left. So nobody can insure a flight that's already late. A keeper buys the signed arrival over x402 for five cents and settles. Nobody files a claim, and you can check all of it yourself, from your own wallet.

**0:50 — The API3 part (30 s)** *(show the contract's request-hash code, then the policy #1 purchase tx)*
> In AeroGuard, signed data isn't something to look at. It decides whether cover can be sold, and whether and how much gets paid. No signature, no money moves. The contract rebuilds the AirnodeHub request hash itself from the policy's flight and date, so a response about another flight doesn't count. Here is a real purchase: the scheduled arrival comes from the Airnode's signature, not from the buyer.

**1:20 — Proof (35 s)** *(README "Live evidence" → a settlement tx, then the dashboard's tamper lab; end on the dashboard's **Local rehearsal** section, already run)*
> Four real policies on last night's flights from Munich, bought with signed proofs and settled by our keeper. Nobody filed a claim. This one landed early, so the signed arrival closed it with no payout. Now we attack the deployed contract with a real Airnode response. Edit one value: NotSignedByAirnode. Another flight: WrongRequest. An attacker's key: rejected. Too old: Stale. None of last night's flights was two hours late, so here is the same contract on a local chain with a test signer and a fast clock: three hours late pays all, two hours pays half, a cancellation pays all.

> Live, use the dashboard's tamper lab rather than `npm run tamper`: it runs the four forgeries as `eth_call`s from the browser against the deployed contract, no key, and its **Reopen** option (a state override for that call) lets the oracle checks run even on a policy that is already settled. `npm run tamper` on a settled policy stops at `NotActive` first. If policy B is still Active, the **Send it for real** panel under the tamper lab sends the same forgeries as real transactions from a wallet instead, and each one is mined as a failed transaction on Basescan. Backup for the rehearsal: `anvil --chain-id 84532 & npm run rehearse` in the terminal.

**1:55 — Close (5 s)**
> Same contract shape works for rail, weather or any event an Airnode can sign. Thank you.

## What each demo proves (say it before a judge asks)

| On screen | Proves | Say |
|---|---|---|
| Live evidence: purchases, settlements, x402 receipts on Base Sepolia | **Authenticity.** The real AeroDataBox Airnode signed it, the deployed contract accepted it, real money moved | "These are real policies on real flights, settled from real Airnode signatures." |
| Tamper lab (`eth_call`), or **Send it for real** (real transactions) | **The qualifier.** Real responses that were edited, too old, for another request or from the wrong signer are rejected by the deployed contract | "A real Airnode response, one value changed: rejected." |
| **Local rehearsal** | **Completeness.** Every payout rule, the late-purchase guard, keeper autonomy and expiry, in 20 seconds | "Same contract and keeper, local chain, test signer, fast-forwarded clock, so you can see every outcome." |
| Foundry tests (86) | **Edge cases.** Every boundary and attack, a real Airnode capture byte for byte, policies #1–#4 (30 Oct) replayed | "Every rejection has a test, and the live policies are replayed in Solidity." |

The rehearsal is a flight simulator next to the real flight: same controls, scenarios we cannot wait for. Never present it as the tamper test, because the track asks for **real** responses.

## Q&A

**"Isn't the local rehearsal just signing its own data?"**
Yes, on purpose, and only there. It runs the same contract and keeper on a throwaway chain whose trusted signer is a local test key, so we can produce every outcome and fast-forward the clock. The live contract trusts only the AeroDataBox Airnode and rejects every rehearsal response with `NotSignedByAirnode`. Authenticity is shown on the live chain, completeness in the rehearsal, edge cases in the Foundry tests.

**"What's the business case? Does the data cost kill the margin?"**
Embedded cover that travel apps sell at checkout, paid without a claim. It complements EU261, which needs a claim, starts at 3 h and excludes weather and strikes. Measured on Base Sepolia, a policy costs about $0.18 in signed data and gas when it is alone on its flight, and $0.07 when ten share it: one signed outcome settles every policy on that flight. For $50 cover at an 8 % premium, that is 4.6 % or 1.8 % of the premium, for fraud-resistant settlement within minutes. Today a claim agency keeps about a third of an EU261 payout. Details and assumptions: [docs/BUSINESS.md](BUSINESS.md).

**"Why trust AeroDataBox / the Airnode?"**
The signature proves the AeroDataBox Airnode returned exactly this data for exactly this request at this time. It does not prove AeroDataBox is right about the world, and we say so. We reduce the risk in three ways: we only pay on a final status (`Arrived` or `Canceled`), the response must be signed after the landing it reports, and it must be fresh. The next step is a second check of the landing time with the OpenSky Network's Airnode on AirnodeHub (ADS-B tracking). OpenSky has no schedules, so it can confirm when the aircraft landed but can't decide a delay on its own. A second source of scheduled and actual times is what we couldn't find.

**"What if a key is compromised or rotated?"**
The Airnode address is immutable. A rotated key means active policies can only expire after 3 days and release their capital. A new deployment trusts the new key. Nobody can swap the signer under live policies.

**"Is the pool solvent?"**
Every sale checks `freeCapital() >= coverage` after the premium is paid in. `reserved` tracks the coverage of all active policies, and the owner can only withdraw `balance − reserved` ([test](../contracts/test/FlightDelayCover.t.sol#L261)). Selling cover the pool cannot back reverts with `Insolvent` ([test](../contracts/test/FlightDelayCover.t.sol#L235)). The parameters the owner sets only apply to new policies. The flat 8 % premium is a hackathon simplification; real pricing needs route statistics.

**"Why can anyone call settle? Isn't that dangerous?"**
It is what makes the cover claim-free. `settle` has no discretion: the payout is computed from signed fields and always goes to the stored holder. A caller can only provide evidence, and the contract rejects any evidence that is not right. Each policy settles exactly once (`NotActive` on the second try). If our keeper goes down, anyone can settle, including the traveller.

**"Was the keeper really autonomous?"**
It decides on its own what to buy, when, and whether the evidence is final, then settles. What starts a pass differs: `npm run keeper` is a plain unattended loop, and in GitHub Actions a pass runs on a schedule. On 30 Oct GitHub's scheduler didn't fire at first, so the first passes were started with the Run button; it first fired on its own at 22:55Z on 30 Oct, and again at 02:14Z on 31 Oct (both runs successful), though less often than the cron asks. Same code, same decisions, and because `settle` gives the caller no power, any of these triggers (or a stranger) is fine.

**"Can a keeper pick a favourable response?"**
Only among genuine, fresh, final responses for this exact flight. Once a flight has landed, those all say the same thing. Responses that are old, early or not final are rejected.

**"Private policies: what's the risk?"**
Only a commitment `keccak256(flight, date, salt)` is stored, so nobody can see which flight is insured. The cost is that the purchase proof cannot be checked without revealing the flight. A private buyer is then only limited by the 2 h lead time and a ±1 h schedule window, so they could insure a flight that is already visibly delayed. We document this. The fix is a ZK proof that the committed flight was pre-departure at purchase. Until then: cap private coverage or sell it only through the agent.

**"The AeroDataBox quota is shared by all teams. How do you avoid burning it?"**
- One signed response settles every policy on that flight. The request hash is the same, so it is the same truth.
- The keeper takes one early look 3 h before arrival, for cancellations. From 30 min after the scheduled arrival it checks every 30 min until +6 h, then every 3 h until +24 h, at most 20 paid lookups per policy. Most flights settle on the first check.
- Responses are cached on disk.
- All tests and the rehearsal use captured fixtures (`contracts/test/fixtures`, `keeper/fixtures`), so CI never calls the API.

**"You're also in the Cardano track. What's the link?"**
Same project, two tracks, confirmed by the organizers. On Cardano preprod an agent pays over **x402 in tADA**: `GET /verdict` sells an Airnode-signed flight verdict (first paid request: [tx e2ef922b…](https://preprod.cardanoscan.io/transaction/e2ef922be71ba61da9431f1a5f56f4c56f5d61348c4945194cf390dd0acd7864)), and `GET /policy` sells cover. Only after the Cardano payment settles, the server buys the policy on Base through the keeper's own path (fresh signed proof, `buyPolicy`) and writes `cardanoJobRef = keccak256("cardano:<payment tx>")`, so each Base policy names the Cardano payment that bought it. The same signed AeroDataBox response is verified by `FlightDelayCover` on Base and by the Aiken cover on Cardano (44 Aiken tests). The API3 part does not depend on Cardano: the payout is decided only by AirnodeHub-signed data, whoever paid.

**"Etherisc (2017) and AXA fizzy already did flight-delay insurance on-chain."**
They relied on an oracle relay or on the insurer itself to post the outcome, and nothing stopped cover from being bought on a flight that was already late. Here the contract checks the data source's own signature (the AeroDataBox Airnode), purchase needs a signed pre-departure proof, `settle` has no privileged caller, and the same signed response is verified on Base (Solidity) and on Cardano (Aiken).

**"No policy has paid out yet?"**
No. Every flight so far landed on time or early, so 0 is the correct result, and anyone can check it against the Airnode's signature (`docs/EVIDENCE.md`). The payout path (50 % / 100 % / cancellation) is covered by the contract tests and by the anvil rehearsal. The Saturday policies are still open and settle during and after judging, so a real delay would pay live.

**"Why Base Sepolia, why x402?"**
AirnodeHub's x402 payments use aUSD on Base Sepolia, so the data and the contract sit on the same chain. With x402, an autonomous agent pays per call without an API key or an account, and it needs no ETH for the payment, because the facilitator submits the transfer. That is what a keeper needs.

## Run of show: one setup, every proof

**One process serves everything.** With the keeper wallet in `.env` (`KEEPER_PK`, `FLIGHT_COVER_ADDRESS`, `KEEPER=off`), start the API with the rehearsal switched on:
```bash
cd keeper && REHEARSE=on npm run api      # http://localhost:8787
```
In PowerShell, or to save typing, put `REHEARSE=on` in `.env` instead; `npm run api` reads it.
The page reads the live contract on Base Sepolia, **Cover me** buys live with the keeper wallet, and **Local rehearsal** runs on its own throwaway anvil on `:8545` with no keys, so it never touches the live contract. Do not start anvil yourself: the rehearsal starts its own.

**Morning (by 12:00)**
1. Buy **policy B**: a flight landing after the video is recorded, at least 2 h after purchase. Use the dashboard **Cover me**, or `npm run cli -- buy …`. B serves both the real-transaction tamper shot (6A in `docs/VIDEO.md`) and, if timed right, the on-stage purchase.
2. Run `npm run cli -- proof <B's buyPolicy tx> > B-proof.json`. From 1 h after buying, it shows `Stale` when sent.
3. Record the video (`docs/VIDEO.md`).

**14:30, before the pitch**
1. `npm run cli -- status`: the keeper has ≥ 0.1 aUSD and gas, and the pool `free` ≥ the cover you will buy.
2. Start the API as above and open http://localhost:8787. Click **Run the full rehearsal** once, so its result is already on screen; a reload keeps it.
3. Tabs: README "Live evidence" · Basescan contract · the dashboard. Connect the browser wallet in **Send it for real** if policy B is still Active.

**During the pitch (2 min)**

| Time | Screen | Proof |
|---|---|---|
| 0:00–0:50 | Title, then the dashboard header | problem, product and the USP: signed data at both ends |
| 0:50–1:20 | Editor: `requestHashFor` → Basescan policy #1 purchase tx | the request binding and a real purchase proof |
| 1:20–1:35 | README Live evidence → one settlement tx | the valid case, live |
| 1:35–1:45 | Tamper lab: **Run the 4 attacks** (or **Send it for real** on B) | the qualifier, with real responses |
| 1:45–1:55 | Local rehearsal results: the payout table | every payout rule |
| 1:55–2:00 | Close | — |

Optional, only if the morning dry run worked: the live purchase on stage (below), about 20 s. Take that time from the rehearsal segment.

## No laptop? Everything from the phone
- **Dashboard**: https://womp-maindev.github.io/aeroguard/ (once the repo is public and the Pages workflow has run). Inspector and tamper lab run in the phone's browser: `eth_call`s to the deployed contract, no key, no paid lookups.
- **Live purchase**: send "купи LH1234@2026-10-31" in the Claude chat (the API3 session dispatches the `Buy policies` workflow, ~30 s, answers with the Basescan link), or GitHub → Actions → Buy policies → Run workflow. The key stays in the GitHub secret.
- **Keeper**: runs from GitHub Actions, triggered by the API3 session; nothing to start.
- **Evidence**: `docs/EVIDENCE.md` on GitHub has every purchase, proof, x402 receipt and settlement.

## Live purchase on stage (optional, ~20 s)

Buying a real policy live proves the purchase-side oracle check on the deployed contract. It costs **one** paid AeroDataBox lookup (0.05 aUSD) plus the premium. Only do it if the morning dry run worked.

**What the contract will demand.** A fresh (≤ 15 min) signed status for the flight, the status must still be pre-departure (`Expected / Unknown / CheckIn / Boarding`), and the scheduled arrival must be **≥ 2 h after the purchase block** (`minLeadTime`).

**Pick the flight the evening before, without the API.** Use the public MUC departures board to choose one flight landing between about **17:30 and 20:00 CET on Sat 31 Oct**, plus one backup. That keeps it ≥ 2 h ahead at 15:00 while the keeper can still settle it the same evening. Do **not** run `resolve` or `verdict` to check it: every call is a paid lookup from the shared quota, and `buy` already does that lookup.

**Before the pitch (14:30):**
- `cd keeper && npm run cli -- status` shows that the keeper wallet has ≥ 0.1 aUSD (lookup + premium) and some ETH for gas, and that the pool's `free` ≥ the coverage you will buy.
- For the purchase, the dashboard's **Cover me** needs the local keeper API: `cd keeper && npm run api`, then open http://localhost:8787. Or keep the terminal command below in the shell history.

**On stage**, either click **Cover me** in the dashboard section "Cover a flight" (flight, local departure date, holder, coverage 0.5), or run:
```bash
npm run cli -- buy --flight <FLIGHT> --date 2026-10-31 --holder <YOUR_ADDRESS> --coverage 0.5
```

| Step | What happens | Expected time |
|---|---|---|
| 1 | The keeper pays 0.05 aUSD over x402 and receives the signed status | ~3–8 s (the Airnode answers, then the facilitator settles the payment) |
| 2 | `buyPolicy` with the signed proof as calldata. The contract checks the signer, request hash, freshness, pre-departure status and lead time | ~2–4 s (Base Sepolia ~2 s blocks + receipt) |
| 3 | The output shows the policy id and a Basescan link. Open it and point at `PolicyBought` | ~5 s |

About **10–20 s** in total. These times are estimates; time steps 1–2 in the morning dry run and replace them. The allowance was already approved during the first purchase, so there is no extra `approve` transaction.

**Say while it runs:** "The keeper is buying a signed status from the AeroDataBox Airnode. The contract won't sell cover unless the Airnode says this flight hasn't left yet, and it takes the schedule from the signature, not from me."

**If something fails:** the error is a decoded revert (`NotBuyable(Delayed)`, `TooCloseToArrival`, `Insolvent`, …). That is a demo of the checks too: say so, and move on to the backup flight or to the local `npm run rehearse`. Never retry more than once on stage: each retry is another paid lookup.

**Afterwards:** the GitHub Actions keeper settles this policy after it lands, with no further action.
