# Video script: what to say over the Cardano video

**The video:** [`AeroGuard-Cardano-video.mp4`](AeroGuard-Cardano-video.mp4) in this folder (same as `web/media/cardano.mp4`). It runs 2:04, 1080p, voiced with these EN lines. The block timecodes below are from the earlier 1:57 cut: in the 2:04 cut a 6 s clip of the live site follows the title, so add 6.5 s to every later block. Exact times: [`voiceover/lines.tsv`](voiceover/lines.tsv).
Separate clips for editing are in [`../../cardano/video/`](../../cardano/video/), numbered 01–10.

**The voiced video in one command:** [`voiceover/make-voiced-video.sh`](voiceover/make-voiced-video.sh) builds
`aeroguard-cardano-full-voiced.mp4` with these EN lines placed on their timecodes:
```bash
cd presentation/cardano/voiceover && ELEVENLABS_API_KEY=sk_... sh make-voiced-video.sh
```
Without a key it uses the Mac's built-in voice (`say`). With your own recording: `sh make-voiced-video.sh my-voice.m4a`.
It needs ffmpeg (`brew install ffmpeg`).

**How to record:** play the video and read the **EN** line for each block in time with the picture. That is about
2.5 words per second, a calm pace. **RU** is the translation, so you know what you are saying. Everything on screen
is real: our paid run on preprod, the server's response, the Aiken tests and the live landings.

---

### 0:00–0:06 · Clip 01 — title
**On screen:** "Agents pay per request for flight outcomes".
**EN:** "AeroGuard on Cardano: agents pay per request for flight outcomes any contract can verify."
**RU:** «AeroGuard на Cardano: агенты платят за каждый запрос о результате рейса, который может проверить любой контракт».

### 0:06–0:20 · Clip 02 — architecture (steps light up)
**On screen:** the diagram; a frame moves agent → server → Cardano → evidence → contracts.
**EN:** "The agent asks our server. It answers 402: pay in tADA. The wallet signs a Cardano transaction, the facilitator puts it on chain, and the agent gets the verdict plus the Airnode's signature, which any contract can check."
**RU:** «Агент спрашивает наш сервер. Тот отвечает 402: заплати в tADA. Кошелёк подписывает транзакцию Cardano, facilitator отправляет её в сеть, и агент получает вердикт плюс подпись Airnode, которую может проверить любой контракт».

### 0:20–0:46 · Clip 03 — our real `npm run qualify`
**On screen:** preflight checks, `402 → pay 2 tADA`, signing, the wait for the block, `4/4 done`, the tx and the link.
**EN:** "This is a real run on Cardano preprod. Preflight checks the keys and the balance. The server asks for two tADA. The wallet signs, but never broadcasts — the facilitator does. After one block, about forty seconds, sped up here, we get the verdict for flight IB1314: arrived, signed by the AeroDataBox Airnode. And the transaction hash is our receipt."
**RU:** «Это реальный запуск в Cardano preprod. Preflight проверяет ключи и баланс. Сервер просит два tADA. Кошелёк подписывает, но сам не отправляет: это делает facilitator. Через один блок, около сорока секунд (здесь ускорено), мы получаем вердикт по рейсу IB1314: прилетел, подписано Airnode AeroDataBox. Хэш транзакции — наш чек».

### 0:46–0:57 · Clip 04 — the server's response (JSON)
**On screen:** the verdict is highlighted, then the signature, then the payment.
**EN:** "What the agent gets back: the verdict — landed twenty-five minutes early. The proof — the Airnode's signature over exactly this data. And the receipt — the Cardano payment that bought it."
**RU:** «Что получает агент: вердикт — сел на 25 минут раньше. Доказательство — подпись Airnode именно над этими данными. И чек — платёж в Cardano, которым это куплено».

### 0:57–1:04 · Clip 05 — transaction card
**On screen:** "2 tADA → one verdict", the hash, from/to.
**EN:** "Two tADA for one verdict. No account, no API key. You can check it on Cardanoscan."
**RU:** «Два tADA за один вердикт. Без аккаунта, без API-ключа. Проверить можно на Cardanoscan».

### 1:04–1:16 · Clip 06 — our dashboard
**On screen:** the Cardano panel: ASK → PAY → VERDICT for the same run.
**EN:** "Our dashboard shows the same exchange in three steps: the 402 offer, the payment, and the signed verdict."
**RU:** «Наш дашборд показывает тот же обмен в три шага: 402-оффер, оплату и подписанный вердикт».

### 1:16–1:31 · Clip 07 — `aiken check`, 44 of 44
**On screen:** green PASS lines, four blocks marked "real Airnode landing".
**EN:** "And it's not just JSON. Our Aiken escrow on Cardano checks the same Airnode signature with Plutus builtins, so the cover pays only on a signed result. Forged data fails, real landings pass — forty-four tests out of forty-four."
**RU:** «И это не просто JSON. Наш escrow на Aiken в Cardano проверяет ту же подпись Airnode встроенными функциями Plutus, поэтому покрытие платится только по подписанному результату. Подделки отклоняются, реальные посадки проходят — 44 теста из 44».

### 1:31–1:42 · Clip 08 — the same verdict on two blockchains
**On screen:** a table of 4 policies: Base `ClosedNoPayout`, Cardano "no payout".
**EN:** "Last night our first four policies landed. The same signed answers closed them on Base — and settle the Cardano contract exactly the same way. One signature, one verdict, two chains."
**RU:** «Вчера вечером приземлились рейсы наших первых четырёх полисов. Те же подписанные ответы закрыли их на Base и точно так же закрывают контракт на Cardano. Одна подпись, один вердикт, два блокчейна».

### 1:42–1:51 · Clip 09 — tADA buys a policy on Base
**On screen:** Cardano → after settlement → linked (cardanoJobRef).
**EN:** "Cardano can also pay for the insurance itself: the premium in tADA buys a policy on Base, and the policy records the Cardano payment."
**RU:** «Cardano может оплатить и саму страховку: премия в tADA покупает полис на Base, и полис хранит ссылку на платёж в Cardano».

### 1:51–1:57 · Clip 10 — closing
**On screen:** the closing line and the repository.
**EN:** "Agents pay per request on Cardano, for flight outcomes any contract can verify."
**RU:** «Агенты платят за каждый запрос в Cardano за результаты рейсов, которые может проверить любой контракт».

---

**Short version (~45 s):** clip 01 (3 s) → clip 03 from 0:07 to 0:22 → clip 05 → clip 07 from 0:08 → clip 08 → clip 10.
For it, use the EN lines from blocks 03, 05, 07, 08 and 10.

**If you want Cardanoscan in the video:** record 3–5 s yourself from this link (it was blocked from where we rendered
the clips):
https://preprod.cardanoscan.io/transaction/e2ef922be71ba61da9431f1a5f56f4c56f5d61348c4945194cf390dd0acd7864
