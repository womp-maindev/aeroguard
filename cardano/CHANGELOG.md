# Changelog — AeroGuard on Cardano

Everything in the Cardano track, newest first. Times are UTC, 30–31 Oct 2026. Branch `claude/magical-feynman-qda2d7`,
[PR #1](https://github.com/womp-maindev/aeroguard/pull/1). The Cardano work lives in `cardano/`. Outside it, it touches
only the short "Cardano" section in the root `README.md`, `docs/DEVFOLIO-cardano.md` and the dashboard file
`web/data/cardano-run.json`.

## 31 Oct — final video, 2:20
- `web/media/cardano.mp4` and `presentation/cardano/AeroGuard-Cardano-video.mp4` are now the final 2:20 cut (12.3 MB):
  cards on the business case / ROI / USP and on limits / next come before the closing. Durations in the docs and on
  the site are updated.

## 31 Oct — live Aiken escrow as an optional bonus
- `presentation/cardano/DEMO.md` has a new section, "Bonus block (optional, ~2 min)": `sh live-cover.sh now`, what
  the screen shows step by step, what to say while the block is pending, and a fallback.
- The 2-speaker pitch and `PITCH-RUNBOOK.md` each get one line pointing to it.

## 31 Oct — the voiced 2:04 cut is live
- `web/media/cardano.mp4` and `presentation/cardano/AeroGuard-Cardano-video.mp4` are now the new cut, voiced from the
  shifted `lines.tsv` (2:04, 12.5 MB). The silent 16.7 MB render is no longer committed. Durations in the docs and on
  the site are updated.

## 31 Oct — voice-over follows the new cut
- `voiceover/lines.tsv` is shifted to the new timings: the title runs from 0.5 s, and every later line starts 6.5 s
  later. A new line runs over the live site clip (6.5–12.5 s). `make-voiced-video.sh` now voices the silent cut in
  `cardano/video/`.

## 31 Oct — video polish: hero title, live site clip, smooth playback
- **01-title** is redrawn as the site's hero: a light sky with a dot grid, planes with dashed trails drifting across, soft
  clouds, and a 0.5 s still lead-in.
- **New 01b-site** (6 s): the live site, from the hero with its moving planes to the Cardano x402 panel. It is rendered
  frame by frame: CSS animations are paused and set to each frame's time.
- **`src/assemble.sh`**: 0.3 s dips between clips (every clip keeps its length), constant 30 fps, a keyframe every
  second, faststart. The new timings are in `SHOTLIST.md`. The silent cut `cardano/video/aeroguard-cardano-full.mp4`
  is committed for the voice-over rebuild.

## 31 Oct — the voiced video is the only full cut
- `web/media/cardano.mp4` is the full cut, voiced with `voiceover/lines.tsv`. The silent copy in
  `presentation/cardano/` is removed (−6 MB), and every link points to the voiced one.
- `npm run video` writes its silent full cut to `cardano/video/`, which is git-ignored.

## 31 Oct — one copy of the full video
- The full cut lives only in `presentation/cardano/aeroguard-cardano-full.mp4`, which the deck uses; the 5.9 MB copy in
  `cardano/video/` is removed, links point to the one copy, and `npm run video` writes the full cut there.

## 31 Oct — Windows paths, judge in 60 seconds, numbers checked
- **Windows:** every `new URL(…, import.meta.url).pathname` is now `fileURLToPath(…)`. On Windows the old form gave
  `/C:/…` paths, which broke the evidence, log and test paths. Linux: 53/53.
- **`cardano/README.md`:** "Judge in 60 seconds (no wallet)": the Cardanoscan tx, the dashboard's Cardano panel, the
  video, the offline tests.
- **Numbers checked against the code:** `GET /policy` has 11 offline tests (was "8"). The deck says "1–2 tADA per
  verdict" (was "~1 ADA"). All 10 slides render at 1920×1080 with no overflow.

## 31 Oct — deck: escrow and "an agent hires an agent"
- Slide 6 says the Aiken cover is an escrow that pays only on a signed result. Slide 9 has a new card: the claims agent
  hires our verdict agent, pays only for a final proof whose signature checks, and an unknown flight is a free 404.
  The speaker notes (EN and RU) say the same.

## 31 Oct — receipts say early or late
- `EVIDENCE.md` rows now show the signed offset ("25 min early", "11 min late") instead of a delay clamped to "+0 min".
  The first row is corrected: IB1314 landed 25 min early.

## 31 Oct — the Aiken cover live on preprod in one command
- **`sh live-cover.sh now`** pays 2 tADA over x402 for a final verdict (LH1816) and opens a 5 tADA Aiken cover. It
  then settles the cover with that same verdict body: the script checks the Airnode signature on chain. Every tx goes
  to `COVER-EVIDENCE.md`. The run was rehearsed offline on the fake Blockfrost: three txs, and the settle passed
  Aiken's UPLC evaluator.
- **Today's flights:** `sh live-cover.sh open <flight> 2026-10-31 <policy id>` reads the scheduled arrival from the Base
  policy. After landing, `settle` imports the keeper's signed answer, pays for it and settles. `claims.json` now lists
  policies #5–#11.
- **Docs:**
  - "Agent hires agent" in the Devfolio text.
  - `GET /policy` is marked as tested offline.
  - The README links the live-vs-tested table.
  - The demo budget points to `npm run preflight`.
- **Voice-over:** the Aiken line now says "escrow … pays only on a signed result".

## 31 Oct — wording after policies #5–#11
- Main now has 11 policies (7 fly today). The Cardano docs and speaker notes say "the four policies of 30 Oct" /
  "our first four policies" where they meant #1–#4, so nobody reads it as "all our policies". No code changes.

## 31 Oct — presentation: video and what to say, in one place
- `presentation/cardano/aeroguard-cardano-full.mp4`: the full video now sits next to the slides.
- `presentation/cardano/VIDEO-SCRIPT.md`: what to say over the video, block by block with timecodes. Each block has
  what is on screen, the English line to read and a Russian translation.
- `presentation/cardano/SPEAKER-NOTES.md`: the English text for each slide, now with a Russian translation.
- `presentation/cardano/README.md`: a table of which file is for what, and how to update the local copy.

## 31 Oct — presentation
- **New folder [`presentation/`](../presentation/)**, with the Cardano deck in [`presentation/cardano/`](../presentation/cardano/):
  - `index.html`: a 10-slide offline deck (16:9). The real paid run, the response and `aiken check` play as embedded
    videos, and two QR codes link to the Cardanoscan tx and to the code. Keys: ←/→, F fullscreen, N speaker notes.
  - `SPEAKER-NOTES.md`: what to say on each slide, about 2½ min.
  - `DEMO.md`: a live-demo runbook with a rehearsal, the window layout, what to say while it waits and a fallback plan.
  - `open-presentation.command`: double-click on a Mac.
  - `media/`: WebM fallbacks for the slide videos.

## 31 Oct — video
- **Video clips** in [`video/`](video/): ten 1080p30 clips without sound, plus the full cut
  `aeroguard-cardano-full.mp4` (1:57) and [`video/SHOTLIST.md`](video/SHOTLIST.md) (timings, a suggested English
  voice-over, a ~45 s short cut). Every clip shows real data: the paid preprod run, its JSON response, `aiken check`,
  the dashboard, and the four live landings.
- **Reproducible:** `npm run video` (or `sh video/src/render.sh`) re-renders every clip frame by frame from
  `web/data/cardano-run.json` and `video/src/aiken-check.json`. It needs ffmpeg and Playwright's Chromium.

## 30 Oct 23:16 — qualification: first paid request on Cardano preprod
- **Real x402 payment:** 2 tADA for the final IB1314 verdict, tx
  [`e2ef922b…`](https://preprod.cardanoscan.io/transaction/e2ef922be71ba61da9431f1a5f56f4c56f5d61348c4945194cf390dd0acd7864).
  Settled after 44 s; the verdict was signed by Airnode `0x83FE…F2Ec`.
- **Recorded in** [`EVIDENCE.md`](EVIDENCE.md), `evidence/sales.jsonl` and `web/data/cardano-run.json`. The dashboard's
  Cardano panel now shows this run.
- `npm run qualify` also writes `web/data/cardano-run.json` (`{ challenge, response }`), the format the dashboard reads.
- Linked from the root README, `cardano/README.md`, the Devfolio text and the plan.

## 30 Oct 22:47 — all four live landings, the same verdict on two chains
- The keeper's signed `Arrived` answers for IB1314, LH1816, EI357 and BA955 are imported from `keeper-data`.
- **Same outcome on both chains:** they closed policies #1–#4 on Base as `ClosedNoPayout`. The same signatures settle the
  Aiken cover the same way (no payout, cover back to the insurer), and a payout to the holder is refused.
- **Generated tests:** `npm run vectors` writes one Aiken test module per flight
  (`onchain/lib/aeroguard/real_final_<flight>_test.ak`), and the TS lifecycle test builds and executes each settlement
  transaction. 44 Aiken tests, 53 TS tests.

## 30 Oct 21:49–21:58 — Cardano pays for cover on Base; code-review fixes
- **`GET /policy`:** a premium in tADA buys a `FlightDelayCover` policy on Base Sepolia.
  - The price comes from the contract's own `quote` (demo rate 1 aUSD = 10 tADA, at least 1 tADA).
  - The purchase runs only after the Cardano payment settles, with `cardanoJobRef = keccak256("cardano:<tx>")`.
  - Order status is free at `/orders/:tx`.
  - Tools: `npm run buy-policy`, `npm run server:policies`, MCP tool `buy_flight_cover`.
- **Review fixes:**
  - One payment can never buy two policies: the order is recorded before any `await`.
  - Every failure after payment is recorded as `refundDue`: an RPC error, a restart mid-purchase, or a quote that moved.
  - Past dates and flights already past the gate get a free 409 before payment.
  - The idempotency key is unambiguous.
  - The sales and orders logs read their file once at start.
- **Aiken freshness, as in `FlightDelayCover`:** the settle window must lie within `[signed at, signed at + max_age]`
  (Stale, FromTheFuture), and an arrival answer must be signed after the landing it reports (ObservedTooEarly).
  `max_age` is a policy field.
  - New script hash `107d6818…`, preprod address `addr_test1wqg866…`.
  - reclaim works right after the deadline; `cover open` refuses covers too small for a half payout.

## 30 Oct 21:20–21:39 — real data, demo polish
- **Live answers:** the service resells the keeper's live Airnode answers. `npm run import-evidence` checks each signature
  before saving, and the newest answer per request wins.
- **Pricing:** 1 tADA while a flight is live, 2 tADA once the answer is final.
- **Real arrival signature in Aiken:** a real arrival-format signature (IB1314 `EnRoute`) verifies, relabelling it as
  `Arrived` breaks it, and an en-route answer cannot settle.
- **Demo output:** `buy` and `qualify` print the decoded 402 offer before paying.
- **Docs:** architecture diagram (`docs/architecture.svg`) and a judge quickstart.
- **Anchor fix:** the anchor transaction pays only the fee, and `preflight` checks the seller's balance when
  `ANCHOR=true`.
- **Branch:** `main` is merged into the branch with no conflicts.

## 30 Oct 20:58–21:03 — the cover lifecycle and one-command qualification
- **Off-chain open / settle / reclaim for the Aiken cover.** Every build runs the validator locally with Aiken's UPLC
  evaluator (`@evolution-sdk/aiken-uplc`, PlutusV3 cost model).
- **x402 → contract:** the verdict body an agent buys is exactly the settle redeemer (`npm run cover -- settle`).
- **`npm run qualify`:** preflight, start the endpoint, pay, record the evidence. It is tested as a separate process.
- **`npm run preflight`:** checks the key's network, both wallets, the evidence and the balance, with a fix for each
  failure.

## 30 Oct 20:44–20:52 — server hardening, agents, Aiken contract
- **Payments:** one transaction buys one operation; replaying it returns the same answer. `confirmExpiry` keeps a
  Blockfrost outage from expiring a payment.
- **Server:** sales log, tUSDM option, free discovery (`/flights`, `/sales`, `/.well-known/x402`), and an optional
  on-chain metadata anchor (labels 674 / 8402).
- **Agents:** a claims agent (budget, free catalog check, the same decision rule as the contract) and MCP tools.
- **Aiken flight cover** (Plutus V3):
  - Checks the Airnode's secp256k1 signature with `keccak_256` and `verifyEcdsaSecp256k1Signature`, rebuilding the
    signed bytes from typed fields.
  - Pays out by `FlightDelayCover`'s rule.
  - Payout outputs are tagged with the spent input (no double satisfaction).
- **Plutus-primitive model:** `src/onchain.ts` recovers the Airnode key from its live signature and pins it in tests.

## 30 Oct 17:26 — first version
- **Paid endpoint:** `GET /verdict?flight=&date=` on `cardano:preprod` with `@x402/express` and `@x402/cardano` 2.26.0
  (`exact` scheme, Blockfrost) and an in-process facilitator. The response is the AeroGuard verdict plus the
  Airnode-signed evidence.
- **Tools:** buyer script with a spend cap, wallet and balance helpers.
- **Tests:** offline e2e tests on a local Blockfrost fixture.
- **Plan and docs:** development plan ([`PLAN.md`](PLAN.md)) and the Devfolio text.
