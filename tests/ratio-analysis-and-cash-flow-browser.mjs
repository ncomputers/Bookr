import {startOwnedTestServer, stopOwnedTestServer} from './owned-test-server.mjs';
import {chromium} from 'playwright-core';
import {mkdtemp, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'evidence/web');
const base = 'http://127.0.0.1:4384';
const directory = await mkdtemp(join(tmpdir(), 'bookr-ratio-browser-'));
let server, browser, page, serverOutput = '', step = 'startup';
const errors = [];

async function start() {
  server = await startOwnedTestServer({
    root,
    port: 4384,
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

  step = 'seed financial vouchers for ratio analysis and cash flow';
  const customer = await post('/api/customers', {name: 'Flow Customer'});
  const supplier = await post('/api/suppliers', {name: 'Flow Supplier'});
  const ledgers = await get('/api/state');
  const salesAccount = ledgers.ledgers.find(l => l.kind === 'sales').id;
  const purchaseAccount = ledgers.ledgers.find(l => l.kind === 'purchase').id;
  const bank = await post('/api/banks', {name: 'State Bank', bank: {account_number: '987654'}});
  const expense = await post('/api/ledgers', {name: 'Office Rent', kind: 'expense'});
  const capital = await post('/api/ledgers', {name: 'Founding Capital', kind: 'capital'});

  const bankAlloc = (type, amount, date) => ({
    account_id: bank.id,
    transaction_type: type === 'payment' ? 'Cheque' : 'Cheque/DD',
    amount,
    instrument_number: '200001',
    instrument_date: date,
    bank_name: 'Not Applicable',
    cheque_range: type === 'payment' ? 'Not Applicable' : ''
  });

  // 1. Capital funding receipt: 50,000.00
  await post('/api/vouchers', {
    type: 'receipt',
    date: '2026-04-01',
    ledger_id: capital.id,
    account_id: bank.id,
    amount: 5000000,
    details: {bank: bankAlloc('receipt', 5000000, '2026-04-01')},
    narration: 'Capital contribution'
  });

  // 2. Cash sale: 10,000.00
  await post('/api/vouchers', {
    type: 'sale',
    date: '2026-04-02',
    customer_id: 1,
    account_id: salesAccount,
    amount: 1000000,
    narration: 'Cash sale'
  });

  // 3. Credit sale: 5,000.00
  const creditSale = await post('/api/vouchers', {
    type: 'sale',
    date: '2026-04-03',
    customer_id: customer.id,
    account_id: salesAccount,
    amount: 500000,
    narration: 'Credit sale'
  });

  // 4. Cash purchase: 4,000.00
  await post('/api/vouchers', {
    type: 'purchase',
    date: '2026-04-04',
    supplier_id: 1,
    account_id: purchaseAccount,
    amount: 400000,
    narration: 'Cash purchase'
  });

  // 5. Customer receipt: 2,000.00
  await post('/api/vouchers', {
    type: 'receipt',
    date: '2026-04-05',
    customer_id: customer.id,
    account_id: bank.id,
    amount: 200000,
    allocations: [{bill_id: creditSale.bill.id, amount: 200000}],
    details: {bank: bankAlloc('receipt', 200000, '2026-04-05')},
    narration: 'Customer cheque'
  });

  // 6. Expense payment from Cash: 500.00
  await post('/api/vouchers', {
    type: 'payment',
    date: '2026-04-06',
    ledger_id: expense.id,
    account_id: 1,
    amount: 50000,
    narration: 'Rent cash'
  });

  // 7. Contra: 1,000.00 cash to bank
  await post('/api/vouchers', {
    type: 'contra',
    date: '2026-04-07',
    source_id: 1,
    destination_id: bank.id,
    amount: 100000,
    details: {
      bank: {
        account_id: bank.id,
        transaction_type: 'Cash',
        amount: 100000,
        instrument_number: '',
        instrument_date: '2026-04-07',
        bank_name: 'Not Applicable',
        cheque_range: '',
        denominations: { counts: {}, others: 0 }
      }
    },
    narration: 'Cash deposit'
  });

  step = 'reload gateway and test Ratio Analysis';
  await page.reload({waitUntil: 'networkidle'});
  await page.getByRole('heading', {name: 'Gateway of Bookr', exact: true}).waitFor();

  // Press R to open Ratio Analysis
  await page.keyboard.press('r');
  await page.getByRole('heading', {name: 'Ratio Analysis', exact: true}).waitFor();

  // Verify Ratio Analysis fields
  assert.equal(await page.locator('#val-sales').innerText(), '15,000.00 Cr');
  assert.equal(await page.locator('#val-cash-in-hand').innerText(), '4,500.00 Dr');
  assert.equal(await page.locator('#val-bank-accounts').innerText(), '53,000.00 Dr');
  assert.equal(await page.locator('#val-debtors').innerText(), '3,000.00 Dr');
  assert.equal(await page.locator('#val-working-capital').innerText(), '60,500.00 Dr');
  assert.equal(await page.locator('#val-gross-profit-pct').innerText(), '73.33 %');

  // Escape back to Gateway
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Gateway of Bookr', exact: true}).waitFor();

  step = 'open Display More Reports and test Cash/Bank Book(s)';
  await page.getByRole('button', {name: 'Display More Reports', exact: true}).click();
  await page.getByRole('heading', {name: 'Display More Reports', exact: true}).waitFor();

  await page.locator('#open-cash-bank-summary').click();
  await page.getByRole('heading', {name: 'Cash/Bank Summary', exact: true}).waitFor();

  assert.equal(await page.locator('#cash-bank-debit').innerText(), '57,500.00');

  // Click on Cash ledger to drill down to monthly summary
  await page.locator('[data-ledger-id="1"]').click();
  await page.getByRole('heading', {name: 'Ledger Monthly Summary', exact: true}).waitFor();

  // Escape back to Cash/Bank Summary
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Cash/Bank Summary', exact: true}).waitFor();

  // Escape back to Display More Reports
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Display More Reports', exact: true}).waitFor();

  step = 'test Cash Flow report and monthly drilldown';
  await page.locator('#open-cash-flow').click();
  await page.getByRole('heading', {name: 'Cash Flow', exact: true}).waitFor();

  // April totals: Inflow 62,000.00 (50k capital + 10k sale + 2k receipt), Outflow 4,500.00 (4k purchase + 500 rent)
  // Nett Flow = 57,500.00
  assert.equal(await page.locator('#cf-total-inflow').innerText(), '62,000.00');
  assert.equal(await page.locator('#cf-total-outflow').innerText(), '4,500.00');
  assert.equal(await page.locator('#cf-total-nett').innerText(), '57,500.00');

  // Click on April button to drill down
  await page.locator('[data-cash-flow-month="2026-04"]').click();
  await page.locator('.cash-flow-drilldown-screen').waitFor();

  assert.equal(await page.locator('#drill-inflow').innerText(), '62,000.00');
  assert.equal(await page.locator('#drill-outflow').innerText(), '4,500.00');
  assert.equal(await page.locator('#drill-nett-inflow').innerText(), '57,500.00');

  // Escape back to Cash Flow monthly summary
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Cash Flow', exact: true}).waitFor();

  // Escape back to Display More Reports
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Display More Reports', exact: true}).waitFor();

  // Escape back to Gateway
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Gateway of Bookr', exact: true}).waitFor();

  assert.equal(errors.length, 0, `Page errors: ${errors.join(', ')}`);
  console.log(JSON.stringify({passed: true, checks: 8}));
} catch (error) {
  if (page) await page.screenshot({path: join(output, 'ratio-cash-flow-failure.png'), fullPage: true}).catch(() => {});
  console.error(`Ratio Analysis & Cash Flow browser check failed at ${step}:`, error);
  throw error;
} finally {
  if (browser) await browser.close();
  await stop();
  await rm(directory, {recursive: true, force: true});
}
