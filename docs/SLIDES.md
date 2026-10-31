# AeroGuard: pitch deck (2 minutes), content for Lovable

**Format:** 16:9, 7 slides (a title and 6 content slides) plus an appendix of sources that is not presented. **Total speaking time: 2:00** (286 words, about 2.4 words per second). Each slide lists what goes **on the slide** (keep it sparse: big numbers, few words), a **visual** direction, and the **speaker script** with its time.

**Style:** match the AeroGuard dashboard.
- Light sky background `#eef0f3`, white cards `#ffffff`, text `#151b26`, muted text `#556071`.
- Accent orange `#e8521c` for the key number on each slide. Blue `#2f62d6` for "AeroGuard". Green `#1d8a5a` for "accepted / paid". Red `#d0342c` for "rejected / problem".
- Fonts: **Kelly Slab** for headlines, **Jost** for body, a monospace font for contract errors and addresses.
- Optional motif: thin hand-drawn plane outlines in the background, as on the dashboard. One idea per slide.

---

## Slide 0 · Title (0:00–0:05)

**On the slide**
- **AeroGuard**
- *Your flight is late. You're already paid.*
- Flight-delay cover that is **sold and paid only on data signed by the AeroDataBox Airnode on API3 AirnodeHub**
- Small footer: TUM Blockchain & AI Hackathon 2026 · API3 track (also entered in the Cardano track) · live on Base Sepolia

**Visual:** logo or wordmark centred, one plane outline, a small "API3 · AirnodeHub" badge.

**Speaker (5 s):** "AeroGuard is in the API3 and Cardano tracks; this is the API3 part."

---

## Slide 1 · The problem, and why it isn't solved yet (0:05–0:27)

**Headline:** Delays are common. Getting paid isn't.

**On the slide**

| Big number | Caption |
|---|---|
| **1 in 6** | European flights delayed more than 30 min (Eurocontrol, Sept 2025) |
| **€250–600** | EU261 compensation, but only from **3 h**, only **after a claim**, never for "extraordinary circumstances" |
| **31–35 %** | of the payout kept by claim agencies |
| **2–33 %** | of eligible passengers who ever claim (claims-industry estimates) |

**Why not solved yet:** AXA's blockchain flight cover **fizzy** (2017–2019): €5 premium, €100 at a 2 h delay. **Shut down**, citing low demand and weak distribution. The hard parts are still open:
1. Can the contract **trust the data**?
2. Who **presses the pay button**?
3. How do you stop people **insuring a flight already known to be late**?

**Visual:** four big numbers in a row (the key one in orange), then a slim timeline "fizzy 2017 → shut down 2019" and the three questions as icons: shield, button, clock.

**Speaker (22 s):** "One in six European flights is delayed. EU261 pays only from three hours, only if you claim, and agencies keep a third. AXA tried automatic flight cover on Ethereum and shut it down in 2019. Three problems remain: trusting the data, who triggers the payout, and insuring flights already known to be late."

---

## Slide 2 · Our solution: signed data at both ends (0:27–0:52)

**Headline:** No signature, no money moves.

**On the slide:** a three-step flow:
1. **Buy:** only with a fresh (≤ 15 min) AeroDataBox status, **signed by its Airnode**, saying the flight **hasn't left**. The schedule is read **from the signature**, at least 2 h before arrival.
2. **Verify on-chain:** right signer · request hash **derived by the contract** from flight + date · fresh · final status · signed after landing.
3. **Pay automatically:** ≥ 3 h late or cancelled → **100 %** · ≥ 2 h → **50 %**. A keeper buys the signed arrival over **x402 for $0.05** and settles. **Nobody files a claim.**

**Proof strip, live on Base Sepolia:**
- **11** real policies on real Munich flights
- **4 / 4** forgeries rejected by the deployed contract, with real Airnode responses
- **86** contract tests
- **Judges can attack it from their own wallet**

**Visual:** a horizontal flow Buy → Verify → Pay with check marks; under it, four proof chips. Show one revert in monospace, red: `NotSignedByAirnode`.

**Speaker (25 s):** "AeroGuard sells and pays only on data signed by the AeroDataBox Airnode on API3. You can only buy with a fresh signed status saying the flight hasn't left. After landing, our keeper buys the signed arrival for five cents and the contract pays: no claim. It's live with eleven real policies, and forgeries are rejected on-chain."

---

## Slide 3 · Business case, ROI and USP (0:52–1:14)

**Headline:** Verification for a few percent of the premium, not a third of the payout.

**On the slide**

