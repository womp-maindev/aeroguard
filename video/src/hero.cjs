// The site's real hero (web/index.html), frame by frame at 30 fps: the CSS planes are driven through the Web Animations
// API (deterministic, sped up ×6 so they visibly fly), LATE → PAID is highlighted on the boarding pass, then a smooth
// scroll down to the "Try to steal" / Inspector buttons and the 5-step flow. Usage: node hero.cjs <out.mp4>
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const out = process.argv[2]; const fps = 30, dur = 6;
const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
const clamp = (x) => Math.max(0, Math.min(1, x));
(async () => {
  const dir = require('path').join(require('os').tmpdir(), 'aeroguard-hero'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
  await p.goto(`http://127.0.0.1:${process.env.PORT || 8099}/index.html`);
  await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(1500);
  await p.addStyleTag({ content: `html { scroll-behavior: auto !important; } #apistat { visibility: hidden; }
    aside.pass .bp b { display: inline-block; transition: none; } .toast, #toasts { display: none !important; }` });
  const base = await p.evaluate(() => document.getAnimations().map((a) => a.currentTime || 0));
  const target = await p.evaluate(() => { const c = document.querySelector('.ctas'); return Math.max(0, c.getBoundingClientRect().top + scrollY - 260); });
  for (let i = 0; i < dur * fps; i++) {
    const t = i / fps;
    await p.evaluate(({ t, base, y, late, paid }) => {
      document.getAnimations().forEach((a, k) => { a.pause(); a.currentTime = (base[k] || 0) + t * 6000; });
      scrollTo(0, y);
      const [l, pd] = document.querySelectorAll('aside.pass .bp b');
      l.style.transform = `scale(${1 + 0.18 * late})`; l.style.color = late > 0.05 ? '#c13d0b' : '';
      pd.style.transform = `scale(${1 + 0.22 * paid})`;
    }, { t, base, y: target * 0.55 * ease(clamp((t - 3.2) / 2.2)), late: Math.sin(Math.PI * clamp((t - 0.6) / 1.2)), paid: Math.sin(Math.PI * clamp((t - 1.6) / 1.4)) });
    await p.screenshot({ path: `${dir}/${String(i).padStart(5, '0')}.png` });
  }
  await b.close();
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', `${dir}/%05d.png`, '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', out]);
  fs.rmSync(dir, { recursive: true, force: true }); console.log('hero', dur + 's ->', out);
})();
