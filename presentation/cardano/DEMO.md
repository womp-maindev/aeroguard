# Live demo on stage — Cardano part (≈ 60 s)

Agents pay per request on Cardano for flight outcomes any contract can verify. This page is the runbook for showing it
live; the deck (`index.html`) and the videos are the fallback.

## The evening before / 30 min before
1. In `~/aeroguard-run` check out the branch (or `main` once PR #1 is merged), then:
   ```bash
   cd cardano && npm i && npm run preflight
   ```
   All lines must be ✅. `Buyer balance` should show well over 4 tADA (each run pays 2 tADA plus a fee).
2. Run `npm run qualify` once as a rehearsal. It takes about 1 minute (the block wait is 20–60 s). That run is a real,
   second paid request — fine to keep: commit `cardano/EVIDENCE.md`, `cardano/evidence/sales.jsonl` and
   `web/data/cardano-run.json` afterwards.
3. Open three windows and arrange them:
   - **Terminal** in `~/aeroguard-run/cardano`, large font (⌘+ a few times).
   - **Browser tab 1:** the deck (`presentation/cardano/open-presentation.command` or open `index.html`), press **F**.
   - **Browser tab 2:** https://preprod.cardanoscan.io/transaction/e2ef922be71ba61da9431f1a5f56f4c56f5d61348c4945194cf390dd0acd7864
4. Turn off notifications (Focus mode) and keep the laptop on power.

## On stage
| When | Do | Say |
|---|---|---|
| Deck slide 4 | Switch to the terminal, run `npm run qualify` | "Let's pay for one verdict right now on Cardano preprod." |
| While it waits (20–60 s) | Point at the `402 → pay 2 tADA` line | "The server asked two tADA; the wallet signed; now the facilitator waits for the block." |
| `4/4 done` appears | Point at `Arrived` and the Airnode signer | "Verdict plus the Airnode's signature — any contract can check it." |
| Then | Click the `link` (⌘-click) → Cardanoscan | "And here is the payment on Cardano." |
| Back to deck | Slides 5–7 | Aiken contract, then "same verdict on two chains". |

## If something goes wrong
- **No network / Blockfrost error / takes > 90 s:** don't wait. Say "this is the run from last night", switch to deck
  slide 4 (its video is that real run) and the Cardanoscan tab. Continue with slide 5.
- **`Buyer balance ❌`:** fund the buyer address from https://docs.cardano.org/cardano-testnets/tools/faucet (Preprod)
  — or use the fallback above.
- **Slides don't show videos:** use the full cut `cardano/video/aeroguard-cardano-full.mp4` instead.

## What judges can verify themselves
- QR on slide 4 → the paid transaction on Cardanoscan.
- QR on slide 10 → the code (`cardano/`), with `npm test` (53) and `aiken check` (44) runnable offline, no keys.
