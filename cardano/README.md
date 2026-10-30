# AeroGuard on Cardano: pay-per-request flight verdicts over x402

Agents pay per request on Cardano for flight outcomes any contract can verify.

`GET /verdict?flight=IB1314&date=2026-10-30` answers **402** with a price of **2 tADA** on `cardano:preprod`.
The agent's wallet signs a Cardano transaction (never broadcasts it), retries with `PAYMENT-SIGNATURE`, the
facilitator verifies and submits it, and the server returns:

- `verdict`: status, scheduled/actual arrival, delay minutes, final or not (same rule as `FlightDelayCover`);
- `evidence`: the AeroDataBox Airnode's signed response (`airnode, requestHash, timestamp, data, signature`), which
  `FlightDelayCover` on Base Sepolia (or any `AirnodeV2Attestation.verify`) accepts unchanged;
- `paidWith`: the Cardano tx hash and its Cardanoscan link.

Built from the official template stack: `@x402/express`, `@x402/core`, `@x402/cardano` 2.26.0 (`exact` scheme,
Blockfrost provider), as in [cardano-foundation/x402-cardano-demo](https://github.com/cardano-foundation/x402-cardano-demo).
The facilitator runs inside the server process (it holds no keys and no funds); set `FACILITATOR_URL` to use a hosted one.

Evidence comes from disk only (`cardano/evidence/`, then `keeper/.cache/`): the AeroDataBox quota is shared, so this
service never calls the Airnode. A flight without evidence gets a free 404, never a charge. `GET /flights` lists them.

## Run (Cardano preprod)

```bash
cd cardano && npm i            # also installs ../keeper, whose verdict code this reuses
npm run wallets                # creates cardano/.env with a buyer and a seller mnemonic, prints both addresses
# put your Blockfrost preprod project ID in cardano/.env, fund the buyer address from the faucet
npm run balance                # buyer should show ~10000 tADA
npm run server                 # http://localhost:4021
npm run buy                    # in a second terminal: pays 2 tADA, prints the verdict, tx hash and Cardanoscan link
```

`npm run buy -- --flight IB1314 --date 2026-10-30` picks the flight. The buyer appends each paid request to
[EVIDENCE.md](EVIDENCE.md). Its spend control allows only tADA and at most `MAX_LOVELACE_PER_REQUEST` (default 5 tADA).

## Test without network or funds

```bash
npm test
```

The buyer signs a real Cardano transaction with the SDK's reference signer, the server's facilitator verifies and
submits it; only Blockfrost is a local fixture (the same approach as the official demo's tests).
