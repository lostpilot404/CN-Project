import { chromium } from '/home/user/CN-Project/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: '/tmp/browser/out/chromium', args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'] });
for (const w of [320, 375, 768, 1440]) {
  const page = await browser.newPage({ viewport: { width: w, height: 800 } });
  await page.goto('http://127.0.0.1:1420/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(w, 'topo doc-overflow:', overflow);
  await page.screenshot({ path: `/tmp/verify/shots/r11-topo-${w}.png` });
  await page.getByRole('button', { name: 'Simulation & Events', exact: true }).click();
  await page.waitForTimeout(1000);
  const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(w, 'sim doc-overflow:', overflow2);
  await page.screenshot({ path: `/tmp/verify/shots/r11-sim-${w}.png` });
  await page.close();
}
await browser.close();
console.log('done');
