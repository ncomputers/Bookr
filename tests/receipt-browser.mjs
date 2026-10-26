import {startOwnedTestServer,stopOwnedTestServer} from './owned-test-server.mjs';
import {chromium} from 'playwright-core';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),output=join(root,'evidence/web');
const directory=await mkdtemp(join(tmpdir(),'bookr-receipt-browser-')),base='http://127.0.0.1:4321';
let server,browser,page,serverOutput='';const errors=[];
async function startServer(){server=await startOwnedTestServer({root,port:4321,database:join(directory,'receipt.sqlite'),onOutput:text=>{serverOutput+=text;}});}
async function stopServer(){await stopOwnedTestServer(server);}
const state=async()=>await(await page.request.get(base+'/api/state')).json();
const saved=text=>page.waitForFunction(t=>document.querySelector('#screen-hint').textContent.includes(t),text);
async function home(){await page.getByRole('link',{name:'Bookr Gateway',exact:true}).click();await page.getByRole('heading',{name:'Gateway of Bookr',exact:true}).waitFor();}
async function sale(amount,reference){
  await home();await page.getByRole('button',{name:'Vouchers',exact:true}).click();
  await page.locator('#sale-customer').fill('Demo Customer');await page.keyboard.press('Enter');
  await page.locator('#voucher-details-dialog').waitFor();await page.keyboard.press('Control+a');
  await page.locator('#voucher-details-dialog[data-stage="party"]').waitFor();await page.keyboard.press('Control+a');
  await page.locator('#voucher-details-dialog').waitFor({state:'detached'});
  await page.locator('#sale-account').selectOption('2');await page.keyboard.press('Enter');
  await page.locator('#sale-amount').fill(amount);await page.keyboard.press('Enter');
  await page.locator('#bill-details-dialog').waitFor();await page.locator('#bill-reference').fill(reference);await page.keyboard.press('Control+a');
  await page.locator('#bill-details-dialog').waitFor({state:'detached'});await page.keyboard.press('Control+a');
  await saved('Saved Sales');
}
async function receipt(amount){
  await page.keyboard.press('F6');await page.locator('#receipt-form').waitFor();
  assert.equal(await page.locator('#receipt-account').evaluate(e=>e===document.activeElement),true);
  await page.keyboard.press('Enter');await page.locator('#receipt-customer').fill('Demo Customer');await page.keyboard.press('Enter');
  await page.locator('#receipt-amount').fill(amount);await page.keyboard.press('Enter');await page.locator('#receipt-bills-dialog').waitFor();
}
async function pickReference(index=0){
  await page.keyboard.press('Enter');await page.keyboard.press('Enter');await page.locator('#pending-picker').waitFor({state:'visible'});
  for(let i=0;i<index;i++)await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
}
async function finishRow(){await page.keyboard.press('Enter');await page.keyboard.press('Enter');}
async function statement(){await home();await page.getByRole('button',{name:'Ledger Vouchers',exact:true}).click();await page.locator('#report-ledger-search').fill('Demo Customer');await page.keyboard.press('Enter');await page.locator('.ledger-statement').waitFor();}
try{
  await mkdir(output,{recursive:true});await startServer();
  browser=await chromium.launch({headless:true,executablePath:process.env.BOOKR_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'});
  page=await browser.newPage({viewport:{width:1229,height:655},deviceScaleFactor:1});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base,{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Create',exact:true}).click();await page.getByRole('button',{name:'Ledger',exact:true}).click();
  await page.locator('#ledger-name').fill('Demo Customer');await page.keyboard.press('Control+a');await saved('Saved Demo Customer');
  await sale('1000','1');
  await receipt('400');await pickReference();
  assert.equal(await page.locator('#allocation-amount-0').inputValue(),'400.00');await finishRow();
  await page.locator('#receipt-bills-dialog').waitFor({state:'detached'});
  assert.equal((await state()).vouchers.length,1); // accepting bill details is not saving the receipt
  await page.keyboard.press('Control+a');await saved('Saved Receipt No. 1');
  let book=await state();assert.equal(book.outstanding[0].pending,60000);assert.equal(book.totals.balanced,true);
  await statement();assert.equal(await page.locator('#statement-closing').innerText(),'600.00 Dr');
  await page.keyboard.press('F5');await page.locator('.outstanding-report').waitFor();assert.equal(await page.locator('#outstanding-total').innerText(),'600.00 Dr');
  await page.screenshot({path:join(output,'bookr-outstanding-600.png'),fullPage:true});

  await sale('2500.75','STUDY-BILL-02');await receipt('825.25');await pickReference(1);
  assert.equal(await page.locator('#allocation-amount-0').inputValue(),'825.25');
  await page.locator('#allocation-amount-0').fill('625.25');await finishRow();
  await page.locator('#allocation-method-1').waitFor();await pickReference();
  assert.equal(await page.locator('#allocation-amount-1').inputValue(),'200.00');
  await page.screenshot({path:join(output,'bookr-receipt-split-dialog.png'),fullPage:true});
  await finishRow();await page.locator('#receipt-bills-dialog').waitFor({state:'detached'});
  assert.equal((await state()).vouchers.length,3);
  assert.equal(await page.locator('#receipt-narration').evaluate(e=>e===document.activeElement),true);
  await page.locator('#receipt-narration').fill('Observed fictional split receipt');await page.keyboard.press('Enter');
  await page.locator('#entry-dialog').waitFor();await page.keyboard.press('y');await saved('Saved Receipt No. 2');
  book=await state();const split=book.vouchers.find(v=>v.type==='receipt' && v.number===2);
  assert.equal(split.allocations.length,2);assert.deepEqual(book.outstanding.map(b=>b.pending),[40000,187550]);
  assert.deepEqual(book.totals,{debit:472600,credit:472600,balanced:true});

  await home();await page.getByRole('button',{name:'Day Book',exact:true}).click();await page.locator(`[data-open-sale="${split.id}"]`).click();
  await page.locator('#receipt-form').waitFor();assert.equal(await page.locator('#receipt-amount').inputValue(),'825.25');
  assert.equal(await page.locator('#receipt-cash-balance').innerText(),'1,225.25 Dr');
  assert.match(await page.locator('#receipt-allocation-summary').innerText(),/STUDY-BILL-02/);
  await page.locator('#receipt-amount').focus();await page.screenshot({path:join(output,'bookr-receipt-reopened.png'),fullPage:true});
  await page.locator('#view-receipt-postings').click();await page.locator('.receipt-entries').waitFor();
  assert.equal(await page.locator('.receipt-entries tbody tr').count(),2);assert.match(await page.locator('.receipt-entries').innerText(),/Balanced/);
  await page.screenshot({path:join(output,'bookr-receipt-entries.png'),fullPage:true});await page.keyboard.press('Escape');

  // The picker must use fresh backend context, never fall back to cached bills.
  const contextRoute=/\/api\/receipt-bills\?/;
  await page.route(contextRoute,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Receipt bill context temporarily unavailable.'})}));
  await page.locator('#receipt-bill-details').click();await page.locator('#receipt-error').filter({hasText:'temporarily unavailable'}).waitFor();
  assert.equal(await page.locator('#receipt-amount').isEnabled(),true);assert.equal(await page.locator('#receipt-amount').inputValue(),'825.25');assert.equal(await page.locator('#receipt-bills-dialog').count(),0);
  await page.unroute(contextRoute);

  // Reproduce the saved native correction and then restore the original split.
  const originalPostings=(await(await page.request.get(base+`/api/vouchers/${split.id}`)).json()).postings;
  const editContext=await(await page.request.get(base+`/api/receipt-bills?customer=${split.customer_id}&receipt=${split.id}`)).json();
  assert.deepEqual(editContext.bills.map(b=>[b.pending,b.own_allocation,b.available]),[[40000,20000,60000],[187550,62525,250075]]);
  await page.locator('#receipt-bill-details').click();await page.locator('#receipt-bills-dialog').waitFor();await page.locator('#allocation-ref-0').click();
  assert.match(await page.locator('#pending-picker').innerText(),/1,875\.50 Dr/);assert.doesNotMatch(await page.locator('#pending-picker').innerText(),/2,500\.75 Dr/);
  await page.keyboard.press('Escape');await page.locator('#pending-picker').waitFor({state:'hidden'});
  await page.locator('#allocation-amount-0').fill('225.25');await page.locator('#allocation-amount-1').fill('600.00');await page.keyboard.press('Control+a');await page.locator('#receipt-bills-dialog').waitFor({state:'detached'});
  await page.keyboard.press('Control+a');await saved('Saved changes to Receipt No. 2');
  const correctedBook=await state();assert.deepEqual(correctedBook.outstanding.map(b=>b.pending),[0,227550]);assert.deepEqual(correctedBook.totals,{debit:472600,credit:472600,balanced:true});
  const corrected=(await(await page.request.get(base+`/api/vouchers/${split.id}`)).json());assert.deepEqual(corrected.postings,originalPostings);assert.equal(corrected.number,2);
  assert.equal((await(await page.request.get(base+`/api/statement?ledger=${split.customer_id}`)).json()).balance,227550);
  assert.equal((await(await page.request.get(base+'/api/statement?ledger=1')).json()).balance,122525);
  const newContext=await(await page.request.get(base+`/api/receipt-bills?customer=${split.customer_id}`)).json();assert.equal(newContext.bills[0].available,0);
  const settledEdit=await(await page.request.get(base+`/api/receipt-bills?customer=${split.customer_id}&receipt=${split.id}`)).json();assert.equal(settledEdit.bills[0].pending,0);assert.equal(settledEdit.bills[0].available,60000);
  await page.locator(`[data-open-sale="${split.id}"]`).click();await page.locator('#receipt-form').waitFor();await page.screenshot({path:join(output,'bookr-receipt-corrected.png'),fullPage:true});
  await page.locator('#receipt-bill-details').click();await page.locator('#receipt-bills-dialog').waitFor();await page.locator('#allocation-ref-1').click();
  assert.match(await page.locator('#pending-picker').innerText(),/0\.00 Dr/);await page.keyboard.press('Escape');await page.locator('#pending-picker').waitFor({state:'hidden'});
  await page.locator('#allocation-amount-0').fill('625.25');await page.locator('#allocation-amount-1').fill('200.00');await page.keyboard.press('Control+a');await page.locator('#receipt-bills-dialog').waitFor({state:'detached'});
  await page.keyboard.press('Control+a');await saved('Saved changes to Receipt No. 2');assert.deepEqual((await state()).outstanding.map(b=>b.pending),[40000,187550]);
  await page.locator(`[data-open-sale="${split.id}"]`).click();await page.locator('#receipt-form').waitFor();

  // Validation and cancelling a dialog leave the saved voucher and entry draft intact.
  await page.locator('#receipt-bill-details').click();await page.locator('#receipt-bills-dialog').waitFor();
  // Pointer/touch users can remove and re-add an allocation without a keyboard.
  await page.locator('#allocation-amount-0').focus();await page.locator('#remove-allocation').click();
  assert.equal(await page.locator('[data-allocation-row]').count(),1);
  await page.locator('#add-allocation').click();await page.locator('#allocation-ref-1').click();
  await page.locator(`#pending-picker [data-bill-id="${split.allocations[0].bill_id}"]`).click();
  assert.equal(await page.locator('#allocation-amount-1').inputValue(),'625.25');
  await page.keyboard.press('Escape');await page.locator('#receipt-bills-dialog').waitFor({state:'detached'});
  await page.locator('#receipt-bill-details').click();await page.locator('#receipt-bills-dialog').waitFor();
  const secondBillIndex=split.allocations.findIndex(a=>a.reference==='STUDY-BILL-02');
  await page.locator(`#allocation-amount-${secondBillIndex}`).fill('625.26');await page.keyboard.press('Control+a');
  await page.locator('#allocation-error').filter({hasText:'must equal'}).waitFor();
  await page.keyboard.press('Escape');await page.locator('#receipt-bills-dialog').waitFor({state:'detached'});
  assert.deepEqual((await state()).vouchers.find(v=>v.id===split.id).allocations,split.allocations);
  await page.locator('#receipt-narration').fill('Edited in browser');await page.keyboard.press('Control+a');await saved('Saved changes to Receipt No. 2');
  await page.getByRole('heading',{name:'Day Book',exact:true}).waitFor();

  await statement();assert.equal(await page.locator('#statement-closing').innerText(),'2,275.50 Dr');
  assert.equal(await page.locator('.ledger-statement tbody tr').count(),4);
  await page.screenshot({path:join(output,'bookr-ledger-statement.png'),fullPage:true});
  // Reopen and save from a statement, retaining report context.
  await page.locator(`[data-report-voucher="${split.id}"]`).click();await page.locator('#receipt-form').waitFor();
  await page.locator('#receipt-narration').fill('Saved from ledger statement');await page.keyboard.press('Control+a');await saved('Saved changes to Receipt No. 2');
  await page.locator('.ledger-statement').waitFor();
  await page.keyboard.press('F5');await page.locator('.outstanding-report').waitFor();
  assert.equal(await page.locator('#outstanding-total').innerText(),'2,275.50 Dr');
  await page.screenshot({path:join(output,'bookr-outstanding-split.png'),fullPage:true});
  await page.keyboard.press('Enter');await page.locator('#sales-form').waitFor();await page.locator('#sale-amount').focus();await page.keyboard.press('Escape');await page.locator('.outstanding-report').waitFor();

  // The separately observed F2 period carries balances even with no rows.
  await page.keyboard.press('Escape');await page.locator('.ledger-statement').waitFor();await page.keyboard.press('F2');
  await page.locator('#report-period-dialog').waitFor();
  await page.locator('#period-from').fill('2-4-2026');await page.keyboard.press('Enter');
  assert.equal(await page.locator('#period-to').evaluate(e=>e===document.activeElement),true);
  await page.locator('#period-to').fill('2-4-2026');await page.keyboard.press('Enter');
  await page.locator('#report-period-dialog').waitFor({state:'detached'});
  assert.equal(await page.locator('.ledger-statement tbody tr').count(),0);
  assert.equal(await page.locator('#statement-opening').innerText(),'2,275.50 Dr');assert.equal(await page.locator('#statement-closing').innerText(),'2,275.50 Dr');
  await page.screenshot({path:join(output,'bookr-period-opening.png'),fullPage:true});
  await page.keyboard.press('F2');await page.locator('#report-period-dialog').waitFor();
  await page.locator('#period-from').fill('3-4-2026');await page.locator('#period-to').fill('2-4-2026');await page.keyboard.press('Control+a');
  await page.locator('#period-error').filter({hasText:'must not be after'}).waitFor();
  await page.locator('#period-from').fill('1-4-2026');
  await page.screenshot({path:join(output,'bookr-period-dialog.png'),fullPage:true});
  await page.keyboard.press('Control+a');await page.locator('#report-period-dialog').waitFor({state:'detached'});
  assert.equal(await page.locator('.ledger-statement tbody tr').count(),4);assert.equal(await page.locator('#statement-opening').innerText(),'0.00 Dr');
  await page.keyboard.press('F2');await page.locator('#period-from').fill('3-4-2026');await page.keyboard.press('Escape');
  await page.locator('#report-period-dialog').waitFor({state:'detached'});assert.equal(await page.locator('.ledger-statement tbody tr').count(),4);
  await page.keyboard.press('F5');await page.locator('.outstanding-report').waitFor();assert.match(await page.locator('.report-ledger-name').innerText(),/Current balances/);
  await page.keyboard.press('Escape');await page.locator('.ledger-statement').waitFor();assert.match(await page.locator('.report-ledger-name').innerText(),/1-Apr-2026 to 2-Apr-2026/);
  await page.locator('#statement-all-dates').click();await page.waitForFunction(()=>document.querySelector('.report-ledger-name')?.textContent.includes('All saved vouchers'));

  await stopServer();await startServer();await page.reload({waitUntil:'networkidle'});await statement();
  assert.equal(await page.locator('#statement-closing').innerText(),'2,275.50 Dr');
  await page.locator(`[data-report-voucher="${split.id}"]`).click();await page.locator('#receipt-form').waitFor();
  assert.equal(await page.locator('#receipt-narration').inputValue(),'Saved from ledger statement');
  // Reject stale writes without losing the current form.
  const detail=await(await page.request.get(base+`/api/vouchers/${split.id}`)).json();
  assert.equal((await page.request.put(base+`/api/vouchers/${split.id}`,{data:{...detail,narration:'Other tab saved'}})).status(),200);
  await page.locator('#receipt-narration').fill('Keep my draft');await page.keyboard.press('Control+a');
  await page.locator('#receipt-error').filter({hasText:'changed after you opened'}).waitFor();assert.equal(await page.locator('#receipt-narration').inputValue(),'Keep my draft');
  await page.keyboard.press('Escape');await page.locator('#entry-dialog').waitFor();await page.keyboard.press('y');await page.locator('.ledger-statement').waitFor();
  await page.locator(`[data-report-voucher="${split.id}"]`).click();await page.locator('#receipt-form').waitFor();
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.locator('#receipt-bill-details').click();await page.locator('#receipt-bills-dialog').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:join(output,'bookr-receipt-mobile.png'),fullPage:true});
  await page.keyboard.press('Escape');await page.locator('#receipt-bills-dialog').waitFor({state:'detached'});
  await page.keyboard.press('Escape');await page.locator('.ledger-statement').waitFor();await page.keyboard.press('F5');await page.locator('.outstanding-report').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.setViewportSize({width:320,height:740});await page.keyboard.press('Escape');await page.locator('.ledger-statement').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.keyboard.press('F2');await page.locator('#report-period-dialog').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.keyboard.press('Escape');await page.locator('#report-period-dialog').waitFor({state:'detached'});
  book=await state();assert.equal(book.vouchers.length,4);assert.deepEqual(book.outstanding.map(b=>b.pending),[40000,187550]);assert.equal(errors.length,0);
  const report={application:'Bookr',testData:'Temporary fictional database; installed reference application and live web company untouched',checks:{customerAndSalesInBrowser:true,receiptViaF6:true,enterAllocationFlow:true,ctrlAAcceptsDialogOnly:true,partialReceipt600:true,splitReceipt82525:true,saveReopen:true,onlyTwoAccountingPostings:true,allocationTotalValidation:true,cancelKeepsSavedAllocation:true,receiptEditKeepsVoucherNumber:true,statementDrillAndReturn:true,outstandingDrillAndReturn:true,staleWritesPreserveDraft:true,restartPersistence:true,mobileNoDocumentOverflow:true},observedResult:{saleTotal:350075,receiptTotal:122525,closing:227550,pending:book.outstanding.map(b=>({reference:b.reference,paise:b.pending}))},totals:book.totals,pageErrors:errors,screenshots:['bookr-outstanding-600.png','bookr-receipt-split-dialog.png','bookr-receipt-reopened.png','bookr-receipt-entries.png','bookr-ledger-statement.png','bookr-outstanding-split.png','bookr-receipt-mobile.png']};
  await writeFile(join(output,'receipt-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  await writeFile(join(output,'receipt-correction-check.json'),JSON.stringify({application:'Bookr',nativeStudy:'evidence/native-study/receipt-correction-study.json',testData:'Separate temporary fictional database',checks:{pickerUsesBackendContext:true,contextFailureKeepsDraftAndAllowsRetry:true,currentPendingSeparateFromEditAvailability:true,corrected22525Plus60000Saved:true,onlyTwoPostingsUnchanged:true,customerClosing227550Unchanged:true,cashBalance122525Unchanged:true,settledBillUnavailableForNewReceipt:true,ownSettledAllocationCanBeReplaced:true,restored62525Plus20000:true,noExtraVouchers:true},screenshots:['bookr-receipt-corrected.png'],limits:['Fully settled existing allocations remain editable; general native settled-reference discovery is not reproduced','Advance and on-account rules remain outside scope']},null,2));
  await writeFile(join(output,'period-check.json'),JSON.stringify({application:'Bookr',testData:'Same separate temporary fictional receipt test database',nativeStudy:'evidence/native-study/period-study.json',checks:{f2PeriodDialog:true,fromEnterMovesTo:true,numericDateEntry:true,enterAndCtrlAAccept:true,invalidRangeRejected:true,cancelKeepsPreviousPeriod:true,emptyPeriodCarriesOpening227550:true,inclusiveRangeRestoresFourVouchers:true,outstandingCaptionExplicitlyCurrent:true,periodRetainedOnReturnFromOutstanding:true,allDatesClearsRange:true,mobile320NoDocumentOverflow:true},screenshots:['bookr-period-opening.png','bookr-period-dialog.png'],limitations:['View period resets on page reload','Outstanding as-of dates are not implemented','Blank and partial native date parsing is not implemented']},null,2));
}catch(failure){if(page){await page.screenshot({path:join(output,'bookr-receipt-failure.png'),fullPage:true}).catch(()=>{});console.error(await page.locator('body').innerText().catch(()=>''));}console.error(serverOutput);throw failure;}
finally{await browser?.close();await stopServer();await rm(directory,{recursive:true,force:true});}
