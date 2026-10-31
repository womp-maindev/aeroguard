// Serve web/ first (python3 -m http.server 8099 in web/). The real dashboard's Cardano panel showing the recorded paid run (header hidden: Base RPC is unreachable from the build box).
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
(async () => {
  const out = process.argv[2]; const fps = 30, dur = 12;
  const dir = require('path').join(require('os').tmpdir(), 'aeroguard-frames-dash'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
  await p.goto('http://127.0.0.1:8099/#cardano'); await p.waitForTimeout(2500);
  await p.addStyleTag({ content: `header, nav, .topbar, [class*="nav"] { visibility: hidden !important; } html { scroll-behavior: auto !important; }
    #capbar { position: fixed; left: 0; right: 0; bottom: 0; height: 64px; background: rgba(11,16,32,.92); color: #e6edf7; font: 24px Jost, sans-serif;
      display: flex; align-items: center; justify-content: space-between; padding: 0 40px; z-index: 99999; }
    #capbar span.t { padding: 6px 14px; border: 1px solid #2d3d66; border-radius: 8px; background: #13213f; font-size: 20px; }` });
  await p.evaluate(() => { const d = document.createElement('div'); d.id = 'capbar';
    d.innerHTML = '<span><b>AeroGuard dashboard</b> · Cardano x402 panel — ask, pay, verdict</span><span class="t">recorded real run · tx e2ef922b…</span>'; document.body.appendChild(d); });
  const top = await p.evaluate(() => document.getElementById('cardano').getBoundingClientRect().top + scrollY);
  const h = await p.evaluate(() => document.getElementById('cardano').getBoundingClientRect().height);
  const y0 = top - 20, y1 = top + h - 720 + 90;
  const ease = (x) => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
  for (let i = 0; i < dur * fps; i++) {
    const t = i / fps; const k = ease(Math.max(0, Math.min(1, (t - 2) / 6)));
    await p.evaluate((y) => window.scrollTo(0, y), y0 + (y1 - y0) * k);
    await p.screenshot({ path: `${dir}/${String(i).padStart(5, '0')}.png` });
  }
  await b.close();
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', `${dir}/%05d.png`, '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
  fs.rmSync(dir, { recursive: true, force: true }); console.log('dash', dur + 's ->', out);
})();
