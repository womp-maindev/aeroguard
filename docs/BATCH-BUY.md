# Batch purchase on the day: giving a live payout a chance

**Testnet only.** aUSD and Base Sepolia ETH come from faucets and have no value. Use a fresh wallet that has never held, and never will hold, real assets: the same key works on mainnet.

A payout needs a real flight to land 2 h or more late, or to be cancelled, signed by the AeroDataBox Airnode. That can't be staged, so this buys cover on several flights and lets reality decide. One of the policies doubles as **policy B** for the real-transaction tamper shot (`docs/VIDEO.md`, shot 6A).

## Status, Sat 31 Oct, about 01:30 CET: already bought

Seven policies on today's flights were bought overnight with the keeper wallet (0.5 aUSD each, holder `0xd9b4…Be24`):

| # | Flight | Scheduled arrival (signed) | Settles from about (CET) |
|---|---|---|---|
| 7 | EI352 | 09:10Z (10:10 CET) | 10:40 |
| 8 | LH1810 | 10:00Z (11:00 CET) | 11:30 |
| 5 | LH1866 | 10:20Z (11:20 CET) | 11:50 |
| 6 | LH2472 | 10:25Z (11:25 CET) | 11:55 |
| 10 | LH1868 | 12:29Z (13:15 CET) | 13:45 |
| 11 | LH2476 | 15:50Z (16:50 CET) | 17:20 |
| 9 | LH1814 | 16:35Z (17:35 CET) | 18:05 |

So:
- **Don't buy duplicates.** The pool has **0.94 aUSD free**, room for **one** more 0.5 aUSD policy. More needs the owner to fund the pool first.
- **Policy B is already there: #9 (LH1814) or #11 (LH2476).** Both are still Active through the video and the 15:00–17:00 judging. They were bought last night, so their purchase proofs are already old enough to show `Stale`. Run step 4 with one of their purchase transactions.
- **Settlement is Mikhail's keeper.** Don't run a second keeper (step 5).

The steps below remain the procedure for any further purchase.

## Budget (8 policies of 0.5 aUSD)

| Item | Each | 8 policies |
|---|---|---|
| Purchase proof (signed status, x402) | 0.05 aUSD | 0.40 aUSD |
| Premium (8 % of 0.5) | 0.04 aUSD | 0.32 aUSD |
| Settlement lookups (about 2–3 per flight, shared by every policy on it) | ≈ 0.125 aUSD | ≈ 1.00 aUSD |
| Gas (`buyPolicy` + `settle`) | < 0.000003 ETH | negligible |
| **Total** | | **≈ 1.7 aUSD + a little test ETH** |

**Pool limit:** the pool has **4.16 aUSD free**, which caps the total cover at about **8 × 0.5 aUSD**. More cover is rejected with `Insolvent`, unless the owner funds the pool from the faucet first. Every lookup also draws on the AeroDataBox quota shared by all teams: about 24 lookups here.

## 1. Wallet and `.env` (once)

```bash
cast wallet new        # prints an address and a private key: a fresh TEST wallet only
```

Fund that address with:
- **Base Sepolia ETH**, about 0.01 is plenty, from a faucet listed at https://docs.base.org/get-started/get-funds
- **aUSD**, up to 10 per account, from https://api3dao.github.io/airnodehub-hackathon/faucet/

Create `.env` in the repo root. It is git-ignored:
```
BASE_SEPOLIA_RPC=https://sepolia.base.org
KEEPER_PK=0x<the test wallet's private key>
FLIGHT_COVER_ADDRESS=0x257054204c4Cd43846C4553eBe6D709841980a80
KEEPER=off
REHEARSE=on
```
`KEEPER_PK` buys the policies, pays the x402 lookups and the premiums (the aUSD approval happens automatically on the first purchase), and later settles.

Check it:
```bash
cd keeper && npm ci && npm run --silent cli -- status
```
You want: the wallet has ETH and at least 2 aUSD, and the pool `free` is at least the total cover you plan to buy.

## 2. Pick the flights (by about 10:30)

