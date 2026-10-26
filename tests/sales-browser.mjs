import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp,rm,mkdir,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output = join(root,'evidence/web');
const directory = await mkdtemp(join(tmpdir(),'bookr-sales-browser-'));
const base = 'http://127.0.0.1:4319';
const errors = [];
let server,browser,page,serverOutput = '';
async function startServer() {
  server = spawn(process.execPath,[join(root,'server.mjs')],{cwd:root,windowsHide:true,env:{...process.env,PORT:'4319',BOOKR_DB:join(directory,'sales.sqlite'),BOOKR_TAILSCALE_IP:''},stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',data => { serverOutput += data; }); server.stderr.on('data',data => { serverOutput += data; });
  for(let attempt=0;attempt<80;attempt++) {
    if(server.exitCode !== null) throw new Error(serverOutput);
    try { if((await fetch(base+'/api/state')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve,100));
  }
  throw new Error('Sales test server did not start. '+serverOutput);
}
async function stopServer() {
  if(!server || server.exitCode !== null) return;
  const stopped = new Promise(resolve => server.once('exit',resolve)); server.kill(); await stopped;
}
async function saved(message) { await page.waitForFunction(text => document.querySelector('#screen-hint').textContent.includes(text),message); }
async function acceptBill(reference,viaEnter = false) {
  await page.locator('#bill-details-dialog').waitFor();
  if (reference !== undefined) await page.locator('#bill-reference').fill(reference);
  if (viaEnter) {
    await page.locator('#bill-method').focus();
    for (let index=0;index<5;index++) await page.keyboard.press('Enter');
  } else await page.keyboard.press('Control+a');
  await page.locator('#bill-details-dialog').waitFor({state:'detached'});
  assert.equal(await page.locator('#sale-narration').evaluate(el => el === document.activeElement),true);
}
async function openDayBook() {
  await page.getByRole('link',{name:'Bookr Gateway',exact:true}).click();
  await page.getByRole('button',{name:'Day Book',exact:true}).click();
  await page.getByRole('heading',{name:'Day Book',exact:true}).waitFor();
}
async function chooseCustomer() {
  await page.locator('#sale-customer').fill('Buyer');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  assert.equal(await page.locator('#sale-customer').inputValue(),'Fictional Sales Customer');
  await page.locator('#voucher-details-dialog[data-stage="dispatch"]').waitFor();
  await page.locator('#detail-document_no').fill('DEMO-DISPATCH-7');
  await page.locator('#detail-destination').fill('Example Town');
  await page.locator('#detail-bill_date').fill('3-Apr-2026');
  await page.screenshot({path:join(output,`bookr-sales-dispatch${page.viewportSize().width < 650 ? '-mobile' : ''}.png`),fullPage:true});
  await page.keyboard.press('Control+a');
  await page.locator('#voucher-details-dialog[data-stage="party"]').waitFor();
  assert.equal(await page.locator('#detail-mailing_name').inputValue(),'Fictional Buyer Trading');
  assert.equal(await page.locator('#detail-address').inputValue(),'12 Example Street\nDemo City');
  await page.locator('#detail-address').fill('Voucher-specific fictional address');
  await page.screenshot({path:join(output,`bookr-sales-party-details${page.viewportSize().width < 650 ? '-mobile' : ''}.png`),fullPage:true});
  await page.keyboard.press('Control+a');
  await page.locator('#voucher-details-dialog').waitFor({state:'detached'});
  await page.locator('#sale-account').selectOption('2');
}
try {
  await mkdir(output,{recursive:true}); await startServer();
  browser = await chromium.launch({headless:true,executablePath:process.env.BOOKR_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'});
  page = await browser.newPage({viewport:{width:1229,height:655},deviceScaleFactor:1});
  page.on('pageerror',error => errors.push(error.message));
  await page.goto(base,{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Create',exact:true}).click();
  await page.getByRole('button',{name:'Ledger',exact:true}).click();
  await page.locator('#ledger-name').fill('Fictional Sales Customer'); await page.locator('#ledger-alias').fill('Buyer');
  await page.locator('#mailing-name').fill('Fictional Buyer Trading');
  await page.locator('#mailing-address').fill('12 Example Street\nDemo City');
  await page.keyboard.press('Control+a'); await saved('Saved Fictional Sales Customer');
  await page.getByRole('link',{name:'Bookr Gateway',exact:true}).click();
  await page.getByRole('button',{name:'Vouchers',exact:true}).click();
  await page.getByRole('heading',{name:'Accounting Voucher Creation',exact:true}).waitFor();
  await page.screenshot({path:join(output,'bookr-sales-party-picker.png'),fullPage:true});
  await page.keyboard.press('Escape'); // close the customer list, preserving the voucher
  await page.keyboard.press('F2');
  assert.equal(await page.locator('#sale-date').evaluate(el => el === document.activeElement),true);
  await page.locator('#sale-date').fill('2-Apr-2026'); await page.keyboard.press('Enter');
  await chooseCustomer();
  assert.equal(await page.locator('#sale-account').evaluate(el => el === document.activeElement),true);
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#sale-amount').evaluate(el => el === document.activeElement),true);
  await page.locator('#sale-amount').fill('1250.755'); await page.keyboard.press('Control+a');
  await page.getByRole('alert').filter({hasText:'two decimal'}).waitFor();
  let state = await (await page.request.get(base+'/api/state')).json(); assert.equal(state.vouchers.length,0);
  await page.locator('#sale-amount').fill('1250.75'); await page.keyboard.press('Enter');
  await page.locator('#bill-details-dialog').waitFor();
  assert.equal(await page.locator('#bill-reference').inputValue(),'1');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#bill-reference').evaluate(el => el === document.activeElement),true);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.locator('#bill-method').evaluate(el => el === document.activeElement),true);
  await page.keyboard.press('Enter');
  await page.locator('#bill-reference').fill(''); await page.keyboard.press('Control+a');
  await page.locator('#bill-reference-error').filter({hasText:'Enter a bill reference name'}).waitFor();
  await page.locator('#bill-reference').fill('STUDY-BILL-02');
  await page.screenshot({path:join(output,'bookr-bill-new-ref.png'),fullPage:true});
  await acceptBill();
  assert.equal((await (await page.request.get(base+'/api/state')).json()).vouchers.length,0);
  assert.equal(await page.locator('#sale-narration').evaluate(el => el === document.activeElement),true);
  await page.locator('#sale-narration').fill('Fictional no-tax credit sale');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.locator('#sale-amount').evaluate(el => el === document.activeElement),true);
  await page.keyboard.press('Enter');
  await acceptBill();
  await page.screenshot({path:join(output,'bookr-sales-create.png'),fullPage:true});
  await page.keyboard.press('Control+a'); await saved('Saved Sales No. 1');
  assert.equal(await page.locator('#sale-number').innerText(),'2');
  assert.equal(await page.locator('#sale-amount').inputValue(),'');
  state = await (await page.request.get(base+'/api/state')).json();
  const id = state.vouchers[0].id; const customer = state.ledgers.find(row => row.kind === 'customer');
  assert.equal(state.vouchers[0].amount,125075); assert.equal(state.totals.balanced,true);
  assert.equal(state.vouchers[0].number,1);
  assert.equal(state.vouchers[0].bill.reference,'STUDY-BILL-02');
  const billId = state.vouchers[0].bill.id;
  assert.equal(state.vouchers[0].details.dispatch.document_no,'DEMO-DISPATCH-7');
  assert.equal(state.vouchers[0].details.dispatch.bill_date,'2026-04-03');
  assert.equal(state.vouchers[0].details.party.address,'Voucher-specific fictional address');
  assert.equal(state.ledgers.find(row => row.id === customer.id).address,'12 Example Street\nDemo City');
  await openDayBook(); await page.keyboard.press('Enter');
  await page.getByRole('heading',{name:'Accounting Voucher Alteration',exact:true}).waitFor();
  assert.equal(await page.locator('#sale-amount').inputValue(),'1250.75');
  await page.getByRole('button',{name:'View Entries',exact:true}).click();
  await page.getByRole('heading',{name:'Accounting Entries',exact:true}).waitFor();
  assert.match(await page.locator('.posting-status').innerText(),/Balanced/);
  assert.match(await page.locator('.posting-status').innerText(),/STUDY-BILL-02/);
  await page.screenshot({path:join(output,'bookr-sales-entries.png'),fullPage:true});
  await page.keyboard.press('Escape');
  await page.locator('#sale-amount').fill('2345.50'); await page.locator('#sale-narration').fill('Corrected fictional credit sale');
  await page.keyboard.press('Control+a');
  await acceptBill('CORRECTED-REF');
  await page.keyboard.press('Control+a'); await saved('Saved changes to Sales No. 1');
  state = await (await page.request.get(base+'/api/state')).json();
  assert.equal(state.vouchers.length,1); assert.equal(state.vouchers[0].id,id); assert.equal(state.vouchers[0].amount,234550);
  assert.equal(state.vouchers[0].bill.id,billId); assert.equal(state.vouchers[0].bill.reference,'CORRECTED-REF');
  const detail = await (await page.request.get(base+`/api/vouchers/${id}`)).json();
  assert.deepEqual(detail.postings.map(row => [row.ledger_id,row.side,row.amount]),[[customer.id,'debit',234550],[2,'credit',234550]]);
  await page.screenshot({path:join(output,'bookr-sales-day-book.png'),fullPage:true});

  // Reject a stale revision through the browser and preserve the user's unsaved input.
  await page.keyboard.press('Enter'); await page.getByRole('heading',{name:'Accounting Voucher Alteration',exact:true}).waitFor();
  const concurrent = await page.request.put(base+`/api/vouchers/${id}`,{data:{...detail,narration:'Another browser saved this first'}});
  assert.equal(concurrent.status(),200);
  await page.locator('#sale-narration').fill('My unsaved text'); await page.keyboard.press('Control+a');
  await page.getByRole('alert').filter({hasText:'changed after you opened'}).waitFor();
  assert.equal(await page.locator('#sale-narration').inputValue(),'My unsaved text');
  await page.getByRole('link',{name:'Bookr Gateway',exact:true}).click();
  await page.getByRole('dialog').waitFor(); await page.keyboard.press('y');
  await page.getByRole('heading',{name:'Gateway of Bookr',exact:true}).waitFor();

  await stopServer(); await startServer(); await page.reload({waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Day Book',exact:true}).click();
  await page.getByRole('heading',{name:'Day Book',exact:true}).waitFor(); await page.keyboard.press('Enter');
  await page.getByRole('heading',{name:'Accounting Voucher Alteration',exact:true}).waitFor();
  assert.equal(await page.locator('#sale-amount').inputValue(),'2345.50');
  assert.equal(await page.locator('#sale-narration').inputValue(),'Another browser saved this first');
  await page.locator('#bill-details').click();
  await page.locator('#bill-details-dialog').waitFor();
  assert.equal(await page.locator('#bill-reference').inputValue(),'CORRECTED-REF');
  await page.screenshot({path:join(output,'bookr-bill-reopened.png'),fullPage:true});
  await page.locator('#bill-reference').fill('DISCARDED-REF');
  await page.keyboard.press('Escape');
  await page.locator('#bill-details-dialog').waitFor({state:'detached'});
  assert.equal(await page.locator('#sale-amount').inputValue(),'2345.50');
  assert.equal(await page.locator('#sale-narration').inputValue(),'Another browser saved this first');
  assert.equal((await (await page.request.get(base+`/api/vouchers/${id}`)).json()).bill.reference,'CORRECTED-REF');
  await page.locator('#bill-details').click();
  await page.locator('#bill-details-dialog').waitFor();
  assert.equal(await page.locator('#bill-reference').inputValue(),'CORRECTED-REF');
  await acceptBill();
  await page.locator('#party-details').click();
  await page.locator('#voucher-details-dialog[data-stage="dispatch"]').waitFor();
  assert.equal(await page.locator('#detail-document_no').inputValue(),'DEMO-DISPATCH-7');
  assert.equal(await page.locator('#detail-bill_date').inputValue(),'3-Apr-2026');
  await page.keyboard.press('Control+a');
  await page.locator('#voucher-details-dialog[data-stage="party"]').waitFor();
  assert.equal(await page.locator('#detail-address').inputValue(),'Voucher-specific fictional address');
  await page.keyboard.press('Control+a');
  await page.locator('#voucher-details-dialog').waitFor({state:'detached'});
  await page.locator('#sale-amount').focus();
  await page.screenshot({path:join(output,'bookr-sales-reopened.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
  await page.screenshot({path:join(output,'bookr-sales-mobile.png'),fullPage:true});
  assert.equal(await page.locator('#accept-sale').isVisible(),true);
  await openDayBook();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
  await page.locator('#new-sale').click();
  await chooseCustomer(); await page.keyboard.press('Enter');
  await page.locator('#sale-amount').fill('0.29'); await page.keyboard.press('Enter');
  await page.locator('#bill-details-dialog').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
  await page.screenshot({path:join(output,'bookr-bill-mobile.png'),fullPage:true});
  await acceptBill(undefined,true);
  await page.locator('#sale-narration').fill('Fractional rupee test'); await page.keyboard.press('Enter');
  await page.getByRole('dialog').waitFor(); await page.keyboard.press('y'); await saved('Saved Sales No. 2');
  state = await (await page.request.get(base+'/api/state')).json();
  assert.equal(state.vouchers.length,2); assert.equal(state.vouchers.find(row => row.number === 2).amount,29);
  assert.equal(state.totals.debit,234579); assert.equal(state.totals.credit,234579); assert.equal(state.totals.balanced,true);

  // Create a missing customer in context, keeping the partly entered voucher.
  await chooseCustomer();
  await page.locator('#sale-amount').fill('37.19');
  await page.locator('#sale-narration').fill('Preserve this sales draft');
  await page.locator('#sale-customer').fill('Inline Fictional Customer');
  await page.locator('#create-party').click();
  await page.getByRole('heading',{name:'Ledger Creation',exact:true}).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('heading',{name:'Accounting Voucher Creation',exact:true}).waitFor();
  assert.equal(await page.locator('#sale-amount').inputValue(),'37.19');
  assert.equal(await page.locator('#sale-narration').inputValue(),'Preserve this sales draft');
  await page.locator('#sale-customer').focus();
  await page.locator('#create-party').click();
  await page.locator('#ledger-name').fill('Inline Fictional Customer');
  await page.locator('#mailing-address').fill('Inline fictional address');
  await page.keyboard.press('Control+a');
  await page.locator('#voucher-details-dialog[data-stage="dispatch"]').waitFor();
  await page.keyboard.press('Control+a');
  await page.locator('#voucher-details-dialog[data-stage="party"]').waitFor();
  assert.equal(await page.locator('#detail-address').inputValue(),'Inline fictional address');
  await page.keyboard.press('Control+a');
  await page.locator('#voucher-details-dialog').waitFor({state:'detached'});
  assert.equal(await page.locator('#sale-customer').inputValue(),'Inline Fictional Customer');
  assert.equal(await page.locator('#sale-amount').inputValue(),'37.19');
  assert.equal(await page.locator('#sale-narration').inputValue(),'Preserve this sales draft');
  await page.keyboard.press('Control+a'); await acceptBill('INLINE-BILL-03');
  await page.keyboard.press('Control+a'); await saved('Saved Sales No. 3');
  state = await (await page.request.get(base+'/api/state')).json();
  assert.equal(state.vouchers.length,3); assert.equal(state.totals.debit,238298); assert.equal(state.totals.credit,238298);

  // A second browser's writes appear at navigation boundaries without a reload.
  const otherTab = await page.request.post(base+'/api/customers',{data:{name:'Other Tab Fictional Customer',alias:'OtherTab'}});
  assert.equal(otherTab.status(),201);
  const firstSale = state.vouchers.find(row => row.number === 1);
  assert.equal((await page.request.put(base+`/api/vouchers/${firstSale.id}`,{data:{...firstSale,amount:234551}})).status(),200);
  await openDayBook();
  assert.match(await page.locator('[data-sale-row="0"]').innerText(),/2,345\.51/);
  await page.locator('#new-sale').click();
  await page.locator('#sale-customer').fill('OtherTab');
  await page.getByRole('option',{name:'Other Tab Fictional Customer OtherTab',exact:true}).waitFor();
  await page.locator('#sale-customer').fill('');
  await page.locator('#sale-amount').focus();
  state = await (await page.request.get(base+'/api/state')).json();
  assert.equal(errors.length,0);
  const report = {application:'Bookr',scope:'Audited customer-to-sale flow; no tax or inventory',testData:'Temporary fictional database, separate from the live app and installed reference application',checks:{customerCreatedInBrowser:true,mailingDetailsPersist:true,dispatchAndPartySteps:true,voucherDetailsSnapshotPersistsAfterRestart:true,inlineCustomerCreationKeepsDraft:true,cancelInlineCreationKeepsDraft:true,otherTabChangesVisibleOnNavigation:true,customerAliasPicker:true,f2Date:true,enterAndShiftTab:true,ctrlAAccept:true,enterAccept:true,decimalAmountExact:true,invalidAmountRejected:true,newVoucherNumber:true,dayBookReopens:true,editReplacesPostings:true,balancedDebitsAndCredits:true,staleRevisionRejectedWithoutLosingInput:true,serverRestartPersistence:true,mobileNoHorizontalOverflow:true},finalTotals:state.totals,pageErrors:errors,screenshots:['bookr-sales-create.png','bookr-sales-dispatch.png','bookr-sales-party-details.png','bookr-sales-day-book.png','bookr-sales-entries.png','bookr-sales-reopened.png','bookr-sales-mobile.png']};
  await writeFile(join(output,'bookr-sales-check.json'),JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2));
  const billReport = {application:'Bookr',scope:'One New Ref for the full credit sale amount',nativeReference:'reference-app-sandbox/screenshots/live-29-custom-bill-name.png',checks:{defaultVoucherNumberEditable:true,namedReferenceIndependentOfNumber:true,emptyReferenceRejected:true,enterAndShiftTab:true,ctrlAAcceptsDialogOnly:true,enterAcceptsDialog:true,cancelPreservesSaleDraftAndSavedReference:true,reopenAfterServerRestart:true,alterKeepsBillIdentity:true,balancedEntriesUnchanged:true,mobileNoHorizontalOverflow:true},savedBillId:billId,pageErrors:errors,screenshots:['bookr-bill-new-ref.png','bookr-bill-reopened.png','bookr-bill-mobile.png'],limitations:['One new bill reference per sale','Credit periods and due-date entry are not implemented','Receipt allocation changes remain a separate step','Native duplicate reference-name semantics have not been established']};
  await writeFile(join(output,'bill-reference-check.json'),JSON.stringify(billReport,null,2));
} catch(failure) {
  if(page) { await page.screenshot({path:join(output,'bookr-sales-failure.png'),fullPage:true}).catch(() => {}); console.error(await page.locator('body').innerText().catch(() => 'Page unavailable')); }
  console.error(serverOutput); throw failure;
} finally { await browser?.close(); await stopServer(); await rm(directory,{recursive:true,force:true}); }

