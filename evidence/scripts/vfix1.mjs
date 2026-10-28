import { chromium } from '/home/user/CN-Project/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: '/tmp/browser/out/chromium', args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:1420/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

// --- 1. Prefix slider: drag from /24 to /26, check results follow ---
await page.getByRole('button', { name: 'Addressing & NAT', exact: true }).click();
await page.waitForTimeout(1500);
const slider = page.getByLabel('Prefix Slider');
console.log('slider present:', await slider.count());
if (await slider.count() > 0) {
  console.log('slider before:', await slider.inputValue());
  await slider.fill('26');
  await page.waitForTimeout(1200);
  console.log('slider after:', await slider.inputValue());
  const body = await page.textContent('main, body').then(t => t.slice(0, 1));
  const net = await page.getByText('192.168.1.0', { exact: false }).count();
  const bcast = await page.getByText('192.168.1.63').count(); // /26 broadcast of .0/26
  console.log('network .0 present:', net, '| /26 broadcast .63 present:', bcast);
  await page.screenshot({ path: '/tmp/verify/shots/v-slider.png' });
}

// --- 2. Addressing invalid input clears results (D4) ---
const ipv4input = page.locator('input[value*="192.168"]').first();
await ipv4input.fill('not-an-ip');
await page.waitForTimeout(1200);
console.log('addr error shown:', await page.getByText(/invalid|error|must|require/i).count() > 0);
console.log('stale Network Address card present:', await page.getByText('Network Address').count());
await page.screenshot({ path: '/tmp/verify/shots/v-addr-invalid.png' });
// split options should now be plain /p without counts
const opts = await page.locator('select[aria-label="Target Prefix"] option').allTextContents();
console.log('split options (no base):', JSON.stringify(opts.slice(0,3)), '... total', opts.length);
// restore
await ipv4input.fill('192.168.1.0/24');
await page.waitForTimeout(1200);
const opts2 = await page.locator('select[aria-label="Target Prefix"] option').allTextContents();
console.log('split options (base /24):', JSON.stringify(opts2.slice(0,2)));

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
  return el && el.textContent && el.textContent.includes('Inject Packet');
}));
await browser.close();
console.log('done');
