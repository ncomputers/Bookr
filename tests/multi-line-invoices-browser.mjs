import assert from 'node:assert/strict';
import {browserFixture} from './browser-fixture.mjs';

function seed(book) {
  const customer = book.createCustomer({name: 'MultiLine Browser Client'});
  const freight = book.saveAccount({name: 'Freight Outward Fictional', kind: 'income'});
  return {customer, freight};
}

const test = await browserFixture({port: 4398, name: 'multi-line-invoices-browser', seed});
const {page, get, out, errors} = test;
let step = 'startup';

async function home() {
  await page.getByRole('link', {name: 'Bookr Gateway', exact: true}).click();
  await page.getByRole('heading', {name: 'Gateway of Bookr', exact: true}).waitFor();
}

async function dismissDetailsDialog() {
  await page.locator('#voucher-details-dialog').waitFor();
  await page.keyboard.press('Control+a');
  await page.locator('#voucher-details-dialog[data-stage="party"]').waitFor();
  await page.keyboard.press('Control+a');
  await page.locator('#voucher-details-dialog').waitFor({state: 'detached'});
}

async function dismissBillDialog() {
  await page.locator('#bill-details-dialog').waitFor();
  await page.keyboard.press('Control+a');
  await page.locator('#bill-details-dialog').waitFor({state: 'detached'});
}

try {
  // 1. Open Sales Voucher
  step = 'open Sales voucher';
  await home();
  await page.getByRole('button', {name: 'Vouchers', exact: true}).click();
  await page.locator('.voucher-type').waitFor();
  assert.equal(await page.locator('.voucher-type').innerText(), 'Sales');

  // 2. Select Party
  step = 'select customer';
  await page.locator('#sale-customer').focus();
  await page.locator('#sale-customer').fill('MultiLine Browser Client');
  await page.locator('[data-party="0"]').click();
  await dismissDetailsDialog();

  // 3. Fill first line: Sales 1000.00
  step = 'fill line 1';
  await page.locator('#sale-account').selectOption({label: 'Demo Sales'});
  await page.locator('#sale-amount').fill('1000.00');
  await page.locator('#sale-amount').dispatchEvent('input');

  // 4. Add second line: Freight Outward 50.00
  step = 'add line 2';
  await page.locator('#sale-add-line').click();
  await page.locator('.sale-line[data-line="1"]').waitFor();
  await page.locator('.sale-line[data-line="1"] .line-ledger').selectOption({label: 'Freight Outward Fictional'});
  await page.locator('.sale-line[data-line="1"] .line-amount').fill('50.00');
  await page.locator('.sale-line[data-line="1"] .line-amount').dispatchEvent('input');

  // 5. Verify total updates to 1,050.00
  step = 'verify total';
  assert.equal(await page.locator('#sale-total').innerText(), '1,050.00');

  // 6. Accept Bill Details and Save
  step = 'save multi-line sale';
  await page.locator('#sale-narration').fill('Multi-line sales browser test');
  await page.locator('#accept-sale').click();
  await dismissBillDialog();
  await page.keyboard.press('Control+a');
  await page.waitForFunction(() => document.querySelector('#screen-hint')?.textContent.includes('Saved Sales No. 1'));

  // 7. Verify backend voucher state
  step = 'verify backend voucher state';
  const state = await get('/api/state');
  const sale = state.vouchers.find(v => v.type === 'sale' && v.number === 1);
  assert.ok(sale);
  assert.equal(sale.amount, 105000);
  assert.ok(sale.lines);
  assert.equal(sale.lines.length, 2);
  assert.equal(sale.lines[0].amount, 100000);
  assert.equal(sale.lines[1].amount, 5000);

  // Postings: customer Dr 105000, 2 ledger credits
  const postings = sale.postings;
  assert.equal(postings.length, 3);
  const custPosting = postings.find(p => p.ledger_id === sale.customer_id);
  assert.equal(custPosting.side, 'debit');
  assert.equal(custPosting.amount, 105000);

  // 8. Open Day Book and reopen voucher to verify lines render
  step = 'reopen in Day Book';
  await home();
  await page.getByRole('button', {name: 'Day Book', exact: true}).click();
  await page.locator('.filtered-day-book').waitFor();
  await page.locator('[data-open-sale="1"]').click();
  await page.locator('.sale-line[data-line="1"]').waitFor();
  assert.equal(await page.locator('#sale-total').innerText(), '1,050.00');

  console.log(JSON.stringify({
    application: 'Bookr',
    passed: true,
    step,
    checks: 8,
    errors
  }));
} catch (err) {
  console.error(`Multi-line browser test failed at step "${step}":`, err);
  process.exitCode = 1;
} finally {
  await test.close();
}
