# Demo video — shot list (≤ 2:30)

Target 2:24 with shot 6A (2:20 with 6B), which leaves at least 6 s of slack. 1080p screen recording plus voice-over. Each shot lists what is on screen and what is said.

## Before recording

- The tamper lab works at any time, from the published dashboard (https://womp-maindev.github.io/aeroguard/ once the repo is public) or `web/index.html`: every attack is an `eth_call` from the browser to the deployed contract, no key. For a policy that is already settled, keep **Reopen a settled policy for the simulation** ticked (a state override for that call only); otherwise the contract answers `NotActive` before any oracle check.
- Do **not** press "Fetch real evidence" or run `verdict` on camera. Each press is a paid lookup from the AeroDataBox quota that every team shares. Use "Open .json" with `keeper/fixtures/IB1314-status-proof.json` or the demo fixture.
- Prepare these tabs: the dashboard (published page, or `web/index.html`; no keeper API needed. `npm run api` serves it locally without a second keeper unless `KEEPER=on`), Basescan contract page, policy #1 purchase tx, one settlement payout tx (from README "Live evidence"), GitHub Actions keeper run log, and the editor open at `contracts/src/FlightDelayCover.sol` on `requestHashFor`.
- Terminal: font ≥ 18 pt. Have `anvil --chain-id 84532 &` already running in `keeper/`.

### For the real-transaction tamper shot (6A)

The track wants **a valid, timely response that triggers the on-chain action first, then four responses rejected before that action**. A settled policy answers every later transaction with `NotActive`, before any oracle check. So use **two policies**:

- **Policy A, the valid case:** a policy the keeper settled with a real final Airnode response (any of #1–#4, or the on-stage one after landing). Shot 5 shows its settlement transaction.
- **Policy B, the four rejections:** a policy that is still **Active** while you record. All four live policies have settled, so buy a new one on Saturday for a flight that lands after recording. Buy it **at least 1 h before recording** so its purchase proof is older than `maxAge` and can show `Stale`. One purchase costs 0.05 aUSD for the signed schedule, from the shared quota.

Set up before pressing record:

1. Use a fresh test wallet (MetaMask or Rabby) with no real funds and about 0.001 Base Sepolia ETH. Hide every other account. Connect it in **Send it for real** and check that the panel says *Connected … on Base Sepolia* with no gas warning.
2. Run `cd keeper && npm run cli -- proof <policy B's buyPolicy tx>`, which needs no key and no lookup, and save the output as `B-proof.json`. In the dashboard: Inspector → **Open .json** → `B-proof.json`. In the tamper lab, set the target to **policy B** and tick **Use the inspector's response as the base**. All four attacks now start from a real Airnode signature for B.
3. Rehearse once off camera. The wallet will warn *"this transaction will likely fail"*: that is expected, so confirm. Each send takes a few seconds on Base Sepolia; cut the waits in the edit, but keep each wallet prompt on screen for about 1 s so it is visibly a real transaction.
4. Never press **Send: Genuine** on policy B on camera. A final response settles it for good.

If there is no Active policy, or the wallet misbehaves, record shot **6B** instead: the same four attacks as `eth_call` simulations, which need no wallet.

## Shots

| # | Time | On screen | Voice-over |
|---|---|---|---|
| 1 | 0:00–0:12 | Title card: "AeroGuard — your flight is late, you're already paid". Below it: "API3 AirnodeHub · AeroDataBox · Base Sepolia" | "Your flight lands three hours late. Getting money means forms, evidence, weeks of waiting and an agency fee." |
| 2 | 0:12–0:25 | Dashboard hero, then the "How it works" diagram in the README | "AeroGuard is cover that settles itself. The contract pays only on flight data signed by the AeroDataBox Airnode on API3 AirnodeHub. Nobody files a claim." |
| 3 | 0:25–0:45 | Dashboard "Cover a flight": fill in a flight and press **Only check status** *only if a cached response exists*; otherwise show the policy #1 purchase tx on Basescan → Input data → the signed `{"scheduled":…,"status":"Expected"}` | "To buy cover, you attach a fresh signed status from the Airnode. The contract checks it is the real signer, the right flight, under 15 minutes old and still pre-departure. It reads the scheduled arrival from the signature, so nobody insures a flight that's already late." |
| 4 | 0:45–1:00 | Editor: `requestHashFor` (zoom). Then `Fixtures.t.sol` `test_Fixture_RealAeroDataBoxCapture` passing in the terminal | "The contract rebuilds AirnodeHub's request hash itself from the policy's flight and date. Here it matches a real Airnode capture byte for byte, so a genuine response about a different flight is useless." |
| 5 | 1:00–1:20 | **The valid case (policy A).** GitHub Actions: keeper run log for the settlement tick → click the tx link → Basescan `Settled` event. #1–#4 all closed with `ClosedNoPayout` and payout 0, because none was 2 h late. Use #1 (IB1314), which landed on time. If a delayed on-stage flight has settled by then, show its aUSD transfer to the holder instead | "After landing, our keeper buys a signed arrival over x402 for five cents, simulates the settlement, and sends it. This flight was on time, so the signed arrival closes the policy with no payout: the data decided, on-chain. Anyone could run the keeper, and a payout always goes to the stored holder." |
| 6A | 1:20–1:55 | Tamper lab → **Send it for real**, target **policy B** (Active), base = B's real purchase proof. Press **Send: Edited data** → wallet prompt (about 1 s) → **REVERTED · ON-CHAIN** `NotSignedByAirnode`. Repeat for **Wrong request** (`WrongRequest`), **Wrong signer** (`NotSignedByAirnode(attacker)`) and **Stale evidence** (`Stale`), with the waits cut. End on one Basescan link: the transaction shows **Fail**, and the policy row below still says **Active** | "Now four forgeries against a policy that's still open, sent as real transactions from a wallet. A real response with one value edited: not signed by the Airnode. A real response for another flight: wrong request. An attacker's key: rejected. A genuine but hour-old response: stale. Each one is a failed transaction on Basescan, and the policy is untouched." |
| 6B | 1:20–1:50 | *Fallback, if 6A cannot be recorded.* Dashboard "Attack the deployed contract": target policy #1 (base = its real Airnode response, shown in the note), keep **Reopen** ticked, **Run the 4 attacks**, each revert reason highlighted. Nothing is paid: all four are `eth_call`s | "Now we attack the live contract with a real Airnode response. Edit one value: not signed by the Airnode. Another flight: wrong request. An attacker's key: rejected. A genuine but old response: stale." |
| 7 | 1:55–2:07 | Dashboard Security Inspector: load the fixture, click "Add 3 h to the arrival time", and the verdict flips to rejected; click Reset and it is valid again | "The Security Inspector shows the same checks in the browser, so anyone can see exactly why the contract would or wouldn't pay." |
| 8 | 2:07–2:14 | Terminal: `npm run rehearse` scrolling to "holder balance" | "And the whole flow runs locally in seconds with no funds: five policies, four attacks, every policy settled." |
| 9 | 2:14–2:24 | End card: repo URL, contract address, "86 tests · 4 live policies settled & replayed · x402 · judges can attack it from their own wallet" | "AeroGuard. The signed data is the decision. Try to break it yourself. Thanks." |

## After recording

- Upload the video as unlisted on YouTube, then add the link to `docs/DEVFOLIO.md` (Links) and to the top of `README.md`.
- Check the length is ≤ 2:30, the subtitles are legible, and no `.env` or private key is visible in any frame (the terminal history included).
