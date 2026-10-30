# AeroGuard — your flight is late, you're already paid

Parametric flight-delay cover that settles itself. A smart contract pays out **only** on flight data signed by the **AeroDataBox Airnode on API3 AirnodeHub**, and an autonomous keeper buys that data over **x402** and settles policies on-chain without anyone filing a claim.

| | |
|---|---|
| Contract (Base Sepolia) | [`0x257054204c4Cd43846C4553eBe6D709841980a80`](https://sepolia.basescan.org/address/0x257054204c4Cd43846C4553eBe6D709841980a80) · source verified on Sourcify |
| Trusted signer | AeroDataBox Airnode `0x83FE2E8F24E66520B1902C3507De4F471248f2Ec` |
| Data operation | `flightStatusOnDate` (0.05 aUSD per call, x402) |
| Payment token | aUSD `0xbeA34973e5f67F18F656A2C6070C64326C791808` |

## Live evidence (Base Sepolia, real AeroDataBox data)
| Step | Tx |
|---|---|
| x402 payment for a signed AeroDataBox response (0.05 aUSD) | [0x76d334da…](https://sepolia.basescan.org/tx/0x76d334da55c86bbf61d37762f8ee843f4920bc874477a82d06852247b4e2054f) |
| Policy #1 IB1314 MUC→MAD, bought with a signed pre-departure proof | [0xbfd3ae73…](https://sepolia.basescan.org/tx/0xbfd3ae73074ff63a3ef5f7e56b211d1ffb7223e2db944d0cc38ed069d1958b8d) |
| Policy #2 LH1816 MUC→BCN | [0x7e71c55b…](https://sepolia.basescan.org/tx/0x7e71c55b970b96fb1588ddde1da029060d805c9b87691280ca2504098d4e69d2) |
| Policy #3 EI357 MUC→DUB | [0x2aeed601…](https://sepolia.basescan.org/tx/0x2aeed6010ced165f66c26ea0f34e7068421a327cac0c6375d72ef7b794f41672) |
| Policy #4 BA955 MUC→LHR | [0x7e675d8f…](https://sepolia.basescan.org/tx/0x7e675d8f94946db1d02a40c1eff87ac5a0ca29b65730751cf0d902d767d2b0d1) |

Tamper test against the deployed contract with a REAL signed Airnode response (policy #1): edited value → `NotSignedByAirnode`, other flight → `WrongRequest`, attacker key → `NotSignedByAirnode`, genuine but pre-departure → `NotFinal(Expected)`. A captured real response (`contracts/test/fixtures/aerodatabox-arrival.json`, LH400) is verified in Solidity by `test_Fixture_RealAeroDataBoxCapture`: the on-chain request-hash derivation matches AirnodeHub byte for byte.
The keeper runs on its own as a GitHub Actions cron (`.github/workflows/keeper.yml`, every 15 min) and settles these policies after landing.

## The problem
Flight delays are common and compensation claims are slow: forms, evidence, weeks of waiting, often a claims-agency fee. Parametric cover removes the claim: if trustworthy data says the flight landed late, money moves. The hard parts are **trusting the data** and **who presses the button**. AeroGuard answers both: AirnodeHub signatures checked by the contract, and a keeper that anyone can replace because it has no special power.

## How it works
```
Traveller / travel app
  │ 1  buy: attach a fresh signed AeroDataBox STATUS response (pre-departure)        → buyPolicy
  ▼
FlightDelayCover.sol (Base Sepolia)
  ✓ purchase: signer · request (derived on-chain from flight+date) · ≤15 min old · status pre-departure
              · scheduled arrival read FROM the signature · ≥ minLeadTime away
  ✓ settle:   signer · request · fresh (≤ maxAge) · not from the future · status final
              · observed after the landing it reports · same signed schedule as at purchase · policy still Active
  → ≥180 min late or cancelled: 100% · ≥120 min: 50% · otherwise closed, premium stays in the pool
  ▲
  │ 2  keeper (keeper/): after scheduled arrival buys a SIGNED arrival response via x402 and calls settle
  │    anyone can call settle — money always goes to the stored holder
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

### Signed data at BOTH ends — no adverse selection
Buying cover also needs AirnodeHub-signed evidence. `buyPolicy` takes a fresh (≤15 min) signed AeroDataBox **status** response for that exact flight+date: the contract checks signer + request + freshness, accepts only pre-departure statuses (`Expected / Unknown / CheckIn / Boarding`), reads the scheduled arrival **from the signature** and requires it to be ≥ `minLeadTime` away. Nobody can insure a flight that is already late, and nobody can lie about its schedule; settlement must show the exact same signed schedule.

### Private policies (commit–reveal)
`buyPrivatePolicy(commitment, …)` stores only `keccak256(abi.encode(flight, date, salt))`. Observers can't tell which flight is insured until `settlePrivate` reveals it, then the same verification runs. Residual risk (documented): without a purchase proof a private buyer is bounded only by lead time and a ±1 h schedule window; production fix = ZK proof of purchase-time status.

### Autonomous keeper (API3 bonus)
`npm run keeper` (or the GitHub Actions cron in `.github/workflows/keeper.yml`, every 15 min) runs unattended. It reads active policies from chain, decides **when** data is worth buying (≥30 min after scheduled arrival, one early look 3 h before for cancellations, at most 6 paid lookups per policy because the AeroDataBox quota is shared), pays through x402, simulates `settle`, and only then sends the transaction. One signed outcome settles every policy on the same flight. State = chain + cache, so it survives restarts.

## Tamper test for judges
```bash
cp .env.example .env            # set KEEPER_PK (Base Sepolia ETH) and FLIGHT_COVER_ADDRESS
cd keeper && npm i
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

Also rejected: buying after departure (`NotBuyable`), buying too close to arrival (`TooCloseToArrival`), schedule switched after purchase (`ScheduleMismatch`), settling twice (`NotActive`), future timestamps (`FromTheFuture`), "Arrived" signed before the landing it reports (`ObservedTooEarly`), non‑final status (`NotFinal`), selling cover the pool can't back (`Insolvent`).

## Run it
Node ≥ 22.18 and [Foundry](https://getfoundry.sh).
```bash
git clone --recurse-submodules https://github.com/womp-maindev/aeroguard && cd aeroguard
cp .env.example .env                    # set KEEPER_PK (Base Sepolia ETH + aUSD)

cd contracts && forge test              # 49 tests + real-capture fixture
forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast --private-key $DEPLOYER_PK

cd ../keeper && npm i
npm run api                             # dashboard + API + keeper on http://localhost:8787
npm run cli -- buy --flight LH1816 --date 2026-10-30 --holder 0x… --coverage 0.5
npm run cli -- policies
npm run cli -- tick                     # one keeper pass
```

### Rehearsal without testnet funds
```bash
anvil --chain-id 84532 &
cd keeper && npm run rehearse   # deploy locally, buy 5 policies with signed proofs, 4 attacks + valid, keeper settles all
```
Rehearsal responses are signed with a local test key and labelled; the real deployment rejects them with `NotSignedByAirnode`.

## Cardano: pay per request via x402
Agents pay per request on Cardano for flight outcomes any contract can verify. `GET /verdict?flight=&date=` answers 402 with 1–2 tADA on `cardano:preprod` (`@x402/cardano` `exact` scheme, `@x402/express`, Blockfrost); once paid it returns the verdict plus the Airnode-signed proof that `FlightDelayCover` verifies unchanged. The same proof also settles an Aiken (Plutus V3) flight cover validator that checks the Airnode's secp256k1 signature on Cardano (23 tests, incl. the real signature). Plus a budgeted claims agent and an MCP tool. Details: [`cardano/README.md`](cardano/README.md) · paid preprod txs: [`cardano/EVIDENCE.md`](cardano/EVIDENCE.md).

## Repo
```
contracts/  FlightDelayCover.sol + AirnodeHub libraries (api3dao/airnodehub-hackathon-starter), Foundry tests, threat model
keeper/     x402 AirnodeHub client, AeroDataBox requests, buy/settle, autonomous keeper, tamper CLI, HTTP API
cardano/    x402 on Cardano preprod: paid /verdict, claims agent, MCP tool, metadata anchor, Aiken validator (onchain/)
web/        dashboard: in-browser Security Inspector, tamper lab, policies, keeper log (single file, works offline)
```

## Security notes
- Checks‑effects‑interactions + `ReentrancyGuard`, `SafeERC20`; reserved capital tracked so the owner can only withdraw capital **not** backing active policies.
- Flight numbers restricted to `[A-Z0-9]{3,8}` so the on‑chain JSON hash can never diverge from AirnodeHub's (no escaping).
- Hackathon simplifications: owner key sets premium/limits; premium is a flat 8 % (real pricing would use route/airline delay statistics, which AeroDataBox's priced tier offers).

## What's next
LP vault earning premiums · risk-priced premiums per route · 2-source agreement (AeroDataBox + OpenSky) · ZK purchase proofs for private policies · the same contract shape for weather and rail delays.
