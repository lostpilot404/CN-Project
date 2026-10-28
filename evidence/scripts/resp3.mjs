import { chromium } from '/home/user/CN-Project/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: '/tmp/browser/out/chromium', args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'] });
for (const w of [320, 768, 1440]) {
  const page = await browser.newPage({ viewport: { width: w, height: 800 } });
  await page.goto('http://127.0.0.1:1420/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `/tmp/verify/shots/r12-topo-${w}.png` });
  await page.getByRole('button', { name: 'Simulation & Events', exact: true }).click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `/tmp/verify/shots/r12-sim-${w}.png` });
  await page.close();
}
await browser.close();
console.log('done');
