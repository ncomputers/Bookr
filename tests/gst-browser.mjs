import {startOwnedTestServer,stopOwnedTestServer} from './owned-test-server.mjs';
import { chromium } from 'playwright-core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(join(tmpdir(), 'bookr-gst-flow-browser-'));
const base = 'http://127.0.0.1:4322';
const errors = [];
let server, browser, page;

async function startServer() {
  server = await startOwnedTestServer({
    root,
    port: 4322,
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

  // 1. Create a customer with Maharashtra GSTIN
  await page.getByRole('button', {name: 'Create', exact: true}).click();
  await page.getByRole('button', {name: 'Ledger', exact: true}).click();

  await page.locator('#ledger-name').fill('GST Client Mumbai');
  await page.locator('#ledger-gstin').fill('27AAPFU0939F1ZV');
  await page.locator('#ledger-gstin').dispatchEvent('input');

  assert.equal(await page.locator('#mailing-state').inputValue(), 'Maharashtra');
  await page.keyboard.press('Control+a');
  await page.waitForFunction(() => document.querySelector('#screen-hint').textContent.includes('Saved GST Client Mumbai'));

  // 2. Return to Gateway
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Master Creation', exact: true}).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Gateway of Bookr', exact: true}).waitFor();

  // 3. Post a GST Sale voucher via API
  const stateBefore = await (await page.request.get(base + '/api/state')).json();
  const customer = stateBefore.ledgers.find(l => l.name === 'GST Client Mumbai');
  const salesAccount = stateBefore.ledgers.find(l => l.kind === 'sales');

  const vchRes = await page.request.post(base + '/api/vouchers', {
    data: {
      type: 'sale',
      date: '2026-05-10',
      customer_id: customer.id,
      account_id: salesAccount.id,
      lines: [
        {
          ledger_id: salesAccount.id,
          amount: 100000,
          hsn_sac: '8471',
          gst_rate: 18
        }
      ]
    }
  });
  assert.equal(vchRes.status(), 201);
  const createdVoucher = await vchRes.json();
  assert.equal(createdVoucher.amount, 118000);
  assert.equal(createdVoucher.details.gst.total_tax, 18000);

  // 4. Navigate to Display More Reports -> GST Summary
  await page.getByRole('button', {name: 'Display More Reports', exact: true}).click();
  await page.getByRole('heading', {name: 'Display More Reports', exact: true}).waitFor();

  await page.locator('#open-gst-summary').click();
  await page.getByRole('heading', {name: 'GST Summary', exact: true}).waitFor();

  // 5. Assert GST Summary values rendered on page
  const netTotalText = await page.locator('#gst-net-total').innerText();
  assert.equal(netTotalText, '180.00');

  // Verify outward supplies total
  const pageContent = await page.content();
  assert.ok(pageContent.includes('B2B Supplies'));
  assert.ok(pageContent.includes('8471'));
  assert.ok(pageContent.includes('18%'));

  // 6. Return back to Display More Reports -> Gateway
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Display More Reports', exact: true}).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Gateway of Bookr', exact: true}).waitFor();

  assert.equal(errors.length, 0, `Browser errors: ${errors.join(', ')}`);
} finally {
  if (browser) await browser.close();
  await stopOwnedTestServer(server);
  await rm(directory, {recursive: true, force: true});
}
