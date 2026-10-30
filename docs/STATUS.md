# Status — Fri 30 Oct 2026, 18:00 CET

Track: **API3 "Any API in your contract"** (€2,000). Cardano track parked (would be a thin x402 layer later, only if API3 is fully done).

## Live (Base Sepolia, chain 84532)
- FlightDelayCover `0x257054204c4Cd43846C4553eBe6D709841980a80` (Sourcify-verified). Owner/keeper wallet `0xd9b446FbC743f2D592b8699fbfC80443af00Be24`.
- Signer: AeroDataBox Airnode `0x83FE2E8F24E66520B1902C3507De4F471248f2Ec`; aUSD `0xbeA34973e5f67F18F656A2C6070C64326C791808` (faucet cap 10 aUSD/account, `mintFromFaucet(uint256)`).
- Pool funded 4 aUSD. Policies (0.5 aUSD cover, bought with signed pre-departure proofs, sched. arrival UTC):
  #1 IB1314 MUC→MAD 21:25 · #2 LH1816 MUC→BCN 21:55 · #3 EI357 MUC→DUB 21:55 · #4 BA955 MUC→LHR 21:50 (all 2026-10-30)
- Keeper: GitHub Actions `.github/workflows/keeper.yml`, every 15 min, secret `KEEPER_PK` set. Expected settlements ~22:30–23:30 CET.
- On-chain tamper results (policy #1, real Airnode data): edit → NotSignedByAirnode, wrongreq → WrongRequest, wrongsigner → NotSignedByAirnode, genuine pre-departure → NotFinal(Expected).

## Done
Contract (purchase proof, private commit-reveal policies, per-policy settlement, 50 tests, ~98% line coverage) · keeper (x402, cache, autonomous loop, tamper CLI, API, rehearsal) · dashboard with in-browser Security Inspector · README for judges · real captured Airnode response verified in Solidity.

## Next (in order)
1. After ~17:45 UTC: on-chain **stale** tamper on policy #1 with `keeper/fixtures/IB1314-status-proof.json` (expect `Stale(...)`). Add result to README table.
2. Sat morning: check Actions log + Basescan for the 4 settlements; add tx links to README "Live evidence".
3. Screenshots / GIF of dashboard Inspector for README.
4. Devfolio description (problem · what we built · how it works · API3 notes: who relies on the data, what breaks if forged, data we wanted but couldn't find).
5. Video ≤2:30: problem → buy with signed proof → keeper buys signed data (x402) → payout tx → tamper lab rejects 4 forgeries → architecture.
6. Sat 14:30: repo public, submit on tum.devfolio.co (track API3). 15:00 live pitch.

## Known decisions / limits
- Anyone may call `settle`; payout always to stored holder (enables autonomous keeper).
- Public policies: exact signed schedule match (airline reschedule ⇒ policy expires). Private policies: ±1 h, residual adverse-selection risk documented.
- `minLeadTime` = 2 h on the live contract; `setMinLeadTime(0)` only for a live demo.
- Contract struct field is still named `cardanoJobRef` (renaming = redeploy). Keeper calls it `orderRef`.
