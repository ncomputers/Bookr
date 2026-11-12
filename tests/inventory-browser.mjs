import {startOwnedTestServer, stopOwnedTestServer} from './owned-test-server.mjs';
import { chromium } from 'playwright-core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(join(tmpdir(), 'bookr-inventory-browser-'));
const base = 'http://127.0.0.1:4323';
const errors = [];
let server, browser, page;

async function startServer() {
  server = await startOwnedTestServer({
    root,
    port: 4323,
    database: join(directory, 'browser.sqlite')
  });
}

try {
  await startServer();
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BOOKR_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  });
  page = await browser.newPage({viewport: {width: 1229, height: 655}});
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base, {waitUntil: 'networkidle'});
  await page.getByRole('heading', {name: 'Gateway of Bookr', exact: true}).waitFor();

  // 1. Verify Inventory Masters in Master Creation menu
  await page.getByRole('button', {name: 'Create', exact: true}).click();
  await page.getByRole('heading', {name: 'Master Creation', exact: true}).waitFor();
  await page.locator('#open-stock-group').waitFor();
  await page.locator('#open-stock-item').waitFor();
  await page.locator('#open-unit').waitFor();
  await page.locator('#open-godown').waitFor();

  // 2. Create Unit: Box
  await page.locator('#open-unit').click();
  await page.locator('#unit-master-form').waitFor();
  await page.locator('#unit-symbol').fill('Box');
  await page.locator('#unit-formal-name').fill('Boxes');
  await page.locator('#unit-uqc').selectOption('BOX-BOX');
  await page.keyboard.press('Control+a');
  await page.waitForFunction(() => document.querySelector('#screen-hint').textContent.includes('Saved Unit Box'));

  // Return to Master Creation
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Master Creation', exact: true}).waitFor();

  // 3. Create Godown: Central Warehouse
  await page.locator('#open-godown').click();
  await page.locator('#godown-master-form').waitFor();
  await page.locator('#godown-name').fill('Central Warehouse');
  await page.locator('#godown-address').fill('Plot 42, GIDC');
  await page.keyboard.press('Control+a');
  await page.waitForFunction(() => document.querySelector('#screen-hint').textContent.includes('Saved Godown Central Warehouse'));

  // Return to Master Creation
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Master Creation', exact: true}).waitFor();

  // 4. Create Stock Group: Hardware
  await page.locator('#open-stock-group').click();
  await page.locator('#stock-group-master-form').waitFor();
  await page.locator('#stock-group-name').fill('Hardware');
  await page.keyboard.press('Control+a');
  await page.waitForFunction(() => document.querySelector('#screen-hint').textContent.includes('Saved Stock Group Hardware'));

  // Return to Master Creation
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Master Creation', exact: true}).waitFor();

  // 5. Create Stock Item: Brass Screws with opening balance
  await page.locator('#open-stock-item').click();
  await page.locator('#stock-item-master-form').waitFor();
  await page.locator('#item-name').fill('Brass Screws');
  await page.locator('#item-part-number').fill('BS-01');
  await page.locator('#item-group').selectOption({label: 'Hardware'});
  await page.locator('#item-unit').selectOption({label: 'Box (Boxes)'});
  await page.locator('#item-hsn').fill('73181500');
  await page.locator('#item-gst-rate').fill('18');
  await page.locator('#item-opening-qty').fill('10');
  await page.locator('#item-opening-rate').fill('50.00');
  await page.locator('#item-opening-rate').dispatchEvent('input');
  assert.equal(await page.locator('#item-opening-val').inputValue(), '500.00');
  await page.keyboard.press('Control+a');
  await page.waitForFunction(() => document.querySelector('#screen-hint').textContent.includes('Saved Stock Item Brass Screws'));

  // Return to Master Creation then Gateway
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Master Creation', exact: true}).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Gateway of Bookr', exact: true}).waitFor();

  // 6. Verify Master Alteration selectors
  await page.getByRole('button', {name: 'Alter', exact: true}).click();
  await page.getByRole('heading', {name: 'Master Alteration', exact: true}).waitFor();
  await page.locator('#open-stock-item').click();
  await page.locator('#stock-item-search').waitFor();
  await page.locator('#stock-item-search').fill('Brass');
  await page.keyboard.press('Enter');
  await page.locator('#stock-item-master-form').waitFor();
  assert.equal(await page.locator('#item-name').inputValue(), 'Brass Screws');
  assert.equal(await page.locator('#item-part-number').inputValue(), 'BS-01');

  // Return to Gateway
  await page.keyboard.press('Escape');
  await page.locator('#stock-item-search').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Master Alteration', exact: true}).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Gateway of Bookr', exact: true}).waitFor();

  // 7. Create a Customer for Item Invoice sale
  await page.getByRole('button', {name: 'Create', exact: true}).click();
  await page.getByRole('button', {name: 'Ledger', exact: true}).click();
  await page.locator('#ledger-name').fill('Metro Builders');
  await page.keyboard.press('Control+a');
  await page.waitForFunction(() => document.querySelector('#screen-hint').textContent.includes('Saved Metro Builders'));
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Master Creation', exact: true}).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Gateway of Bookr', exact: true}).waitFor();

  // 8. Open Sales Voucher and switch to Item Invoice Mode
  await page.getByRole('button', {name: 'Vouchers', exact: true}).click();
  await page.getByRole('heading', {name: 'Accounting Voucher Creation', exact: true}).waitFor();
  assert.equal(await page.locator('.voucher-type').innerText(), 'Sales');

  // Toggle mode to Item Invoice
  await page.locator('#toggle-mode').click();
  await page.locator('.voucher-lines-heading.item-mode-heading').waitFor();

  // Fill Party and line details
  await page.locator('#sale-customer').fill('Metro Builders');
  await page.keyboard.press('Enter');
  // Dispatch details dialog appears - Ctrl+A through dispatch and party stages
  await page.locator('#voucher-details-dialog[data-stage="dispatch"]').waitFor();
  await page.keyboard.press('Control+a');
  await page.locator('#voucher-details-dialog[data-stage="party"]').waitFor();
  await page.keyboard.press('Control+a');
  await page.locator('#voucher-details-dialog').waitFor({state: 'detached'});

  // In item line: select Brass Screws
  const itemSelect = page.locator('.sale-line.item-line select.line-item');
  await itemSelect.selectOption({label: 'Brass Screws'});
  await itemSelect.dispatchEvent('change');

  // Fill Quantity and Rate
  await page.locator('.sale-line.item-line .line-qty').fill('3');
  await page.locator('.sale-line.item-line .line-qty').dispatchEvent('input');
  await page.locator('.sale-line.item-line .line-rate').fill('80.00');
  await page.locator('.sale-line.item-line .line-rate').dispatchEvent('input');

  assert.equal(await page.locator('.sale-line.item-line .line-amount').inputValue(), '240.00');
  // 3 * 80 = 240.00
  // Save sale voucher with Ctrl+A
  await page.keyboard.press('Control+a');

  // Bill reference popup appears for credit sale
  await page.locator('#bill-details-dialog').waitFor();
  await page.keyboard.press('Control+a');
  await page.locator('#bill-details-dialog').waitFor({state: 'detached'});
  await page.keyboard.press('Control+a');
  await page.waitForFunction(() => document.querySelector('#screen-hint').textContent.includes('Saved Sales No. 1'));

  // 9. Return to Gateway and check Stock Summary Report
  if (await page.locator('#party-options:not([hidden])').count()) {
    await page.keyboard.press('Escape');
  }
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Gateway of Bookr', exact: true}).waitFor();

  // Press S for Stock Summary
  await page.keyboard.press('s');
  await page.getByRole('heading', {name: 'Stock Summary', exact: true}).waitFor();

  // Verify the row content: Brass Screws opening 10, outwards 3, closing 7
  const summaryText = await page.locator('.stock-summary-report table').innerText();
  assert.ok(summaryText.includes('Brass Screws'), 'Report must display Brass Screws');
  assert.ok(summaryText.includes('10 Box'), 'Opening must show 10 Box');
  assert.ok(summaryText.includes('3 Box'), 'Outwards must show 3 Box');
  assert.ok(summaryText.includes('7 Box'), 'Closing must show 7 Box');

  // Verify grand total closing value: 7 * 50.00 = 350.00
  const totalVal = await page.locator('#stock-total-val').innerText();
  assert.equal(totalVal, '350.00', 'Closing stock valuation must be 350.00');

  // Check period filter button
  await page.locator('#stock-period').click();
  await page.locator('#report-period-dialog').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('#report-period-dialog').waitFor({state: 'detached'});

  // Return to Gateway
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Gateway of Bookr', exact: true}).waitFor();

  // 10. Check Stock Summary also accessible from Display More Reports
  await page.getByRole('button', {name: 'Display More Reports', exact: true}).click();
  await page.getByRole('heading', {name: 'Display More Reports', exact: true}).waitFor();
  await page.locator('#open-stock-summary').waitFor();
  await page.locator('#open-stock-summary').click();
  await page.getByRole('heading', {name: 'Stock Summary', exact: true}).waitFor();

  assert.equal(errors.length, 0, `Page errors: ${errors.join(', ')}`);
  console.log('inventory-browser.mjs passed successfully');
} finally {
  if (browser) await browser.close();
  if (server) await stopOwnedTestServer(server);
  await rm(directory, {recursive: true, force: true});
}
