// Records the LIVE dashboard (web/, served on :8099; reads Base Sepolia with eth_calls, no key) at 1920×1080.
// Needs the Base Sepolia RPC, so it runs in GitHub Actions (video.yml). Usage: node dash.cjs <policies|lab> <out.mp4>
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const [clip, out] = process.argv.slice(2);
const fps = 30;
const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
(async () => {
  const dir = require('path').join(require('os').tmpdir(), `aeroguard-dash-${clip}`);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
  await p.goto('http://127.0.0.1:8099/index.html');
  await p.waitForFunction(() => document.querySelectorAll('#pol tr, #policies tbody tr').length > 3, null, { timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(4000);
  await p.addStyleTag({ content: 'html { scroll-behavior: auto !important; }' });
  const top = (sel) => p.evaluate((s) => document.querySelector(s).getBoundingClientRect().top + scrollY, sel);
  let dur, y;
  if (clip === 'policies') {
    const y0 = (await top('#policies')) - 70; const y1 = y0 + 420;
    dur = 10; y = (t) => y0 + (y1 - y0) * ease(clamp((t - 2.5) / 5));
  } else {
    await p.selectOption('#tPolicy', '1').catch(() => {});
    const y0 = (await top('#lab')) - 70;
    await p.evaluate((v) => scrollTo(0, v), y0);
    await p.click('#runAll');
    await p.waitForTimeout(9000); // the four eth_calls to the live contract
    const y1 = y0 + 560;
    dur = 12; y = (t) => y0 + (y1 - y0) * ease(clamp((t - 2) / 6));
  }
  for (let i = 0; i < dur * fps; i++) {
    await p.evaluate((v) => scrollTo(0, v), y(i / fps));
    await p.screenshot({ path: `${dir}/${String(i).padStart(5, '0')}.png` });
  }
  await b.close();
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', `${dir}/%05d.png`, '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('dash', clip, dur + 's ->', out);
})();
function clamp(x) { return Math.max(0, Math.min(1, x)); }
