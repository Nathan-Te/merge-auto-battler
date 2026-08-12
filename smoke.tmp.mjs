import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:4173/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 390, height: 780 } });

const errors = [];
const logs = [];
page.on('console', (m) => { logs.push(`${m.type()}: ${m.text()}`); if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(3500);

const state = await page.evaluate(() => {
  const g = window.__game;
  const active = g.scene.getScenes(true).map((s) => s.scene.key);
  const game = g.scene.getScene('GameScene');
  return {
    active,
    title: document.title,
    lang: document.documentElement.lang,
    items: game ? game.views.size : -1,
    skinCount: game?.skin ? game.skin.count : -1,
    fps: Math.round(g.loop.actualFps),
    wave: game?.session?.battle?.wave ?? -1,
  };
});

await page.screenshot({ path: 'shot-portrait.png' });
await page.setViewportSize({ width: 900, height: 480 });
await page.waitForTimeout(800);
await page.screenshot({ path: 'shot-landscape.png' });

console.log(JSON.stringify(state, null, 2));
console.log('--- erreurs ---');
console.log(errors.length ? errors.join('\n') : 'aucune');
await browser.close();
