# Working on this repo

Read first: `README.md`, `contracts/README.md`, then `docs/STATUS.md` (what is done, live addresses, next steps).

## Rules
- Commit as `womp-maindev` only: `git config user.name womp-maindev && git config user.email 226526968+womp-maindev@users.noreply.github.com`. No AI co-author trailers.
- Never commit `.env` or private keys. The keeper key lives in the user's local `.env` and in the GitHub secret `KEEPER_PK`.
- Deadline Sat 31 Oct 2026 15:00 CET (Devfolio). Repo must be public before then. Live judging 15:00–17:00 in Munich.
- Do not redeploy `FlightDelayCover` unless asked: 4 live policies sit on the current deployment.
- AeroDataBox quota is shared by all teams: cache, never poll, prefer `keeper/fixtures` and `contracts/test/fixtures` for tests.

## Commands
```bash
cd contracts && forge test                 # 86 tests (incl. the full live lifecycle of policies #1–#4)
cd keeper && npm i && npx tsc --noEmit -p . && npm test
anvil --chain-id 84532 & cd keeper && npm run rehearse   # full local run, no funds
cd keeper && npm run cli -- policies       # needs .env (KEEPER_PK, FLIGHT_COVER_ADDRESS)
npm run tamper -- --policy 1 --response fixtures/IB1314-status-proof.json
npm run api                                # dashboard http://localhost:8787
```
