# Evidence: every live policy, every signed response

Contract [`0x2570…0a80`](https://sepolia.basescan.org/address/0x257054204c4Cd43846C4553eBe6D709841980a80) on Base Sepolia. Signer: AeroDataBox Airnode `0x83FE2E8F24E66520B1902C3507De4F471248f2Ec`. Each AeroDataBox call was paid over x402 (0.05 aUSD).

Every signed response below can be re-verified offline without trusting us. Recover the EIP-191 signer of `keccak256(requestHash ‖ timestamp ‖ data)`, then compare `requestHash` with `requestHashFor(flight, date, arrival)` on the contract. The dashboard's Security Inspector does both in the browser. All responses the keeper has bought are published in [`keeper-data/keeper.json`](https://github.com/womp-maindev/aeroguard/blob/keeper-data/keeper.json).

## Policies (30 Oct 2026, from Munich, 0.5 aUSD cover each)

| # | Flight | Scheduled arrival (signed) | Purchase | Signed pre-departure proof | Settlement | Outcome · payout |
|---|---|---|---|---|---|---|
| 1 | IB1314 MUC→MAD | 21:25Z | [0xbfd3ae73…](https://sepolia.basescan.org/tx/0xbfd3ae73074ff63a3ef5f7e56b211d1ffb7223e2db944d0cc38ed069d1958b8d) | `Expected`, signed 16:41:56Z ([file](../contracts/test/fixtures/IB1314-purchase-proof.json), x402 [0x544a7241…](https://sepolia.basescan.org/tx/0x544a72416958438be7181af6dc96111ea7d0e6544d63e7ac869faac28671dad2)) | pending | pending |
| 2 | LH1816 MUC→BCN | 21:55Z | [0x7e71c55b…](https://sepolia.basescan.org/tx/0x7e71c55b970b96fb1588ddde1da029060d805c9b87691280ca2504098d4e69d2) | `Expected` ([file](../contracts/test/fixtures/LH1816-purchase-proof.json), read back from the calldata) | pending | pending |
| 3 | EI357 MUC→DUB | 21:55Z | [0x2aeed601…](https://sepolia.basescan.org/tx/0x2aeed6010ced165f66c26ea0f34e7068421a327cac0c6375d72ef7b794f41672) | `Expected` ([file](../contracts/test/fixtures/EI357-purchase-proof.json), read back from the calldata) | pending | pending |
| 4 | BA955 MUC→LHR | 21:50Z | [0x7e675d8f…](https://sepolia.basescan.org/tx/0x7e675d8f94946db1d02a40c1eff87ac5a0ca29b65730751cf0d902d767d2b0d1) | `Expected` ([file](../contracts/test/fixtures/BA955-purchase-proof.json), read back from the calldata) | pending | pending |

Every purchase proof sits in its `buyPolicy` calldata (`timestamp`, `data`, `signature`). [`proofs.yml`](../.github/workflows/proofs.yml) reads all four back (`keeper cli proof <tx>`, read-only); IB1314's matched our earlier capture byte for byte.

## Keeper lookups

| When (UTC) | Policy | Why | Signed answer | x402 payment |
|---|---|---|---|---|
| 30 Oct 19:10 | #1 IB1314 | early look for a cancellation (scheduled − 2 h 15) | arrival: `EnRoute`, revised 20:47Z | [0x9ce6ea22…](https://sepolia.basescan.org/tx/0x9ce6ea2237d2a98300858be7c5f427de6e12c2f83a29930f3aa86bfa69f39006) |
| 30 Oct 19:10 | #2 LH1816 | early look | arrival: `CheckIn`, revised 21:45Z | [0xf3568783…](https://sepolia.basescan.org/tx/0xf3568783791c945e20e5c7a5ecccb21c1d3a061fe613593021f83b4412d88e0d) |
| 30 Oct 19:10 | #3 EI357 | early look | arrival: `Boarding`, revised 21:55Z | [0x6d3aa808…](https://sepolia.basescan.org/tx/0x6d3aa8080ae7ee561108ea9795ed06c5051732368858b5460b01848bffe78efc) |
| 30 Oct 19:10 | #4 BA955 | early look | arrival: `CheckIn`, revised 21:50Z | [0xac70e982…](https://sepolia.basescan.org/tx/0xac70e982516617addda1270febe45a7a46a03cede9aac8ca3b36c72aef8add8f) |

None of these is final, so the keeper did not try to settle. Settlement lookups start 30 min after each scheduled arrival ([`schedule.ts`](../keeper/src/schedule.ts)).

## Attacks against the deployed contract (policy #1, real Airnode response)

Simulated with `eth_call`, no transaction. The full table is in [README → Tamper test](../README.md#tamper-test-for-judges).

| Forgery | Answer |
|---|---|
| one signed value edited | `NotSignedByAirnode` |
| genuine response for another request | `WrongRequest` |
| signed by an attacker key | `NotSignedByAirnode` |
| genuine but older than `maxAge` | `Stale(1793378516)` |
| genuine, fresh, pre-departure | `NotFinal(Expected)` |

## Replays in Solidity

- [`LiveReplay.t.sol`](../contracts/test/LiveReplay.t.sol) buys all four policies through the real `buyPolicy` with their real proofs, and for #1 reproduces `NotFinal(Expected)` and `Stale(1793378516)`. Once the keeper's settlement responses are committed as `<FLIGHT>-settlement.json`, it must reproduce each on-chain outcome and payout.
- [`Fixtures.t.sol`](../contracts/test/Fixtures.t.sol) shows that a real LH400 capture (x402 [0x76d334da…](https://sepolia.basescan.org/tx/0x76d334da55c86bbf61d37762f8ee843f4920bc874477a82d06852247b4e2054f)) recovers to the Airnode and that its request hash matches the contract's derivation byte for byte.