| | Claim-based today | AeroGuard |
|---|---|---|
| Time to money | weeks to months | **about 30 min** after landing (the keeper's first check) |
| Middleman cut | **31–35 %** of the payout | **0 %** |
| Who claims | 2–33 % of the eligible | **every** qualifying policy pays |

- **Cost per policy (measured):** **$0.18** alone on a flight · **$0.07** when ten share it. One signed outcome settles every policy on a flight.
- **= 4.6 % / 1.8 % of the premium** on $50 cover.
- **Use case:** embedded at checkout by travel apps and agents; complements EU261 (pays from 2 h, any cause).
- **For API3 (illustration):** 10,000 policies a day ≈ **15,000 paid calls ≈ $750 a day** for one data operation.
- **USP:** *"Everyone can pay out on signed data. We also **sell** on it."*

**Visual:** a bar chart: "claim agency fee 35 % of payout" (red, tall) next to "AeroGuard data + gas 1.8–4.6 % of premium" (green, short). The USP line as a pull quote in blue.

**Speaker (22 s):** "Verification costs eighteen cents per policy, seven when travellers share a flight. That's under five percent of the premium, against the third agencies take, and money arrives in minutes, not weeks. Travel apps embed it at checkout. Our edge: everyone pays out on signed data; we also sell on it."

---

## Slide 4 · Architecture (1:14–1:32)

**Headline:** Every arrow that carries flight data carries a signature.

**On the slide:** a diagram, left to right:

```
AeroDataBox ─▶ AeroDataBox Airnode (API3 AirnodeHub) ── signs every response
                       │  x402 · $0.05 per call
                       ▼
                 Keeper (anyone can run it, no special power)
                       │  buyPolicy · settle
                       ▼
     FlightDelayCover · Base Sepolia ── checks signer, request, freshness, final status
                       │
                       ▼
                 Payout to the stored holder (aUSD)
     Dashboard + judges ── read and attack the live contract directly
```

**Facts beside the diagram:**
- The request hash is **rebuilt by the contract**, identical to AirnodeHub's byte for byte (tested on a real capture).
- `buyPolicy` 309k gas · `settle` 126k gas: **under $0.01 per policy** on Base.
- The keeper **can't** pick the flight, the schedule or the recipient.

**Visual:** a clean left-to-right diagram, a small padlock icon on every signed arrow, the contract box highlighted in blue.

**Speaker (18 s):** "The AeroDataBox Airnode signs every response. Our keeper pays per call with x402 and brings it on-chain. The contract rebuilds the request hash itself, checks the signer and freshness, and pays only the stored holder. The keeper has no power, so anyone can run it."

---

## Slide 5 · Edge cases and limitations (1:32–1:47)

**Headline:** What we block, and what we know is still open.

**On the slide:** two columns.

**Blocked on-chain (tested):** edited value · stale response · response for another flight · wrong signer · buying after departure · lying about the schedule · "landed" signed before landing · settling twice · selling cover the pool can't back.

**Open, with the production fix:**
- A delay already visible in *revised* times at purchase → add revised times to the purchase proof
- Multi-leg flights share a number → name the departure airport in the signed request
- Diverted flights don't settle → treat as final
- Schedule change or no evidence in 3 days → refund the premium
- No live payout yet (none of our flights was 2 h late) → shown in tests and a one-click rehearsal

**Visual:** a green column with check marks and red reverts in monospace (`Stale`, `WrongRequest`, `NotBuyable`); an amber column with "→ fix" arrows.

**Speaker (15 s):** "Every classic attack is blocked on-chain and tested. We also list what's still open, like delays already visible in revised times, or multi-leg flights, each with its fix. And honestly: no live flight was two hours late yet."

---

## Slide 6 · What's next: growth and scale (1:47–2:00)

**Headline:** One contract shape, any event an Airnode can sign.

**On the slide**
- **Trust:** a second check of the landing time with **OpenSky's Airnode** (also on AirnodeHub) · first-party airline Airnodes
- **Pricing and capital:** risk-priced premiums per route · an open liquidity vault earning premiums
- **Distribution:** travel apps and AI travel agents embed it with **one contract call**, paying for data per call over x402
- **New markets:** rail delays · weather · any parametric event an Airnode can sign
- Closing line, big: **No signature, no money moves.**

**Visual:** an expanding ring diagram: flights at the centre, then rail, weather, events; a small "x402 · pay per call" chip.

**Speaker (13 s):** "Next: a second landing check with OpenSky, risk pricing, and distribution through travel apps and AI agents. The same contract fits rail, weather, any signed event. No signature, no money moves."

---

## Appendix (not presented): sources and checks

| Figure | Source |
|---|---|
| 1 in 6 flights delayed > 30 min | Eurocontrol monthly network operations report, Sept 2025: 16.5 % (from a search excerpt; **verify on eurocontrol.int before presenting**) |
| EU261 €250–600, from 3 h, extraordinary circumstances excluded | Regulation (EC) No 261/2004 |
| Claim agencies 31–35 % | AirHelp 35 % incl. VAT: https://www.airhelp.com/en/blog/airhelp-vs-euclaim-best-flight-compensation-company/ · EUclaim 31 %: https://www.airhelp.co.uk/blog/airhelp-vs-euclaim-best-flight-compensation-company-in-the-uk/ |
| 2–33 % of eligible passengers claim | claims-industry estimates, not official statistics: https://travelweekly.co.uk/in-depth/flight-delay-compensation-unclaimed-by-70-of-passengers |
| AXA fizzy 2017–2019, €5 → €100, shut down | https://www.ledgerinsights.com/axa-blockchain-flight-delay-compensation/ · https://atlas-mag.net/en/articles/blockchain-axa-stops-fizzy-0 |
| $0.05 per signed lookup, x402 | AirnodeHub listing for AeroDataBox: https://airnodehub.api3.org/llms-full.txt |
| 309k / 126k gas, $0.18 / $0.07 per policy, 4.6 % / 1.8 % | measured on Base Sepolia; see [docs/BUSINESS.md](BUSINESS.md) (ETH at $3,000 assumed) |
| 11 live policies, 4/4 forgeries rejected, 96 tests | [docs/EVIDENCE.md](EVIDENCE.md), README tamper table, `forge test` |
| OpenSky on AirnodeHub | AirnodeHub catalogue (slug `opensky`) |

**Before presenting:** update "11 real policies" and slide 5's "no live payout yet" if one of today's flights pays out. A payout would be the strongest number in the deck.
