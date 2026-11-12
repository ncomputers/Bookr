import {startOwnedTestServer, stopOwnedTestServer} from './owned-test-server.mjs';
import {chromium} from 'playwright-core';
import {mkdtemp, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'evidence/web');
const base = 'http://127.0.0.1:4381';
const directory = await mkdtemp(join(tmpdir(), 'bookr-brs-browser-'));
let server, browser, page, serverOutput = '', step = 'startup';
const errors = [];

async function start() {
  server = await startOwnedTestServer({
    root,
    port: 4381,
    database: join(directory, 'book.sqlite'),
    onOutput: text => { serverOutput += text; }
  });
}

async function stop() {
  await stopOwnedTestServer(server);
}

async function get(path) {
  const response = await page.request.get(base + path);
  assert.equal(response.ok(), true, await response.text());
  return response.json();
}

async function post(path, data) {
  const response = await page.request.post(base + path, {data});
  assert.equal(response.ok(), true, await response.text());
  return response.json();
}

async function home() {
  await page.getByRole('link', {name: 'Bookr Gateway', exact: true}).click();
  await page.getByRole('heading', {name: 'Gateway of Bookr', exact: true}).waitFor();
}

try {
  await mkdir(output, {recursive: true});
  await start();
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BOOKR_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  });
  page = await browser.newPage({viewport: {width: 1229, height: 655}, deviceScaleFactor: 1});
  page.on('pageerror', e => errors.push(e.message));
  page.setDefaultTimeout(5000);
  await page.goto(base, {waitUntil: 'networkidle'});

  step = 'seed vouchers with bank transactions';
  const customer = await post('/api/customers', {name: 'BRS Demo Customer'});
  const supplier = await post('/api/suppliers', {name: 'BRS Demo Supplier'});
  const bank = await post('/api/banks', {
    name: 'Study Bank Fictional',
    alias: 'SBF',
    bank: {account_number: '1234567890', branch: 'Demo Branch'}
  });
  const purchaseAccount = (await get('/api/state')).ledgers.find(l => l.kind === 'purchase').id;

  const sale = await post('/api/vouchers', {
    type: 'sale',
    date: '2026-04-01',
    customer_id: customer.id,
    account_id: 2,
    amount: 50000
  });

  const purchase = await post('/api/vouchers', {
    type: 'purchase',
    date: '2026-04-01',
    supplier_id: supplier.id,
    account_id: purchaseAccount,
    amount: 30000
  });

  // Receipt of 300.00 into Bank
  await post('/api/vouchers', {
    type: 'receipt',
    date: '2026-04-01',
    customer_id: customer.id,
    account_id: bank.id,
    amount: 30000,
    allocations: [{bill_id: sale.bill.id, amount: 30000}],
    details: {
      bank: {
        account_id: bank.id,
        amount: 30000,
        transaction_type: 'Cheque/DD',
        instrument_number: '000101',
        instrument_date: '2026-04-01'
      }
    }
  });

  // Payment of 100.00 from Bank
  await post('/api/vouchers', {
    type: 'payment',
    date: '2026-04-01',
    supplier_id: supplier.id,
    account_id: bank.id,
    amount: 10000,
    allocations: [{bill_id: purchase.bill.id, amount: 10000}],
    details: {
      bank: {
        account_id: bank.id,
        amount: 10000,
        transaction_type: 'Cheque',
        instrument_number: '000201',
        instrument_date: '2026-04-01'
      }
    }
  });

  step = 'open Bank Reconciliation from Display More Reports';
  await home();
  await page.getByRole('button', {name: 'Display More Reports', exact: true}).click();
  await page.locator('#open-bank-reconciliation').waitFor();
  await page.locator('#open-bank-reconciliation').click();

  step = 'verify BRS screen contents matching Tally Prime';
  await page.locator('.bank-reconciliation-screen').waitFor();
  const screenTitle = await page.locator('.screen-title h1').textContent();
  assert.equal(screenTitle, 'Bank Reconciliation');

  // Verify book balance = 200.00
  const summaryPaneText = await page.locator('.brs-summary-pane').innerText();
  assert.ok(summaryPaneText.includes('200.00'));
  assert.ok(summaryPaneText.includes('300.00'));
  assert.ok(summaryPaneText.includes('100.00'));
  assert.ok(summaryPaneText.includes('0.00'));

  // There should be 2 rows (Receipt and Payment)
  const rows = await page.locator('.brs-table tbody tr').count();
  assert.equal(rows, 2);

  step = 'enter bank date and verify live recalculation';
  const firstDateInput = page.locator('.brs-date-input').first();
  await firstDateInput.fill('2026-04-02');
  await firstDateInput.dispatchEvent('input');

  // Live recalculation: receipt is now reconciled, so unreflected debit = 0, bank balance = 300.00
  const bankBalanceEl = await page.locator('#balance-as-per-bank').textContent();
  assert.equal(bankBalanceEl.trim(), '300.00');

  step = 'save bank reconciliation with Ctrl+A';
  await page.keyboard.press('Control+a');
  await page.waitForFunction(() => document.querySelector('#screen-hint').textContent.includes('saved successfully'));

  step = 'verify reopening BRS hides reconciled entry (Tally default)';
  // Esc back to More Reports
  await page.keyboard.press('Escape');
  await page.locator('#open-bank-reconciliation').waitFor();

  // Reopen BRS
  await page.locator('#open-bank-reconciliation').click();
  await page.locator('.bank-reconciliation-screen').waitFor();

  // Only 1 unreconciled row should be visible
  const unreconciledRowCount = await page.locator('.brs-table tbody tr').count();
  assert.equal(unreconciledRowCount, 1);

  step = 'toggle Basis of Values with Ctrl+B to view all vouchers';
  await page.keyboard.press('Control+b');
  await page.waitForFunction(() => document.querySelectorAll('.brs-table tbody tr').length === 2);
  const allRowsCount = await page.locator('.brs-table tbody tr').count();
  assert.equal(allRowsCount, 2);

  // Esc back to More Reports
  await page.keyboard.press('Escape');
  await page.locator('#open-bank-reconciliation').waitFor();

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({passed: true, checks: 7}));
} catch (error) {
  console.error('Bank reconciliation browser test failed at ' + step, error);
  throw error;
} finally {
  try { await browser?.close(); } finally { await stop(); await rm(directory, {recursive: true, force: true}); }
}
