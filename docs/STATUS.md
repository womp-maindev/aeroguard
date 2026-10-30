# Status — Fri 30 Oct 2026, 20:40 CET

Tracks: **one project, two tracks** (confirmed by the organizers): **API3 "Any API in your contract"** (€2,000, this repo's oracle/keeper work) + **Cardano** (Masumi/Sokosumi payment for policies, handled in the Cardano session; on-chain link = `cardanoJobRef` per policy).

## Live (Base Sepolia, chain 84532)
- FlightDelayCover `0x257054204c4Cd43846C4553eBe6D709841980a80` (Sourcify-verified). Owner/keeper wallet `0xd9b446FbC743f2D592b8699fbfC80443af00Be24`.
- Signer: AeroDataBox Airnode `0x83FE2E8F24E66520B1902C3507De4F471248f2Ec`; aUSD `0xbeA34973e5f67F18F656A2C6070C64326C791808` (faucet cap 10 aUSD/account, `mintFromFaucet(uint256)`).
- Pool funded 4 aUSD. Policies (0.5 aUSD cover, bought with signed pre-departure proofs, sched. arrival UTC):
  #1 IB1314 MUC→MAD 21:25 · #2 LH1816 MUC→BCN 21:55 · #3 EI357 MUC→DUB 21:55 · #4 BA955 MUC→LHR 21:50 (all 2026-10-30)
- Keeper: GitHub Actions `.github/workflows/keeper.yml`, cron `7,22,37,52 * * * *` (schedule has **not fired yet**; runs are manual `workflow_dispatch`, safe at any time, input `force` ignores the 30-min rhythm). Secret `KEEPER_PK` set. Each run logs balances + policies, then prints and uploads the signed response of every settlement (artifact `settlement-evidence`).
- Check schedule (`keeper/src/schedule.ts`, tested): one early look 3 h before arrival (done 19:10 UTC), then every 30 min from +30 min to +6 h, every 3 h to +24 h, max 20 lookups/policy. Next checks: #1 ≥ 21:55Z, #4 ≥ 22:20Z, #2/#3 ≥ 22:25Z. The API3 session triggers runs at 21:57, 22:27, 22:57, 23:27, 23:57, 01:27 UTC.
- Balances 19:19 UTC: keeper 0.000368 ETH (top up from a faucet if possible), 5.34 aUSD; pool 4.16 aUSD, reserved 2.00, free 2.16.
- On-chain tamper results (policy #1, real Airnode data): edit → NotSignedByAirnode, wrongreq → WrongRequest, wrongsigner → NotSignedByAirnode, stale → Stale(1793378516), genuine pre-departure → NotFinal(Expected).

## Done
Contract (purchase proof, private commit-reveal policies, per-policy settlement, 52 tests + live replay, ~98% line coverage) · keeper (x402, cache, autonomous loop, tamper CLI, API, rehearsal) · dashboard with in-browser Security Inspector · README for judges · real captured Airnode response verified in Solidity · CI (forge test, keeper tests, anvil rehearsal with asserted outcomes).

## Next (in order)
1. Tonight (API3 session, automatic): settlements → tx links in README "Live evidence" + DEVFOLIO; IB1314 settlement response → `contracts/test/fixtures/IB1314-settlement.json` (activates `test_Live_IB1314_SettlesLikeOnChain`); `docs/EVIDENCE.md`.
2. Frontend session (owns `web/`): show the network from `GET /health` → `{ network: "Base Sepolia" | "Local anvil", explorer }` instead of the fixed "Base Sepolia"; Evidence view per settled policy. Live policies screenshot for README.
3. Devfolio text: drafted in `docs/DEVFOLIO.md`; paste into tum.devfolio.co. Pitch + Q&A: `docs/PITCH.md`.
4. Video ≤2:30: shot list in `docs/VIDEO.md`. Record the live tamper shot while policy #1 is still Active.
5. Sat 14:30: repo public, submit on tum.devfolio.co, one project, tracks API3 + Cardano. 15:00 live pitch.

## Known decisions / limits
- Anyone may call `settle`; payout always to stored holder (enables autonomous keeper).
- Public policies: exact signed schedule match (airline reschedule ⇒ policy expires). Private policies: ±1 h, residual adverse-selection risk documented.
- `minLeadTime` = 2 h on the live contract; `setMinLeadTime(0)` only for a live demo.
- Contract struct field is still named `cardanoJobRef` (renaming = redeploy). Keeper calls it `orderRef`.
