# AeroGuard on Cardano: pay-per-request flight verdicts over x402

Agents pay per request on Cardano for flight outcomes any contract can verify.

![Agent pays over x402 on Cardano preprod; the server returns an Airnode-signed verdict that the Aiken cover and FlightDelayCover both verify](docs/architecture.svg)

**For judges (3 min, no funds, no keys):**

```bash
cd cardano && npm i && npm test     # 39 tests: real signed Cardano txs, x402 round trips, Aiken cover executed via UPLC
cd onchain && aiken check           # 26 tests, incl. real AeroDataBox Airnode signatures verified with Plutus builtins
```

Paid preprod transactions: [EVIDENCE.md](EVIDENCE.md). Live run: `npm run qualify` (needs a Blockfrost preprod key and a
faucet-funded wallet, see below).

`GET /verdict?flight=IB1314&date=2026-10-30` answers **402** with a price on `cardano:preprod`: **1 tADA** while the
flight is live (scheduled, en route…), **2 tADA** once the proof is final (arrived or cancelled); tUSDM offered too. The agent's wallet signs a Cardano
transaction (never broadcasts it), retries with `PAYMENT-SIGNATURE`, the facilitator verifies and submits it, and the
server returns:

- `verdict`: status, scheduled/actual arrival, delay minutes, final or not (same rule as `FlightDelayCover`);
- `evidence`: the AeroDataBox Airnode's signed response (`airnode, requestHash, timestamp, data, signature`), which
  `FlightDelayCover` on Base Sepolia, any `AirnodeV2Attestation.verify`, and the Aiken validator in [`onchain/`](onchain)
  accept unchanged;
- `paidWith`: the Cardano tx hash and its Cardanoscan link.

Built on the official template stack: `@x402/express`, `@x402/core`, `@x402/cardano` 2.26.0 (`exact` scheme, Blockfrost
provider), as in [cardano-foundation/x402-cardano-demo](https://github.com/cardano-foundation/x402-cardano-demo). The
facilitator runs in the server process (no keys, no funds); set `FACILITATOR_URL` to use a hosted one.

| Endpoint | Cost | What |
|---|---|---|
| `GET /verdict?flight=&date=[&requestId=]` | 1 or 2 tADA | verdict + Airnode proof + payment receipt |
| `GET /flights` | free | flights with evidence, kind and price |
| `GET /sales` | free | settled sales with Cardanoscan links (and anchor tx) |
| `GET /.well-known/x402` | free | machine-readable offer for agent discovery |

- **One payment, one answer.** A replayed payment returns the same body; it never buys a second operation. A flight
  without evidence gets a free 404, never a charge.
- **Quota-safe.** Evidence comes from disk only (`evidence/`, then `keeper/.cache/`); this service never calls the Airnode.
  It resells what the keeper already bought: `npm run import-evidence -- keeper.json` imports the keeper's published
  answers (`keeper-data` branch) after checking each signature. Today's catalog: live answers for all four policies
  (IB1314, LH1816, EI357, BA955); the newest answer per request wins.
- **On-chain anchor** (`ANCHOR=true`, seller wallet needs ≥ 2 tADA from the faucet): after each sale the seller writes the sold proof into Cardano tx metadata (label
  674 message + label 8402 proof bytes), so the evidence is findable on Cardano itself.

## Run (Cardano preprod)

```bash
cd cardano && npm i            # also installs ../keeper, whose verdict code this reuses
npm run wallets                # creates cardano/.env with a buyer and a seller mnemonic, prints both addresses
# put your Blockfrost preprod project ID in cardano/.env, fund the buyer address from the faucet
npm run qualify                # preflight → start endpoint → pay → EVIDENCE.md + Cardanoscan link (one command)
```

`npm run preflight` alone checks the key's network, both wallets, the evidence and the buyer's balance, with a fix for
each failure. The same steps by hand, e.g. for the video:

```bash
npm run server                 # http://localhost:4021   (ANCHOR=true npm run server to anchor sales)
npm run buy                    # second terminal: pays, prints verdict, tx hash and Cardanoscan link, appends EVIDENCE.md
npm run agent                  # claims agent over claims.json: free catalog check, budget, pay only for final proofs
```

`npm run buy -- --flight IB1314 --date 2026-10-30` picks the flight. Spend control: tADA only, at most
`MAX_LOVELACE_PER_REQUEST` (default 5 tADA) per request; the agent also has `AGENT_BUDGET_LOVELACE` (default 10 tADA).

**MCP for LLM agents** (`npm run mcp`, stdio): tools `list_flights` (free) and `get_flight_verdict` (paid).
Client config: `{ "command": "node", "args": ["--env-file=cardano/.env", "cardano/src/mcp.ts"] }`.

## On-chain: a Cardano contract that verifies the same proof

[`onchain/`](onchain) is an Aiken (Plutus V3) flight cover: a UTxO holding the cover amount, spendable only with an
Airnode proof that the flight is final, paying the holder by `FlightDelayCover`'s rule (cancelled or ≥ 180 min: full,
≥ 120 min: half, else back to the insurer), or reclaimed by the insurer after a deadline.

