import { chromium } from '/home/user/CN-Project/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: '/tmp/browser/out/chromium', args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:1420/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/verify/shots/d2-topo.png' });
await page.getByRole('button', { name: 'Simulation & Events', exact: true }).click();
await page.waitForTimeout(1200);
await page.getByRole('button', { name: 'Inject Packet' }).click();
await page.waitForTimeout(700);
await page.screenshot({ path: '/tmp/verify/shots/d5-modal.png' });
const modal = page.locator('[role=dialog], .modal, [class*=modal]').first();
console.log('modal visible:', await modal.count());
// find inject submit inside modal
const submit = page.getByRole('button', { name: /inject/i }).last();
await submit.click().catch(e => console.log('submit click failed', String(e).slice(0,100)));
await page.waitForTimeout(800);
await page.getByRole('button', { name: 'Run All' }).click();
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/verify/shots/d36-sim.png' });
// element shot of filters
await page.locator('[data-testid=event-filters]').screenshot({ path: '/tmp/verify/shots/d3-filters.png' });
await browser.close();
console.log('done');
