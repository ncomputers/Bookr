import {startOwnedTestServer, stopOwnedTestServer} from './owned-test-server.mjs';
import {chromium} from 'playwright-core';
import {mkdtemp, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'evidence/web');
const port = 4386;
const base = `http://127.0.0.1:${port}`;
const directory = await mkdtemp(join(tmpdir(), 'bookr-funds-flow-browser-'));
let server, browser, page, serverOutput = '', step = 'startup';
const errors = [];

async function start() {
  server = await startOwnedTestServer({
    root,
    port,
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

  step = 'seed vouchers and accounts';
  const customer = await post('/api/customers', {name: 'Test Customer'});
  const supplier = await post('/api/suppliers', {name: 'Test Supplier'});
  const ledgers = await get('/api/state');
  const salesAccount = ledgers.ledgers.find(l => l.kind === 'sales').id;
  const purchaseAccount = ledgers.ledgers.find(l => l.kind === 'purchase').id;
  const bank = await post('/api/banks', {name: 'Primary Bank', bank: {account_number: '112233'}});
  const capital = await post('/api/ledgers', {name: 'Founders Capital', kind: 'capital'});

  // Create an overdrawn bank account to test Negative Ledgers exception report:
  const overdrawnBank = await post('/api/banks', {
    name: 'Overdrawn Credit Facility',
    kind: 'bank',
    group_name: 'Bank Accounts',
    opening_balance: -50000, // 500.00 Cr
    bank: {account_number: '998877'}
  });

  // Capital introduction into Primary Bank: 10,000.00
  await post('/api/vouchers', {
    type: 'receipt',
    date: '2026-04-01',
    ledger_id: capital.id,
    account_id: bank.id,
    amount: 1000000,
    details: {
      bank: {
        account_id: bank.id,
        transaction_type: 'Cheque/DD',
        amount: 1000000,
        instrument_number: '300001',
        instrument_date: '2026-04-01',
        bank_name: 'State Bank',
        cheque_range: ''
      }
    }
  });

  // Sale voucher on 2026-04-01: 5,000.00
  await post('/api/vouchers', {
    type: 'sale',
    date: '2026-04-01',
    customer_id: customer.id,
    account_id: salesAccount,
    amount: 500000
  });

  // Purchase voucher on 2026-04-05: 2,000.00
  await post('/api/vouchers', {
    type: 'purchase',
    date: '2026-04-05',
    supplier_id: supplier.id,
    account_id: purchaseAccount,
    amount: 200000
  });

  // Sale voucher on 2026-04-25: 1,500.00
  await post('/api/vouchers', {
    type: 'sale',
    date: '2026-04-25',
    customer_id: customer.id,
    account_id: salesAccount,
    amount: 150000
  });

  await page.reload({waitUntil: 'networkidle'});
  await page.getByRole('heading', {name: 'Gateway of Bookr', exact: true}).waitFor();

  step = 'open Display More Reports';
  await page.keyboard.press('d');
  await page.getByRole('heading', {name: 'Display More Reports', exact: true}).waitFor();
  await page.screenshot({path: join(output, 'funds-flow-1-reports-menu.png')});

  step = 'open Funds Flow from reports menu';
  await page.locator('#open-funds-flow').click();
  await page.getByRole('heading', {name: 'Funds Flow', exact: true}).waitFor();
  await page.locator('.funds-flow-report table tbody tr').first().waitFor();
  await page.screenshot({path: join(output, 'funds-flow-2-monthly-summary.png')});

  step = 'drilldown into April month in Funds Flow';
  await page.locator('[data-month-btn="2026-04"]').click();
  await page.getByRole('heading', {name: /Funds Flow - April/, exact: true}).waitFor();
  await page.locator('#table-sources').waitFor();
  await page.locator('#table-applications').waitFor();
  await page.locator('#table-working-capital-changes').waitFor();
  await page.screenshot({path: join(output, 'funds-flow-3-april-drilldown.png')});

  step = 'press Escape to go back to Funds Flow summary';
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Funds Flow', exact: true}).waitFor();

  step = 'press Escape to go back to Display More Reports';
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Display More Reports', exact: true}).waitFor();

  step = 'open Exception Reports menu';
  await page.locator('#open-exception-reports').click();
  await page.getByRole('heading', {name: 'Exception Reports', exact: true}).waitFor();
  await page.screenshot({path: join(output, 'exception-reports-1-menu.png')});

  step = 'open Negative Ledgers';
  await page.keyboard.press('n');
  await page.getByRole('heading', {name: 'List of Negative Ledgers', exact: true}).waitFor();
  await page.getByRole('button', {name: 'Overdrawn Credit Facility'}).waitFor();
  await page.screenshot({path: join(output, 'exception-reports-2-negative-ledgers.png')});

  step = 'press Escape back to Exception Reports menu';
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Exception Reports', exact: true}).waitFor();

  step = 'open Overdue Receivables';
  await page.keyboard.press('r');
  await page.getByRole('heading', {name: 'Bills - Overdue Receivables', exact: true}).waitFor();
  await page.screenshot({path: join(output, 'exception-reports-3-overdue-receivables.png')});

  step = 'test F2 As of in Overdue Receivables';
  await page.locator('#overdue-as-of-btn').click();
  const dateDialog = page.locator('.outstanding-asof-dialog');
  await dateDialog.waitFor();
  const dateInput = dateDialog.locator('input');
  await dateInput.fill('2026-04-10');
  await dateInput.press('Enter');
  await dateDialog.waitFor({state: 'detached'});

  // The 2026-04-01 bill is overdue as at 2026-04-10!
  await page.getByRole('heading', {name: 'Bills - Overdue Receivables', exact: true}).waitFor();
  await page.locator('.overdue-bills-report table tbody tr').first().waitFor();
  await page.screenshot({path: join(output, 'exception-reports-4-as-of-filter.png')});

  step = 'press Escape to return to Exception Reports menu';
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Exception Reports', exact: true}).waitFor();

  step = 'open Overdue Payables';
  await page.keyboard.press('p');
  await page.getByRole('heading', {name: 'Bills - Overdue Payables', exact: true}).waitFor();
  await page.screenshot({path: join(output, 'exception-reports-5-overdue-payables.png')});

  step = 'press Escape back to Exception Reports menu';
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Exception Reports', exact: true}).waitFor();

  step = 'press Escape back to Display More Reports';
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Display More Reports', exact: true}).waitFor();

  step = 'press Escape back to Gateway of Bookr';
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: 'Gateway of Bookr', exact: true}).waitFor();

  assert.deepEqual(errors, [], 'No unexpected page errors occurred during test');
  console.log('All Funds Flow and Exception Reports browser tests passed successfully.');
} catch (error) {
  console.error(`Failed at step "${step}":`, error);
  if (serverOutput) console.error('Server output:\n', serverOutput);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await stop();
  await rm(directory, {recursive: true, force: true});
}
