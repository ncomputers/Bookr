import assert from 'node:assert/strict';
import {browserFixture} from './browser-fixture.mjs';

function seed(book) {
  const customerA = book.createCustomer({name: 'Browser Party Alpha'});
  const customerB = book.createCustomer({name: 'Browser Party Beta'});
  const supplier = book.saveSupplier({name: 'Browser Landlord Prime'});
  const rent = book.saveLedger({kind: 'expense', name: 'Browser Compound Rent'});
  return {customerA, customerB, supplier, rent};
}

const test = await browserFixture({port: 4399, name: 'compound-journals-browser', seed});
const {page, get, out, errors} = test;
let step = 'startup';

async function home() {
  await page.getByRole('link', {name: 'Bookr Gateway', exact: true}).click();
  await page.getByRole('heading', {name: 'Gateway of Bookr', exact: true}).waitFor();
}

try {
  // 1. Open Vouchers and switch to Journal (F7)
  step = 'open Journal voucher';
  await home();
  await page.getByRole('button', {name: 'Vouchers', exact: true}).click();
  await page.locator('.voucher-type').waitFor();
  await page.keyboard.press('F7');
  await page.locator('#journal-form').waitFor();

  // 2. Open General Journal
  step = 'open General Journal mode';
  await page.locator('#open-general-journal').click();
  await page.locator('#general-journal-form').waitFor();

  // 3. Verify party ledgers are in the options
  step = 'verify party ledgers offered in picker';
  const offered = await page.locator(':nth-match([data-journal-line], 1) [data-entry-ledger] option').evaluateAll(options => options.map(o => o.text));
  assert.ok(offered.some(text => text.includes('Browser Party Alpha')), 'Customer Alpha must be selectable');
  assert.ok(offered.some(text => text.includes('Browser Party Beta')), 'Customer Beta must be selectable');
  assert.ok(offered.some(text => text.includes('Browser Landlord Prime')), 'Supplier Prime must be selectable');

  // 4. Fill line 1: Debit Browser Party Beta 500.00
  step = 'fill line 1';
  const line1 = page.locator(':nth-match([data-journal-line], 1)');
  await line1.locator('[data-entry-side]').selectOption('debit');
  await line1.locator('[data-entry-ledger]').selectOption({label: 'Browser Party Beta'});
  await line1.locator('[data-entry-amount]').fill('500.00');
  await line1.locator('[data-entry-amount]').dispatchEvent('input');

  // 5. Fill line 2: Credit Browser Party Alpha 500.00
  step = 'fill line 2';
  const line2 = page.locator(':nth-match([data-journal-line], 2)');
  await line2.locator('[data-entry-side]').selectOption('credit');
  await line2.locator('[data-entry-ledger]').selectOption({label: 'Browser Party Alpha'});
  await line2.locator('[data-entry-amount]').fill('500.00');
  await line2.locator('[data-entry-amount]').dispatchEvent('input');

  // 6. Verify totals
  step = 'verify totals';
  assert.equal(await page.locator('#general-journal-debit-total').innerText(), '500.00');
  assert.equal(await page.locator('#general-journal-credit-total').innerText(), '500.00');
  assert.equal(await page.locator('#general-journal-difference').innerText(), 'Balanced');

  // 7. Save compound journal
  step = 'save compound journal';
  await page.locator('#general-journal-narration').fill('Browser compound journal party transfer');
  await page.keyboard.press('Control+a');
  await page.locator('#screen-hint').filter({hasText: 'Saved Journal No. 1'}).waitFor();

  // 8. Verify API state & statements
  step = 'verify API state';
  const state = await get('/api/state');
  assert.equal(state.vouchers.length, 1);
  const voucher = state.vouchers[0];
  assert.equal(voucher.amount, 50000);
  assert.equal(voucher.details.journal_mode, 'general');

  const customerA = state.ledgers.find(l => l.name === 'Browser Party Alpha');
  const customerB = state.ledgers.find(l => l.name === 'Browser Party Beta');
  const stmtAlpha = await get(`/api/statement?ledger=${customerA.id}`);
  assert.equal(stmtAlpha.balance, -50000); // 500.00 Cr
  const stmtBeta = await get(`/api/statement?ledger=${customerB.id}`);
  assert.equal(stmtBeta.balance, 50000); // 500.00 Dr

  // 9. View Entries from Day Book
  step = 'open Day Book and view entries';
  await home();
  await page.getByRole('button', {name: 'Day Book', exact: true}).click();
  await page.locator('[data-open-sale="' + voucher.id + '"]').click();
  await page.locator('#general-journal-form').waitFor();
  await page.locator('#general-journal-postings').click();
  await page.locator('.accounting-entries').waitFor();

  const entriesText = await page.locator('.accounting-entries').innerText();
  assert.match(entriesText, /Browser Party Beta/);
  assert.match(entriesText, /Browser Party Alpha/);
  assert.match(entriesText, /500\.00/);

  console.log(JSON.stringify({passed: true, test: 'compound-journals-browser', checks: 9}));
} catch (error) {
  console.error('Compound Journals browser test failed at ' + step);
  throw error;
} finally {
  await test.close();
}
