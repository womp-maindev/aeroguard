# AeroGuard ✈️ — your flight is late, you're already paid

**An autonomous agent that sells flight‑delay cover and pays it out with no claim form.**
It is hired and paid on **Cardano** (Masumi / Sokosumi), buys **AeroDataBox data signed by its AirnodeHub Airnode** over **x402**, and a contract on **Base Sepolia** releases money only when that signed evidence passes its checks.

> TUM Blockchain & AI Hackathon 2026 · Tracks: **API3 (AirnodeHub)** · **Cardano (Agentic Commerce)**

| | |
|---|---|
| Contract (Base Sepolia) | `FLIGHT_COVER_ADDRESS` → _filled in after deploy_ |
| AeroDataBox Airnode signer | `0x83FE2E8F24E66520B1902C3507De4F471248f2Ec` |
| Payment token | aUSD `0xbeA34973e5f67F18F656A2C6070C64326C791808` |
| Masumi agent / Sokosumi Coworker | see [`docs/cardano-evidence.md`](docs/cardano-evidence.md) |

## The problem
Flight delays are common, and in the EU passengers are often owed compensation, but claiming it takes forms, weeks and often a claims agency fee. Many people never claim. Parametric cover fixes that: if the data says the flight landed ≥2 h late, you are paid. The hard part is **trusting the data**, and **who presses the button**.

## How it works
```
 Traveller / travel-booking agent
   │ hires AeroGuard on Sokosumi, pays per job on Cardano preprod (Masumi escrow)      ← Cardano
   ▼
 AeroGuard agent (agent/)
   │ 1  buys the flight's schedule from AirnodeHub via x402 (0.05 aUSD)
   │ 2  opens a policy: FlightDelayCover.buyPolicy(flight, date, …)
   │ 3  keeper loop: after scheduled arrival, buys SIGNED arrival data (x402)        ← API3 +10
   │ 4  submits it: FlightDelayCover.settle(id, requestHash, timestamp, data, sig)
   ▼
 FlightDelayCover.sol (Base Sepolia)                                                  ← API3
   ✓ request  = one of the two hashes DERIVED ON-CHAIN from this policy's flight + date
   ✓ signer   = the AeroDataBox Airnode (AirnodeV2Attestation.verify)
   ✓ fresh    = signed ≤ maxAge ago, not from the future
   ✓ observed = signed after the landing it reports; status must be final (Arrived / Canceled)
   ✓ once     = signature never used before, policy still Active
   → ≥180 min late or cancelled: 100% · ≥120 min: 50% · else closed, premium stays in the pool
```

