import { chromium } from '/home/user/CN-Project/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: '/tmp/browser/out/chromium', args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:1420/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.getByRole('button', { name: 'Algorithm Studio', exact: true }).click();
await page.waitForTimeout(1200);
// ensure pure aloha tab (default?) — click Multiple Access category then Pure ALOHA if needed
const mac = page.getByRole('button', { name: /multiple access/i });
if (await mac.count() > 0) { await mac.first().click(); await page.waitForTimeout(800); }
const g = page.getByLabel('Offered Load (G)');
console.log('G input present:', await g.count());
await g.fill('0.3');
await page.getByRole('button', { name: 'Run Simulation' }).first().click();
await page.waitForTimeout(2000);
const col1 = await page.locator('text=Collisions').locator('..').textContent().then(t => t.replace(/\s+/g,' ')).catch(() => 'n/a');
console.log('G=0.3 collisions block:', col1);
await g.fill('2.5');
await page.getByRole('button', { name: 'Run Simulation' }).first().click();
await page.waitForTimeout(2000);
const col2 = await page.locator('text=Collisions').locator('..').textContent().then(t => t.replace(/\s+/g,' ')).catch(() => 'n/a');
console.log('G=2.5 collisions block:', col2);
await page.screenshot({ path: '/tmp/verify/shots/v-mac-g.png' });
await browser.close();
console.log('done');
