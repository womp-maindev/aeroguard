# Status — Fri 30 Oct 2026, 22:40 CET (final handoff before the night)

Tracks: **one project, two tracks** (confirmed by the organizers): **API3 "Any API in your contract"** (€2,000, this repo's oracle/keeper work) + **Cardano** (Masumi/Sokosumi payment for policies, handled in the Cardano session; on-chain link = `cardanoJobRef` per policy).

## Live (Base Sepolia, chain 84532)
- FlightDelayCover `0x257054204c4Cd43846C4553eBe6D709841980a80` (Sourcify-verified). Owner/keeper wallet `0xd9b446FbC743f2D592b8699fbfC80443af00Be24`.
- Signer: AeroDataBox Airnode `0x83FE2E8F24E66520B1902C3507De4F471248f2Ec`; aUSD `0xbeA34973e5f67F18F656A2C6070C64326C791808` (faucet cap 10 aUSD/account, `mintFromFaucet(uint256)`).
- Pool funded 4 aUSD. Policies (0.5 aUSD cover, bought with signed pre-departure proofs, sched. arrival UTC):
  #1 IB1314 MUC→MAD 21:25 · #2 LH1816 MUC→BCN 21:55 · #3 EI357 MUC→DUB 21:55 · #4 BA955 MUC→LHR 21:50 (all 2026-10-30)
- Keeper: GitHub Actions `.github/workflows/keeper.yml`, cron `7,22,37,52 * * * *` (schedule has **not fired yet**; runs are manual `workflow_dispatch`, safe at any time, input `force` ignores the 30-min rhythm). Secret `KEEPER_PK` set. Each run logs balances, gas headroom and policies, prints + uploads the signed response of every settlement (artifact `settlement-evidence`), and commits its log + all signed responses to `keeper-data/keeper.json` (read by the dashboard on Pages). Unsettled policies are expired after scheduled + 3 days; private policies are never looked up.
- Check schedule (`keeper/src/schedule.ts`, tested): one early look 3 h before arrival (done 19:10 UTC), then every 30 min from +30 min to +6 h, every 3 h to +24 h, max 20 lookups/policy. Next checks: #1 ≥ 21:55Z, #4 ≥ 22:20Z, #2/#3 ≥ 22:25Z. The API3 session triggers runs at 21:57, 22:27, 22:57, 23:27, 23:57, 01:27 UTC. A forced look at #1 at 20:59 UTC got "Approaching" (not final). Manual input `policy` = only that policy.
- Balances 20:59 UTC: keeper 0.000368 ETH (≈66× the gas for 4 settles at 0.007 gwei; a faucet top-up is still nice), ~5.3 aUSD; pool 4.16 aUSD, reserved 2.00, free 2.16.
- On-chain tamper results (policy #1, real Airnode data): edit → NotSignedByAirnode, wrongreq → WrongRequest, wrongsigner → NotSignedByAirnode, stale → Stale(1793378516), genuine pre-departure → NotFinal(Expected).

## Done
- **Contract**: purchase proof, private commit-reveal policies, per-policy settlement; 98.8 % line / 86.8 % branch coverage. **59 tests pass**, incl. the full live lifecycle (purchase + settlement) of all 4 policies on their real Airnode signatures. All 4 policies settled by the keeper on 30 Oct (#1 21:58 UTC, #2–#4 22:27 UTC), all `ClosedNoPayout`: every flight landed early or < 2 h late: includes all 4 live policies replayed on their real Airnode signatures (`LiveReplay.t.sol`, proofs read back from the purchase calldata via `keeper cli proof` / `proofs.yml`).
- **Keeper**: x402, off-chain signature check, phase schedule (tested), simulate-then-settle, never looks up private policies, expires after 3 days, `--policy N` / `force`, publishes log + every signed response to `keeper-data`, writes each settling response as a Solidity fixture. `keeper/README.md`.
- **CI** (`ci.yml`): forge test · keeper typecheck + tests · anvil rehearsal (5 policies + 1 private, 4 forgeries, settlements, expiry; exits 1 on any mismatch). Green.
- **Docs for judges**: README (quickstart with a link per claim, architecture SVG, screenshots, tamper table with live results), `docs/EVIDENCE.md` (every policy, proof, lookup, x402 receipt), `docs/DEVFOLIO.md` (incl. feedback for API3), `docs/PITCH.md` (2-min + Q&A + on-stage purchase runbook), `docs/VIDEO.md` (shot list). All relative links/anchors/line refs checked.

## Night (API3 session, automatic)
Each run: settle what landed → push notification with the first payout tx → `<FLIGHT>-settlement.json` into `contracts/test/fixtures` (activates its replay test, must pass) → tx into README "Live evidence", DEVFOLIO Links, EVIDENCE → push to main. The Cardano session reads the same final responses from `keeper-data` (22:45 UTC).

## Owner checklist (Sat)
1. Tonight: pick the on-stage flight (lands Sat 17:30–20:00 CET) + a backup — from the public MUC board, not the API (`docs/PITCH.md`).
2. GitHub → Settings → Advanced Security: enable **Secret Protection** + **Push protection**.
3. Morning: dry-run the live purchase with a timer (`npm run cli -- buy …`, or dashboard **Cover me** with `npm run api`); `npm run cli -- status` shows keeper aUSD ≥ 0.1 and pool `free` ≥ coverage.
4. Record the video (`docs/VIDEO.md`; the tamper shot works any time from the dashboard), upload unlisted, send the link → it goes into README + DEVFOLIO.
5. Live policies screenshot (dashboard, Policies section) for README — or ask the API3 session if `sepolia.base.org` is allowed in its network settings.
6. By 14:30: repo **public** → run the "Dashboard on GitHub Pages" workflow (Pages needs a public repo) → submit on tum.devfolio.co: one project, tracks **API3 + Cardano**, text from `docs/DEVFOLIO.md`.
7. 15:00: pitch from `docs/PITCH.md` (first sentence: "API3 and Cardano tracks; this is the API3 part").

## Open issues
- GitHub's schedule for `keeper.yml` has never fired (0 scheduled runs); manual `workflow_dispatch` runs cover it.
- Some Frontend commits on `main` carry a `Co-Authored-By: Claude` trailer, against CLAUDE.md. Avoid in new commits; rewriting `main` history would need a force-push and the owner's go.

## Known decisions / limits
- Anyone may call `settle`; payout always to stored holder (enables autonomous keeper).
- Public policies: exact signed schedule match (airline reschedule ⇒ policy expires). Private policies: ±1 h, residual adverse-selection risk documented.
- `minLeadTime` = 2 h on the live contract; `setMinLeadTime(0)` only for a live demo.
- Contract struct field is still named `cardanoJobRef` (renaming = redeploy). Keeper calls it `orderRef`.
