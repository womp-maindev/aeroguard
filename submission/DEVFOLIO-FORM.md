# Devfolio form — copy-paste, field by field

Submit by **14:00 CET** (hard deadline 14:30). One project, tracks: **API3** + **Cardano**.
Long versions: `docs/DEVFOLIO.md` (API3) and `docs/DEVFOLIO-cardano.md` (Cardano). Check every link after the repo is public.

---

## Project name
AeroGuard

## Tagline (short)
Your flight is late, you're already paid — and nobody can fake it. Flight-delay cover settled by AirnodeHub-signed data, paid for by AI agents on Cardano.

## Tracks
- API3 — Any API in your contract
- Cardano

## The problem it solves
Flight delays are common and compensation is slow: forms, evidence, weeks of waiting, often a 25–35 % claims-agency fee. Parametric cover removes the claim — if trustworthy data says the flight landed late, money moves. Two things usually break it:

1. **Can the contract trust the data?** If anyone can say "my flight was 4 h late", the pool is drained.
2. **Who presses the button?** If the insurer triggers payouts, the claim process is back.

And a new one: AI agents are starting to move money on API answers they cannot verify. A flight API sells monthly keys and returns plain JSON — an autonomous agent can't sign up, and can't prove the answer to anyone.

AeroGuard answers all three: the contract pays **only** on data signed by the AeroDataBox Airnode on API3 AirnodeHub, an unprivileged keeper settles every policy with no human, and agents buy the same signed answer per request on Cardano over x402.

## What we built
**API3 track — FlightDelayCover on Base Sepolia** (`0x2570…0a80`, source verified)
- **Signed data at both ends.** Cover is bought only with a fresh signed *pre-departure* status (no insuring a flight that is already late); it is settled only with a signed *Arrived* or *Canceled*. The scheduled arrival is read from the signature, not from the buyer.
- **The contract derives the AirnodeHub request hash itself** from the policy's flight and date: a genuine response about another flight or day is rejected (`WrongRequest`).
- **Autonomous keeper**: pays AirnodeHub 0.05 aUSD per signed response over x402, decides when a lookup is worth it, simulates, settles. Anyone can call `settle`; the payout always goes to the stored holder.
- **Live**: 11 real policies on real flights from Munich. Policies #1–#4 (30 Oct) were settled by the keeper on their signed `Arrived` (all landed early or < 2 h late → no payout, premium stays in the pool). Policies #5–#11 (31 Oct) settle during judging day.
- **Attack it yourself**: forged value → `NotSignedByAirnode`, other flight → `WrongRequest`, attacker key → `NotSignedByAirnode`, old response → `Stale` — run against the deployed contract from the browser.
- **86 Foundry tests** (98.8 % line coverage), incl. every live policy re-bought and re-settled on its real Airnode signatures read back from calldata.

**Cardano track — agents pay per request for verifiable flight truth**
- `GET /verdict?flight=…` answers **HTTP 402** on Cardano preprod (`@x402/cardano` exact scheme). The agent's wallet signs, the facilitator verifies and submits, the agent gets the verdict **plus the Airnode-signed response** — the same bytes FlightDelayCover accepts.
- **Paid on preprod**: tx `e2ef922b…` (2 tADA for the final IB1314 verdict). 53 TypeScript tests + 44 Aiken tests.
- **Aiken (Plutus V3) flight cover** verifies the same AirnodeHub signature on Cardano (no `ecrecover` in Plutus: rebuilds the signed bytes, `verifyEcdsaSecp256k1Signature` + `keccak_256`). 44 Aiken tests on real signatures — the escrow pays only on a signed final result (built and tested; live run on preprod: see cardano/COVER-EVIDENCE.md once pushed). The verdict an agent buys over x402 is exactly the redeemer that settles the cover.
- **An agent hires an agent**: our budgeted claims agent hires the verdict agent over x402 and pays only for a final proof whose signature checks; no evidence → free 404. An **MCP tool** lets any LLM agent (e.g. Claude Desktop) do the same.
- `GET /policy` sells a real Base Sepolia policy for tADA; the policy stores `keccak256("cardano:<payment tx>")` in `cardanoJobRef`, so the chains point to each other (tested offline, 11 tests).

