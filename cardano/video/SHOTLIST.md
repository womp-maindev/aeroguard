# AeroGuard × Cardano — video clips

1920×1080, 30 fps, H.264, **no audio** (lay your voice-over on top). `npm run video` also writes `aeroguard-cardano-full.mp4` here (not committed) = all ten clips in order (1:57).
Everything shown is real: the terminal replays use the exact output of the paid run on 30 Oct 2026 23:16 UTC (tx `e2ef922b…`),
the response is the real JSON, the Aiken results are a real `aiken check` (44/44), the dashboard is the real page.

| # | File | Length | What it shows | Voice-over idea (EN) |
|---|---|---|---|---|
| 1 | 01-title.mp4 | 6 s | Title: agents pay per request for flight outcomes | "On Cardano, AI agents buy flight outcomes per request — and any contract can verify them." |
| 2 | 02-arch.mp4 | 14 s | Architecture, 5 steps highlighted one by one | "The agent asks, gets a 402 with a price in tADA, its wallet signs, the facilitator settles on Cardano, and the answer comes back with the Airnode's signature." |
| 3 | 03-qualify.mp4 | 26 s | Real `npm run qualify`: preflight, 402 offer, signed tx, settled after 44 s (sped up), tx + Cardanoscan link | "Here's a real run on preprod: the server asks two tADA, the wallet signs, the transaction lands in a block, and we get the verdict." |
| 4 | 04-response.mp4 | 11 s | The paid JSON; highlights verdict → Airnode signature → payment receipt | "What the agent gets: IB1314 arrived 25 minutes early, signed by the AeroDataBox Airnode, plus the Cardano receipt." |
| 5 | 05-tx.mp4 | 7 s | Card: tx hash, from/to, what it bought | "Two tADA for one verdict. You can check it on Cardanoscan." |
| 6 | 06-dashboard.mp4 | 12 s | Our dashboard's Cardano panel: ask · pay · verdict for this run | "The dashboard shows the same exchange: ask, pay, verdict." |
| 7 | 07-aiken.mp4 | 16 s | Real `aiken check`: forgery tests, then 4 modules for the 4 real landings, 44/44 | "And it's not just JSON: our Aiken contract verifies the Airnode's secp256k1 signature on Cardano — forgeries fail, real landings pass." |
| 8 | 08-chains.mp4 | 11 s | Table: 4 live policies, Base `ClosedNoPayout` vs Cardano "no payout" | "The same four signed landings closed our live policies on Base, and settle the Cardano cover exactly the same way." |
| 9 | 09-policy.mp4 | 9 s | `/policy`: tADA buys a Base policy, `cardanoJobRef` link (tested offline) | "And Cardano can pay for the cover itself: the premium in tADA buys a policy on Base, linked to the payment." |
| 10 | 10-outro.mp4 | 6 s | Pitch line + numbers + repo | "Agents pay per request on Cardano for flight outcomes any contract can verify." |

**Short cut (~45 s):** 01 (3 s) → 03 from 0:07 to 0:22 → 05 → 07 from 0:08 → 08 → 10.

Notes
- Clip 3: the 44 s wait for the block is compressed and labelled "(44 s, sped up)"; the Blockfrost key is masked.
- Clip 9 is the only part not run live (8 offline tests); its caption says so.
- To show Cardanoscan itself, record 3–5 s of https://preprod.cardanoscan.io/transaction/e2ef922be71ba61da9431f1a5f56f4c56f5d61348c4945194cf390dd0acd7864 in your browser (blocked from our build box).

## Final cut timings (31 Oct, `sh src/assemble.sh`)
0.3 s dip between clips, constant 30 fps, keyframe every second. 0.5 s still lead-in at the start of the title.

| Clip | Start (s) | Length (s) |
|---|---|---|
| 01-title (site hero sky, drifting planes) | 0.00 | 6.50 |
| 01b-site (live site: hero → Cardano x402 panel) | 6.50 | 6.00 |
| 02-arch | 12.50 | 14.00 |
| 03-qualify | 26.50 | 25.70 |
| 04-response | 52.20 | 11.00 |
| 05-tx | 63.20 | 7.00 |
| 06-dashboard | 70.20 | 12.00 |
| 07-aiken | 82.20 | 15.47 |
| 08-chains | 97.67 | 11.00 |
| 09-policy | 108.67 | 9.00 |
| 10-outro | 117.67 | 6.00 |
| **total** | | **123.67** |
