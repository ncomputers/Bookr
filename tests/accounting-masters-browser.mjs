import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {browserFixture} from './browser-fixture.mjs';

const test = await browserFixture({port: 4377, name: 'accounting-masters-browser', seed: () => ({})});
const {page, get, out, errors} = test;
let step = 'startup';

async function home() {
  await page.getByRole('link', {name: 'Bookr Gateway', exact: true}).click();
  await page.getByRole('heading', {name: 'Gateway of Bookr', exact: true}).waitFor();
}

try {
  // 1. Verify Master Creation menu options
  step = 'verify Master Creation menu';
  await home();
  await page.getByRole('button', {name: 'Create', exact: true}).click();
  await page.locator('#open-group').waitFor();
  await page.locator('#open-ledger').waitFor();
  await page.locator('#open-cost-category').waitFor();
  await page.locator('#open-cost-centre').waitFor();

  // 2. Create a custom Group
  step = 'create custom Group';
  await page.locator('#open-group').click();
  await page.locator('#group-master-form').waitFor();
  await page.locator('#group-name').fill('Northern Debtors');
  await page.locator('#group-alias').fill('ND');
  await page.keyboard.press('Control+a');
  await page.waitForFunction(() => document.querySelector('#screen-hint').textContent.includes('Saved Group Northern Debtors'));

  // 3. Verify Master Alteration menu and alter Group
  step = 'alter Group';
  await home();
  await page.getByRole('button', {name: 'Alter', exact: true}).click();
  await page.locator('#open-group').click();
  await page.locator('#group-search').waitFor();
  await page.locator('#group-search').fill('Northern Debtors');
  await page.keyboard.press('Enter');
  await page.locator('#group-master-form').waitFor();
  assert.equal(await page.locator('#group-name').inputValue(), 'Northern Debtors');
  await page.locator('#group-name').fill('North India Debtors');
  await page.keyboard.press('Control+a');
  await page.waitForFunction(() => document.querySelector('#screen-hint').textContent.includes('Updated Group North India Debtors'));

  // 4. Create Cost Category
  step = 'create Cost Category';
  await home();
  await page.getByRole('button', {name: 'Create', exact: true}).click();
  await page.locator('#open-cost-category').click();
  await page.locator('#category-master-form').waitFor();
  await page.locator('#category-name').fill('Branch Offices');
  await page.locator('#category-alias').fill('BO');
  await page.keyboard.press('Control+a');
  await page.waitForFunction(() => document.querySelector('#screen-hint').textContent.includes('Saved Cost Category Branch Offices'));

  // 5. Create Cost Centre under the new Category
  step = 'create Cost Centre';
  await home();
  await page.getByRole('button', {name: 'Create', exact: true}).click();
  await page.locator('#open-cost-centre').click();
  await page.locator('#centre-master-form').waitFor();
  // Select Branch Offices
  const catOptions = await page.locator('#centre-category option').allTextContents();
  assert.ok(catOptions.includes('Branch Offices'));
  await page.locator('#centre-category').selectOption({label: 'Branch Offices'});
  await page.locator('#centre-name').fill('Chandigarh Branch');
  await page.locator('#centre-alias').fill('CHB');
  await page.keyboard.press('Control+a');
  await page.waitForFunction(() => document.querySelector('#screen-hint').textContent.includes('Saved Cost Centre Chandigarh Branch'));

  // 6. Verify Chart of Accounts menus and views
  step = 'chart of accounts groups';
  await home();
  await page.getByRole('button', {name: 'Chart of Accounts', exact: true}).click();
  await page.locator('#chart-open-groups').waitFor();
  await page.locator('#chart-open-groups').click();
  await page.locator('.chart-report').waitFor();
  assert.ok(await page.locator('[data-chart-group-id]').allTextContents().then(names => names.some(n => n.includes('North India Debtors'))));
  await page.keyboard.press('Escape');
  await page.locator('#chart-open-groups').waitFor();

  step = 'chart of accounts cost categories';
  await page.locator('#chart-open-cost-categories').click();
  await page.locator('.chart-report').waitFor();
  assert.ok(await page.locator('[data-chart-cat-id]').allTextContents().then(names => names.some(n => n.includes('Branch Offices'))));
  await page.keyboard.press('Escape');
  await page.locator('#chart-open-cost-categories').waitFor();

  step = 'chart of accounts cost centres';
  await page.locator('#chart-open-cost-centres').click();
  await page.locator('.chart-report').waitFor();
  assert.ok(await page.locator('[data-chart-centre-id]').allTextContents().then(names => names.some(n => n.includes('Chandigarh Branch'))));
  await page.keyboard.press('Escape');
  await page.locator('#chart-open-cost-centres').waitFor();

  step = 'chart of accounts ledgers default Enter';
  await page.locator('#chart-open-ledgers').focus();
  await page.keyboard.press('Enter');
  await page.locator('.chart-report').waitFor();
  assert.equal(await page.locator('.chart-grouped').count(), 1);

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({passed: true, checks: 6}));
} catch (error) {
  console.error('Accounting masters browser check failed at ' + step);
  throw error;
} finally {
  await test.close();
}