Each payout output must carry the spent policy's `OutputReference` as inline datum, so one output can never settle
two policies at once (double satisfaction).

Plutus has no `ecrecover`, so the validator stores the Airnode's compressed secp256k1 key and checks
`verifyEcdsaSecp256k1Signature(key, keccak_256(prefix ‖ keccak_256(requestHash ‖ uint256(timestamp) ‖ data)), r‖s)`.
It never parses JSON: it rebuilds the exact signed bytes from typed redeemer fields. `src/onchain.ts` is a byte-exact
model of that path; its tests verify the **real** Airnode signature with Plutus semantics and recover the key back to
`0x83FE…F2Ec`. `npm run vectors` regenerates `onchain/lib/aeroguard/vectors.ak` (then `aiken fmt`).

```bash
cd onchain && aiken check      # 26 tests: real Airnode signatures, forgeries, time, payout rule, validator paths
aiken build                    # plutus.json
```

| | |
|---|---|
| Compiler / stdlib | Aiken v1.1.24, stdlib v2.2.0, Plutus V3 |
| Script hash | `58d832a40020e79da24d7b444845ff27fe22ccd4a19f5b50971dfa27` (2,022 bytes) |
| Preprod script address | `addr_test1wpvdsv4yqqsw08dzf4a5gjz9lunlugkv6jse7k6sjuwl5fchwmjh4` |
| Real Airnode signature check | ≈ 34–48k mem / 59–64M cpu; a full settlement ≈ 0.46M mem / 0.19B cpu (tx limit 14M / 10B) |

**Off-chain** (`src/cover.ts`, `npm run cover`): the insurer (seller wallet, needs a few tADA) opens a cover; anyone
settles it with the JSON body an agent bought from `/verdict`; the insurer reclaims after the deadline.

```bash
npm run cover -- open --flight IB1314 --date 2026-10-30 --holder addr_test1... --ada 5 --hours 48
npm run buy -- --flight IB1314 --date 2026-10-30 > /dev/null   # or save the /verdict body to verdict.json
npm run cover -- settle --open <openTx> --verdict verdict.json   # refused until the verdict is final
npm run cover -- reclaim --open <openTx>                         # after the deadline
```

Every build runs the validator locally with Aiken's UPLC evaluator (`@evolution-sdk/aiken-uplc`), so a transaction the
script would reject is never submitted.

Real Airnode signatures in the Aiken tests: the IB1314 pre-departure status and a live arrival answer (`EnRoute`, with
`actual`), both verify on-chain-style and both are refused for settlement (`NotFinal`), exactly like `FlightDelayCover`;
relabelling the en-route answer as `Arrived` breaks the signature. Final-outcome paths use a public test key until the
keeper buys a final answer; then `npm run vectors` writes `real_final_test.ak` and the TS lifecycle test settles a cover
on the real signature automatically.

## Test without network or funds

```bash
npm test
```

39 tests. The buyer signs real Cardano transactions with the SDK's reference signer and the server's facilitator
verifies and submits them; the Aiken cover's transactions are built and **executed** with Aiken's UPLC evaluator
(PlutusV3 cost model). Only Blockfrost is a local fixture (as in the official demo's tests). Covers the 402 offer,
refusals, discovery, paid verdicts, replay, sales log, anchor transaction, claims agent, MCP, preflight, the whole
`qualify` run as a separate process, the Plutus model, and the cover lifecycle (full/half/none/cancel, edited proof,
wrong signer, non-final live proof, reclaim before/after deadline).
