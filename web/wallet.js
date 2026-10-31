'use strict';
// aeroguard dashboard: real-transaction tamper lab. plain js, no build step.
// Loaded after index.html's main script. It reuses the lab's policies and forgeries (labPolicy, labBase, mutate) and
// sends each one to the deployed FlightDelayCover as a REAL settle() transaction from the judge's wallet, so the
// contract's rejection is on Basescan, not just in an eth_call. If the page's helpers are missing (renamed), the panel
// says so and stays out of the way.
(() => {
  const CHAIN_ID = 84532;
  const CHAIN_HEX = '0x14a34';
  const CHAIN = {
    chainId: CHAIN_HEX,
    chainName: 'Base Sepolia',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://sepolia.base.org'],
    blockExplorerUrls: ['https://sepolia.basescan.org'],
  };
  const EXPLORER = 'https://sepolia.basescan.org';
  // settle() uses ~160k gas. A fixed limit makes the wallet send a transaction that will revert, instead of refusing
  // at its gas estimate, so the revert is recorded on-chain.
  const GAS_LIMIT = '0x61a80'; // 400,000
  const SETTLE_SIG = 'settle(uint256,bytes32,uint256,bytes,bytes)';
  const ATTACKS = [
    { m: 'edit', t: 'Edited data' },
    { m: 'wrongreq', t: 'Wrong request' },
    { m: 'wrongsigner', t: 'Wrong signer' },
    { m: 'stale', t: 'Stale evidence' },
  ];

  // The main script's top-level bindings. Classic scripts share them, and typeof does not throw if one was renamed.
  const PAGE = {
    labPolicy: typeof labPolicy !== 'undefined' ? labPolicy : undefined,
    labBase: typeof labBase !== 'undefined' ? labBase : undefined,
    mutate: typeof mutate !== 'undefined' ? mutate : undefined,
    CONTRACT: typeof CONTRACT !== 'undefined' ? CONTRACT : undefined,
    selector: typeof selector !== 'undefined' ? selector : undefined,
    pad: typeof pad !== 'undefined' ? pad : undefined,
    hexN: typeof hexN !== 'undefined' ? hexN : undefined,
    encBytes: typeof encBytes !== 'undefined' ? encBytes : undefined,
    enc: typeof enc !== 'undefined' ? enc : undefined,
    fromHex: typeof fromHex !== 'undefined' ? fromHex : undefined,
    // optional: nicer revert text and a policy refresh
    decodeRevert: typeof decodeRevert !== 'undefined' ? decodeRevert : undefined,
    explain: typeof explain !== 'undefined' ? explain : undefined,
    titleOf: typeof titleOf !== 'undefined' ? titleOf : undefined,
    shortCode: typeof shortCode !== 'undefined' ? shortCode : undefined,
    allEvidence: typeof allEvidence !== 'undefined' ? allEvidence : undefined,
    refreshChain: typeof refreshChain !== 'undefined' ? refreshChain : undefined,
  };
  const OPTIONAL = ['decodeRevert', 'explain', 'titleOf', 'shortCode', 'allEvidence', 'refreshChain'];
  // CONTRACT is a let that the page reassigns when it finds a local keeper API, so it is read live.
  const g = (name) => (name === 'CONTRACT' && typeof CONTRACT !== 'undefined' ? CONTRACT : PAGE[name]);
  const missing = Object.keys(PAGE).filter((n) => !OPTIONAL.includes(n) && PAGE[n] === undefined);

  const W = { account: null, chainId: null, busy: false, results: {} };
  const eth = () => window.ethereum;
  const el = (id) => document.getElementById(id);
  const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
  const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // --------------------------------------------------------------------------------------------- calldata

  function settleCalldata(policyId, r) {
    const [selector, pad, hexN, encBytes, enc, fromHex] = ['selector', 'pad', 'hexN', 'encBytes', 'enc', 'fromHex'].map(g);
    if (!/^\d+$/.test(String(r.timestamp).trim())) throw new Error('timestamp is not a unix time');
    const dataEnc = encBytes(enc.encode(r.data));
    return (
      selector(SETTLE_SIG) + pad(hexN(policyId)) + pad(r.requestHash) + pad(hexN(String(r.timestamp).trim()))
      + pad(hexN(5 * 32)) + pad(hexN(5 * 32 + dataEnc.length / 2)) + dataEnc + encBytes(fromHex(r.signature))
    );
  }

  // ------------------------------------------------------------------------------------------------ wallet

  async function refreshWallet() {
    if (!eth()) return render();
    try {
      const [accounts, chainId] = await Promise.all([eth().request({ method: 'eth_accounts' }), eth().request({ method: 'eth_chainId' })]);
      W.account = accounts[0] ?? null;
      W.chainId = parseInt(chainId, 16);
    } catch {
      W.account = null;
    }
    await afterWalletChange();
  }

  async function connect() {
    if (!eth()) return render();
    try {
      const accounts = await eth().request({ method: 'eth_requestAccounts' });
      W.account = accounts[0] ?? null;
      W.chainId = parseInt(await eth().request({ method: 'eth_chainId' }), 16);
      if (W.chainId !== CHAIN_ID) await switchChain();
    } catch (e) {
      note(e.code === 4001 ? 'Connection rejected in the wallet.' : `Could not connect: ${e.message}`);
    }
    await afterWalletChange();
  }

  async function switchChain() {
    try {
      await eth().request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_HEX }] });
    } catch (e) {
      if (e.code === 4902) await eth().request({ method: 'wallet_addEthereumChain', params: [CHAIN] });
      else if (e.code === 4001) note('Network switch rejected. Switch to Base Sepolia to send transactions.');
      else throw e;
    }
    W.chainId = parseInt(await eth().request({ method: 'eth_chainId' }), 16);
    await afterWalletChange();
  }

  // ------------------------------------------------------------------------------------------ transactions

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitForReceipt(hash) {
    for (let i = 0; i < 90; i++) {
      const receipt = await eth().request({ method: 'eth_getTransactionReceipt', params: [hash] });
      if (receipt) return receipt;
      await sleep(2000);
    }
    throw new Error('no receipt after 3 minutes; check the transaction on Basescan');
  }

  // A mined revert has no reason in its receipt: replay the same call against the block it was mined in.
  async function revertReason(tx, blockNumber) {
    try {
      await eth().request({ method: 'eth_call', params: [tx, blockNumber] });
      return 'reverted (the replay at that block did not revert, so the state changed in between)';
    } catch (e) {
      const raw = e?.data?.data ?? e?.data ?? e?.error?.data;
      const decode = g('decodeRevert');
      if (typeof raw === 'string' && typeof decode === 'function') return decode(raw);
      return e?.message || 'reverted';
    }
  }

  // The lab's selected policy, or null after explaining in `box` why a real transaction would be pointless.
  function activePolicy(box) {
    const p = g('labPolicy')();
    if (!p) {
      result(box, 'sk', 'NO POLICY', 'Pick a target policy above first.');
      return null;
    }
    if (Number(p.status) !== 1) {
      result(box, 'sk', 'NOT ACTIVE', `Policy #${p.id} is ${p.statusName} on-chain, so a real transaction stops at NotActive before any oracle check. Pick an Active policy, or use the eth_call lab above, which can reopen it.`);
      return null;
    }
    return p;
  }

  async function send(mode) {
    const p = activePolicy(mode);
    if (!p) return;
    const base = g('labBase')(p);
    if ((mode === 'stale' || mode === 'valid') && !base.genuine && !el('tUseInsp')?.checked) {
      return result(mode, 'sk', 'SKIPPED', `This test needs a real signed response for ${p.flight}, and there is none yet.`);
    }
    if (mode === 'stale' && base.genuine && typeof g('allEvidence') === 'function') {
      // stale wants the oldest real response for this policy, like the eth_call lab
      const hs = [p.arrivalRequestHash, p.statusRequestHash].map((h) => String(h).toLowerCase());
      const old = g('allEvidence')().filter((x) => hs.includes(String(x.requestHash).toLowerCase())).sort((x, y) => Number(x.timestamp) - Number(y.timestamp))[0];
      if (old) base.r = old;
    }
    if (mode === 'stale' && Math.floor(Date.now() / 1000) - Number(base.r.timestamp) <= Number(p.maxAge)) {
      return result(mode, 'sk', 'SKIPPED', 'The base response is still fresh, so it cannot show Stale yet.');
    }
    if (mode === 'valid' && !confirm(`This sends the genuine response for real. If it is final, it settles policy #${p.id} for good and pays the holder; anyone may do this, but it cannot be undone. Send it?`)) {
      return result(mode, 'sk', 'CANCELLED', 'Not sent.');
    }
    const r = mode === 'valid' ? { ...base.r } : g('mutate')(mode, base, p);
    await submit(mode, p, r);
  }

  // same look as the eth_call lab: short title, one plain sentence, the raw revert small underneath
  const withExplanation = (reason) => {
    const explain = g('explain'), titleOf = g('titleOf'), shortCode = g('shortCode');
    const plain = typeof explain === 'function' ? explain(reason) : '';
    const title = typeof titleOf === 'function' ? `<b class="t">${escape(titleOf(reason))}</b>` : '';
    const code = typeof shortCode === 'function' ? shortCode(reason) : reason;
    return `${title}${plain ? `<span class="e">${escape(plain)}</span>` : ''}<code class="c" title="${escape(reason)}">${escape(code)}</code>`;
  };

  // Sends settle(policy, response) from the wallet and reports the on-chain outcome in `box`.
  async function submit(box, p, r) {
    let tx;
    try {
      tx = { from: W.account, to: g('CONTRACT'), data: settleCalldata(p.id, r), gas: GAS_LIMIT };
    } catch (e) {
      return result(box, 'no', 'NOT SENDABLE', escape(e.message));
    }
    if (lowGas()) {
      return result(box, 'sk', 'NO GAS', `<span class="e">This wallet has too little Base Sepolia ETH to pay for gas. Get ${faucetLink}, then send again.</span>`);
    }
    W.busy = true;
    render();
    try {
      result(box, '', 'CONFIRM IN WALLET', 'Your wallet may warn that this transaction will fail. For an attack, that is the point: send it anyway.');
      const hash = await eth().request({ method: 'eth_sendTransaction', params: [tx] });
      const link = `<a href="${EXPLORER}/tx/${hash}" target="_blank" rel="noopener">${short(hash)}</a>`;
      result(box, '', 'PENDING', `Sent ${link}. Waiting for Base Sepolia…`);
      const receipt = await waitForReceipt(hash);
      if (receipt.status === '0x1') {
        result(box, 'ok', 'CONFIRMED · ON-CHAIN', `<span class="e">settle() succeeded in ${link}. Policy state refreshed.</span>`);
      } else {
        const attack = box !== 'valid' && box !== 'own';
        result(box, attack ? 'blk' : 'no', attack ? '🛡 BLOCKED · ON-CHAIN' : 'REVERTED · ON-CHAIN', `${withExplanation(await revertReason(tx, receipt.blockNumber))}<span class="e">Transaction ${link}</span>`);
      }
      const refresh = g('refreshChain');
      if (typeof refresh === 'function') await refresh();
    } catch (e) {
      if (e.code === 4001) result(box, 'sk', 'REJECTED', 'You rejected the transaction in the wallet. Nothing was sent.');
      else result(box, 'no', 'ERROR', escape(e.message || String(e)));
    } finally {
      W.busy = false;
      await updateBalance();
      render();
    }
  }

  // ------------------------------------------------------------------------------------- your own response

  // Takes an AirnodeHub response ({requestHash, timestamp, data, signature}), a keeper fixture with the same fields,
  // or a proof that nests them under `response`. data must be the exact string that was signed.
  function parseOwn(text) {
    let o;
    try {
      o = JSON.parse(text);
    } catch {
      throw new Error('Not valid JSON.');
    }
    const r = o && typeof o === 'object' && o.response && typeof o.response === 'object' ? o.response : o;
    if (!r || typeof r !== 'object') throw new Error('Expected a JSON object.');
    const warnings = [];
    let data = r.data;
    if (data && typeof data === 'object') {
      data = JSON.stringify(data);
      warnings.push('data was an object, so it was written back as compact JSON; the signature only matches if that is byte for byte what was signed.');
    }
    const timestamp = String(r.timestamp ?? '').trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(String(r.requestHash ?? ''))) throw new Error('requestHash must be 0x and 64 hex digits.');
    if (!/^\d+$/.test(timestamp)) throw new Error('timestamp must be a unix time in seconds, such as "1793378516".');
    if (typeof data !== 'string') throw new Error('data must be the signed JSON string.');
    if (!/^0x([0-9a-fA-F]{2})*$/.test(String(r.signature ?? ''))) throw new Error('signature must be 0x and hex bytes.');
    return { r: { airnode: r.airnode, requestHash: r.requestHash, timestamp, data, signature: r.signature }, warnings };
  }

  function readOwn() {
    try {
      const parsed = parseOwn(el('wOwn').value);
      const iso = new Date(Number(parsed.r.timestamp) * 1000).toISOString().replace('T', ' ').slice(0, 16) + 'Z';
      const sigBytes = (parsed.r.signature.length - 2) / 2;
      result('own', '', 'READ', `<span class="e">Signed ${iso}, request ${short(parsed.r.requestHash)}, data ${parsed.r.data.length} characters, signature ${sigBytes} bytes.${parsed.warnings.map((w) => ` ${escape(w)}`).join('')}</span>`);
      return parsed.r;
    } catch (e) {
      result('own', 'sk', 'NOT READABLE', escape(e.message));
      return null;
    }
  }

  // eth_call first, so a judge knows what the real transaction will do. Needs no wallet when the page's simulator exists.
  async function checkOwn() {
    const r = readOwn();
    if (!r) return null;
    const p = activePolicy('own');
    if (!p) return null;
    result('own', '', 'CHECKING', 'eth_call settle() against the live contract…');
    try {
      const simulate = typeof simulateSettle !== 'undefined' ? simulateSettle : undefined;
      let out;
      if (simulate) out = await simulate(p, r, {});
      else {
        try {
          await eth().request({ method: 'eth_call', params: [{ to: g('CONTRACT'), data: settleCalldata(p.id, r) }, 'latest'] });
          out = { ok: true };
        } catch (e) {
          const raw = e?.data?.data ?? e?.data;
          out = { ok: false, reason: typeof raw === 'string' && g('decodeRevert') ? g('decodeRevert')(raw) : e.message };
        }
      }
      if (out.ok) result('own', 'ok', 'WOULD SETTLE', `<span class="e">The contract accepts it: sending it for real settles policy #${p.id} for good.</span>`);
      else if (out.error) result('own', 'sk', 'RPC ERROR', escape(out.error));
      else result('own', 'no', 'WOULD REVERT', withExplanation(out.reason));
      return out;
    } catch (e) {
      result('own', 'no', 'ERROR', escape(e.message));
      return null;
    }
  }

  async function sendOwn() {
    const r = readOwn();
    if (!r) return;
    const p = activePolicy('own');
    if (!p) return;
    const check = await checkOwn();
    if (check?.ok && !confirm(`The contract accepts this response, so sending it settles policy #${p.id} for good and pays the holder. Send it?`)) {
      return result('own', 'sk', 'CANCELLED', 'Not sent.');
    }
    await submit('own', p, r);
  }

  function fillOwn(r, label) {
    el('wOwn').value = JSON.stringify({ requestHash: r.requestHash, timestamp: String(r.timestamp), data: r.data, signature: r.signature }, null, 2);
    readOwn();
    result('own', '', 'LOADED', `<span class="e">${escape(label)}. Edit anything, then check or send it.</span>`);
  }

  // ------------------------------------------------------------------------------------- after a wallet change

  const FAUCETS = 'https://docs.base.org/get-started/get-funds';
  const faucetLink = `<a href="${FAUCETS}" target="_blank" rel="noopener">free Base Sepolia ETH from a faucet</a>`;
  const ready = () => !missing.length && eth() && W.account && W.chainId === CHAIN_ID;
  const lowGas = () => W.balance != null && W.gasNeeded != null && W.balance < W.gasNeeded;

  // Gas check: one settle() at the fixed gas limit and the current gas price.
  async function updateBalance() {
    if (!ready()) {
      W.balance = W.gasNeeded = null;
      return;
    }
    try {
      const [balance, price] = await Promise.all([
        eth().request({ method: 'eth_getBalance', params: [W.account, 'latest'] }),
        eth().request({ method: 'eth_gasPrice' }),
      ]);
      W.balance = BigInt(balance);
      W.gasNeeded = BigInt(GAS_LIMIT) * BigInt(price);
    } catch {
      W.balance = W.gasNeeded = null;
    }
  }

  async function afterWalletChange() {
    if (W.account) W.note = W.note === 'Wallet disconnected.' ? null : W.note;
    await updateBalance();
    decoratePolicies();
    fillHolder();
    render();
  }

  // ------------------------------------------------------------------------------------------- my policies

  const mine = (p) => W.account && String(p.holder).toLowerCase() === W.account.toLowerCase();

  // Marks the rows of the Policies table that the connected wallet holds, and lists them above the table. Runs on
  // every redraw of the table (MutationObserver), so it survives the page's 20 s refresh without wrapping it.
  function decoratePolicies() {
    const body = el('pol');
    const all = typeof S !== 'undefined' && Array.isArray(S.policies) ? S.policies : [];
    if (!body) return;
    for (const row of body.querySelectorAll('tr')) {
      const id = row.cells[0]?.textContent.trim();
      const p = all.find((x) => String(x.id) === id);
      const yours = !!(p && mine(p));
      row.classList.toggle('wmine', yours);
      const holderCell = row.cells[7];
      const badge = holderCell?.querySelector('.wyou');
      if (yours && holderCell && !badge) holderCell.insertAdjacentHTML('beforeend', ' <span class="pill wyou">yours</span>');
      if (!yours && badge) badge.remove();
    }
    const bar = el('wMine');
    if (!bar) return;
    if (!W.account) {
      bar.hidden = true;
      return;
    }
    const held = all.filter(mine);
    bar.hidden = false;
    bar.innerHTML = held.length
      ? `<b>Your wallet holds ${held.length} ${held.length === 1 ? 'policy' : 'policies'}:</b> ${held
          .map((p) => `#${escape(p.id)} ${escape(p.flight || 'private')} <span class="pill ${escape(p.statusName)}">${escape(statusText(p))}</span>`)
          .join(' · ')}`
      : `No policy on this contract is held by <code>${short(W.account)}</code>. Cover bought with this address as the payout address shows up here.`;
  }

  const statusText = (p) =>
    ({ Active: 'Active, waiting for the flight', PaidHalf: 'Paid 50%', PaidFull: 'Paid 100%', ClosedNoPayout: 'Closed, no payout', Expired: 'Expired' })[p.statusName] ?? p.statusName;

  function mountPolicies() {
    const table = document.querySelector('#policies .card');
    if (!table || el('wMine')) return;
    table.insertAdjacentHTML('beforebegin', '<div id="wMine" class="wmine-bar" hidden></div>');
    const body = el('pol');
    if (body) new MutationObserver(decoratePolicies).observe(body, { childList: true });
  }

  // ----------------------------------------------------------------------------------------- buying cover

  // Turns what the keeper API answers into one sentence a judge can act on. The raw text stays underneath.
  function friendlyBuyError(message) {
    const m = String(message);
    if (/no keeper API/i.test(m)) return 'Buying runs through the keeper API, which is not running for this page. Start it with cd keeper && npm run api, then open localhost:8787.';
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'The keeper API did not answer. Check that npm run api is still running.';
    const departed = m.match(/(\S+) is (\w+); cover can only be bought before departure/);
    if (departed) return `${departed[1]} is already ${departed[2]}. Cover can only be bought before departure: the contract checks a fresh signed status.`;
    const contractError = m.match(/\b([A-Z][A-Za-z0-9]+)\(([^()]*)\)/);
    if (contractError) {
      const own = {
        BadFlight: 'The flight number must be 3 to 8 capital letters and digits, such as LH1816.',
        BadDate: 'The date must be the local departure date as YYYY-MM-DD.',
        BadCoverage: 'Cover must be more than 0 and at most the pool maximum.',
      }[contractError[1]];
      const explain = g('explain');
      const plain = own || (typeof explain === 'function' ? explain(contractError[0]) : '');
      if (plain) return plain;
    }
    if (/responded with 4\d\d|not found|no flight/i.test(m)) return 'AeroDataBox has no such flight on that date. Check the flight number and the local departure date.';
    if (/\b402\b|payment/i.test(m)) return 'The keeper could not pay for the signed schedule over x402. Its aUSD balance may be too low.';
    return '';
  }

  function validateCover() {
    const problems = [];
    const flight = el('flight');
    const date = el('date');
    const holder = el('holder');
    const cov = el('cov');
    const mark = (input, bad) => input?.setAttribute('aria-invalid', bad ? 'true' : 'false');

    const f = flight?.value.trim() ?? '';
    const badFlight = !/^[A-Z0-9]{3,8}$/.test(f);
    if (badFlight) problems.push('Flight number: 3 to 8 capital letters and digits, such as LH1816.');
    mark(flight, badFlight);

    const d = date?.value ?? '';
    const day = Date.parse(`${d}T00:00:00Z`);
    const today = Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    const badDate = !/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(day) || day < today - 86400000 || day > today + 330 * 86400000;
    if (badDate) problems.push('Departure date: today or later, as the local date at the departure airport.');
    mark(date, badDate);

    const h = holder?.value.trim() ?? '';
    const cs = typeof checksum !== 'undefined' ? checksum : undefined;
    let badHolder = !/^0x[0-9a-fA-F]{40}$/.test(h);
    if (!badHolder && /[a-f]/.test(h.slice(2)) && /[A-F]/.test(h.slice(2)) && cs && cs(h) !== h) badHolder = true;
    if (badHolder) problems.push('Payout address: a 0x address with 40 hex digits (mixed case must match its checksum).');
    mark(holder, badHolder);

    const c = Number(cov?.value);
    const max = Number(cov?.max) || Infinity;
    const badCov = !(c > 0 && c <= max);
    if (badCov) problems.push(`Cover: more than 0 and at most ${max} aUSD.`);
    mark(cov, badCov);
    return problems;
  }

  function fillHolder() {
    const holder = el('holder');
    if (holder && W.account && !holder.value.trim()) {
      holder.value = typeof checksum !== 'undefined' ? checksum(W.account) : W.account;
      holder.dispatchEvent(new Event('input'));
    }
    const use = el('wHolder');
    if (use) use.hidden = !W.account;
  }

  // Replaces the page's buy() (the "Cover me" button calls it by name) with the same keeper call plus validation,
  // a pending state with elapsed time, and readable errors. If the page lacks post(), the original stays.
  function mountCover() {
    const form = el('coverForm');
    if (!form || el('wHolder')) return;
    el('flight')?.addEventListener('input', (e) => {
      const v = e.target.value.toUpperCase().replace(/\s+/g, '');
      if (v !== e.target.value) e.target.value = v;
    });
    const holderLabel = el('holder')?.closest('label');
    holderLabel?.insertAdjacentHTML('beforeend', '<button class="btn-ghost btn-sm whold" type="button" id="wHolder" hidden>Use my wallet</button>');
    el('wHolder')?.addEventListener('click', () => {
      el('holder').value = '';
      fillHolder();
    });

    const postFn = typeof post !== 'undefined' ? post : undefined;
    if (typeof buy === 'undefined' || !postFn) return;
    window.buy = async function buyChecked() {
      const out = el('buyOut');
      if (!out) return;
      out.hidden = false;
      const problems = validateCover();
      if (problems.length) {
        out.className = 'out err';
        out.innerHTML = `<b>Fix before buying:</b><ul class="wlist">${problems.map((p) => `<li>${escape(p)}</li>`).join('')}</ul>`;
        return;
      }
      const buttons = form.querySelectorAll('.needs-api');
      buttons.forEach((b) => (b.disabled = true));
      const started = Date.now();
      const pending = () => {
        out.className = 'out';
        out.innerHTML = `<b>Buying… ${Math.round((Date.now() - started) / 1000)} s</b><ol class="wlist">
          <li>The keeper pays 0.05 aUSD over x402 for the flight's AeroDataBox status, signed by the Airnode.</li>
          <li>buyPolicy checks the signature, the request and that the flight has not left, then opens the policy.</li></ol>`;
      };
      pending();
      const timer = setInterval(pending, 1000);
      try {
        const p = await postFn('/cover', {
          flight: el('flight').value.trim(),
          date: el('date').value,
          holder: el('holder').value.trim(),
          coverage: +el('cov').value,
        });
        const link = typeof scanLink !== 'undefined' ? scanLink('tx', p.txHash, 'Basescan ↗') : escape(p.txHash);
        out.className = 'out';
        out.innerHTML = `<b>Policy #${escape(p.policyId)} is Active</b> for ${escape(p.flight)} · scheduled arrival ${escape(p.scheduled)} · premium ${Number(p.premium) / 1e6} aUSD · ${link}<br>
          It settles by itself after landing: the keeper buys the signed arrival and calls settle(). Watch it in Policies below.`;
        const refresh = g('refreshChain');
        if (typeof refresh === 'function') refresh();
      } catch (e) {
        const plain = friendlyBuyError(e.message);
        out.className = 'out err';
        out.innerHTML = `<b>Not bought.</b> ${escape(plain || e.message)}${plain ? `<br><small>${escape(e.message)}</small>` : ''}`;
      } finally {
        clearInterval(timer);
        buttons.forEach((b) => (b.disabled = false));
      }
    };
  }

  // ---------------------------------------------------------------------------------------------------- UI

  function result(mode, cls, head, html) {
    W.results[mode] = { cls, head, html };
    const box = el(`wres-${mode}`);
    if (box) {
      box.className = `res ${cls}`;
      box.innerHTML = `<span class="h">${head}</span>${html.startsWith('<') ? html : `<span class="e">${html}</span>`}`;
    }
  }

  function note(text) {
    W.note = text;
  }

  function render() {
    const status = el('wStatus');
    if (!status) return;
    const btn = el('wConnect');
    const ready = !missing.length && eth() && W.account && W.chainId === CHAIN_ID;
    if (missing.length) {
      status.innerHTML = `<span class="warn">Real-transaction mode is off: the page no longer has ${escape(missing.join(', '))}.</span>`;
    } else if (!eth()) {
      status.innerHTML = 'No browser wallet found. Install MetaMask, Rabby or Coinbase Wallet to send real transactions; the eth_call lab above needs none.';
    } else if (!W.account) {
      status.innerHTML = 'Wallet not connected.';
    } else if (W.chainId !== CHAIN_ID) {
      status.innerHTML = `<span class="warn">Wrong network (chain ${W.chainId}). Transactions go to Base Sepolia only.</span>`;
    } else {
      status.innerHTML = `Connected <code>${short(W.account)}</code> on <b>Base Sepolia</b>. Each attack costs a little Base Sepolia ETH in gas.`;
    }
    if (ready && lowGas()) status.innerHTML += ` <span class="warn">Too little ETH for gas.</span> Get ${faucetLink}.`;
    if (W.note) status.innerHTML += ` <span class="warn">${escape(W.note)}</span>`;
    if (btn) {
      btn.hidden = !!missing.length || !eth() || (W.account && W.chainId === CHAIN_ID);
      btn.textContent = W.account && W.chainId !== CHAIN_ID ? 'Switch to Base Sepolia' : 'Connect wallet';
    }
    document.querySelectorAll('[data-wsend]').forEach((b) => (b.disabled = !ready || W.busy));
    document.querySelectorAll('[data-wbusy]').forEach((b) => (b.disabled = !!missing.length || W.busy));
  }

  function mount() {
    const lab = document.querySelector('#lab .card');
    if (!lab || el('wPanel')) return;
    const style = document.createElement('style');
    style.textContent = `
      #wPanel { padding: 16px 18px; border-top: 1px solid var(--line, #e1e5eb); }
      #wPanel h3 { margin: 0; font: 400 21px/1.15 var(--display, serif); }
      #wPanel > p { font-size: 13px; color: var(--mute, #556071); margin: 4px 0 0; }
      #wPanel .wtop { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 12px 0 14px; font-size: 13px; }
      #wPanel .warn { font-weight: 600; color: var(--bad, #d0342c); }
      #wPanel .wgrid { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
      #wPanel .wcell { display: flex; flex-direction: column; gap: .4rem; }
      #wPanel .res { min-height: 2.5rem; overflow-wrap: anywhere; }
      #wPanel .wown { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line, #e1e5eb); }
      #wPanel .wown > p { font-size: 13px; color: var(--mute, #556071); margin: 4px 0 10px; }
      #wPanel .wown textarea { width: 100%; min-height: 120px; box-sizing: border-box; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      #wPanel .wrow { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; }
      .wmine-bar { margin: 0 0 10px; padding: 10px 14px; border-radius: 10px; background: var(--blue-soft, rgba(47,98,214,.1)); font-size: 13px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
      #pol tr.wmine td { background: var(--blue-soft, rgba(47,98,214,.1)); }
      .pill.wyou { color: var(--accent-ink, #fff); background: var(--blue, #2f62d6); margin-left: 4px; }
      #coverForm .whold { margin-top: 6px; align-self: flex-start; justify-self: start; width: auto; }
      #coverForm [aria-invalid="true"] { outline: 2px solid var(--bad, #d0342c); outline-offset: 1px; }
      .wlist { margin: 6px 0 0; padding-left: 20px; }
      @media (max-width: 480px) { #wPanel .wtop button { width: 100%; } }`;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'wPanel';
    panel.innerHTML = `
      <h3>Send it for real</h3>
      <p>The same forgeries as above, sent as real <code>settle()</code> transactions from your wallet to the deployed
      contract. A rejected one is mined as a failed transaction, so the revert is on Basescan. Works on an
      <b>Active</b> policy; a settled one stops at <code>NotActive</code>.</p>
      <div class="wtop"><button class="btn-primary" id="wConnect" type="button">Connect wallet</button><span id="wStatus"></span></div>
      <div class="wgrid">
        ${ATTACKS.map((a) => `<div class="wcell"><button class="btn-ghost btn-sm" type="button" data-wsend="${a.m}">Send: ${a.t}</button>
          <div class="res" id="wres-${a.m}"><span class="e">Not sent.</span></div></div>`).join('')}
        <div class="wcell"><button class="btn-primary btn-sm" type="button" data-wsend="valid">Send: Genuine</button>
          <div class="res" id="wres-valid"><span class="e">Settles for good if final. Asks first.</span></div></div>
      </div>
      <div class="wown">
        <h3>Your own response</h3>
        <p>Paste any AirnodeHub response (or a keeper fixture) for the target policy, edit it however you like, then
        check it with an <code>eth_call</code> or send it for real. <code>data</code> must be the exact string that was
        signed.</p>
        <textarea id="wOwn" spellcheck="false" placeholder='{"requestHash":"0x…","timestamp":"1793378516","data":"{\\"scheduled\\":\\"…\\",\\"status\\":\\"…\\"}","signature":"0x…"}'></textarea>
        <div class="wrow">
          <button class="btn-ghost btn-sm" type="button" id="wOwnBase">Start from the lab's base</button>
          <button class="btn-ghost btn-sm" type="button" id="wOwnInsp">Copy from the Inspector</button>
          <button class="btn-ghost btn-sm" type="button" id="wOwnCheck" data-wbusy>Check (eth_call)</button>
          <button class="btn-primary btn-sm" type="button" data-wsend="own">Send for real</button>
        </div>
        <div class="res" id="wres-own"><span class="e">Nothing pasted yet.</span></div>
      </div>`;
    lab.appendChild(panel);

    el('wConnect').addEventListener('click', () => (W.account && W.chainId !== CHAIN_ID ? switchChain().catch((e) => note(e.message)) : connect()));
    panel.querySelectorAll('[data-wsend]').forEach((b) => b.addEventListener('click', () => (b.dataset.wsend === 'own' ? sendOwn() : send(b.dataset.wsend))));
    el('wOwn').addEventListener('input', readOwn);
    el('wOwnCheck').addEventListener('click', checkOwn);
    el('wOwnBase').addEventListener('click', () => {
      const p = g('labPolicy')();
      if (!p) return result('own', 'sk', 'NO POLICY', 'Pick a target policy above first.');
      const base = g('labBase')(p);
      fillOwn(base.r, `Loaded ${base.label}`);
    });
    el('wOwnInsp').addEventListener('click', () => {
      const read = typeof readResp !== 'undefined' ? readResp : undefined;
      const r = read?.();
      if (!r?.signature) return result('own', 'sk', 'EMPTY', 'The Inspector has no response loaded. Paste or load one there, or paste it here.');
      fillOwn(r, "Copied the Inspector's response");
    });
    if (eth()?.on) {
      eth().on('accountsChanged', (a) => {
        W.account = a[0] ?? null;
        if (!W.account) note('Wallet disconnected.');
        afterWalletChange();
      });
      eth().on('chainChanged', (c) => {
        W.chainId = parseInt(c, 16);
        afterWalletChange();
      });
    }
    mountPolicies();
    mountCover();
    refreshWallet();
  }

  // Exposed for tests and the console.
  window.AGWallet = { settleCalldata, send, connect, switchChain, validateCover, friendlyBuyError, state: W, missing };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
