'use strict';
// aeroguard dashboard: run the local rehearsal from the page. plain js, no build step.
// Shows a "Local rehearsal" section only when this page talks to a keeper API started with REHEARSE=on (npm run api on
// your laptop). The API starts a fresh anvil and runs keeper/src/rehearse.ts, the same script CI runs: deploy, five
// purchases with signed proofs, a late purchase, four forgeries and the genuine response, the keeper settling every
// policy, and a private policy expiring. This page polls the output and turns it into phases and tables.
(() => {
  const api = typeof API !== 'undefined' ? API : null; // the main script's keeper API base: '' when served by it
  if (api == null) return;

  const R = { id: null, from: 0, lines: [], timer: null, cover: null };
  const el = (id) => document.getElementById(id);
  const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const call = async (path, init) => {
    const r = await fetch(api + path, init);
    const b = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    if (!r.ok && r.status !== 409) throw new Error(b.error || `HTTP ${r.status}`);
    return b;
  };

  const PHASES = [
    { key: 'deploy', label: 'Deploy', test: /^deployed MockUSD/ },
    { key: 'buy', label: 'Buy with signed proofs', test: /^bought |late purchase rejected/ },
    { key: 'attack', label: 'Attack: 4 forgeries + genuine', test: /^tamper / },
    { key: 'settle', label: 'Keeper settles', test: /settled (PaidFull|PaidHalf|ClosedNoPayout)|holder balance/ },
    { key: 'expire', label: 'Private policy expires', test: /expired after the settlement window/ },
  ];
  const STATUS_TEXT = { PaidFull: 'Paid 100%', PaidHalf: 'Paid 50%', ClosedNoPayout: 'Closed, no payout' };

  // ------------------------------------------------------------------------------------------------ parse

  function digest(lines) {
    const d = { buys: [], late: null, attacks: [], settles: [], balance: null, expired: null, ok: null, failure: null };
    for (const { text } of lines) {
      let m;
      if ((m = text.match(/^bought (\S+) policy (\d+)n scheduled (.+)$/))) d.buys.push({ flight: m[1], id: m[2], scheduled: m[3] });
      else if ((m = text.match(/^bought private policy (\d+)/))) d.buys.push({ flight: 'private', id: m[1], scheduled: 'hidden until reveal' });
      else if ((m = text.match(/^late purchase rejected: (.+)$/))) d.late = m[1];
      else if ((m = text.match(/^tamper (\w+)\s+(\{.*\})$/))) {
        try {
          const r = JSON.parse(m[2]);
          d.attacks.push({ mode: m[1], accepted: r.accepted, reason: r.reason, payout: r.payout, status: r.status });
        } catch {}
      } else if ((m = text.match(/policy #(\d+) settled (\w+): (.*?), payout ([\d.]+) aUSD/))) d.settles.push({ id: m[1], status: m[2], why: m[3], payout: m[4] });
      else if ((m = text.match(/^holder balance ([\d.]+) aUSD/))) d.balance = m[1];
      else if ((m = text.match(/policy #(\d+) expired after the settlement window/))) d.expired = m[1];
      else if (/^REHEARSAL OK/.test(text)) d.ok = true;
      else if ((m = text.match(/^REHEARSAL FAILED:?\s*(.*)$/))) (d.ok = false), (d.failure = m[1] || 'see the log');
    }
    return d;
  }

  const ATTACK_TEXT = {
    edit: 'One signed value edited',
    wrongreq: 'Real response for another request',
    wrongsigner: "Signed by a key that isn't the Airnode",
    stale: 'Real but older than maxAge',
    valid: 'The genuine response',
  };

  // ----------------------------------------------------------------------------------------------- render

  function render(status) {
    const d = digest(R.lines);
    const reached = new Set(PHASES.filter((p) => R.lines.some((l) => p.test.test(l.text))).map((p) => p.key));
    const running = !!status?.running;
    el('rhPhases').innerHTML = PHASES.map((p, i) => {
      const done = reached.has(p.key) && (d.ok != null || PHASES.slice(i + 1).some((q) => reached.has(q.key)));
      const active = running && reached.has(p.key) && !done;
      return `<span class="rh-phase ${done ? 'done' : active ? 'active' : ''}">${i + 1}. ${escape(p.label)}</span>`;
    }).join('');

    const btn = el('rhRun');
    btn.disabled = running;
    btn.textContent = running ? 'Running…' : R.lines.length ? 'Run it again' : 'Run the full rehearsal';

    const banner = el('rhBanner');
    if (running) {
      const secs = status?.startedAt ? Math.round((Date.now() - status.startedAt) / 1000) : 0;
      banner.className = 'rh-banner';
      banner.innerHTML = `<b>Running… ${secs} s</b> on a fresh local chain (anvil, chain id 84532). No keys, no funds, no paid lookups.`;
    } else if (d.ok === true || status?.ok === true) {
      banner.className = 'rh-banner ok';
      banner.innerHTML = `<b>Rehearsal OK.</b> 4 forgeries rejected, the genuine response accepted, 5 policies settled as expected, the private policy untouched, then expired.${
        R.cover ? ` <a href="${escape(inspectUrl())}" target="_blank" rel="noopener">Inspect the rehearsal chain in this dashboard ↗</a>` : ''}`;
    } else if (d.ok === false || status?.ok === false) {
      banner.className = 'rh-banner bad';
      banner.innerHTML = `<b>Rehearsal failed.</b> ${escape(d.failure || 'See the log below.')}`;
    } else {
      banner.className = 'rh-banner';
      banner.innerHTML = 'Not run yet.';
    }

    const rows = [];
    if (d.buys.length) {
      rows.push(`<h4>Purchases</h4><table class="tbl"><thead><tr><th>#</th><th>Flight</th><th>Scheduled arrival (signed)</th></tr></thead><tbody>${d.buys
        .map((b) => `<tr><td class="m">${escape(b.id)}</td><td class="m"><b>${escape(b.flight)}</b></td><td class="m">${escape(b.scheduled)}</td></tr>`)
        .join('')}</tbody></table>`);
      if (d.late) rows.push(`<p class="rh-note">After landing, buying again is <b>rejected</b>: ${escape(d.late)}…</p>`);
    }
    if (d.attacks.length) {
      rows.push(`<h4>Attacks on policy #1, then the genuine response</h4><table class="tbl"><thead><tr><th>Sent</th><th>Contract answer</th></tr></thead><tbody>${d.attacks
        .map((a) => `<tr><td>${escape(ATTACK_TEXT[a.mode] ?? a.mode)}</td><td>${a.accepted
          ? `<span class="pill PaidFull">ACCEPTED</span> ${escape(STATUS_TEXT[a.status] ?? a.status ?? '')}${a.payout ? `, ${Number(a.payout) / 1e6} aUSD to the holder` : ''}`
          : `<span class="pill rh-no">REVERTED</span> <code>${escape(a.reason)}</code>`}</td></tr>`)
        .join('')}</tbody></table>`);
    }
    if (d.settles.length) {
      rows.push(`<h4>The keeper settles</h4><table class="tbl"><thead><tr><th>#</th><th>Outcome</th><th>Signed evidence</th><th>Payout</th></tr></thead><tbody>${d.settles
        .map((s) => `<tr><td class="m">${escape(s.id)}</td><td><span class="pill ${escape(s.status)}">${escape(STATUS_TEXT[s.status] ?? s.status)}</span></td><td>${escape(s.why)}</td><td class="m">${escape(s.payout)} aUSD</td></tr>`)
        .join('')}</tbody></table>`);
      if (d.balance) rows.push(`<p class="rh-note">The holder ends with <b>${escape(d.balance)} aUSD</b> from the payouts.</p>`);
    }
    if (d.expired) rows.push(`<p class="rh-note">Three days on, private policy #${escape(d.expired)} was never revealed, so the keeper never looked it up and <b>expired</b> it, releasing its coverage.</p>`);
    el('rhResults').innerHTML = rows.join('');

    const log = el('rhLog');
    const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
    log.textContent = R.lines.map((l) => l.text).join('\n') || '(no output yet)';
    if (atBottom || running) log.scrollTop = log.scrollHeight;
  }

  function inspectUrl() {
    const qs = new URLSearchParams(location.search);
    qs.set('rpc', 'http://127.0.0.1:8545');
    qs.set('contract', R.cover);
    if (api && !qs.get('api')) qs.set('api', api);
    return `${location.pathname}?${qs}`;
  }

  // ---------------------------------------------------------------------------------------------- polling

  async function poll() {
    try {
      const b = await call(`/rehearse/log?from=${R.from}`);
      if (R.id != null && b.id !== R.id) {
        // a new run started (another tab, or the button again): read it from the start
        Object.assign(R, { id: b.id, from: 0, lines: [], cover: null });
        return poll();
      }
      R.id = b.id;
      R.lines.push(...b.lines);
      R.from = b.from + b.lines.length;
      R.cover = b.cover || R.cover;
      render(b);
      if (b.running) R.timer = setTimeout(poll, 700);
    } catch (e) {
      el('rhBanner').className = 'rh-banner bad';
      el('rhBanner').innerHTML = `<b>Lost the keeper API.</b> ${escape(e.message)}`;
      el('rhRun').disabled = false;
    }
  }

  async function runIt() {
    clearTimeout(R.timer);
    el('rhRun').disabled = true;
    try {
      await call('/rehearse/run', { method: 'POST' });
      R.id = null;
      R.from = 0;
      R.lines = [];
      R.cover = null;
      poll();
    } catch (e) {
      el('rhBanner').className = 'rh-banner bad';
      el('rhBanner').innerHTML = `<b>Could not start.</b> ${escape(e.message)}`;
      el('rhRun').disabled = false;
    }
  }

  // ------------------------------------------------------------------------------------------------ mount

  function mount(status) {
    const anchor = el('policies');
    if (!anchor || el('rehearsal')) return;
    const style = document.createElement('style');
    style.textContent = `
      #rehearsal .rh-phases { display: flex; flex-wrap: wrap; gap: 8px; padding: 16px 18px 0; }
      #rehearsal .rh-phase { font: 600 12px var(--mono, monospace); padding: 6px 10px; border-radius: 8px; background: var(--card2, #f3f5f8); color: var(--dim, #8a93a2); }
      #rehearsal .rh-phase.active { color: var(--blue, #2f62d6); background: var(--blue-soft, rgba(47,98,214,.1)); }
      #rehearsal .rh-phase.done { color: var(--ok, #1d8a5a); background: var(--ok-soft, rgba(29,138,90,.1)); }
      #rehearsal .rh-top { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; padding: 16px 18px; }
      #rehearsal .rh-banner { font-size: 14px; color: var(--mute, #556071); }
      #rehearsal .rh-banner.ok { color: var(--ok, #1d8a5a); }
      #rehearsal .rh-banner.bad { color: var(--bad, #d0342c); }
      #rehearsal .rh-results { padding: 0 18px; }
      #rehearsal .rh-results h4 { margin: 14px 0 6px; }
      #rehearsal .rh-note { font-size: 13px; color: var(--mute, #556071); margin: 8px 0; }
      #rehearsal .pill.rh-no { color: var(--bad, #d0342c); background: var(--bad-soft, rgba(208,52,44,.07)); }
      #rehearsal details { padding: 12px 18px 16px; }
      #rehearsal pre { max-height: 280px; overflow: auto; font: 12px/1.5 var(--mono, monospace); background: var(--card2, #f3f5f8); padding: 12px; border-radius: 10px; white-space: pre-wrap; overflow-wrap: anywhere; }`;
    document.head.appendChild(style);
    anchor.insertAdjacentHTML('beforebegin', `
      <section class="block" id="rehearsal">
        <div class="sh"><div><span class="num">LOCAL REHEARSAL</span><h2>Run the whole lifecycle</h2>
          <p>One click runs <code>keeper/src/rehearse.ts</code>, the script CI runs, on a fresh local chain: deploy, buy five
          policies with signed proofs, attack with four forgeries, settle with the keeper, expire a private policy. Block time
          jumps from 06:00 (buying) to 22:00 (landed) to three days later, so it takes about 20 seconds. Responses are signed by
          a local test key that only this throwaway contract trusts; the live contract rejects them.</p></div></div>
        <div class="card">
          <div class="rh-phases" id="rhPhases"></div>
          <div class="rh-top"><button class="btn-primary" id="rhRun" type="button">Run the full rehearsal</button><span class="rh-banner" id="rhBanner"></span></div>
          <div class="rh-results" id="rhResults"></div>
          <details><summary>Raw output</summary><pre id="rhLog"></pre></details>
        </div>
      </section>`);
    el('rhRun').addEventListener('click', runIt);
    render(status);
    if (status.lines) poll(); // show the last run after a reload
  }

  async function boot() {
    try {
      const status = await call('/rehearse/status');
      if (status.enabled) mount(status);
    } catch {
      // no keeper API, or an older one without the route: nothing to show
    }
  }

  window.AGRehearsal = { digest };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
