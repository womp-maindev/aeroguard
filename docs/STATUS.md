# Status — Fri 30 Oct 2026, 22:40 CET (final handoff before the night)

Tracks: **one project, two tracks** (confirmed by the organizers): **API3 "Any API in your contract"** (€2,000, this repo's oracle/keeper work) + **Cardano** (x402 in tADA on preprod: `GET /verdict` sells signed verdicts, `GET /policy` sells Base cover and writes `cardanoJobRef = keccak256("cardano:<payment tx>")`; Aiken cover verifies the same Airnode signature; see `cardano/README.md`).

## Live (Base Sepolia, chain 84532)
- FlightDelayCover `0x257054204c4Cd43846C4553eBe6D709841980a80` (Sourcify-verified). Owner/keeper wallet `0xd9b446FbC743f2D592b8699fbfC80443af00Be24`.
- Signer: AeroDataBox Airnode `0x83FE2E8F24E66520B1902C3507De4F471248f2Ec`; aUSD `0xbeA34973e5f67F18F656A2C6070C64326C791808` (faucet cap 10 aUSD/account, `mintFromFaucet(uint256)`).
- Pool funded 4 aUSD. Policies (0.5 aUSD cover, bought with signed pre-departure proofs, sched. arrival UTC):
  #1 IB1314 MUC→MAD 21:25 · #2 LH1816 MUC→BCN 21:55 · #3 EI357 MUC→DUB 21:55 · #4 BA955 MUC→LHR 21:50 (all 2026-10-30)
- Keeper: GitHub Actions `.github/workflows/keeper.yml`, cron `7,22,37,52 * * * *` (the schedule fires on its own since 22:55Z on 30 Oct, but sparsely: 2 scheduled runs by 03:30Z on 31 Oct, both successful; manual `workflow_dispatch` fills the gaps, safe at any time, input `force` ignores the 30-min rhythm). Secret `KEEPER_PK` set. Each run logs balances, gas headroom and policies, prints + uploads the signed response of every settlement (artifact `settlement-evidence`), and commits its log + all signed responses to `keeper-data/keeper.json` (read by the dashboard on Pages). Unsettled policies are expired after scheduled + 3 days; private policies are never looked up.
- Check schedule (`keeper/src/schedule.ts`, tested): one early look 3 h before arrival (done 19:10 UTC), then every 30 min from +30 min to +6 h, every 3 h to +24 h, max 20 lookups/policy. Next checks: #1 ≥ 21:55Z, #4 ≥ 22:20Z, #2/#3 ≥ 22:25Z. The API3 session triggers runs at 21:57, 22:27, 22:57, 23:27, 23:57, 01:27 UTC. A forced look at #1 at 20:59 UTC got "Approaching" (not final). Manual input `policy` = only that policy.
- Balances 20:59 UTC: keeper 0.000368 ETH (≈66× the gas for 4 settles at 0.007 gwei; a faucet top-up is still nice), ~5.3 aUSD; pool 4.16 aUSD, reserved 2.00, free 2.16.
- On-chain tamper results (policy #1, real Airnode data): edit → NotSignedByAirnode, wrongreq → WrongRequest, wrongsigner → NotSignedByAirnode, stale → Stale(1793378516), genuine pre-departure → NotFinal(Expected).

## Done
- **Contract**: purchase proof, private commit-reveal policies, per-policy settlement; 98.8 % line / 86.8 % branch coverage. **86 tests pass** (incl. 27 hardening tests by Eskender), incl. the full live lifecycle (purchase + settlement) of policies #1–#4 (30 Oct) on their real Airnode signatures. Policies #1–#4 (30 Oct) settled by the keeper on 30 Oct (#1 21:58 UTC, #2–#4 22:27 UTC), all `ClosedNoPayout`: every flight landed early or < 2 h late: includes policies #1–#4 (30 Oct) replayed on their real Airnode signatures (`LiveReplay.t.sol`, proofs read back from the purchase calldata via `keeper cli proof` / `proofs.yml`).
- **Keeper**: x402, off-chain signature check, phase schedule (tested), simulate-then-settle, never looks up private policies, expires after 3 days, `--policy N` / `force`, publishes log + every signed response to `keeper-data`, writes each settling response as a Solidity fixture. `keeper/README.md`.
- **CI** (`ci.yml`): forge test · keeper typecheck + tests · anvil rehearsal (5 policies + 1 private, 4 forgeries, settlements, expiry; exits 1 on any mismatch). Green.
- **Docs for judges**: README (quickstart with a link per claim, architecture SVG, screenshots, tamper table with live results), `docs/EVIDENCE.md` (every policy, proof, lookup, x402 receipt), `docs/DEVFOLIO.md` (incl. feedback for API3), `docs/PITCH.md` (2-min + Q&A + on-stage purchase runbook), `docs/VIDEO.md` (shot list). All relative links/anchors/line refs checked.

## Saturday policies #5–#11 (bought 30 Oct 23:28–23:38Z)
LH1866 MUC→FCO 10:20Z · LH2472 MUC→LHR 10:25Z · EI352 DUB→MUC 09:10Z · LH1810 MUC→BCN 10:00Z · LH1868 MUC→FCO 12:15Z · LH2476 MUC→LHR 15:50Z · LH1814 MUC→BCN 16:35Z, 0.5 aUSD each, holder = keeper wallet. The API3 session runs the keeper at 09:42, 10:32, 10:57, 11:32, 12:32, 12:47, 14:27, 14:42, 16:22 and 17:07 UTC; #11 and #9 settle live during or just after judging. A real delay of 2 h or more, or a cancellation, pays 50–100 % on the Airnode signature; anything else closes with no payout. Pool after purchases: 4.44 aUSD, reserved 3.50, free 0.94. Do not buy more: AeroDataBox answered 429 (shared quota).

## Night (API3 session, automatic)
Each run: settle what landed → push notification with the first payout tx → `<FLIGHT>-settlement.json` into `contracts/test/fixtures` (activates its replay test, must pass) → tx into README "Live evidence", DEVFOLIO Links, EVIDENCE → push to main. The Cardano session reads the same final responses from `keeper-data` (22:45 UTC).

## Owner checklist (Sat) — morning from the phone, pitch from the laptop
Steps 1–4 work from a phone: everything runs in GitHub Actions or in the browser, and the keeper key never leaves the GitHub secret. The pitch (step 5) is on the laptop.
1. **GitHub (mobile browser, "Desktop site" on)** → Settings → Advanced Security: enable **Secret Protection** + **Push protection**.
2. **By 14:00 CET**: Settings → General → Danger zone → **Change visibility → Public**. Then Actions → "Dashboard on GitHub Pages" → **Run workflow**. Open https://womp-maindev.github.io/aeroguard/ on the phone and check that the policies and the keeper log show up.
3. **Video**: done. The voiced 1:47 demo is in the repo ([`web/media/demo.mp4`](../web/media/demo.mp4), served by Pages, linked from README, DEVFOLIO and EVIDENCE); API3 clips rendered from real data are in [`video/`](../video/SHOTLIST.md) (re-render after new settlements: Actions → "Render API3 video"). Optional: upload the demo unlisted to YouTube and send the link; it goes into README + DEVFOLIO.
4. **By 14:30**: tum.devfolio.co on the phone → one project, tracks **API3 + Cardano**, text copied from `docs/DEVFOLIO.md` (open it on GitHub → Raw → copy).
5. **Pitch 15:00, laptop**: `docs/PITCH.md`. Open the Pages dashboard in the browser (no setup), or `cd keeper && npm run api` for the local dashboard with **Cover me**. Before going on stage, check that the laptop has the repo up to date (`git pull`) and `.env` with `KEEPER_PK`. Live purchase on stage: send **"купи <FLIGHT>@<YYYY-MM-DD>"** in this chat; the API3 session runs the "Buy policies" workflow and replies with the Basescan link in about 30 s. Or tap Actions → "Buy policies" → Run workflow yourself.
6. Payouts: the API3 session sends a push if a Saturday policy pays out; otherwise the pitch line in `docs/PITCH.md` ("no delay → no payout, and nobody can fake one") applies.

## Final state (live vs tested)
- **Live on Base Sepolia:** contract, 11 real policies bought with signed AeroDataBox proofs, #1–#4 settled by the keeper on signed arrivals (`ClosedNoPayout`), #5–#11 settling today, x402 payments for every lookup, the tamper results on policy #1, the dashboard reading the chain.
- **Live on Cardano preprod:** the x402 verdict sale in tADA (tx `e2ef922b…`); the Aiken cover runs in one command (`cardano/live-cover.sh`).
- **Tested only:** payouts (50 % / 100 % / cancelled) in 86 forge tests and the anvil rehearsal (no live flight has been ≥ 2 h late yet); `GET /policy` (Cardano pays for Base cover) offline.

## Open issues
- GitHub's schedule for `keeper.yml` now fires on its own, but sparsely (2 scheduled runs by 03:30Z on 31 Oct, at 22:55Z and 02:14Z, both successful, against a 15-min cron). Manual `workflow_dispatch` runs fill the gaps, so trigger one after each landing.
- Some Frontend commits on `main` carry a `Co-Authored-By: Claude` trailer, against CLAUDE.md. Avoid in new commits; rewriting `main` history would need a force-push and the owner's go.

## Known decisions / limits
- Anyone may call `settle`; payout always to stored holder (enables autonomous keeper).
- Public policies: exact signed schedule match (airline reschedule ⇒ policy expires). Private policies: ±1 h, residual adverse-selection risk documented.
- `minLeadTime` = 2 h on the live contract; `setMinLeadTime(0)` only for a live demo.
- Contract struct field is still named `cardanoJobRef` (renaming = redeploy). Keeper calls it `orderRef`.