Use the **public** departures board (for example Munich's website or a flight-tracking site), **not** the API: every API call is a paid lookup from the shared quota, and `buy` does the lookup itself.

- **Arrival between about 13:00 and 16:30 CET today.** Each must still be **at least 2 h away when you buy** (`minLeadTime`), so buy by about 11:00. Then they land in time to settle before or during judging (15:00 to 17:00).
- **Not departed yet.** The contract only sells against `Expected / Unknown / CheckIn / Boarding`.
- **Different flights, airlines and routes.** Several policies on the same flight don't raise the chance of a payout.
- **Flight numbers** in capitals without a space (`LH1816`). **Date** = the local **departure** date (`2026-10-31`).
- **Don't** pick a flight whose board already shows a long delay. That exploits a known limitation ([README](../README.md#known-limitations)), undercuts the USP, and would be rigged.
- **Holder:** your own wallet address, so the dashboard marks the policies "yours". Any address works; the payout always goes to the stored holder.

## 3. Buy (one command, sequential, no retries)

Git Bash, from the repo root. Edit the three variables first:
```bash
HOLDER=0xYourAddress
COVER=0.5
FLIGHTS="LH1816@2026-10-31 BA955@2026-10-31 EI357@2026-10-31"   # replace with today's picks
cd keeper && mkdir -p .cache
for E in $FLIGHTS; do
  F=${E%@*}; D=${E#*@}
  echo "=== $(date -u +%H:%M:%SZ) $F $D" | tee -a .cache/batch-buy.log
  npm run --silent cli -- buy --flight "$F" --date "$D" --holder "$HOLDER" --coverage "$COVER" 2>&1 | tee -a .cache/batch-buy.log
done
npm run --silent cli -- policies
```

PowerShell, from the repo root:
```powershell
$holder = '0xYourAddress'; $cover = '0.5'
$flights = 'LH1816@2026-10-31', 'BA955@2026-10-31', 'EI357@2026-10-31'   # replace with today's picks
cd keeper; New-Item -ItemType Directory -Force .cache | Out-Null
foreach ($e in $flights) {
  $f, $d = $e -split '@'
  "=== $(Get-Date -Format HH:mm:ss) $f $d" | Tee-Object -Append .cache\batch-buy.log
  npm run --silent cli -- buy --flight $f --date $d --holder $holder --coverage $cover 2>&1 | Tee-Object -Append .cache\batch-buy.log
}
npm run --silent cli -- policies
```

Each line prints the policy id, the signed scheduled arrival and the transaction. A rejection is a decoded contract error, and the loop moves on to the next flight. **Don't re-run a flight that failed**: every attempt is another paid lookup.

| Error | Meaning |
|---|---|
| `… is Departed / Delayed …; cover can only be bought before departure` | Too late for this flight (no purchase, but the lookup was paid) |
| `TooCloseToArrival` | Less than 2 h before the scheduled arrival |
| `Insolvent` | The pool's free capital is used up |
| `The Airnode responded with 400` | AeroDataBox has no such flight on that date: check the number and the local departure date |

Keep `.cache/batch-buy.log`: it holds every transaction for `docs/EVIDENCE.md`.

## 4. Policy B for the video

Pick one policy that lands **after** you record. Then:
```bash
npm run --silent cli -- proof <its buyPolicy tx> > .cache/B-proof.json
```
From **1 h after purchase**, this proof sent unmodified shows `Stale`. Load it in the dashboard's Inspector and tick "Use the inspector's response as the base".

## 5. Settlement (from about 13:00)

Run **one** keeper, not two: a second keeper on the same policies spends the shared quota twice.
- **Here:** `cd keeper && npm run keeper`, and tell Mikhail not to dispatch the GitHub Actions keeper; or
- **Mikhail:** dispatches the GitHub Actions keeper runs, and you don't run one.

The keeper looks once about 3 h before arrival (for cancellations), then from 30 min after each scheduled arrival, and settles as soon as the signed status is final. A payout goes to the holder in the same transaction. For a single policy right now: `npm run cli -- tick --policy <N> --force`.

## 6. Afterwards

- Add the purchases, the settlements, and any payout to `docs/EVIDENCE.md` and the README "Live evidence".
- If one paid out: that's the headline for shot 5 of the video and for the pitch's proof segment.
- If none did, the honest line still holds: real signed data decided every outcome on-chain, and the payout tiers are shown by the tests and the rehearsal.
