# Speaker notes — AeroGuard × Cardano

About 2½ minutes at a calm pace. In the deck, press **N** to show these notes under the slide.

## 1. AeroGuard · Cardano track — Agents pay per request for flight outcomes any contract can verify

Hi, we're AeroGuard. This is the Cardano part of our project.
In one line: AI agents pay per request on Cardano for flight outcomes, and the answer is a signed proof that any smart contract can check — not just a JSON you have to trust.

## 2. The problem — Flight data can't move money

The problem. Flight data is sold as monthly plans with API keys — an autonomous agent can't sign up, and a one-off check costs a subscription.
And even if you get the data, it's just JSON: a contract can't move money on it, because anybody could fake '4 hours late'.
Insurers and claim services all rebuild the same trusted back office.

## 3. How it works — 402 → pay on Cardano → signed answer

How it works, left to right.
The agent asks our endpoint. It answers HTTP 402: pay two tADA.
The agent's wallet signs a Cardano transaction — it never broadcasts it — and retries.
The facilitator checks amount, recipient and validity window and puts it on Cardano.
The agent gets the verdict plus the AeroDataBox Airnode's signature. That signature is the point: any contract can verify it — our Aiken contract on Cardano, our FlightDelayCover on Base.

## 4. Live proof · Cardano preprod — A real paid request

This is a real run on Cardano preprod, last night at 23:16 UTC.
Preflight checks keys and balance. The server offers: pay two tADA. The wallet signs, the transaction lands in a block after 44 seconds — sped up here — and we get the verdict for IB1314: arrived, signed by the AeroDataBox Airnode.
The QR code opens the transaction on Cardanoscan.

## 5. What the agent gets — Verdict + proof + receipt

What the agent gets back: the verdict — arrived 21:00, 25 minutes early, so no payout —
then the proof: the Airnode address, the request hash and the signature,
and the receipt: the Cardano payment that bought it.
These five evidence fields go unchanged into a contract.

## 6. Verified on Cardano — An Aiken contract checks the Airnode signature

And it's verified on Cardano itself. Our Aiken contract is a flight-cover UTxO.
Plutus has no ecrecover, so we rebuild the exact signed bytes and use the secp256k1 builtin.
Edited data, another signer, a stale answer — all fail. 44 tests pass, including the real landings of our four live policies.

## 7. Real landings · 30 Oct 2026 — One signed answer, the same verdict on two chains

This is my favourite slide. Last night our four live policies landed.
The keeper bought the signed answers and settled them on Base — none was late enough, so no payout.
We took the very same signatures to Cardano: the Aiken contract reaches exactly the same verdict, and refuses to pay the holder.
One signed answer, the same result on two chains.

## 8. Cross-chain — Pay the premium in tADA, get cover on Base

Cardano can also pay for the cover itself. An agent pays the premium in tADA, priced from the contract's own quote.
Only after the Cardano payment is final, the server buys the policy on Base and writes the Cardano transaction into the policy, so both chains point to each other.
No settled payment, no policy. If the purchase fails, it's recorded as a refund. This part is tested offline.

## 9. Business case — Pay per answer, sell the same proof many times

Who pays for this? Claims agents for EU261 delay compensation, travel insurers, corporate travel tools, and agent marketplaces like Masumi.
They pay per answer, only for the flights they need. A final arrival never changes, so we buy the signed lookup once and every later sale is margin.

## 10. Next · Thank you — Agents pay per request on Cardano for flight outcomes any contract can verify.

Next: mainnet with ADA or USDM, a hosted facilitator, listing as a Masumi agent, and deploying the Aiken cover with a pool of policies.
Thank you — the QR code goes to the code; everything you saw is in the repository, including the tests.
