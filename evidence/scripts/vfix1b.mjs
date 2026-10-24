import { chromium } from '/home/user/CN-Project/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: '/tmp/browser/out/chromium', args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:1420/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.getByRole('button', { name: 'Addressing & NAT', exact: true }).click();
await page.waitForTimeout(1500);
const opts2 = await page.locator('select[aria-label="Target Prefix"] option').allTextContents();
console.log('split options (base /24):', JSON.stringify(opts2.slice(0,2)), 'total', opts2.length);

// --- 3. DNS stale clear (D4) ---
await page.getByRole('button', { name: 'Application Layer', exact: true }).click();
await page.waitForTimeout(1200);
await page.getByRole('button', { name: 'Simulate DNS Query' }).click();
await page.waitForTimeout(1500);
console.log('dns NOERROR present:', await page.getByText('NOERROR').count());
await page.getByLabel('Query Domain Name').fill('');
await page.getByRole('button', { name: 'Simulate DNS Query' }).click();
await page.waitForTimeout(1200);
console.log('dns empty-error present:', await page.getByText(/must not be empty/i).count());
console.log('stale NOERROR after error:', await page.getByText('NOERROR').count());
console.log('stale transaction/packet inspector:', await page.getByText('pkt-dns').count());
await page.screenshot({ path: '/tmp/verify/shots/v-dns-empty.png' });

// --- 4. Modal Escape + focus return (D5) ---
await page.getByRole('button', { name: 'Simulation & Events', exact: true }).click();
await page.waitForTimeout(1200);
const opener = page.getByRole('button', { name: 'Inject Packet' }).first();
await opener.click();
await page.waitForTimeout(700);
const dialog = page.locator('[role=dialog]');
console.log('dialog role present:', await dialog.count());
console.log('focus inside dialog:', await page.evaluate(() => {
  const d = document.querySelector('[role=dialog]');
  return d ? d.contains(document.activeElement) : false;
}));
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
console.log('dialog closed by Escape:', await dialog.count() === 0);
console.log('focus returned to opener:', await page.evaluate(() => {
  const el = document.activeElement;
  return !!(el && el.textContent && el.textContent.includes('Inject Packet'));
}));
await browser.close();
console.log('done');