### Why the signed data matters (API3)
The payout decision **is** the verified flight status. Remove AirnodeHub and there is nothing the contract could safely pay on: anyone could claim "my flight was 4 h late". Because the contract computes the request hash itself from `flight` + `date` (mirroring AirnodeHub's `keccak256(JSON.stringify([operation, sortedParams, sortedProjection]))`), not even the agent that sold the policy can settle it with data about another flight, another day or another projection.

Two projections per policy keep the signed payload tiny and cover both outcomes:
- **arrival**: `{actual: /0/arrival/revisedTime/utc, scheduled: /0/arrival/scheduledTime/utc, status: /0/status}`
- **status**: `{scheduled, status}`: a cancelled flight has no revised time (the Airnode answers 400 for a missing pointer), so cancellations are proven with this one.

**Who relies on the data:** travellers and the travel agents/bots that resell cover; LPs who fund the pool.
**If it were forged:** the pool is drained by fake "4 h late" claims, or honest travellers are denied payment.
**Trust assumptions:** the signature proves the AeroDataBox Airnode returned exactly this at this time. It does not prove AeroDataBox is right about the real world. We pick a recognised aviation source and require a final status.
**Data we wanted but couldn't find on AirnodeHub:** EU261 eligibility (delay cause, extraordinary circumstances), airline compensation registries, a second independent flight source to require 2‑of‑2 agreement.

### Autonomous agent (API3 bonus)
`pnpm --dir agent keeper` runs unattended. Every minute it scans active policies on‑chain, decides **when** data is worth buying (≥30 min after scheduled arrival; one early look 3 h before for cancellations; at most 6 paid lookups per policy, because the shared AeroDataBox quota is ~2,000 lookups for all teams), pays via x402, simulates `settle`, and only then sends the transaction. It survives restarts (state = chain + cache).

### Cardano (Masumi)
`masumi/` is the official TUM quickstart Coworker, rewired so a Task runs the AeroGuard engine:
- `"Cover LH1234 on 2026-10-31 for 2 aUSD, pay 0x…"` → policy opened, reply with tx link; follow‑up reply when the keeper settles
- `"Was KL1395 delayed on 2026-10-30?"` → **verdict** mode: a contract‑verifiable signed flight outcome any other agent can reuse (agent‑to‑agent oracle).
Payment per job on Cardano preprod via Masumi escrow: the buyer is refunded if the verdict is not delivered. Evidence (Task IDs, tx hashes, seller receipt): [`docs/cardano-evidence.md`](docs/cardano-evidence.md).

## Tamper test for judges
```bash
cp .env.example .env            # set AGENT_PK (Base Sepolia ETH) and FLIGHT_COVER_ADDRESS
cd agent && npm i
npm run tamper -- --policy 1                          # edit · stale · wrongreq · wrongsigner · valid
npm run tamper -- --policy 1 --response my.json       # YOUR OWN signed response
npm run tamper -- --policy 1 --mode edit --response my.json
```
Each forgery is simulated against the deployed contract and prints the revert reason:

| Attack | Contract answer |
|---|---|
| one value edited | `NotSignedByAirnode(<random signer>)` |
| response too old | `Stale(timestamp)` |
| response to a different request | `WrongRequest(hash)` |
| signed by an unexpected key | `NotSignedByAirnode(attacker)` |
| valid, fresh, final | ✅ `Settled` → payout |

Also rejected: replay on another policy (`ResponseReused`), settling twice (`NotActive`), future timestamps (`FromTheFuture`), "Arrived" signed before the landing it reports (`ObservedTooEarly`), non‑final status (`NotFinal`), selling cover the pool can't back (`Insolvent`).

## Run it
Requires Node ≥ 22.18, [Foundry](https://getfoundry.sh).
```bash
git clone --recurse-submodules https://github.com/womp-maindev/aeroguard && cd aeroguard
cp .env.example .env
# contracts
cd contracts && forge test                       # 19 tests incl. fuzzed payout tiers
forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast --private-key $DEPLOYER_PK
# agent + dashboard (http://localhost:8787)
cd ../agent && npm i && npm run api              # API + keeper + dashboard
npm run cli -- buy --flight LH1234 --date 2026-10-31 --holder 0x… --coverage 2
npm run cli -- policies
# Cardano coworker
cd ../masumi && npm ci && npm start              # model agent;  in 2nd terminal: npm run worker
```

## Repo
```
contracts/  FlightDelayCover.sol + AirnodeHub libraries (from api3dao/airnodehub-hackathon-starter), Foundry tests
agent/      x402 AirnodeHub client, AeroDataBox requests, policy/settle, autonomous keeper, tamper CLI, HTTP API
masumi/     Sokosumi Coworker (Masumi TUM quickstart) running AeroGuard jobs, paid on Cardano preprod
web/        dashboard: flow, policies, live keeper log, tamper lab
```

## Security notes
- Checks‑effects‑interactions + `ReentrancyGuard`, `SafeERC20`; reserved capital tracked so the owner can only withdraw capital **not** backing active policies.
- Flight numbers restricted to `[A-Z0-9]{3,8}` so the on‑chain JSON hash can never diverge from AirnodeHub's (no escaping).
- Hackathon simplifications: owner key sets premium/limits; premium is a flat 8 % (real pricing would use route/airline delay statistics, which AeroDataBox's priced tier offers).

## What's next
LP vault with yield from premiums · priced risk per route · 2‑source agreement (AeroDataBox + OpenSky) · weather / rail delay products on the same contract shape · listing AeroGuard verdicts as a paid x402 endpoint on Cardano for any agent.
