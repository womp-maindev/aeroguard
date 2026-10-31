# AeroGuard × API3 — video clips

1920×1080, 30 fps, H.264, no audio. Clip lengths are fixed so a voice-over stays in sync after a re-render.
Everything shown is real: the signed proof is policy #1's AirnodeHub response, the keeper terminal replays the keeper's published log
([`keeper-data/keeper.json`](https://github.com/womp-maindev/aeroguard/blob/keeper-data/keeper.json)), the test and rehearsal terminals replay a real
`forge test` and `npm run rehearse` output ([`src/forge-test.txt`](src/forge-test.txt), [`src/rehearse.txt`](src/rehearse.txt)), the tamper table holds the live contract's answers,
and clips 5 and 7 are the live dashboard reading Base Sepolia (recorded in GitHub Actions; this render uses the 31 Oct 05:00Z recording, the "Render API3 video" workflow records them fresh).

Re-render after new settlements: Actions → **Render API3 video** → Run workflow (`.github/workflows/video.yml`: fresh `forge test`, fresh anvil rehearsal,
the keeper's latest log, live dashboard; commits the clips and the silent full cut here). Locally: `sh video/src/render.sh` (dashboard clips need `LIVE=1` and the Base Sepolia RPC).

Silent full cut: [`aeroguard-api3-full.mp4`](aeroguard-api3-full.mp4) (2:15, CFR 30 fps, 0.3 s fades at every cut, 0.5 s held first frame).
The voiced version is [`web/media/api3.mp4`](../web/media/api3.mp4) (until the new voice-over lands it is the earlier 2:08 cut).

| # | Clip | Start (s) | Length (s) |
|---|---|---|---|
| 1 | 01-title.mp4 | 0.00 | 7.00 |
| 2 | 02-hero.mp4 | 7.00 | 6.00 |
| 3 | 03-flow.mp4 | 13.00 | 14.00 |
| 4 | 04-buy.mp4 | 27.00 | 13.00 |
| 5 | 05-keeper.mp4 | 40.00 | 14.80 |
| 6 | 06-dashboard.mp4 | 54.80 | 10.00 |
| 7 | 07-ledger.mp4 | 64.80 | 12.00 |
| 8 | 08-tamper-lab.mp4 | 76.80 | 13.00 |
| 9 | 09-tamper.mp4 | 89.80 | 12.00 |
| 10 | 10-tests.mp4 | 101.80 | 14.30 |
| 11 | 11-rehearsal.mp4 | 116.10 | 12.10 |
| 12 | 12-outro.mp4 | 128.20 | 7.00 |

Clip 2 is the site's real hero (`src/hero.cjs`); clips 6 and 8 are the live dashboard; the rest are rendered by `src/player.html` from real data.

**Short cut (~60 s):** 01 → 02 → 05 → 07 → 08 → 09 → 12.

Notes
- To show Basescan itself, record 3–5 s of a settlement tx from [docs/EVIDENCE.md](../docs/EVIDENCE.md) in your browser.
- Wallet tamper (real failed txs) is not in the clips: it needs your wallet. See [docs/VIDEO.md](../docs/VIDEO.md) shot 6A if you record it.
