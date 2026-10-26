import {startOwnedTestServer,stopOwnedTestServer} from './owned-test-server.mjs';
import { chromium } from 'playwright-core';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output = join(root,'evidence/web');
const directory = await mkdtemp(join(tmpdir(),'bookr-browser-'));
const base = 'http://127.0.0.1:4318';
const errors = [];
let server, browser, page, serverOutput = '';
async function startServer(){server=await startOwnedTestServer({root,port:4318,database:join(directory,'browser.sqlite'),onOutput:text=>{serverOutput+=text;}});}
async function stopServer(){await stopOwnedTestServer(server);}
async function waitForSaved(page, fragment) {
  await page.waitForFunction(text => document.querySelector('#screen-hint').textContent.includes(text),fragment);
}
async function openCreate(page) {
  await page.getByRole('button',{name:'Create',exact:true}).click();
  await page.getByRole('button',{name:'Ledger',exact:true}).click();
}
try {
  await mkdir(output,{recursive:true});
  await startServer();
  browser = await chromium.launch({ headless:true,executablePath:process.env.BOOKR_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' });
  page = await browser.newPage({viewport:{width:1229,height:655},deviceScaleFactor:1});
  page.on('pageerror',error => errors.push(error.message));
  await page.goto(base,{waitUntil:'networkidle'});
  await page.getByRole('heading',{name:'Gateway of Bookr',exact:true}).waitFor();
  await openCreate(page);
  assert.equal(await page.locator('#ledger-name').evaluate(el => el === document.activeElement),true);
  await page.keyboard.press('Control+a');
  assert.equal(await page.locator('#ledger-error').innerText(),'Enter a customer name.');
  await page.locator('#ledger-name').fill('Browser Demo Customer');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#ledger-alias').evaluate(el => el === document.activeElement),true);
  await page.keyboard.type('Browser Demo');
  await page.locator('#mailing-address').fill('12 Fictional Street\nExample Town');
  await page.locator('#mailing-pincode').fill('000000');
  await page.locator('#ledger-alias').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#ledger-group').evaluate(el => el === document.activeElement),true);
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#ledger-billwise').evaluate(el => el === document.activeElement),true);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.locator('#ledger-group').evaluate(el => el === document.activeElement),true);
  await page.screenshot({path:join(output,'bookr-ledger-create.png'),fullPage:true});
  await page.keyboard.press('Control+a');
  await waitForSaved(page,'Saved Browser Demo Customer');
  assert.equal(await page.locator('#ledger-name').inputValue(),'');
  const afterCreate = await (await page.request.get(base+'/api/state')).json();
  const customer = afterCreate.ledgers.find(row => row.name === 'Browser Demo Customer');
  assert.equal(customer.alias,'Browser Demo');
  assert.equal(customer.address,'12 Fictional Street\nExample Town');

  // A failed save retains the typed data and does not create another record.
  await page.locator('#ledger-name').fill('browser demo customer');
  await page.locator('#ledger-alias').fill('Keep this text');
  await page.keyboard.press('Control+a');
  await page.getByRole('alert').filter({hasText:'already exists'}).waitFor();
  assert.equal(await page.locator('#ledger-alias').inputValue(),'Keep this text');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'No',exact:true}).click();
  await page.locator('#entry-dialog').waitFor({state:'detached'});
  assert.equal(await page.locator('#ledger-alias').inputValue(),'Keep this text');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('y');
  await page.getByRole('heading',{name:'Master Creation',exact:true}).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Alter',exact:true}).click();
  await page.getByRole('button',{name:'Ledger',exact:true}).click();
  await page.locator('#ledger-search').fill('Browser Demo');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.getByRole('heading',{name:'Ledger Alteration',exact:true}).waitFor();
  assert.equal(await page.locator('#ledger-alias').inputValue(),'Browser Demo');
  await page.locator('#ledger-name').fill('Browser Demo Customer Updated');
  await page.locator('#ledger-alias').fill('Updated Demo');
  await page.keyboard.press('Control+a');
  await waitForSaved(page,'Saved changes to');
  assert.match(await page.locator('#ledger-options').innerText(),/Browser Demo Customer Updated/);

  // Restart the actual HTTP process and open the same on-disk database again.
  await stopServer(); await startServer();
  await page.reload({waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Alter',exact:true}).click();
  await page.getByRole('button',{name:'Ledger',exact:true}).click();
  await page.locator('#ledger-search').fill('Updated Demo');
  await page.screenshot({path:join(output,'bookr-ledger-select.png'),fullPage:true});
  await page.keyboard.press('Enter');
  await page.getByRole('heading',{name:'Ledger Alteration',exact:true}).waitFor();
  assert.equal(await page.locator('#ledger-name').inputValue(),'Browser Demo Customer Updated');
  assert.equal(await page.locator('#ledger-alias').inputValue(),'Updated Demo');
  assert.equal(await page.locator('#mailing-address').inputValue(),'12 Fictional Street\nExample Town');
  assert.equal(await page.locator('#mailing-pincode').inputValue(),'000000');
  await page.screenshot({path:join(output,'bookr-ledger-reopened.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
  await page.screenshot({path:join(output,'bookr-ledger-mobile.png'),fullPage:true});
  assert.equal(await page.locator('#accept-ledger').isVisible(),true);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await openCreate(page);
  await page.locator('#ledger-name').fill('Second Fictional Customer');
  // Ordinary Enter walks through fields and reaches an acceptance confirmation.
  // The party opening amount is now an enabled final field. A blank opening
  // advances to the same acceptance confirmation without opening a breakup.
  for (let index=0;index<10;index++) await page.keyboard.press('Enter');
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('y');
  await waitForSaved(page,'Saved Second Fictional Customer');
  const state = await (await page.request.get(base+'/api/state')).json();
  assert.equal(state.ledgers.filter(row => row.kind === 'customer').length,2);
  assert.equal(state.vouchers.length,0);
  assert.equal(state.totals.balanced,true);
  assert.equal(errors.length,0);
  const report = {
    application:'Bookr',scope:'Customer ledger layer only',testDatabase:'Temporary fictional database; separate from the live app and installed reference application',
    checks:{create:true,aliasSaved:true,mailingAddressAndPincodePersist:true,enterAdvances:true,shiftTabBack:true,ctrlAAccept:true,enterAcceptConfirmation:true,duplicateRejectedWithoutLosingInput:true,discardConfirmation:true,alterPreservesLedgerId:true,searchByNameAndAlias:true,reopenAfterServerRestart:true,mobileNoHorizontalOverflow:true,vouchersCreated:state.vouchers.length},
    pageErrors:errors,screenshots:['bookr-ledger-create.png','bookr-ledger-select.png','bookr-ledger-reopened.png','bookr-ledger-mobile.png']
  };
  const updated = await (await page.request.get(base+`/api/customers/${customer.id}`)).json();
  assert.equal(updated.id,customer.id); assert.equal(updated.revision,2);
  await writeFile(join(output,'bookr-ledger-check.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} catch (error) {
  if (page) {
    await page.screenshot({path:join(output,'bookr-browser-failure.png'),fullPage:true}).catch(() => {});
    console.error(await page.locator('body').innerText().catch(() => 'Page unavailable'));
  }
  console.error(serverOutput); throw error;
} finally { await browser?.close(); await stopServer(); await rm(directory,{recursive:true,force:true}); }
