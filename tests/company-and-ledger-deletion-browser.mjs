import assert from 'node:assert/strict';
import {browserFixture} from './browser-fixture.mjs';

const test = await browserFixture({port: 4367, name: 'company-ledger-deletion-browser', seed: book => ({})});
const {page, get, errors} = test;

try {
  // 1. Create a ledger to test deletion
  await page.getByRole('link', {name: 'Bookr Gateway', exact: true}).click();
  await page.getByRole('heading', {name: 'Gateway of Bookr', exact: true}).waitFor();

  await page.getByRole('button', {name: 'Create', exact: true}).click();
  await page.getByRole('button', {name: 'Ledger', exact: true}).click();
  await page.locator('#ledger-name').fill('Disposable Test Ledger');
  await page.locator('#ledger-name').focus();
  await page.keyboard.press('Control+a');
  await page.waitForFunction(() => document.querySelector('#screen-hint').textContent.includes('Saved Disposable Test Ledger'));

  let state = await get('/api/state');
  const createdLedger = state.ledgers.find(l => l.name === 'Disposable Test Ledger');
  assert.ok(createdLedger, 'Disposable Test Ledger must exist');

  // 2. Open Alter -> Ledger -> select it
  await page.getByRole('link', {name: 'Bookr Gateway', exact: true}).click();
  await page.getByRole('button', {name: 'Alter', exact: true}).click();
  await page.getByRole('button', {name: 'Ledger', exact: true}).click();
  await page.locator('#ledger-search').fill('Disposable Test Ledger');
  await page.keyboard.press('Enter');
  await page.locator('#ledger-form').waitFor();

  // Verify delete button is present on Alteration of custom ledger
  const deleteBtn = page.locator('#delete-ledger');
  assert.equal(await deleteBtn.isVisible(), true);

  // Press Alt+D to trigger deletion
  await page.keyboard.press('Alt+d');
  await page.locator('#entry-dialog').waitFor();
  assert.match(await page.locator('#confirmation-message').innerText(), /Delete ledger Disposable Test Ledger\?/);

  // Confirm delete
  await page.locator('dialog button[value="yes"]').click();
  await page.locator('#entry-dialog').waitFor({state: 'detached'});

  // Verify ledger is deleted
  await page.waitForFunction(() => document.querySelector('#screen-hint')?.textContent.includes('Deleted ledger Disposable Test Ledger'));
  state = await get('/api/state');
  assert.ok(!state.ledgers.some(l => l.name === 'Disposable Test Ledger'), 'Disposable Test Ledger must be gone');

  // 3. Test that Cash cannot be deleted
  await page.locator('#ledger-search').fill('Cash');
  await page.keyboard.press('Enter');
  await page.locator('#ledger-form').waitFor();

  // Cash should not have delete button
  assert.equal(await page.locator('#delete-ledger').count(), 0);

  // Pressing Alt+D on Cash should show error
  await page.keyboard.press('Alt+d');
  assert.equal(await page.locator('#ledger-error').innerText(), 'Built-in ledgers cannot be deleted.');

  // 4. Test Company Deletion (Alt+D in Company Alteration)
  // Create a second company via API
  const comp = await page.request.post('http://127.0.0.1:4367/api/companies', {
    data: {name: 'Disposable Company Ltd'}
  }).then(r => r.json());
  assert.ok(comp.id);

  // Switch to the new company
  await page.getByRole('link', {name: 'Bookr Gateway', exact: true}).click();
  await page.getByRole('heading', {name: 'Gateway of Bookr', exact: true}).waitFor();
  await page.keyboard.press('Alt+F3');
  await page.locator('#company-search').fill('Disposable Company Ltd');
  await page.locator('#company-options [data-company-id="' + comp.id + '"]').click();
  await page.waitForFunction(name => document.querySelector('.company-pane .company-name')?.textContent === name, 'Disposable Company Ltd');

  // Open Alter Company
  await page.locator('[data-company-menu]').click();
  await page.locator('#company-alter-menu').waitFor();
  await page.locator('#company-alter-menu').click();
  await page.locator('#main[data-screen="companies"][data-mode="edit"]').waitFor();
  await page.keyboard.press('Enter');
  await page.locator('#main[data-screen="company-alter"] #company-form').waitFor();

  // In Company Alteration, press Alt+D
  await page.keyboard.press('Alt+d');
  await page.locator('#entry-dialog').waitFor();
  assert.match(await page.locator('#confirmation-message').innerText(), /Delete\?/);

  // First confirm: "Delete?"
  await page.locator('dialog button[value="yes"]').click();
  await page.locator('#entry-dialog').waitFor();
  assert.match(await page.locator('#confirmation-message').innerText(), /Are you sure\?/);

  // Second confirm: "Are you sure?"
  await page.locator('dialog button[value="yes"]').click();
  await page.locator('#entry-dialog').waitFor({state: 'detached'});

  // Wait for company list refresh
  await page.waitForTimeout(1000);

  const companies = await get('/api/companies');
  assert.ok(!companies.companies.some(c => c.name === 'Disposable Company Ltd'), 'Disposable Company Ltd must be deleted');
  assert.deepEqual(errors, []);

  console.log(JSON.stringify({passed: true, checks: 4, errors: []}));
} finally {
  await test.close();
}
