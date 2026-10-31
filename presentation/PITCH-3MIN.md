# AeroGuard — 3-minute pitches (spoken text)

~150 words/min → each speech ≈ 440 words ≈ 3:00. Bold = what's on screen / what you click. Speak slowly; pauses are fine.

---

# API3 track — 3:00

**[0:00 · `?pitch=1` on the projector]**
Since yesterday we have insured eleven real flights. All eleven have landed. Nobody filed a claim. Nobody pressed a button. Our contract settled every one of them by itself — on flight data signed by the AeroDataBox Airnode on API3 AirnodeHub. Your flight is late? You're already paid. And nobody can fake it.

**[0:20 · slide Problem]**
Here's why this matters. One in six European flights is delayed. Under EU261 you can get up to six hundred euros — but only after a claim, only from three hours, and claim agencies keep around a third of the payout. Most eligible passengers never claim at all. Parametric insurance fixes this: if trusted data says the flight was late, the money moves. But it has always failed on three questions. Can the contract trust the data? Who presses "pay"? And how do you stop people insuring a flight that is already late?

**[0:55 · slide Solution]**
AeroGuard answers all three with signatures. To buy cover, you must attach a fresh, signed status from the Airnode — under fifteen minutes old, and still before departure. The contract reads the scheduled arrival from that signature, not from you. So nobody can insure a flight that is already late.
To settle, the contract only accepts a signed "Arrived" or "Cancelled". It checks four things on-chain: the right signer, the right request — it rebuilds the AirnodeHub request hash itself from the flight and the date — the data is fresh, and the flight is final. Three hours late or cancelled pays a hundred percent, two hours pays half.

**[1:35 · slide Architecture]**
Who presses pay? Nobody special. Our keeper is an autonomous agent: after landing it pays five cents over x402 for the signed answer, simulates the settlement and sends it. It has no special power — anyone could run it, and the money always goes to the policyholder.

**[1:55 · `?pitch=1` → press Try to steal from this contract]**
Now, don't trust us. Try to steal. I'll attack the live contract on Base Sepolia right now. An edited value: not signed by the Airnode. A real answer for another flight: wrong request. An attacker's key: rejected. A genuine but old answer: stale. Four out of four blocked — by the real bytecode, live. You can scan this QR code and try it on your own phone.

**[2:30 · slide Edge cases / evidence]**
This isn't a mock-up. Eleven real policies on real flights. All eleven already settled by the keeper. A hundred contract tests, including the full lifecycle of our live policies replayed on their real Airnode signatures. And because one signed answer settles every policy on the same flight, the data costs about seven cents per policy.

**[2:50 · closing]**
One contract shape, any event an Airnode can sign. No signature — no money moves. Thank you.

---

# Cardano track — 3:00

**[0:00 · slide Cardano "The agent pays only for a result a contract can check"]**
AI agents are about to move real money based on API answers they can't verify. A JSON response is just someone's claim. AeroGuard sells agents something better: flight outcomes signed at the source, paid per request on Cardano — answers a smart contract can actually check.

**[0:20 · customer & job]**
Our customer is a claims or travel agent with a budget. Its job is simple and valuable: prove whether a flight was late, then pay out — an EU261 claim, a travel-insurance payout, a corporate refund. Today that agent can't even sign up: flight APIs sell monthly plans with API keys. And even if it could, the answer can't move money in a contract.

**[0:50 · agent hires agent]**
So our claims agent hires our verdict agent. It asks for a flight. The server answers HTTP 402: pay two test ADA. No account, no API key. The agent's wallet signs a Cardano transaction, the facilitator checks the amount and submits it, and the agent receives the verdict plus the AeroDataBox Airnode's signature. It pays only for a final proof whose signature checks. If we have no evidence for a flight, the answer is a free 404 — you never pay for work we can't prove.

**[1:25 · demo — Claude Desktop MCP, or terminal `npm run buy`, or video]**
Here it is live. The agent asks about IB1314. Four-oh-two, two tADA. The wallet signs. One block later: arrived, twenty-five minutes early, signed by the Airnode — and here is the payment on Cardanoscan, preprod. Through our MCP tool, any LLM agent, like Claude, can do this in one call.

**[1:55 · slide Aiken escrow]**
Why Cardano, and not just a payment rail? Because payment is tied to the result on Cardano itself. Our Aiken escrow holds the cover and releases it only on a signed final outcome. Plutus has no ecrecover, so we rebuild the signed bytes and verify the Airnode's secp256k1 signature with Plutus builtins. Forty-four Aiken tests run on real signatures — and the exact bytes the agent buys over x402 are the redeemer that settles the escrow.

**[2:30 · two chains]**
And it's portable. Last night four flights landed. The same signed answers closed our policies on Base and settle the Aiken cover on Cardano exactly the same way. No bridge, no oracle relay — one signature, the same verdict, two chains.

**[2:40 · beyond the hackathon]**
The business is simple. A final arrival never changes, so we buy each signed answer once and resell it to every agent that needs it — the margin grows with every sale. Our first customers are EU261 claim firms, travel insurers and corporate travel tools, and agent marketplaces where agents hire other agents. Next: mainnet, prices in ADA or stablecoins, and the escrow as a pool of covers per insurer.

**[2:55 · closing]**
Agents should pay only for truth a contract can check. On Cardano, now they can. Thank you.

---

## Timing tips
- Rehearse each once with a timer. If you're over 3:00, drop the "two chains" block (Cardano) or the cost sentence (API3).
- If the live demo stalls >10 s: "here's the recorded run" → play the video at that scene.