## Challenges we ran into
- **Plutus has no `ecrecover`.** Verifying an EVM-style Airnode signature on Cardano meant rebuilding the exact signed bytes and checking against the Airnode's compressed public key.
- **Request-hash derivation on-chain.** Matching AirnodeHub's `keccak256(JSON.stringify([operation, sortedParams, sortedProjection]))` byte for byte in Solidity — proven against a real capture.
- **Adverse selection.** Without a signed pre-departure proof at purchase, anyone could insure a flight already known to be late. We made the proof mandatory and read the schedule from it.
- **Shared AeroDataBox quota.** One signed response settles every policy on a flight; responses are cached and published; CI runs only on captured fixtures.
- **GitHub's scheduler never fired for a new workflow** on Friday — passes were started manually; same code, and `settle` gives the caller no power.

## Technologies used
Solidity · Foundry · Base Sepolia · API3 AirnodeHub (AeroDataBox Airnode) · x402 (aUSD on Base, tADA on Cardano) · TypeScript · viem · Node.js · GitHub Actions · Cardano preprod · Aiken / Plutus V3 · Blockfrost · Evolution SDK · @x402/cardano · MCP · HTML/JS (no framework)

## Links
- GitHub: https://github.com/womp-maindev/aeroguard
- Live dashboard (after public + Pages run): https://womp-maindev.github.io/aeroguard/
- Contract: https://sepolia.basescan.org/address/0x257054204c4Cd43846C4553eBe6D709841980a80
- First keeper settlement: https://sepolia.basescan.org/tx/0xf0aa5db2e08a9b9aa7298c92853642b39d7ff330fe3e42cd8b441aa136246b44
- Cardano x402 payment: https://preprod.cardanoscan.io/transaction/e2ef922be71ba61da9431f1a5f56f4c56f5d61348c4945194cf390dd0acd7864
- Evidence (every policy, proof, receipt): https://github.com/womp-maindev/aeroguard/blob/main/docs/EVIDENCE.md
- Demo video (1:47, both tracks — the submission video): https://womp-maindev.github.io/aeroguard/media/demo.mp4  (or YouTube link)
- Pitch view for the projector: https://womp-maindev.github.io/aeroguard/?pitch=1
- Try to cheat the contract: https://womp-maindev.github.io/aeroguard/#lab

## Cover image / screenshots
Cover: `docs/img/devfolio-cover.png` (1200×630, both tracks). Screenshots: `docs/img/dashboard-hero.png`, `policies-live.png`, `tamper-lab.png`, `cardano-x402.png`, `inspector.png`, `try-to-cheat-mobile.png`.

---

# Extra judge Q&A (not yet in docs/PITCH.md)

**"Flight-delay insurance on-chain has been done (Etherisc 2017, AXA fizzy)."**
Yes — and both depended on an oracle relay or a company you had to trust, and neither stopped someone insuring a flight already known to be late. We verify the data provider's own signature in the contract, require a signed pre-departure proof at purchase, let anyone settle without power, and the same proof works on EVM and on Cardano, bought per request by agents.

**"No payouts happened."**
Every Friday flight landed early or < 2 h late, so the contract correctly paid 0 — and you can verify each decision against the signed `Arrived`. The payout path is covered by tests on signed data, and Saturday policies settle live during judging.

**"How does Cardano connect to the Base contract?"**
Not via a bridge. The link is the signed Airnode response: an agent buys it on Cardano over x402; the same bytes settle the Base contract and the Aiken contract. And `GET /policy` sells a Base policy for tADA, writing the Cardano payment hash into `cardanoJobRef`.
