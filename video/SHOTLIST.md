# AeroGuard × API3 — video clips

1920×1080, 30 fps, H.264, no audio. The voiced cut of all eleven clips (2:08) is [`web/media/api3.mp4`](../web/media/api3.mp4); clip lengths are fixed so the voice stays in sync after a re-render.
Everything shown is real: the signed proof is policy #1's AirnodeHub response, the keeper terminal replays the keeper's published log
([`keeper-data/keeper.json`](https://github.com/womp-maindev/aeroguard/blob/keeper-data/keeper.json)), the test and rehearsal terminals replay a real
`forge test` and `npm run rehearse` output ([`src/forge-test.txt`](src/forge-test.txt), [`src/rehearse.txt`](src/rehearse.txt)), the tamper table holds the live contract's answers,
and clips 5 and 7 are the live dashboard reading Base Sepolia (recorded in GitHub Actions; this render uses the 31 Oct 05:00Z recording, the "Render API3 video" workflow records them fresh).

Re-render after new settlements: Actions → **Render API3 video** → Run workflow (`.github/workflows/video.yml`: fresh `forge test`, fresh anvil rehearsal,
the keeper's latest log, live dashboard; commits the clips here and puts the voice-over back on `web/media/api3.mp4`). Locally: `sh video/src/render.sh` (dashboard clips need `LIVE=1` and the Base Sepolia RPC).

| # | File | Length | What it shows | Voice-over idea (EN) |
|---|---|---|---|---|
| 1 | 01-title.mp4 | 6 s | Title: your flight is late, you're already paid | "Your flight lands three hours late. Getting money back means forms, evidence and weeks of waiting. AeroGuard pays on its own." |
| 2 | 02-flow.mp4 | 14 s | Buy → wait → pay x402 → verify → settle, one step at a time | "You buy cover with a signed status from the AeroDataBox Airnode on API3 AirnodeHub. After landing, a keeper buys the signed arrival over x402, the contract verifies it and pays. Nobody files a claim." |
| 3 | 03-buy.mp4 | 13 s | Policy #1's real signed purchase proof; signer, request hash, age, status highlighted | "The contract checks the Airnode's signature, rebuilds the request hash for this exact flight and date, and only sells cover before departure, with the schedule read from the signature." |
| 4 | 04-keeper.mp4 | 15 s | The keeper's real runs: early look, signed arrival bought over x402, settled | "Our keeper decides when data is worth buying, pays five cents per signed answer, simulates the settlement and sends it." |
| 5 | 05-dashboard.mp4 | 10 s | Live dashboard: the 11 policies read from Base Sepolia | "Every policy is live on Base Sepolia." |
| 6 | 06-ledger.mp4 | 12 s | All 11 policies with their signed outcome and settlement tx | "Each one closes on the Airnode's signed arrival: a delay of two hours or a cancellation pays, anything else closes with no payout. The data decides." |
| 7 | 07-tamper-lab.mp4 | 13 s | Live dashboard tamper lab: 4 attacks on policy #1, all blocked | "Now let's cheat. Judges can attack the live contract from the browser…" |
| 8 | 08-tamper.mp4 | 12 s | The live contract's answers: NotSignedByAirnode, WrongRequest, attacker key, Stale, NotFinal | "An edited value, another flight's response, an attacker's key, an old response: all rejected. Or send them from your own wallet as real failed transactions." |
| 9 | 09-tests.mp4 | 14 s | Real `forge test`: 86 tests, policies #1–#4 replayed on their real signatures, hardening | "86 tests, including the full live lifecycle of our first four policies on their real Airnode signatures." |
| 10 | 10-rehearsal.mp4 | 12 s | Real anvil rehearsal: 100 % · 50 % · 0 · cancelled → 100 %, 4 forgeries rejected | "And every payout rule on a local chain, in seconds." |
| 11 | 11-outro.mp4 | 7 s | Pitch line + numbers + repo | "AeroGuard. The signed data is the decision. Try to break it yourself." |

**Short cut (~60 s):** 01 → 02 (0:00–0:08) → 04 → 06 → 07 → 08 → 11.

Notes
- To show Basescan itself, record 3–5 s of a settlement tx from [docs/EVIDENCE.md](../docs/EVIDENCE.md) in your browser.
- Wallet tamper (real failed txs) is not in the clips: it needs your wallet. See [docs/VIDEO.md](../docs/VIDEO.md) shot 6A if you record it.
