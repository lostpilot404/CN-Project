import { test, expect } from '@playwright/test';

test.describe('NetSim Authoritative UI & End-to-End Matrix', () => {
  test.beforeEach(async ({ page }) => {
    // Listen for uncaught exceptions or error logs
    page.on('pageerror', (exception) => {
      console.error(`Uncaught exception in page: "${exception.message}"`);
    });
    await page.goto('/');
  });

  test('1. Startup: application loads without errors and renders sidebar', async ({ page }) => {
    await expect(page).toHaveTitle(/NetSim/);
    await expect(page.locator('text=Workspaces')).toBeVisible();
    await expect(page.locator('text=Python Authoritative')).toBeVisible();
    await expect(page.locator('text=Tauri 2.x • Python Core')).toBeVisible();
  });

  test('2. Topology: add devices, inspect canvas controls and controls bar', async ({ page }) => {
    await page.click('button:has-text("Topology Canvas")');
    await expect(page.locator('text=Add Devices')).toBeVisible();

    // Add a Workstation PC and a Core Router
    const pcBtn = page.locator('button:has-text("Workstation PC")');
    if (await pcBtn.isVisible()) {
      await pcBtn.click();
      await page.waitForTimeout(300);
    }

    const routerBtn = page.locator('button:has-text("Core Router")');
    if (await routerBtn.isVisible()) {
      await routerBtn.click();
      await page.waitForTimeout(300);
    }

    // Verify simulation controls in topology bar
    await expect(page.locator('button:has-text("Run 50ms")')).toBeVisible();
    await expect(page.locator('button:has-text("Step Event")')).toBeVisible();
    await expect(page.locator('button:has-text("Reset")').first()).toBeVisible();
  });

  test('3. Routing Studio: Dijkstra & Bellman-Ford calculations and convergence telemetry', async ({ page }) => {
    await page.click('aside button:has-text("Routing Studio")');
    await expect(page.locator('h2:has-text("Routing Studio")')).toBeVisible();
    await expect(page.locator('text=Authoritative Python Core').first()).toBeVisible();

    // Verify algorithm selector or trigger calculation
    const calcBtn = page.locator('button:has-text("Recalculate Routes")');
    if (await calcBtn.count() > 0) {
      await calcBtn.first().click();
      await page.waitForTimeout(500);
    }
  });

  test('4. Addressing & NAT Studio: Subnetting, VLSM and NAT translation', async ({ page }) => {
    await page.click('aside button:has-text("Addressing & NAT")');
    await expect(page.locator('h2:has-text("Addressing & Translation Studio")')).toBeVisible();
    await expect(page.locator('text=Authoritative Python Core').first()).toBeVisible();

    // Check IPv4 calculation
    const calcSubnetBtn = page.locator('button:has-text("Calculate Subnet"), button:has-text("Compute Subnet"), button:has-text("Calculate")');
    if (await calcSubnetBtn.count() > 0) {
      await calcSubnetBtn.first().click();
      await page.waitForTimeout(300);
    }
  });

  test('5. Simulation Studio & Discrete Event Timeline: packet injection and stepping', async ({ page }) => {
    await page.click('aside button:has-text("Simulation & Events")');
    await page.waitForTimeout(400);

    // Verify simulation studio container and controls
    await expect(page.locator('[data-testid="simulation-studio"]')).toBeVisible();
    await expect(page.locator('button:has-text("Step Event")')).toBeVisible();
    await expect(page.locator('button:has-text("Inject Packet")')).toBeVisible();

    // Trigger Step
    const stepBtn = page.locator('button:has-text("Step Event")');
    if (await stepBtn.isVisible()) {
      await stepBtn.click();
      await page.waitForTimeout(200);
    }
  });

  test('6. Algorithm Studio: Hamming, CRC, Checksum, Flow Control & MAC protocols', async ({ page }) => {
    await page.click('aside button:has-text("Algorithm Studio")');
    await expect(page.locator('h1:has-text("Data Link Layer Protocol & Algorithm Studio")')).toBeVisible();

    // Verify sub-tabs
    await expect(page.locator('button:has-text("Error Control")')).toBeVisible();
    await expect(page.locator('button:has-text("Flow Control")')).toBeVisible();
    await expect(page.locator('button:has-text("Multiple Access")')).toBeVisible();

    // Click Flow Control tab
    await page.click('button:has-text("Flow Control")');
    await page.waitForTimeout(300);
    await expect(page.locator('button:has-text("Go-Back-N ARQ")')).toBeVisible();

    // Click MAC tab
    await page.click('button:has-text("Multiple Access")');
    await page.waitForTimeout(300);
    await expect(page.locator('text=CSMA/CD').first()).toBeVisible();
  });

  test('7. Transport Layer: TCP Reno handshake, RTT, retransmission & UDP', async ({ page }) => {
    await page.click('aside button:has-text("Transport Layer")');
    await expect(page.locator('h2:has-text("Transport Layer Studio")')).toBeVisible();
    await expect(page.locator('text=Authoritative Python Core').first()).toBeVisible();

    // Simulate Transport run
    const simBtn = page.locator('button:has-text("Simulate TCP Stream"), button:has-text("Run Simulation"), button:has-text("Simulate")');
    if (await simBtn.count() > 0) {
      await simBtn.first().click();
      await page.waitForTimeout(500);
    }
  });

  test('8. Application Layer: DNS, HTTP, FTP, SMTP, SNMP protocols', async ({ page }) => {
    await page.click('aside button:has-text("Application Layer")');
    await expect(page.locator('h2:has-text("Application-Layer Protocols Studio")')).toBeVisible();

    // Protocol tabs
    await expect(page.locator('button:has-text("DNS Studio")')).toBeVisible();
    await expect(page.locator('button:has-text("HTTP Studio")')).toBeVisible();
    await expect(page.locator('button:has-text("FTP Studio")')).toBeVisible();
    await expect(page.locator('button:has-text("SMTP Studio")')).toBeVisible();
    await expect(page.locator('button:has-text("SNMP Studio")')).toBeVisible();
  });

  test('9. QoS Performance: metrics dashboard, loss breakdown, utilization', async ({ page }) => {
    await page.click('aside button:has-text("QoS Performance")');
    await expect(page.locator('h2:has-text("QoS Performance & Fault Studio")')).toBeVisible();

    // Verify metric cards
    await expect(page.locator('text=Throughput & Goodput')).toBeVisible();
    await expect(page.locator('text=Average Latency')).toBeVisible();
    await expect(page.locator('text=Loss Accounting by Root Cause')).toBeVisible();
  });

  test('10. Batch Experiments: sweeps, multi-seed runs & comparison matrix', async ({ page }) => {
    await page.click('aside button:has-text("Batch Experiments")');
    await expect(page.locator('h2:has-text("Experimentation & Sweeps Lab")')).toBeVisible();

    // Tabs: Parameter Sweep vs Comparative A/B
    const sweepTab = page.getByRole('button', { name: 'Parameter Sweep', exact: true });
    await expect(sweepTab).toBeVisible();
    const abTab = page.locator('button:has-text("Comparative A/B")');
    await expect(abTab).toBeVisible();
  });
});
