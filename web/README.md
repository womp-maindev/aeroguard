# AeroGuard dashboard (`web/`)

> New here? Step-by-step for Windows and Mac: [README-Eskender.md](../README-Eskender.md).

One static page: `index.html` plus fonts and images. It reads the live `FlightDelayCover` on Base Sepolia straight
from the browser (`eth_call` to `https://sepolia.base.org`), runs the tamper lab as simulated `settle()` calls, and
checks Airnode signatures locally. No keys, no build step, no server of ours.

## Open it

**Quickest, no git, nothing to install.** On GitHub: **Code → Download ZIP** → right-click the ZIP → **Extract All**
(running it from inside the ZIP does not work) → open the `web` folder and double-click:

- **Windows:** `start.bat`. It starts a small server in PowerShell (`serve.ps1`, built into Windows) and opens the
  browser. If SmartScreen says "Windows protected your PC": **More info → Run anyway**. Close the black window to stop.
- **macOS:** `start.command` (uses python3). First time: right-click → **Open** → **Open**.


**In GitHub, one click (Codespaces).** Needs access to the repo.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/womp-maindev/aeroguard?quickstart=1)

The Codespace installs everything, serves `web/` on port 8080 and opens the dashboard in a new tab
(if the tab is blocked: **Ports** panel → *Dashboard* → 🌐). Close the Codespace when done; it stops by itself after 30 min idle.

**On your machine.**

```bash
git clone https://github.com/womp-maindev/aeroguard && cd aeroguard/web && python3 -m http.server 8080
```

Open <http://localhost:8080>. Use a local server rather than double-clicking `index.html` so the fonts load.

**With the keeper API** (only to buy cover from the page). Needs `.env` with `KEEPER_PK` and `FLIGHT_COVER_ADDRESS`:

```bash
cd aeroguard/keeper && npm i && npm run api
```

Open <http://localhost:8787>. If 8787 is taken: `PORT=8788 npm run api` and open `http://localhost:8080/?api=http://localhost:8788`.

## What should happen

- Header: green **Live · Base Sepolia**; *Policies* lists the live policies; stats are filled.
- *Tamper lab* → **Run the 4 attacks**: four reverts (`NotSignedByAirnode`, `WrongRequest`, `NotSignedByAirnode`, `Stale`).
  **Simulate genuine** on policy #1 gives `NotFinal(Expected)` (its proof is a pre-departure status).
- *Inspector* → **Load real Airnode proof**: the signer recovers to the AeroDataBox Airnode.
- *Keeper log*: read from `keeper.json` on the `keeper-data` branch (written by every keeper run). While the repo is
  private the page cannot fetch it; the link to the Actions runs always works.

## Hosting

| Where | How |
|---|---|
| GitHub Pages | Repo public → Settings → Pages → Source: *GitHub Actions* → run **Dashboard on GitHub Pages** (Actions tab). |
| Cloudflare Pages | Repo secrets `CLOUDFLARE_API_TOKEN` (*Cloudflare Pages: Edit*) + `CLOUDFLARE_ACCOUNT_ID`. Every push to `web/` deploys: `main` → `aeroguard.pages.dev`, other branches → preview URLs. |
| Cloudflare, team only | Zero Trust → Access → Applications → *Self-hosted* `aeroguard.pages.dev`, policy *Allow → Emails* (the team), login *One-time PIN*. Pages project → Settings → *Access policy* covers previews. Remove it when judging starts. |

## Overrides (testing only)

`?rpc=http://127.0.0.1:8545&contract=0x…` points the page at a local anvil; `?api=` at a keeper API;
`?keeper=` at another `keeper.json`; `?cardano=http://localhost:4021` lets the Cardano card ask a running x402 server
(it needs CORS). A paid Cardano answer saved as `web/data/cardano-run.json` (`{ recordedAt, challenge, response }`)
shows up as a recorded run.
