import assert from 'node:assert/strict';
import {browserFixture} from './browser-fixture.mjs';

function seed(book) {
  const customer = book.createCustomer({name: 'Browser Customer Fictional'});
  const supplier = book.saveSupplier({name: 'Browser Supplier Fictional'});
  const salesAccount = book.ledgers().find(l => l.kind === 'sales');
  const purchaseAccount = book.ledgers().find(l => l.kind === 'purchase');
  const sale = book.saveVoucher({
    type: 'sale',
    date: '2026-04-01',
    customer_id: customer.id,
    account_id: salesAccount.id,
    amount: 150000,
    bill: {reference: 'INV-888'}
  });
  const purchase = book.saveVoucher({
    type: 'purchase',
    date: '2026-04-01',
    supplier_id: supplier.id,
    account_id: purchaseAccount.id,
    amount: 100000,
    details: {supplier_invoice: {number: 'BILL-999', date: '2026-04-01'}}
  });
  return {customer, supplier, sale, purchase};
}

const test = await browserFixture({port: 4399, name: 'debit-credit-notes-browser', seed});
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
  // 1. Open Vouchers from Gateway and switch to Debit Note using Alt+F5
  step = 'open Debit Note via Alt+F5';
  await home();
  await page.getByRole('button', {name: 'Vouchers', exact: true}).click();
  await page.locator('.voucher-type').waitFor();
  await page.keyboard.press('Alt+F5');
  await page.waitForFunction(() => document.querySelector('.voucher-type')?.textContent === 'Debit Note');

  // 2. Fill Debit Note form
  step = 'fill Debit Note';
  await page.locator('#note-invoice').fill('BILL-999');
  await page.locator('#note-party').focus();
  await page.locator('#note-party').fill('Browser Supplier');
  await page.locator('[data-party-idx="0"]').click();
  await dismissDetailsDialog();

  await page.locator('#note-amount').fill('250.00');
  await page.locator('#note-amount').focus();
  await page.keyboard.press('Enter');
  await dismissBillDialog();

  await page.locator('#note-narration').fill('Return defective materials to supplier');
  await page.locator('#accept-note').click();
  await page.waitForFunction(() => document.querySelector('#screen-hint')?.textContent.includes('Saved Debit Note No. 1'));

  // 3. Switch to Credit Note using Alt+F6
  step = 'open Credit Note via Alt+F6';
  await page.keyboard.press('Alt+F6');
  await page.waitForFunction(() => document.querySelector('.voucher-type')?.textContent === 'Credit Note');

  // 4. Fill Credit Note form
  step = 'fill Credit Note';
  await page.locator('#note-invoice').fill('INV-888');
  await page.locator('#note-party').focus();
  await page.locator('#note-party').fill('Browser Customer');
  await page.locator('[data-party-idx="0"]').click();
  await dismissDetailsDialog();

  await page.locator('#note-amount').fill('300.00');
  await page.locator('#note-amount').focus();
  await page.keyboard.press('Enter');
  await dismissBillDialog();

  await page.locator('#note-narration').fill('Damaged goods credit return');
  await page.locator('#accept-note').click();
  await page.waitForFunction(() => document.querySelector('#screen-hint')?.textContent.includes('Saved Credit Note No. 1'));

  // 5. Verify Day Book reflects Debit Note and Credit Note
  step = 'verify Day Book vouchers and filters';
  await home();
  await page.getByRole('button', {name: 'Day Book', exact: true}).click();
  await page.locator('.filtered-day-book').waitFor();

  // Day Book should have 4 vouchers: sale, purchase, debit_note, credit_note
  const rows = await page.locator('.filtered-day-book tbody tr').count();
  assert.equal(rows, 4);

  // Filter by Credit Note
  await page.keyboard.press('F4');
  await page.locator('#voucher-type-dialog').waitFor();
  await page.locator('[data-type="credit_note"]').click();
  await page.waitForFunction(() => document.querySelector('.filtered-day-book')?.dataset.voucherType === 'credit_note');
  const cnRows = await page.locator('.filtered-day-book tbody tr').count();
  assert.equal(cnRows, 1);
  assert.ok(await page.locator('.filtered-day-book tbody tr').textContent().then(t => t.includes('Credit Note')));

  // Filter by Debit Note
  await page.keyboard.press('F4');
  await page.locator('#voucher-type-dialog').waitFor();
  await page.locator('[data-type="debit_note"]').click();
  await page.waitForFunction(() => document.querySelector('.filtered-day-book')?.dataset.voucherType === 'debit_note');
  const dnRows = await page.locator('.filtered-day-book tbody tr').count();
  assert.equal(dnRows, 1);
  assert.ok(await page.locator('.filtered-day-book tbody tr').textContent().then(t => t.includes('Debit Note')));

  // Filter back to All Items
  await page.keyboard.press('F4');
  await page.locator('#voucher-type-dialog').waitFor();
  await page.locator('[data-type="all"]').click();
  await page.waitForFunction(() => document.querySelector('.filtered-day-book')?.dataset.voucherType === 'all');
  assert.equal(await page.locator('.filtered-day-book tbody tr').count(), 4);

  const result = {
    application: 'Bookr',
    passed: true,
    step,
    checks: 6,
    errors
  };
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(`Debit-credit-notes browser test failed at step "${step}":`, error);
  throw error;
} finally {
  await test.close();
}
