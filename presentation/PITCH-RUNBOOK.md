# AeroGuard — stage runbook (15:00)

🎤 **Full 3-min speech: [`PITCH-3MIN.md`](PITCH-3MIN.md)** (this page is the 2-min version and the stage checklist).

Говоришь по-английски (текст ниже), русский — подсказка, что имеешь в виду. Каждый блок ≈ 20–30 с.

## До выхода (14:30–14:55)
- [ ] Ноутбук: открыты вкладки — **1)** `womp-maindev.github.io/aeroguard/?pitch=1` **2)** главная сайта на `#lab` **3)** дека API3 (Lovable/PDF, со слайдом Cardano) **4)** `presentation/cardano/index.html` **5)** Basescan tx `0xf0aa5db2…` **6)** Cardanoscan tx `e2ef922b…`
- [ ] Проверить Wi-Fi площадки: в шапке сайта **«Live · Base Sepolia»**. Если «Chain unreachable» → раздать интернет с телефона (сайт и так покажет снимок, но живое лучше).
- [ ] Видео `web/media/demo.mp4` скачано локально — запасной вариант, если всё упадёт.
- [ ] (опц.) Claude Desktop с MCP по `presentation/cardano/DEMO.md` — или терминал в `~/aeroguard-run/cardano` с готовой командой `npm run buy`.

---

## Версия для API3-судей (2 мин)

**0:00 — Хук** *(экран: `?pitch=1`)*
> "Last night we insured real flights from Munich. Nobody filed a claim. The contract settled every one of them itself — on data signed by the AeroDataBox Airnode on API3. Your flight is late, you're already paid. And nobody can fake it."
*(Вчера застраховали настоящие рейсы, никто не подавал заявку, контракт закрыл всё сам по подписи.)*

**0:20 — Проблема** *(слайд Problem)*
> "One in six European flights is delayed. Claims take weeks, agencies keep a third. Parametric cover fixes that — if two questions are answered: can the contract trust the data, and who presses pay?"

**0:40 — Как работает** *(слайд Solution / Architecture)*
> "Buy only with a fresh signed pre-departure status — so nobody insures a flight that's already late. Settle only on a signed Arrived or Cancelled. The contract rebuilds the AirnodeHub request hash itself, checks the signer, freshness and finality. Our keeper pays five cents over x402 for the answer and settles — no special power, anyone can do it."

**1:10 — ДЕМО «Взломайте нас»** *(вкладка `?pitch=1` → кнопка **Try to steal from this contract**)*
> "Don't trust us — try to steal. Edited value: not signed by the Airnode. Another flight: wrong request. Attacker key: rejected. Old answer: stale. Four out of four blocked, by the real bytecode on Base Sepolia. Scan the QR and try it on your phone."

**1:40 — Доказательства и финал**
> "Eleven real policies, eight already settled by the keeper, 94 contract tests replaying the live policies on their real signatures. No signature — no money moves."

---

## Версия для Cardano-судей (2 мин)

**0:00 — Хук** *(экран: слайд Cardano «The agent pays only for a result a contract can check»)*
> "AI agents are about to move money on API answers they can't verify. AeroGuard sells them answers they can: flight outcomes signed at the source, paid per request on Cardano."

**0:20 — Клиент и работа агента**
> "Our customer is a claims or travel agent with a budget. Its job: prove whether a flight was late, then pay out. It hires our verdict agent over x402 — no account, no API key — and pays only for a final proof whose signature checks. No evidence? Free 404."

**0:45 — ДЕМО оплаты** *(Claude Desktop MCP **или** терминал `npm run buy` **или** видео `presentation/cardano`, сцена qualify)*
> "Here the agent asks for IB1314. The server answers 402: pay two test ADA. The wallet signs a Cardano transaction, the facilitator submits it — and the agent gets the verdict plus the Airnode's signature. Here is the transaction on Cardanoscan."

**1:15 — Почему Cardano** *(слайд Aiken / escrow)*
> "Payment is tied to the result. Our Aiken escrow verifies the same AirnodeHub signature on Cardano — Plutus has no ecrecover, so we rebuild the signed bytes and use the secp256k1 builtin. 44 Aiken tests on real signatures. The exact bytes the agent buys are the redeemer that settles the cover."

**1:45 — Финал**
> "One signed answer, the same verdict on two chains. Agents pay only for truth a contract can check."

---

## Если спросят (коротко)
| Вопрос | Ответ |
|---|---|
| Etherisc / AXA fizzy уже были | "They trusted a relay or a company and didn't stop buying already-late flights. We verify the provider's own signature on-chain, require a signed pre-departure proof, and anyone can settle." |
| Выплат же не было | "Every flight landed early or under two hours late, so 0 is the correct, verifiable result. The payout path is covered by tests on signed data; today's policies settle during judging." |
| Почему доверять AeroDataBox | "The signature proves what AeroDataBox said, not the world. We pay only on final status, signed after landing, fresh. Next: a second Airnode, 2-of-2." |
| Кто жмёт settle | "Anyone. No discretion: payout computed from signed fields, always to the stored holder, once." |
| Связь Base ↔ Cardano | "No bridge. The signed response is portable: bought on Cardano, it settles both contracts. GET /policy also sells a Base policy for tADA and stores the Cardano tx hash in it." |
| Почему x402 | "Agents pay per call without accounts or keys — exactly what a keeper or claims agent needs." |

## Если что-то упало
| Что | Делаешь |
|---|---|
| Нет сети | Сайт сам покажет снимок данных; говоришь "live data from the keeper's last run". Или видео. |
| Try to steal не отвечает | Видео tamper (`web/media/demo.mp4`, 0:34–0:56) |
| Claude Desktop/MCP не поднялся | `npm run buy` в терминале → если и это нет, видео Cardano, сцена qualify |
| Забыл текст | Слайд + одна фраза: **"No signature, no money moves."** |
