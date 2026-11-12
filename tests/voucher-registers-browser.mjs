import {startOwnedTestServer, stopOwnedTestServer} from './owned-test-server.mjs';
import {chromium} from 'playwright-core';
import {mkdtemp, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'evidence/web');
const base = 'http://127.0.0.1:4382';
const directory = await mkdtemp(join(tmpdir(), 'bookr-reg-browser-'));
let server, browser, page, serverOutput = '', step = 'startup';
const errors = [];

async function start() {
  server = await startOwnedTestServer({
    root,
    port: 4382,
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

  step = 'seed vouchers for registers';
  const customer = await post('/api/customers', {name: 'Register Customer'});
  const supplier = await post('/api/suppliers', {name: 'Register Supplier'});
  const salesAccount = (await get('/api/state')).ledgers.find(l => l.kind === 'sales').id;
  const purchaseAccount = (await get('/api/state')).ledgers.find(l => l.kind === 'purchase').id;
  const expense = await post('/api/ledgers', {name: 'Office Tea Expense', kind: 'expense'});

  // Sales in April
  await post('/api/vouchers', {
    type: 'sale',
    date: '2026-04-15',
    customer_id: customer.id,
    account_id: salesAccount,
    amount: 50000
  });

  // Sales in May
  await post('/api/vouchers', {
    type: 'sale',
    date: '2026-05-10',
    customer_id: customer.id,
    account_id: salesAccount,
    amount: 80000
  });

  // Purchase in April
  await post('/api/vouchers', {
    type: 'purchase',
    date: '2026-04-20',
    supplier_id: supplier.id,
    account_id: purchaseAccount,
    amount: 30000
  });

  // Journal in April
  await post('/api/vouchers', {
    type: 'journal',
    date: '2026-04-25',
    debit_ledger_id: expense.id,
    credit_ledger_id: supplier.id,
    debit_amount: 15000,
    credit_amount: 15000,
    narration: 'Office tea'
  });

  step = 'open Sales Register from Display More Reports';
  await home();
  await page.getByRole('button', {name: 'Display More Reports', exact: true}).click();
  await page.locator('#open-sales-register').waitFor();
  await page.locator('#open-sales-register').click();

  step = 'verify Sales Register monthly summary';
  await page.locator('.register-summary-screen').waitFor();
  const title = await page.locator('.screen-title h1').textContent();
  assert.equal(title, 'Sales Register');

  // Verify April row shows 500.00 and May row shows 800.00
  const aprilRow = page.locator('tr[data-month-index="0"]'); // April is first fiscal month
  assert.ok((await aprilRow.innerText()).includes('500.00'));
  assert.ok((await aprilRow.innerText()).includes('500.00 Cr'));

  const mayRow = page.locator('tr[data-month-index="1"]'); // May is second fiscal month
  assert.ok((await mayRow.innerText()).includes('800.00'));
  assert.ok((await mayRow.innerText()).includes('1,300.00 Cr'));

  step = 'drill down into April sales';
  await aprilRow.locator('.month-btn').click();
  await page.locator('.register-month-screen').waitFor();
  const monthRows = await page.locator('.register-month-screen tbody tr').count();
  assert.equal(monthRows, 1);
  assert.ok((await page.locator('.register-month-screen tbody tr').first().innerText()).includes('Register Customer'));

  step = 'toggle F8 Columnar view';
  await page.keyboard.press('F8');
  await page.waitForFunction(() => document.querySelector('.register-month-screen th:nth-child(5)') !== null);
  const colHeaders = await page.locator('.register-month-screen thead th').allTextContents();
  assert.ok(colHeaders.some(h => h.includes('Gross Total')));

  step = 'drill down into sales voucher alteration';
  await page.locator('.vch-btn').first().click();
  await page.locator('#sales-form').waitFor();
  assert.equal(await page.locator('#sale-customer').inputValue(), 'Register Customer');

  step = 'escape back through month and summary to More Reports';
  await page.keyboard.press('Escape');
  await page.locator('.register-month-screen').waitFor();

  await page.keyboard.press('Escape');
  await page.locator('.register-summary-screen').waitFor();

  await page.keyboard.press('Escape');
  await page.locator('#open-purchase-register').waitFor();

  step = 'verify Purchase Register';
  await page.locator('#open-purchase-register').click();
  await page.locator('.register-summary-screen').waitFor();
  assert.equal(await page.locator('.screen-title h1').textContent(), 'Purchase Register');
  const purchaseAprilRow = page.locator('tr[data-month-index="0"]');
  assert.ok((await purchaseAprilRow.innerText()).includes('300.00'));
  assert.ok((await purchaseAprilRow.innerText()).includes('300.00 Dr'));

  await page.keyboard.press('Escape');
  await page.locator('#open-journal-register').waitFor();

  step = 'verify Journal Register with Total Vouchers count';
  await page.locator('#open-journal-register').click();
  await page.locator('.register-summary-screen').waitFor();
  assert.equal(await page.locator('.screen-title h1').textContent(), 'Journal Register');
  const journalThs = await page.locator('.register-summary-screen thead th').allTextContents();
  assert.ok(journalThs.includes('Total Vouchers'));
  const journalAprilRow = page.locator('tr[data-month-index="0"]');
  assert.ok((await journalAprilRow.innerText()).includes('1'));

  await page.keyboard.press('Escape');
  await page.locator('#open-journal-register').waitFor();

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({passed: true, checks: 6}));
} catch (error) {
  console.error('Voucher registers browser test failed at ' + step, error);
  throw error;
} finally {
  try { await browser?.close(); } finally { await stop(); await rm(directory, {recursive: true, force: true}); }
}
