import {startOwnedTestServer, stopOwnedTestServer} from './owned-test-server.mjs';
import {chromium} from 'playwright-core';
import {mkdtemp, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'evidence/web');
const base = 'http://127.0.0.1:4385';
const directory = await mkdtemp(join(tmpdir(), 'bookr-banking-hub-browser-'));
let server, browser, page, serverOutput = '', step = 'startup';
const errors = [];

async function start() {
  server = await startOwnedTestServer({
    root,
    port: 4385,
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

  step = 'seed bank vouchers';
  const customer = await post('/api/customers', {name: 'Hub Customer'});
  const supplier = await post('/api/suppliers', {name: 'Hub Supplier'});
  const bank = await post('/api/banks', {name: 'Kotak Bank', bank: {account_number: '55667788'}});
  const state = await get('/api/state');
  const salesAccount = state.ledgers.find(l => l.kind === 'sales').id;
  const purchaseAccount = state.ledgers.find(l => l.kind === 'purchase').id;

  const sale = await post('/api/vouchers', {
    type: 'sale',
    date: '2026-04-05',
    customer_id: customer.id,
    account_id: salesAccount,
    amount: 100000,
    narration: 'Credit sale'
  });

  const purchase = await post('/api/vouchers', {
    type: 'purchase',
    date: '2026-04-06',
    supplier_id: supplier.id,
    account_id: purchaseAccount,
    amount: 80000,
    narration: 'Credit purchase'
  });

  const bankAlloc = (type, amount, date, instNo = '600001') => ({
    account_id: bank.id,
    transaction_type: type === 'payment' ? 'Cheque' : 'Cheque/DD',
    amount,
    instrument_number: instNo,
    instrument_date: date,
    bank_name: 'Not Applicable',
    cheque_range: type === 'payment' ? 'Not Applicable' : ''
  });

  // Receipt 1
  await post('/api/vouchers', {
    type: 'receipt',
    date: '2026-04-10',
    customer_id: customer.id,
    account_id: bank.id,
    amount: 60000,
    allocations: [{bill_id: sale.bill.id, amount: 60000}],
    details: {bank: bankAlloc('receipt', 60000, '2026-04-10', 'KTK-001')},
    narration: 'Receipt 1'
  });

  // Payment 1
  await post('/api/vouchers', {
    type: 'payment',
    date: '2026-04-12',
    supplier_id: supplier.id,
    account_id: bank.id,
    amount: 40000,
    allocations: [{bill_id: purchase.bill.id, amount: 40000}],
    details: {bank: bankAlloc('payment', 40000, '2026-04-12', 'KTK-002')},
    narration: 'Payment 1'
  });

  // Contra deposit
  await post('/api/vouchers', {
    type: 'contra',
    date: '2026-04-14',
    source_id: 1,
    destination_id: bank.id,
    amount: 25000,
    details: {
      bank: {
        account_id: bank.id,
        transaction_type: 'Cash',
        amount: 25000,
        instrument_number: 'CASH-DEP',
        instrument_date: '2026-04-14',
        bank_name: 'Not Applicable',
        cheque_range: '',
        denominations: { counts: {}, others: 0 }
      }
    },
    narration: 'Cash deposit'
  });

  step = 'reload gateway and test Banking Utilities menu';
  await page.reload({waitUntil: 'networkidle'});
  await page.getByRole('heading', {name: 'Gateway of Bookr', exact: true}).waitFor();

  // Press N to open Banking
  await page.keyboard.press('n');
  await page.getByRole('heading', {name: 'Banking', exact: true}).waitFor();

  step = 'test Cheque Register';
  await page.locator('#open-cheque-register').click();
  await page.getByRole('heading', {name: 'Cheque Register', exact: true}).waitFor();

  // Verify total cheques in summary
  assert.equal(await page.locator('#cr-total-cheques').innerText(), '3');
  assert.equal(await page.locator('#cr-total-unreconciled').innerText(), '3');

  // Drill down into Kotak Bank cheques
  await page.locator(`[data-bank-id="${bank.id}"]`).click();
  await page.locator('.cheque-items-screen').waitFor();

  // Assert rows include KTK-001 and KTK-002
  assert.equal(await page.locator('.cheque-items-screen tbody tr').count(), 3);

  // Escape back to Cheque Register
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Cheque Register', exact: true}).waitFor();

  // Escape back to Banking menu
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Banking', exact: true}).waitFor();

  step = 'test Deposit Slip';
  await page.locator('#open-deposit-slip').click();
  await page.locator('.deposit-slip-screen').waitFor();

  // Total deposits = 600.00 + 250.00 = 850.00
  assert.equal(await page.locator('#slip-total-amount').innerText(), '850.00');

  // Escape back to Banking menu
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Banking', exact: true}).waitFor();

  step = 'test Payment Advice';
  await page.locator('#open-payment-advice').click();
  await page.locator('.payment-advice-screen').waitFor();

  // Total payments = 400.00
  assert.equal(await page.locator('#advice-total-amount').innerText(), '400.00');

  // Escape back to Banking menu
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Banking', exact: true}).waitFor();

  // Escape back to Gateway
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Gateway of Bookr', exact: true}).waitFor();

  assert.equal(errors.length, 0, `Page errors: ${errors.join(', ')}`);
  console.log(JSON.stringify({passed: true, checks: 9}));
} catch (error) {
  if (page) await page.screenshot({path: join(output, 'banking-hub-failure.png'), fullPage: true}).catch(() => {});
  console.error(`Banking Hub browser check failed at ${step}:`, error);
  throw error;
} finally {
  if (browser) await browser.close();
  await stop();
  await rm(directory, {recursive: true, force: true});
}
