// Renders one clip frame by frame (deterministic timeline) and encodes H.264 1080p30.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
(async () => {
  const [clip, out] = process.argv.slice(2);
  const fps = 30;
  const dir = require('path').join(require('os').tmpdir(), `aeroguard-frames-${clip}`);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto(`file://${__dirname}/player.html?clip=${clip}`);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(300);
  const dur = await p.evaluate(() => window.DUR);
  const n = Math.round(dur * fps);
  for (let i = 0; i < n; i++) {
    await p.evaluate((t) => window.seek(t), i / fps);
    await p.screenshot({ path: `${dir}/${String(i).padStart(5, '0')}.png` });
  }
  await b.close();
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', `${dir}/%05d.png`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(clip, dur.toFixed(1) + 's', n, 'frames ->', out);
})();
