# Speaker notes for the slides

About 2½ minutes at a calm pace. In the deck (`index.html`), press **N** to show the English notes under the slide.
Say **EN** out loud; **RU** is the translation for you.

## 1 · Title
**EN:** Hi, we're AeroGuard. This is the Cardano part of our project. In one line: AI agents pay per request on Cardano for flight outcomes, and the answer is a signed proof that any smart contract can check — not just a JSON you have to trust.
**RU:** Привет, мы AeroGuard. Это Cardano-часть нашего проекта. Одной фразой: ИИ-агенты платят в Cardano за каждый запрос о результате рейса, а ответ — подписанное доказательство, которое может проверить любой смарт-контракт, а не JSON, которому приходится верить на слово.

## 2 · The problem
**EN:** Flight data is sold as monthly plans with API keys — an autonomous agent can't sign up, and a one-off check costs a subscription. And even with the data, it's just JSON: a contract can't move money on it, because anybody could fake "4 hours late".
**RU:** Данные о рейсах продают по месячной подписке с API-ключами: автономный агент не может зарегистрироваться, а за разовую проверку приходится платить целую подписку. И даже если данные есть, это просто JSON: контракт не может платить по нему деньги, ведь кто угодно может подделать «опоздал на 4 часа».

## 3 · How it works
**EN:** The agent asks our endpoint. It answers HTTP 402: pay two tADA. The agent's wallet signs a Cardano transaction — it never broadcasts it — and retries. The facilitator checks it and puts it on Cardano. The agent gets the verdict plus the AeroDataBox Airnode's signature, and any contract can verify that signature.
**RU:** Агент обращается к нашему серверу. Тот отвечает HTTP 402: заплати два tADA. Кошелёк агента подписывает транзакцию Cardano (сам её не отправляет) и повторяет запрос. Facilitator проверяет её и отправляет в Cardano. Агент получает вердикт плюс подпись Airnode AeroDataBox, и эту подпись может проверить любой контракт.

## 4 · A real paid request (video + QR)
**EN:** This is a real run on Cardano preprod, last night. Preflight checks keys and balance. The server offers: pay two tADA. The wallet signs, the transaction lands in a block after 44 seconds — sped up here — and we get the verdict for IB1314: arrived, signed by the Airnode. The QR code opens the transaction on Cardanoscan.
**RU:** Это реальный запуск в Cardano preprod, вчера вечером. Preflight проверяет ключи и баланс. Сервер предлагает: заплати два tADA. Кошелёк подписывает, транзакция попадает в блок через 44 секунды (здесь ускорено), и мы получаем вердикт по IB1314: прилетел, подписано Airnode. QR-код открывает транзакцию на Cardanoscan.

## 5 · What the agent gets (video)
**EN:** What the agent gets back: the verdict — arrived 21:00, 25 minutes early, so no payout; the proof — the Airnode address, the request hash and the signature; and the receipt — the Cardano payment that bought it. These evidence fields go unchanged into a contract.
**RU:** Что получает агент: вердикт — прилетел в 21:00, на 25 минут раньше, значит без выплаты; доказательство — адрес Airnode, хэш запроса и подпись; и чек — платёж в Cardano, которым это куплено. Эти поля доказательства без изменений передаются в контракт.

## 6 · The Aiken contract (video)
**EN:** And it's verified on Cardano itself. Our Aiken contract is a flight-cover UTxO. Plutus has no ecrecover, so we rebuild the exact signed bytes and use the secp256k1 builtin. So it's an escrow: the money moves only on a signed result. Edited data, another signer, a stale answer — all fail. 44 tests pass, including the real landings of our first four policies (30 Oct).
**RU:** И это проверяется прямо в Cardano. Наш контракт на Aiken — UTxO со страховым полисом. В Plutus нет ecrecover, поэтому мы заново собираем подписанные байты и используем встроенную проверку secp256k1. Это escrow: деньги двигаются только по подписанному результату. Изменённые данные, чужой подписант, устаревший ответ — всё отклоняется. Проходят 44 теста, включая реальные посадки наших первых четырёх полисов (30 октября).

## 7 · The same verdict on two blockchains
**EN:** Last night our first four policies landed. The keeper bought the signed answers and settled them on Base — none was late enough, so no payout. We took the very same signatures to Cardano: the Aiken contract reaches exactly the same verdict and refuses to pay the holder. One signed answer, the same result on two chains.
**RU:** Вчера вечером приземлились рейсы наших первых четырёх полисов. Keeper купил подписанные ответы и закрыл полисы на Base: ни один рейс не опоздал достаточно, выплаты нет. Мы взяли те же самые подписи в Cardano: контракт на Aiken приходит к тому же вердикту и отказывается платить держателю. Один подписанный ответ, один результат на двух блокчейнах.

## 8 · Paying for cover in tADA
**EN:** Cardano can also pay for the cover itself. An agent pays the premium in tADA, priced from the contract's own quote. Only after the Cardano payment is final, the server buys the policy on Base and writes the Cardano transaction into it. No settled payment, no policy. If the purchase fails, it's recorded as a refund. This part is tested offline.
**RU:** Cardano может оплатить и саму страховку. Агент платит премию в tADA, цена берётся из котировки самого контракта. Только когда платёж в Cardano окончательный, сервер покупает полис на Base и записывает в него транзакцию Cardano. Нет подтверждённой оплаты — нет полиса. Если покупка сорвалась, это записывается как возврат. Эта часть проверена тестами без живого запуска.

## 9 · Business case
**EN:** This is an agent hiring an agent: the claims agent pays our verdict agent only for a final proof whose signature checks, and an unknown flight is a free 404. Who pays? Claims agents for EU261 delay compensation, travel insurers, corporate travel tools, and agent marketplaces like Masumi. They pay per answer, only for the flights they need. A final arrival never changes, so we buy the signed lookup once, and every later sale is margin.
**RU:** Это агент, который нанимает агента: claims-агент платит нашему verdict-агенту только за финальное доказательство с проверенной подписью, а неизвестный рейс — бесплатный 404. Кто платит? Агенты по компенсациям за задержки (EU261), туристические страховщики, корпоративные тревел-сервисы и маркетплейсы агентов вроде Masumi. Платят за ответ, только по нужным рейсам. Финальный результат рейса не меняется, поэтому подписанный ответ мы покупаем один раз, а каждая следующая продажа — чистая маржа.

## 10 · Next steps · thank you
**EN:** Next: mainnet with ADA or USDM, a hosted facilitator, listing as a Masumi agent, and deploying the Aiken cover with a pool of policies. Thank you — the QR code goes to the code; everything you saw is in the repository, including the tests.
**RU:** Дальше: mainnet с ADA или USDM, внешний facilitator, листинг как агент в Masumi и развёртывание контракта на Aiken с пулом полисов. Спасибо! QR-код ведёт на код: всё, что вы видели, есть в репозитории, включая тесты.
