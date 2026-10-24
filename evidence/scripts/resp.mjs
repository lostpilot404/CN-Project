import { chromium } from '/home/user/CN-Project/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: '/tmp/browser/out/chromium', args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'] });
for (const [w,h] of [[320,800],[375,812],[768,1024],[1024,768],[1440,900]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://127.0.0.1:1420/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  const metrics = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    hOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }));
  console.log(`${w}x${h}:`, JSON.stringify(metrics), 'errs:', errs.length);
  await page.screenshot({ path: `/tmp/verify/shots/resp-${w}.png` });
  // also addressing workspace at this size
  await page.getByRole('button', { name: 'Addressing & NAT', exact: true }).click().catch(()=>{});
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `/tmp/verify/shots/resp-${w}-addr.png` });
  await page.close();
}
await browser.close();
