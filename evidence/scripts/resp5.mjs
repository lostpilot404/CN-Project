import { chromium } from '/home/user/CN-Project/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: '/tmp/browser/out/chromium', args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 320, height: 800 } });
await page.goto('http://127.0.0.1:1420/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.getByRole('button', { name: 'Transport Layer', exact: true }).click();
await page.waitForTimeout(1000);
await page.screenshot({ path: '/tmp/verify/shots/r13-trans-320.png' });
// can we reach the UDP tab?
const udp = page.getByRole('button', { name: 'UDP Studio' });
console.log('udp tab visible:', await udp.isVisible().catch(() => false));
if (await udp.count() > 0) { await udp.click(); await page.waitForTimeout(800); }
console.log('udp panel marker:', await page.getByText(/UDP Studio|Datagram/i).count());
await page.getByRole('button', { name: 'Application Layer', exact: true }).click();
await page.waitForTimeout(1000);
await page.screenshot({ path: '/tmp/verify/shots/r13-app-320.png' });
const snmp = page.getByRole('button', { name: 'SNMP Studio' });
console.log('snmp tab visible:', await snmp.isVisible().catch(() => false));
await browser.close();
console.log('done');
