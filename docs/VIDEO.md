# Demo video — shot list (≤ 2:30)

Target 2:20, which leaves 10 s of slack. 1080p screen recording plus voice-over. Each shot lists what is on screen and what is said.

## Before recording

- The tamper lab works at any time, from the published dashboard (https://womp-maindev.github.io/aeroguard/ once the repo is public) or `web/index.html`: every attack is an `eth_call` from the browser to the deployed contract, no key. For a policy that is already settled, keep **Reopen a settled policy for the simulation** ticked (a state override for that call only); otherwise the contract answers `NotActive` before any oracle check.
- Do **not** press "Fetch real evidence" or run `verdict` on camera. Each press is a paid lookup from the AeroDataBox quota that every team shares. Use "Open .json" with `keeper/fixtures/IB1314-status-proof.json` or the demo fixture.
- Prepare these tabs: the dashboard (published page, or `web/index.html`; no keeper API needed. If you do run `npm run api` locally, use `KEEPER=off` so no second keeper spends quota), Basescan contract page, policy #1 purchase tx, one settlement payout tx (from README "Live evidence"), GitHub Actions keeper run log, and the editor open at `contracts/src/FlightDelayCover.sol` on `requestHashFor`.
- Terminal: font ≥ 18 pt. Have `anvil --chain-id 84532 &` already running in `keeper/`.

## Shots

| # | Time | On screen | Voice-over |
|---|---|---|---|
| 1 | 0:00–0:12 | Title card: "AeroGuard — your flight is late, you're already paid". Below it: "API3 AirnodeHub · AeroDataBox · Base Sepolia" | "Your flight lands three hours late. Getting money means forms, evidence, weeks of waiting and an agency fee." |
| 2 | 0:12–0:25 | Dashboard hero, then the "How it works" diagram in the README | "AeroGuard is cover that settles itself. The contract pays only on flight data signed by the AeroDataBox Airnode on API3 AirnodeHub. Nobody files a claim." |
| 3 | 0:25–0:45 | Dashboard "Cover a flight": fill in a flight and press **Only check status** *only if a cached response exists*; otherwise show the policy #1 purchase tx on Basescan → Input data → the signed `{"scheduled":…,"status":"Expected"}` | "To buy cover, you attach a fresh signed status from the Airnode. The contract checks it is the real signer, the right flight, under 15 minutes old and still pre-departure. It reads the scheduled arrival from the signature, so nobody insures a flight that's already late." |
| 4 | 0:45–1:00 | Editor: `requestHashFor` (zoom). Then `Fixtures.t.sol` `test_Fixture_RealAeroDataBoxCapture` passing in the terminal | "The contract rebuilds AirnodeHub's request hash itself from the policy's flight and date. Here it matches a real Airnode capture byte for byte, so a genuine response about a different flight is useless." |
| 5 | 1:00–1:20 | GitHub Actions: keeper run log for the settlement tick → click the tx link → Basescan `Settled` event + aUSD transfer to the holder | "After landing, our keeper buys a signed arrival over x402 for five cents, simulates the settlement, and sends it. It runs in GitHub Actions or as a plain loop. Anyone could run it: the payout always goes to the stored holder." |
| 6 | 1:20–1:50 | Dashboard "Attack the deployed contract": target policy #1 (base = its real Airnode response, shown in the note), keep **Reopen** ticked, **Run the 4 attacks**, each revert reason highlighted. Nothing is paid: all four are `eth_call`s | "Now we attack the live contract with a real Airnode response. Edit one value: not signed by the Airnode. Another flight: wrong request. An attacker's key: rejected. A genuine but old response: stale." |
| 7 | 1:50–2:05 | Dashboard Security Inspector: load the fixture, click "Add 3 h to the arrival time", and the verdict flips to rejected; click Reset and it is valid again | "The Security Inspector shows the same checks in the browser, so anyone can see exactly why the contract would or wouldn't pay." |
| 8 | 2:05–2:15 | Terminal: `npm run rehearse` scrolling to "holder balance" | "And the whole flow runs locally in seconds with no funds: five policies, four attacks, every policy settled." |
| 9 | 2:15–2:25 | End card: repo URL, contract address, "52 tests · 4 live policies · x402" | "AeroGuard. The signed data is the decision. Thanks." |

## After recording

- Upload the video as unlisted on YouTube, then add the link to `docs/DEVFOLIO.md` (Links) and to the top of `README.md`.
- Check the length is ≤ 2:30, the subtitles are legible, and no `.env` or private key is visible in any frame (the terminal history included).
