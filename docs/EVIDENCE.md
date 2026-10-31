# Evidence: every live policy, every signed response

Contract [`0x2570…0a80`](https://sepolia.basescan.org/address/0x257054204c4Cd43846C4553eBe6D709841980a80) on Base Sepolia. Signer: AeroDataBox Airnode `0x83FE2E8F24E66520B1902C3507De4F471248f2Ec`. Each AeroDataBox call was paid over x402 (0.05 aUSD).

Every signed response below can be re-verified offline without trusting us. Recover the EIP-191 signer of `keccak256(requestHash ‖ timestamp ‖ data)`, then compare `requestHash` with `requestHashFor(flight, date, arrival)` on the contract. The dashboard's Security Inspector does both in the browser. Walkthrough: the [1:47 demo video](../web/media/demo.mp4). All responses the keeper has bought are published in [`keeper-data/keeper.json`](https://github.com/womp-maindev/aeroguard/blob/keeper-data/keeper.json).

## Policies (30 Oct 2026, from Munich, 0.5 aUSD cover each)

| # | Flight | Scheduled arrival (signed) | Purchase | Signed pre-departure proof | Settlement | Outcome · payout |
|---|---|---|---|---|---|---|
| 1 | IB1314 MUC→MAD | 21:25Z | [0xbfd3ae73…](https://sepolia.basescan.org/tx/0xbfd3ae73074ff63a3ef5f7e56b211d1ffb7223e2db944d0cc38ed069d1958b8d) | `Expected`, signed 16:41:56Z ([file](../contracts/test/fixtures/IB1314-purchase-proof.json), x402 [0x544a7241…](https://sepolia.basescan.org/tx/0x544a72416958438be7181af6dc96111ea7d0e6544d63e7ac869faac28671dad2)) | [0xf0aa5db2…](https://sepolia.basescan.org/tx/0xf0aa5db2e08a9b9aa7298c92853642b39d7ff330fe3e42cd8b441aa136246b44) 21:58Z | `ClosedNoPayout` · 0 (landed 21:00Z, 25 min early) |
| 2 | LH1816 MUC→BCN | 21:55Z | [0x7e71c55b…](https://sepolia.basescan.org/tx/0x7e71c55b970b96fb1588ddde1da029060d805c9b87691280ca2504098d4e69d2) | `Expected` ([file](../contracts/test/fixtures/LH1816-purchase-proof.json), read back from the calldata) | [0x5270aa58…](https://sepolia.basescan.org/tx/0x5270aa58d63db79af041e74bb40115a801381f28caca028d90c285280594c535) 22:27Z | `ClosedNoPayout` · 0 (landed 22:06Z, 11 min late) |
| 3 | EI357 MUC→DUB | 21:55Z | [0x2aeed601…](https://sepolia.basescan.org/tx/0x2aeed6010ced165f66c26ea0f34e7068421a327cac0c6375d72ef7b794f41672) | `Expected` ([file](../contracts/test/fixtures/EI357-purchase-proof.json), read back from the calldata) | [0x5a5e4fc7…](https://sepolia.basescan.org/tx/0x5a5e4fc750464b0f4043aa2318da55705ae0eb94603adf17d417068de4f2ff9a) 22:27Z | `ClosedNoPayout` · 0 (landed 21:26Z, 29 min early) |
| 4 | BA955 MUC→LHR | 21:50Z | [0x7e675d8f…](https://sepolia.basescan.org/tx/0x7e675d8f94946db1d02a40c1eff87ac5a0ca29b65730751cf0d902d767d2b0d1) | `Expected` ([file](../contracts/test/fixtures/BA955-purchase-proof.json), read back from the calldata) | [0x973e29d8…](https://sepolia.basescan.org/tx/0x973e29d8195ce6bfe7bde0b749b308cfe1e8200e2465c849810a0a01dd01c7ee) 22:27Z | `ClosedNoPayout` · 0 (landed 21:47Z, 3 min early) |

Every purchase proof sits in its `buyPolicy` calldata (`timestamp`, `data`, `signature`). [`proofs.yml`](../.github/workflows/proofs.yml) reads all four back (`keeper cli proof <tx>`, read-only); IB1314's matched our earlier capture byte for byte.

## Policies (31 Oct 2026, bought 30 Oct 23:28–23:38Z for the pitch day, 0.5 aUSD cover each)

Bought in one batch with the `Buy policies` workflow, each with a fresh signed `Expected` status. Two flights that do not operate on Saturdays were rejected before any payment, and the batch stopped when AeroDataBox answered 429, because the quota is shared. The keeper settles these on Saturday morning. A payout happens only if the Airnode signs a real delay of 2 h or more, or a cancellation.

| # | Flight | Scheduled arrival (signed) | Purchase | x402 for the proof | Settlement | Outcome · payout |
|---|---|---|---|---|---|---|
| 5 | LH1866 MUC→FCO | 10:20Z | [0x823fd0d2…](https://sepolia.basescan.org/tx/0x823fd0d28a58f1bd57b061502f00ebe66ab969ebce577a9bc05d3b47abb329a3) | [0x3f59c05c…](https://sepolia.basescan.org/tx/0x3f59c05c939048d7e2329a57e1dbf54dc9da4cc65356e6779ffbbd33ae8733ff) | [0x5892c851…](https://sepolia.basescan.org/tx/0x5892c851847a5bb8340862ff10ce548837f52ffeb7443c0c3fe28daf7dfc9a6d) 10:57Z | `ClosedNoPayout` · 0 (landed 10:18Z, 2 min early; [signed arrival](../contracts/test/fixtures/LH1866-settlement.json), x402 [0x07bb6b6e…](https://sepolia.basescan.org/tx/0x07bb6b6ec23b133c266a2cdfdebdc7e4e5db2a10bd66d66bbd410a7ba5d18ee2)) |
| 6 | LH2472 MUC→LHR | 10:25Z | [0xe82e30cd…](https://sepolia.basescan.org/tx/0xe82e30cd9c6b1b8f9442bb4ea48d618d793d389ef2b96c06f0f39e211d50a55e) | [0x34309557…](https://sepolia.basescan.org/tx/0x34309557c8e5510bfd1fa2b52ff25a810272f219ef5ceb502eae63c22cae09a1) | [0x226abfdc…](https://sepolia.basescan.org/tx/0x226abfdc44a13644145103ff7f2322883eaf3722bee1e6dc78500b8d168798b2) 10:57Z | `ClosedNoPayout` · 0 (landed 10:14Z, 11 min early; [signed arrival](../contracts/test/fixtures/LH2472-settlement.json), x402 [0x42a824e9…](https://sepolia.basescan.org/tx/0x42a824e95eb5c9f8dd553bcb660e5728163ea6bcfc9eebf78fed99393a9dc91d)) |
| 7 | EI352 DUB→MUC | 09:10Z | [0xebee9181…](https://sepolia.basescan.org/tx/0xebee91819106c8e56bc8ef9b76b56dee96cd2638e4060ead67fc62a50b5909e5) | [0x8ea848ff…](https://sepolia.basescan.org/tx/0x8ea848ff1a5e5e9965f98e0ffa6c0218d00642b6616f267ab73a8d7ee61d6e1a) | [0xa74101c2…](https://sepolia.basescan.org/tx/0xa74101c2e2482306712716deda11727893dcd10d448148dbaa3db5888dbb66c1) 09:43Z | `ClosedNoPayout` · 0 (landed 08:45Z, 25 min early; [signed arrival](../contracts/test/fixtures/EI352-settlement.json), x402 [0x22c90b0a…](https://sepolia.basescan.org/tx/0x22c90b0ad73cc6d93415f005d82c46f5651edbca40b2b33c94ffa0df259409dc)) |
| 8 | LH1810 MUC→BCN | 10:00Z | [0x8f5eb0b9…](https://sepolia.basescan.org/tx/0x8f5eb0b9efa6f63fa7bfba1b895efc9c4ea1e4ff424088dcde4c7be064feeb57) | [0x0258eb12…](https://sepolia.basescan.org/tx/0x0258eb121c1fa5e03a9a1c907adc7aeaee3773a0a8530e54fdf8028049f02b76) | [0xa98c28cc…](https://sepolia.basescan.org/tx/0xa98c28cc6987978ae3dba3c1c9c5083e1819a680c18559c02bdd604389741c39) 10:33Z | `ClosedNoPayout` · 0 (landed 09:45Z, 15 min early; [signed arrival](../contracts/test/fixtures/LH1810-settlement.json), x402 [0xd484d1c3…](https://sepolia.basescan.org/tx/0xd484d1c3d3496a4045152c29fcf557eaeea7e6b7d817fe77acf61a71d0aca1b7)) |
| 9 | LH1814 MUC→BCN | 16:35Z | [0xd6c0b35d…](https://sepolia.basescan.org/tx/0xd6c0b35d0fa11f9bc84b7f0cb5b333836a5c9c100355bfe5a08cb9ed892b6130) | [0xd0992dc8…](https://sepolia.basescan.org/tx/0xd0992dc8c5e2d37089520a0961d2f1c44dd37d1514d1cdfc14ef298a0eb4359a) | pending | pending |
| 10 | LH1868 MUC→FCO | 12:15Z | [0x668017d6…](https://sepolia.basescan.org/tx/0x668017d68099092c8614508a94cff53ff9f2f9b3ac296f3cfbdf5fdd3153f1bd) | [0xd03a12f0…](https://sepolia.basescan.org/tx/0xd03a12f0cb447a363cfc47f42c8ee0b069e6cac481ca61c7c8baaf483e831aa6) | pending | pending |
| 11 | LH2476 MUC→LHR | 15:50Z | [0xe0ee4b2a…](https://sepolia.basescan.org/tx/0xe0ee4b2a69b447e09d927d202c9fe8e34f2be34f0ed14a7791b4bb9c6e87d011) | [0x41f00a0b…](https://sepolia.basescan.org/tx/0x41f00a0bd7f57fc40e6e33031a25316e310efa1a25b49704658af99365860def) | pending | pending |

## Keeper lookups

| When (UTC) | Policy | Why | Signed answer | x402 payment |
|---|---|---|---|---|
| 30 Oct 19:10 | #1 IB1314 | early look for a cancellation (scheduled − 2 h 15) | arrival: `EnRoute`, revised 20:47Z | [0x9ce6ea22…](https://sepolia.basescan.org/tx/0x9ce6ea2237d2a98300858be7c5f427de6e12c2f83a29930f3aa86bfa69f39006) |
| 30 Oct 19:10 | #2 LH1816 | early look | arrival: `CheckIn`, revised 21:45Z | [0xf3568783…](https://sepolia.basescan.org/tx/0xf3568783791c945e20e5c7a5ecccb21c1d3a061fe613593021f83b4412d88e0d) |
| 30 Oct 19:10 | #3 EI357 | early look | arrival: `Boarding`, revised 21:55Z | [0x6d3aa808…](https://sepolia.basescan.org/tx/0x6d3aa8080ae7ee561108ea9795ed06c5051732368858b5460b01848bffe78efc) |
| 30 Oct 19:10 | #4 BA955 | early look | arrival: `CheckIn`, revised 21:50Z | [0xac70e982…](https://sepolia.basescan.org/tx/0xac70e982516617addda1270febe45a7a46a03cede9aac8ca3b36c72aef8add8f) |
| 30 Oct 20:59 | #1 IB1314 | forced single-policy look (it was revised to land early) | arrival: `Approaching` (not final) | [0x3780278f…](https://sepolia.basescan.org/tx/0x3780278f40ba654556b4dd5a3452dc996d746ff38e291682a78c771125685473) |
| 30 Oct 21:58 | #1 IB1314 | first check after arrival | arrival: **`Arrived` 21:00Z** → settled ([file](../contracts/test/fixtures/IB1314-settlement.json)) | [0xaaa74d0e…](https://sepolia.basescan.org/tx/0xaaa74d0e408f5558f14e71f43b7a37b6e37764d454d0425291f7dfb7b36e2104) |
| 30 Oct 22:27 | #2 LH1816 | first check after arrival | arrival: **`Arrived` 22:06Z** → settled ([file](../contracts/test/fixtures/LH1816-settlement.json)) | [0x557e5d5b…](https://sepolia.basescan.org/tx/0x557e5d5b3d60626c9d23593fada9d43c81de82e5f6e02b8663336f6a03635156) |
| 30 Oct 22:27 | #3 EI357 | first check after arrival | arrival: **`Arrived` 21:26Z** → settled ([file](../contracts/test/fixtures/EI357-settlement.json)) | [0x856458f5…](https://sepolia.basescan.org/tx/0x856458f50e565ae958ecc5ec385bd01b954f28daf20be41daa07b342bea24e15) |
| 30 Oct 22:27 | #4 BA955 | first check after arrival | arrival: **`Arrived` 21:47Z** → settled ([file](../contracts/test/fixtures/BA955-settlement.json)) | [0x764671bf…](https://sepolia.basescan.org/tx/0x764671bfb440405891e8190fe99168cded5f51acaede70273ce5b4fa18bbc8c3) |

The keeper only sends `settle` on a final status, after simulating it. Settlement lookups start 30 min after each scheduled arrival ([`schedule.ts`](../keeper/src/schedule.ts)).

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

- [`LiveReplay.t.sol`](../contracts/test/LiveReplay.t.sol) buys policies #1–#8 through the real `buyPolicy` with their real proofs, and for #1 reproduces `NotFinal(Expected)` and `Stale(1793378516)`. With the keeper's settlement responses (`<FLIGHT>-settlement.json`) it reproduces each on-chain outcome and payout (part of the 94 forge tests).
- [`Fixtures.t.sol`](../contracts/test/Fixtures.t.sol) shows that a real LH400 capture (x402 [0x76d334da…](https://sepolia.basescan.org/tx/0x76d334da55c86bbf61d37762f8ee843f4920bc874477a82d06852247b4e2054f)) recovers to the Airnode and that its request hash matches the contract's derivation byte for byte.
