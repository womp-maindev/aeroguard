# AeroGuard keeper

The off-chain half of AeroGuard. It buys AirnodeHub-signed AeroDataBox data over x402 and hands it to `FlightDelayCover`. The keeper has no special power on-chain. `settle` checks every signature, request hash and timestamp itself and always pays the stored holder, so anyone can run a keeper, and a buggy or malicious one can only waste its own gas.

## What it does

| Step | Code |
|---|---|
| Builds the AirnodeHub request for `flightStatusOnDate` (arrival or status projection) and derives its request hash exactly as the contract does | [`flight.ts`](src/flight.ts), [`airnode-v2.ts`](src/airnode-v2.ts) |
| Pays the Airnode per call over x402, in aUSD on Base Sepolia, with no API key and no ETH | [`x402.ts`](src/x402.ts) |
| Checks the signature off-chain before caching or using a response | [`flight.ts`](src/flight.ts) (`verifySignedResponse`) |
| Decides **when** a paid lookup is worth it (see the table below) | [`schedule.ts`](src/schedule.ts), tested in [`schedule.test.ts`](src/schedule.test.ts) |
| Simulates `settle` first and only sends it if the simulation passes. One signed outcome settles every policy on that flight | [`keeper.ts`](src/keeper.ts), [`chain.ts`](src/chain.ts) |
| Writes the response that settled each policy as a Solidity fixture, and publishes the run log and all signed responses to the `keeper-data` branch | [`keeper.ts`](src/keeper.ts), [`publish.ts`](src/publish.ts) |

### Lookup schedule (the AeroDataBox quota is shared by every team)

| Time relative to the signed scheduled arrival | Action |
|---|---|
| −3 h | one early look, because cancellations are known early (not counted in the limit) |
| +30 min to +6 h | a check every 30 min |
| +6 h to +24 h | a check every 3 h (very late landings still pay in full) |
| +3 days | `expire`: gas only, releases the reserved capital |

The limit is 20 paid lookups per policy. Private policies are never looked up, because only their holder can reveal the flight. Every decision depends only on the current time, the chain and the saved state, so a run at any moment (cron, manual or a laptop) does the right thing.

## Commands

```bash
npm ci && npx tsc --noEmit -p . && npm test       # schedule + request-hash tests
anvil --chain-id 84532 & npm run rehearse         # local deploy, 5 policies + 1 private, 4 forgeries, keeper settles, 3 days later expires the private one; exits 1 on any mismatch
npm run cli -- status                             # balances, gas headroom for the active settles, policies
npm run cli -- tick                               # one keeper pass (--force: ignore the 30-min rhythm, --policy N: only that one)
npm run keeper                                    # unattended loop
npm run tamper -- --policy 1 --response fixtures/IB1314-status-proof.json --mode stale
npm run api                                       # dashboard + HTTP API on :8787; KEEPER=on also runs the loop
```

`status`, `tick`, `keeper`, `tamper` and `api` read `KEEPER_PK` and `FLIGHT_COVER_ADDRESS` from `../.env` (see `../.env.example`).

## Where it runs

On GitHub Actions ([`.github/workflows/keeper.yml`](../.github/workflows/keeper.yml)), with the secret `KEEPER_PK`. The state and response cache survive between runs in the Actions cache. Each run:
1. logs balances and gas headroom;
2. runs one pass;
3. prints and uploads the signed response of every settlement (artifact `settlement-evidence`);
4. commits its log and every signed response to [`keeper-data/keeper.json`](https://github.com/womp-maindev/aeroguard/blob/keeper-data/keeper.json), which the dashboard reads.
