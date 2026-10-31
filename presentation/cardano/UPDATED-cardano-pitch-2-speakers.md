# AeroGuard × Cardano — 3-minute pitch for two speakers

**A = Mihail** · **B = Eskender**. ≈ 440 words ≈ 3:00. **[Bold brackets]** = slide or action. Hand-offs are marked →.

---

**[Slide 1 · Problem]**

**A:** A flight lands three hours late. Somewhere, an AI agent has to decide: rebook, reimburse, or pay out. It needs one fact — did this flight land late? And today it can't get that fact safely.

**B:** Flight-data APIs sell monthly plans behind API keys. An agent can't sign up. And even if it could, the answer is plain JSON. Anyone in between could change it, so it can't move money in a contract.

**A:** Meanwhile one in six European flights is delayed. EU261 pays up to six hundred euros, but only after a claim, and claim agencies keep about a third. Most people never claim. → 

**[Slide 2 · Solution]**

**B:** So we built a verdict service that agents pay per request on Cardano. The agent asks about a flight. The server answers 402: pay two test ADA. No account, no key. The wallet signs, our facilitator submits, and the agent gets the verdict plus the AeroDataBox Airnode's signature.

**A:** And it pays only for verified work. If we have no evidence for a flight, it's a free 404. Replay a payment, you get the same answer, never charged twice. Our claims agent hires our verdict agent and pays only for final proofs whose signature checks. →

**[Demo: Cardanoscan tx e2ef922b… or `npm run buy` or video scene]**

**B:** Here's the real payment on Cardano preprod: two tADA for the final verdict on IB1314 — arrived, twenty-five minutes early, signed by the Airnode.

**[Slide 3 · Architecture / escrow]**

**A:** Why Cardano, not just a payment rail? Because payment is tied to the result on Cardano itself. Our Aiken escrow holds the cover and releases it only on a signed final outcome.

**B:** Plutus has no ecrecover. So we rebuild the exact signed bytes and verify the Airnode's secp256k1 signature with Plutus builtins. Forty-four Aiken tests run on real signatures and forgeries. And the bytes the agent buys over x402 are exactly the redeemer that settles the escrow. →

**A:** One signature, two chains. Last night four flights landed. The same signed answers closed our policies on Base and settle the Aiken cover on Cardano exactly the same way. No bridge. No relayer.

**[Slide 4 · Business]**

**B:** The business compounds. A final arrival never changes, so we buy each signed answer once — about five cents — and resell it to every agent that asks. Our customers: EU261 claim firms, travel insurers, corporate travel tools, and agent marketplaces like Masumi.

**[Slide 5 · Limits & next]**

**A:** We're honest about limits. The escrow is built and tested on real signatures, but not yet deployed live. Next: deploy it, automatic refunds, list on Masumi, a second data source, then mainnet.

**[Slide 6 · Close]**

**B:** Agents should pay only for truth a contract can check.

**A:** On Cardano, now they can. Thank you.

---

## Q&A split
- **Technical (Aiken, signatures, x402):** Eskender.
- **Business, customers, why Cardano, limits:** Mihail.
- If a question goes long: "Great question — here's the evidence," and open `docs/DEVFOLIO-cardano.md` or the site's `#cardano` section.
