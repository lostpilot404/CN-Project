import { chromium } from '/home/user/CN-Project/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: '/tmp/browser/out/chromium', args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:1420/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
// fresh project for clean topology
await page.getByRole('button', { name: 'New', exact: true }).click();
await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'Transport Layer', exact: true }).click();
await page.waitForTimeout(1200);
// run TCP clean
const runTcp = page.getByRole('button', { name: /run tcp|simulate tcp|tcp.*simulat/i });
console.log('tcp run buttons:', await runTcp.count());
if (await runTcp.count() > 0) { await runTcp.first().click(); await page.waitForTimeout(2500); }
console.log('ESTABLISHED present:', await page.getByText('ESTABLISHED').count());
// break link-1 via backend API directly
await page.evaluate(async () => {
  await fetch('/netsim-api/api/update_link', { method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ linkId: 'link-1', status: 'down' }) });
});
await page.waitForTimeout(500);
// rerun TCP -> expect error and NO stale ESTABLISHED
if (await runTcp.count() > 0) { await runTcp.first().click(); await page.waitForTimeout(2500); }
console.log('error present:', await page.getByText(/unreachable|no route|failed|down/i).count());
console.log('stale ESTABLISHED after failed rerun:', await page.getByText('ESTABLISHED').count());
await page.screenshot({ path: '/tmp/verify/shots/v-trans-stale.png' });
await browser.close();
console.log('done');
