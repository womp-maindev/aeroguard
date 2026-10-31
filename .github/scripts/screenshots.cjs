// takes the dashboard screenshots against the live contract (runs in github actions, where base sepolia is reachable)
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.env.OUT || 'shots';

const open = async (b, w, h, hash = '') => {
  const pg = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await pg.goto(BASE + hash);
  await pg.waitForFunction(() => typeof S !== 'undefined' && S.chain === true && S.policies.length > 0, null, { timeout: 60000 });
  await pg.waitForTimeout(2500); // keeper log, purchase proofs
  await pg.addStyleTag({ content: 'html { scroll-behavior: auto !important; } .toasts { display: none; }' });
  return pg;
};
const shot = async (pg, sel, file) => {
  await pg.addStyleTag({ content: 'nav { position: static !important; }' }); // the sticky bar would sit on top of the element
  const el = await pg.$(sel); await el.scrollIntoViewIfNeeded(); await pg.waitForTimeout(400); await el.screenshot({ path: `${OUT}/${file}` });
};

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  let pg = await open(b, 1440, 900);
  console.log('status:', await pg.textContent('#apitxt'), '| policies:', await pg.evaluate(() => S.policies.length));
  await pg.screenshot({ path: `${OUT}/dashboard-hero.png`, clip: { x: 0, y: 0, width: 1440, height: 900 } });
  await shot(pg, '#policies', 'policies-live.png');
  await shot(pg, '#log', 'keeper-log.png');
  await shot(pg, '#cardano', 'cardano-x402.png');
  await pg.evaluate(() => loadRealProof()); await shot(pg, '#inspector', 'inspector.png');
  await pg.click('#cheatBtn'); await pg.waitForFunction(() => /BLOCKED|reach/.test(document.getElementById('cheatOut').textContent), null, { timeout: 60000 });
  await pg.waitForTimeout(800);
  console.log('cheat:', (await pg.textContent('#cheatOut')).replace(/\s+/g, ' '));
  await shot(pg, '#lab', 'tamper-lab.png');
  await pg.close();
  pg = await open(b, 390, 844, '#lab');
  await pg.click('#cheatBtn'); await pg.waitForFunction(() => /BLOCKED|reach/.test(document.getElementById('cheatOut').textContent), null, { timeout: 60000 });
  await pg.waitForTimeout(800);
  await pg.evaluate(() => document.querySelector('.cheat').scrollIntoView({ block: 'start' }));
  await pg.screenshot({ path: `${OUT}/try-to-cheat-mobile.png` });
  await pg.close();
  pg = await open(b, 390, 844);
  await pg.screenshot({ path: `${OUT}/mobile-390.png` });
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
