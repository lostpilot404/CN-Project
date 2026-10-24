import { chromium } from '/home/user/CN-Project/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: '/tmp/browser/out/chromium', args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 320, height: 800 } });
await page.goto('http://127.0.0.1:1420/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.getByRole('button', { name: 'Transport Layer', exact: true }).click();
await page.waitForTimeout(1200);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log('transport-320 doc-overflow:', overflow);
// is the run button reachable (visible or scrollable into view)?
const runBtn = page.getByRole('button', { name: /run tcp/i }).first();
await runBtn.scrollIntoViewIfNeeded().catch(() => {});
console.log('run button visible after scroll:', await runBtn.isVisible().catch(() => false));
await page.screenshot({ path: '/tmp/verify/shots/r12-trans-320.png' });
await browser.close();
console.log('done');
