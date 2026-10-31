# Live demo on stage — Cardano part (≈ 60 s)

Agents pay per request on Cardano for flight outcomes any contract can verify. This page is the runbook for showing it
live; the deck (`index.html`) and the videos are the fallback.

## Main demo: Claude Desktop pays tADA for a signed verdict (MCP)

Paths below use `~/aeroguard-run`. On any machine, any clone of the repo works: `cd cardano` in it.

**Set up once (Mac), all in one block.** It writes the MCP entry into Claude Desktop's config and keeps any servers
already there:
```bash
cd ~/aeroguard-run && git fetch -q origin main && git checkout -q -f FETCH_HEAD && cd cardano && npm i --silent && node -v && python3 - <<'PY'
import json, os, shutil
cfg = os.path.expanduser('~/Library/Application Support/Claude/claude_desktop_config.json')
os.makedirs(os.path.dirname(cfg), exist_ok=True)
data = json.load(open(cfg)) if os.path.exists(cfg) else {}
home = os.path.expanduser('~/aeroguard-run/cardano')
data.setdefault('mcpServers', {})['aeroguard-cardano'] = {
    'command': shutil.which('node'),
    'args': ['--env-file=' + home + '/.env', home + '/src/mcp.ts'],
    'env': {'SERVER_URL': 'http://localhost:4021'},
}
json.dump(data, open(cfg, 'w'), indent=2)
print('written:', cfg)
PY
```
`node -v` must print **v22.18 or newer**. The entry points Claude Desktop at that exact `node`, not whatever is on
Claude's PATH.

**Before you go on stage:**
1. Terminal 1: `cd ~/aeroguard-run/cardano && npm run server` (keep it open; it is the paid endpoint).
2. Quit Claude Desktop completely (⌘Q), then open it again. 🔨 → **aeroguard-cardano** should show 3 tools:
   `list_flights`, `get_flight_verdict`, `buy_flight_cover`.

**On stage, ask Claude:**
> Use the aeroguard-cardano tools. List the flights you can buy, then buy the signed verdict for IB1314 on 2026-10-30
> and tell me whether a delay policy pays out. Give me the Cardano transaction link.

**Expected:**
- Claude calls `list_flights`, which is free. It shows IB1314 and the other three flights.
- Then it calls `get_flight_verdict`. Approve the tool call when Claude Desktop asks.
- After about 20–60 s (one block) it answers: **arrived 21:00Z, 25 min early, so no payout**. The answer is signed by
  the AeroDataBox Airnode `0x83FE…F2Ec`, and comes with a `preprod.cardanoscan.io/transaction/…` link. Open the link.
- Each call is a real payment of 2 tADA plus a fee. Terminal 1 logs the sale.

**If MCP does not come up (no 🔨 tools, or an error):**
- Run the same purchase from a terminal: `cd ~/aeroguard-run/cardano && npm run buy` (the server must be running).
  It prints the 402 offer, the verdict, the tx and the Cardanoscan link.
- Last resort: slide 4 of the deck (video of the real run) and the Cardanoscan tab.
- Logs to check: `~/Library/Logs/Claude/mcp-server-aeroguard-cardano.log`. Typical causes are an old `node`, a missing
  `.env` (it needs `BUYER_MNEMONIC` and `BLOCKFROST_PROJECT_ID`), or the server not running.

**Budget:** each demo costs about 2.2 tADA. Run `npm run preflight` for the current balance.

## Aiken cover live on preprod (before the pitch, ~3 min)
Run this in `~/aeroguard-run/cardano` (it starts its own endpoint on a free port):
```bash
sh live-cover.sh now
```
It pays 2 tADA for the final LH1816 verdict and locks a 5 tADA cover at the Aiken script. Then it settles the cover
with that verdict: the script checks the Airnode signature on chain, and the cover goes back to the insurer (11 min late
pays nothing). It prints three Cardanoscan links and writes them to `COVER-EVIDENCE.md`. Commit `EVIDENCE.md`,
`COVER-EVIDENCE.md` and `evidence/`.

## The evening before / 30 min before
1. In `~/aeroguard-run` update to `main`, then:
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
- **Slides don't show videos:** use the full cut `web/media/cardano.mp4` (voiced) instead.

## What judges can verify themselves
- QR on slide 4 → the paid transaction on Cardanoscan.
- QR on slide 10 → the code (`cardano/`), with `npm test` (53) and `aiken check` (44) runnable offline, no keys.
