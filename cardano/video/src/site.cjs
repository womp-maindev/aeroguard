// Serve web/ first (python3 -m http.server 8099 in web/). The live site's hero with its planes, then a scroll to the
// Cardano x402 panel. Frame by frame: CSS animations are paused and set to each frame's time, so motion is smooth.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
(async () => {
  const out = process.argv[2]; const fps = 30, dur = 6;
  const dir = require('path').join(require('os').tmpdir(), 'aeroguard-frames-site'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
  await p.goto('http://127.0.0.1:8099/'); await p.waitForTimeout(3000);
  await p.addStyleTag({ content: 'html { scroll-behavior: auto !important; } .toasts, #apistat { display: none !important; }' });
  const top = await p.evaluate(() => document.getElementById('cardano').getBoundingClientRect().top + scrollY - 70);
  const base = await p.evaluate(() => { const a = document.getAnimations(); a.forEach((x) => x.pause()); return a.map((x) => Number(x.currentTime) || 0); });
  const ease = (x) => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  for (let i = 0; i < dur * fps; i++) {
    const t = i / fps; const k = ease(Math.max(0, Math.min(1, (t - 2.2) / 2.6)));
    await p.evaluate(([y, t, base]) => { document.getAnimations().forEach((a, j) => { a.currentTime = (base[j] ?? 0) + t * 1000; }); window.scrollTo(0, y); }, [top * k, t, base]);
    await p.screenshot({ path: `${dir}/${String(i).padStart(5, '0')}.png` });
  }
  await b.close();
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', `${dir}/%05d.png`, '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', out]);
  fs.rmSync(dir, { recursive: true, force: true }); console.log('site', dur + 's ->', out);
})();
