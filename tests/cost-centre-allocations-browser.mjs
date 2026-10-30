import assert from 'node:assert/strict';
import {browserFixture} from './browser-fixture.mjs';

function seed(book) {
  const customer = book.createCustomer({name: 'Cost Allocation Client'});
  return {customer};
}

const test = await browserFixture({port: 4397, name: 'cost-centre-allocations-browser', seed});
const {page, get, base, out, errors} = test;
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
  // Seed cost category and centres via API
  step = 'seed cost centres via API';
  const catRes = await page.request.post(base + '/api/cost-categories', {
    data: {name: 'Regional Branches', allocate_revenue: 1, allocate_non_revenue: 0}
  });
  assert.equal(catRes.ok(), true);
  const cat = await catRes.json();
  const c1Res = await page.request.post(base + '/api/cost-centres', {
    data: {name: 'North Region', category_id: cat.id}
  });
  assert.equal(c1Res.ok(), true);
  const c2Res = await page.request.post(base + '/api/cost-centres', {
    data: {name: 'South Region', category_id: cat.id}
  });
  assert.equal(c2Res.ok(), true);

  // 1. Open Sales Voucher
  step = 'open Sales voucher';
  await home();
  await page.getByRole('button', {name: 'Vouchers', exact: true}).click();
  await page.locator('.voucher-type').waitFor();

  // 2. Select Customer
  step = 'select customer';
  await page.locator('#sale-customer').focus();
  await page.locator('#sale-customer').fill('Cost Allocation Client');
  await page.locator('[data-party="0"]').click();
  await dismissDetailsDialog();

  // 3. Fill Sales amount: 1000.00
  step = 'fill amount';
  await page.locator('#sale-account').selectOption({label: 'Demo Sales'});
  await page.locator('#sale-amount').fill('1000.00');
  await page.locator('#sale-amount').dispatchEvent('input');

  // 4. Click Cost Allocations button
  step = 'open cost allocations dialog';
  await page.locator('#sale-cost-allocations').click();
  await page.locator('#cost-allocations-dialog').waitFor();
  assert.equal(await page.locator('.cost-alloc-header h2').innerText(), 'Cost Allocations to: Demo Sales');

  // 5. Fill allocation rows: Row 1 = 600.00, Row 2 = 400.00
  step = 'fill allocation rows';
  // Row 0 centre name and amount
  const input0 = page.locator('.cost-alloc-table tr[data-row-idx="0"] .cost-centre-input');
  await input0.fill('North Region');
  await input0.dispatchEvent('change');
  const amt0 = page.locator('.cost-alloc-table tr[data-row-idx="0"] .cost-amount-input');
  await amt0.fill('600.00');
  await amt0.dispatchEvent('input');

  // Add Row 1
  await page.locator('#cost-add-line').click();
  await page.locator('.cost-alloc-table tr[data-row-idx="1"]').waitFor();
  const input1 = page.locator('.cost-alloc-table tr[data-row-idx="1"] .cost-centre-input');
  await input1.fill('South Region');
  await input1.dispatchEvent('change');
  const amt1 = page.locator('.cost-alloc-table tr[data-row-idx="1"] .cost-amount-input');
  await amt1.fill('400.00');
  await amt1.dispatchEvent('input');

  // Verify balanced
  assert.equal(await page.locator('#cost-total').innerText(), '₹ 1,000.00');
  assert.equal(await page.locator('#cost-remaining').innerText(), '₹ 0.00');

  // 6. Accept Cost Allocations
  step = 'accept cost allocations';
  await page.locator('#cost-alloc-accept').click();
  await page.locator('#cost-allocations-dialog').waitFor({state: 'detached'});

  // 7. Save Sale voucher
  step = 'save voucher';
  await page.locator('#sale-narration').fill('Voucher with cost allocations');
  await page.locator('#accept-sale').click();
  await dismissBillDialog();
  await page.keyboard.press('Control+a');
  await page.waitForFunction(() => document.querySelector('#screen-hint')?.textContent.includes('Saved Sales No. 1'));

  // 8. Verify backend state
  step = 'verify backend state';
  const state = await get('/api/state');
  const sale = state.vouchers.find(v => v.type === 'sale' && v.number === 1);
  assert.ok(sale);
  assert.ok(sale.details.cost_allocations);
  assert.equal(sale.details.cost_allocations.length, 1);
  const ca = sale.details.cost_allocations[0];
  assert.equal(ca.allocations.length, 2);
  assert.equal(ca.allocations[0].centre_name, 'North Region');
  assert.equal(ca.allocations[0].amount, 60000);
  assert.equal(ca.allocations[1].centre_name, 'South Region');
  assert.equal(ca.allocations[1].amount, 40000);

  // 9. Reopen voucher in Day Book and verify cost allocations populate
  step = 'reopen voucher';
  await home();
  await page.getByRole('button', {name: 'Day Book', exact: true}).click();
  await page.locator('.filtered-day-book').waitFor();
  await page.locator('[data-open-sale="1"]').click();
  await page.locator('#sales-form').waitFor();
  await page.locator('#sale-cost-allocations').click();
  await page.locator('#cost-allocations-dialog').waitFor();
  assert.equal(await page.locator('.cost-alloc-table tr[data-row-idx="0"] .cost-centre-input').inputValue(), 'North Region');
  assert.equal(await page.locator('.cost-alloc-table tr[data-row-idx="0"] .cost-amount-input').inputValue(), '600.00');
  assert.equal(await page.locator('.cost-alloc-table tr[data-row-idx="1"] .cost-centre-input').inputValue(), 'South Region');
  assert.equal(await page.locator('.cost-alloc-table tr[data-row-idx="1"] .cost-amount-input').inputValue(), '400.00');

  console.log(JSON.stringify({
    application: 'Bookr',
    passed: true,
    step,
    checks: 9,
    errors
  }));
} catch (err) {
  console.error(`Cost Centre Allocations browser test failed at step "${step}":`, err);
  process.exitCode = 1;
} finally {
  await test.close();
}
