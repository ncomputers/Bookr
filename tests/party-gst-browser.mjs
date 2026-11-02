import {startOwnedTestServer,stopOwnedTestServer} from './owned-test-server.mjs';
import { chromium } from 'playwright-core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(join(tmpdir(), 'bookr-gst-browser-'));
const base = 'http://127.0.0.1:4321';
const errors = [];
let server, browser, page;

async function startServer() {
  server = await startOwnedTestServer({
    root,
    port: 4321,
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

  // 1. Create a customer with GSTIN
  await page.getByRole('button', {name: 'Create', exact: true}).click();
  await page.getByRole('button', {name: 'Ledger', exact: true}).click();

  await page.locator('#ledger-name').fill('Acme Maharashtra Client');
  await page.locator('#ledger-gstin').fill('27AAPFU0939F1ZV');
  await page.locator('#ledger-gstin').dispatchEvent('input');

  const stateVal = await page.locator('#mailing-state').inputValue();
  assert.equal(stateVal, 'Maharashtra');

  const regVal = await page.locator('#ledger-gst-registration-type').inputValue();
  assert.equal(regVal, 'Regular');

  await page.keyboard.press('Control+a');
  await page.waitForFunction(() => document.querySelector('#screen-hint').textContent.includes('Saved Acme Maharashtra Client'));

  // 2. Create a Tax Ledger under Duties & Taxes
  await page.locator('#ledger-name').fill('Output CGST');
  await page.locator('#ledger-group').selectOption({label: 'Duties & Taxes'});
  await page.locator('#ledger-group').dispatchEvent('change');

  assert.equal(await page.locator('.tax-ledger-settings').isVisible(), true);
  await page.locator('#ledger-tax-type').selectOption('CGST');
  await page.locator('#ledger-tax-rate').fill('9');

  await page.keyboard.press('Control+a');
  await page.waitForFunction(() => document.querySelector('#screen-hint').textContent.includes('Saved Output CGST'));

  // 3. Verify via /api/state
  const state = await (await page.request.get(base + '/api/state')).json();
  const customer = state.ledgers.find(l => l.name === 'Acme Maharashtra Client');
  assert.ok(customer);
  assert.equal(customer.gstin, '27AAPFU0939F1ZV');
  assert.equal(customer.gst_registration_type, 'Regular');
  assert.equal(customer.state, 'Maharashtra');

  const taxLedger = state.ledgers.find(l => l.name === 'Output CGST');
  assert.ok(taxLedger);
  assert.equal(taxLedger.tax_type, 'CGST');
  assert.equal(taxLedger.tax_rate, 9);

  // 4. Return to Master Creation -> Gateway
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Master Creation', exact: true}).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Gateway of Bookr', exact: true}).waitFor();

  assert.equal(errors.length, 0, `Browser errors: ${errors.join(', ')}`);
} finally {
  if (browser) await browser.close();
  await stopOwnedTestServer(server);
  await rm(directory, {recursive: true, force: true});
}
