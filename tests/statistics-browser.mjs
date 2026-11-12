import {startOwnedTestServer, stopOwnedTestServer} from './owned-test-server.mjs';
import {chromium} from 'playwright-core';
import {mkdtemp, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'evidence/web');
const base = 'http://127.0.0.1:4383';
const directory = await mkdtemp(join(tmpdir(), 'bookr-stats-browser-'));
let server, browser, page, serverOutput = '', step = 'startup';
const errors = [];

async function start() {
  server = await startOwnedTestServer({
    root,
    port: 4383,
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

  step = 'seed vouchers for statistics';
  const customer = await post('/api/customers', {name: 'Stats Customer'});
  const supplier = await post('/api/suppliers', {name: 'Stats Supplier'});
  const salesAccount = (await get('/api/state')).ledgers.find(l => l.kind === 'sales').id;
  const purchaseAccount = (await get('/api/state')).ledgers.find(l => l.kind === 'purchase').id;

  const sale = await post('/api/vouchers', {
    type: 'sale',
    date: '2026-04-10',
    customer_id: customer.id,
    account_id: salesAccount,
    amount: 10000
  });

  const purchase = await post('/api/vouchers', {
    type: 'purchase',
    date: '2026-04-11',
    supplier_id: supplier.id,
    account_id: purchaseAccount,
    amount: 20000
  });

  await post('/api/vouchers', {
    type: 'receipt',
    date: '2026-04-12',
    customer_id: customer.id,
    account_id: 1,
    amount: 5000,
    allocations: [{bill_id: sale.bill.id, amount: 5000}]
  });

  await post('/api/vouchers', {
    type: 'payment',
    date: '2026-04-13',
    supplier_id: supplier.id,
    account_id: 1,
    amount: 6000,
    allocations: [{bill_id: purchase.bill.id, amount: 6000}]
  });

  step = 'open Statistics from Display More Reports';
  await home();
  await page.getByRole('button', {name: 'Display More Reports', exact: true}).click();
  await page.locator('#open-statistics').waitFor();
  await page.locator('#open-statistics').click();

  step = 'verify Statistics screen';
  await page.locator('.statistics-screen').waitFor();
  assert.equal(await page.locator('.screen-title h1').textContent(), 'Statistics');

  // Verify voucher counts
  const salesRow = page.locator('tr[data-vch-type="sales"]');
  assert.ok((await salesRow.innerText()).includes('1'));

  const purchaseRow = page.locator('tr[data-vch-type="purchase"]');
  assert.ok((await purchaseRow.innerText()).includes('1'));

  const receiptRow = page.locator('tr[data-vch-type="receipt"]');
  assert.ok((await receiptRow.innerText()).includes('1'));

  const paymentRow = page.locator('tr[data-vch-type="payment"]');
  assert.ok((await paymentRow.innerText()).includes('1'));

  // Total should be 4
  const tfootText = await page.locator('.statistics-table tfoot').innerText();
  assert.ok(tfootText.includes('4'));

  // Types of accounts verification
  const groupsRow = page.locator('tr[data-acc-key="groups"]');
  assert.ok(Number((await groupsRow.locator('.amount').innerText()).trim()) >= 28);

  const ledgersRow = page.locator('tr[data-acc-key="ledgers"]');
  assert.ok(Number((await ledgersRow.locator('.amount').innerText()).trim()) >= 5);

  step = 'drill down into Sales Register from Statistics';
  await salesRow.locator('.stats-vch-btn').click();
  await page.locator('.register-summary-screen').waitFor();
  assert.equal(await page.locator('.screen-title h1').textContent(), 'Sales Register');

  step = 'escape back to More Reports and reopen Statistics';
  await page.keyboard.press('Escape');
  await page.locator('#open-statistics').waitFor();
  await page.locator('#open-statistics').click();
  await page.locator('.statistics-screen').waitFor();

  step = 'drill down into Payment Register from Statistics';
  await page.locator('tr[data-vch-type="payment"] .stats-vch-btn').click();
  await page.locator('.register-summary-screen').waitFor();
  assert.equal(await page.locator('.screen-title h1').textContent(), 'Payment Register');

  step = 'escape back to More Reports';
  await page.keyboard.press('Escape');
  await page.locator('#open-statistics').waitFor();

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({passed: true, checks: 6}));
} catch (error) {
  console.error('Statistics browser test failed at ' + step, error);
  throw error;
} finally {
  try { await browser?.close(); } finally { await stop(); await rm(directory, {recursive: true, force: true}); }
}
