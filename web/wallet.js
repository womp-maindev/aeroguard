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
    refreshChain: typeof refreshChain !== 'undefined' ? refreshChain : undefined,
  };
  const OPTIONAL = ['decodeRevert', 'explain', 'refreshChain'];
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
    render();
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
    render();
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
    render();
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
      return result(mode, 'sk', 'SKIPPED', `Needs a genuine Airnode response for ${p.flight}; none is published for this policy yet.`);
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

  const withExplanation = (reason) => {
    const explain = g('explain');
    const plain = typeof explain === 'function' ? explain(reason) : '';
    return `<code>${escape(reason)}</code>${plain ? `<span class="e">${escape(plain)}</span>` : ''}`;
  };

  // Sends settle(policy, response) from the wallet and reports the on-chain outcome in `box`.
  async function submit(box, p, r) {
    let tx;
    try {
      tx = { from: W.account, to: g('CONTRACT'), data: settleCalldata(p.id, r), gas: GAS_LIMIT };
    } catch (e) {
      return result(box, 'no', 'NOT SENDABLE', escape(e.message));
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
        result(box, 'no', 'REVERTED · ON-CHAIN', `${withExplanation(await revertReason(tx, receipt.blockNumber))}<span class="e">Transaction ${link}</span>`);
      }
      const refresh = g('refreshChain');
      if (typeof refresh === 'function') await refresh();
    } catch (e) {
      if (e.code === 4001) result(box, 'sk', 'REJECTED', 'You rejected the transaction in the wallet. Nothing was sent.');
      else result(box, 'no', 'ERROR', escape(e.message || String(e)));
    } finally {
      W.busy = false;
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
      @media (max-width: 480px) { #wPanel .wtop button { width: 100%; } }`;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'wPanel';
    panel.innerHTML = `
      <h4>Send it for real</h4>
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
        <h4>Your own response</h4>
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
        render();
      });
      eth().on('chainChanged', (c) => {
        W.chainId = parseInt(c, 16);
        render();
      });
    }
    refreshWallet();
  }

  // Exposed for tests and the console.
  window.AGWallet = { settleCalldata, send, connect, switchChain, state: W, missing };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
