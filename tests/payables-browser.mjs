import {startOwnedTestServer,stopOwnedTestServer} from './owned-test-server.mjs';
import {chromium} from 'playwright-core';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),output=join(root,'evidence/web');
const directory=await mkdtemp(join(tmpdir(),'bookr-payables-browser-')),base='http://127.0.0.1:4323';
let server,browser,page,serverOutput='',step='startup';const errors=[];
async function startServer(){server=await startOwnedTestServer({root,port:4323,database:join(directory,'book.sqlite'),onOutput:text=>{serverOutput+=text;}});}
async function stopServer(){await stopOwnedTestServer(server);}
const state=async()=>await(await page.request.get(base+'/api/state')).json();
const saved=text=>page.waitForFunction(t=>document.querySelector('#screen-hint').textContent.includes(t),text);
async function post(path,data){const response=await page.request.post(base+path,{data});assert.equal(response.ok(),true,await response.text());return response.json();}
async function home(){await page.getByRole('link',{name:'Bookr Gateway',exact:true}).click();await page.getByRole('heading',{name:'Gateway of Bookr',exact:true}).waitFor();}
async function statement(name){await home();await page.getByRole('button',{name:'Ledger Vouchers',exact:true}).click();await page.locator('#report-ledger-search').fill(name);await page.keyboard.press('Enter');await page.locator('.ledger-statement').waitFor();}
async function bills(){await page.locator('#receipt-amount').press('Enter');await page.locator('#receipt-bills-dialog').waitFor();}
async function acceptDialog(){await page.keyboard.press('Control+a');await page.locator('#receipt-bills-dialog').waitFor({state:'detached'});}
try{
  await mkdir(output,{recursive:true});await startServer();
  browser=await chromium.launch({headless:true,executablePath:process.env.BOOKR_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'});
  page=await browser.newPage({viewport:{width:1229,height:655},deviceScaleFactor:1});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base,{waitUntil:'networkidle'});
  // The previously observed customer cycle supplies the same opening cash and
  // receivable balances as the isolated native purchase study.
  const customer=await post('/api/customers',{name:'Demo Customer'});
  const sale=amount=>post('/api/vouchers',{type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount});
  const first=await sale(100000),second=await sale(250075);
  await post('/api/vouchers',{type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1,amount:40000,allocations:[{bill_id:first.bill.id,amount:40000}]});
  await post('/api/vouchers',{type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1,amount:82525,allocations:[{bill_id:second.bill.id,amount:62525},{bill_id:first.bill.id,amount:20000}]});
  step='supplier creation and alteration';await home();
  await page.getByRole('button',{name:'Create',exact:true}).click();await page.getByRole('button',{name:'Ledger',exact:true}).click();
  await page.locator('#ledger-name').fill('Study Supplier Fictional');await page.locator('#ledger-alias').fill('SSF');
  await page.locator('#ledger-group').selectOption('supplier');assert.match(await page.locator('.parent-group').innerText(),/Current Liabilities/);
  await page.keyboard.press('Control+a');await saved('Saved Study Supplier Fictional');
  let book=await state();const supplier=book.ledgers.find(l=>l.kind==='supplier');assert.equal(supplier.name,'Study Supplier Fictional');
  await home();await page.getByRole('button',{name:'Alter',exact:true}).click();await page.getByRole('button',{name:'Ledger',exact:true}).click();
  await page.locator('#ledger-search').fill('SSF');await page.keyboard.press('Enter');await page.locator('#ledger-name').waitFor();
  assert.equal(await page.locator('#ledger-group').inputValue(),'supplier');assert.equal(await page.locator('#ledger-group').isDisabled(),true);
  await page.locator('#mailing-address').fill('Fictional Supplier Street');await page.keyboard.press('Control+a');await saved('Saved changes to Study Supplier Fictional');
  assert.equal((await state()).ledgers.find(l=>l.id===supplier.id).revision,2);

  step='purchase through F9';await home();await page.getByRole('button',{name:'Vouchers',exact:true}).click();await page.locator('#sales-form').waitFor();await page.keyboard.press('F9');await page.locator('#purchase-form').waitFor();
  assert.equal(await page.locator('#purchase-invoice').evaluate(e=>e===document.activeElement),true);
  await page.locator('#purchase-invoice').fill('SUP-001');await page.keyboard.press('Enter');await page.keyboard.press('Enter');
  await page.locator('#purchase-supplier').fill('SSF');await page.keyboard.press('Enter');
  await page.locator('#voucher-details-dialog').waitFor();assert.equal(await page.locator('#details-heading').innerText(),'Receipt Details');await page.keyboard.press('Control+a');
  await page.locator('#voucher-details-dialog[data-stage="party"]').waitFor();assert.equal(await page.locator('#detail-address').inputValue(),'Fictional Supplier Street');await page.keyboard.press('Control+a');
  await page.locator('#voucher-details-dialog').waitFor({state:'detached'});await page.keyboard.press('Enter');
  await page.locator('#purchase-amount').fill('1500');await page.keyboard.press('Enter');await page.locator('#bill-details-dialog').waitFor();
  assert.equal(await page.locator('#bill-reference').inputValue(),'SUP-001');assert.equal(await page.locator('#bill-side').inputValue(),'Cr');
  await page.keyboard.press('Control+a');await page.locator('#bill-details-dialog').waitFor({state:'detached'});assert.equal((await state()).vouchers.length,4);
  await page.keyboard.press('Control+a');await saved('Saved Purchase No. 1');
  book=await state();const purchase=book.vouchers.find(v=>v.type==='purchase');assert.equal(purchase.details.supplier_invoice.number,'SUP-001');assert.equal(purchase.bill.reference,'SUP-001');

  step='payment through F5';await page.keyboard.press('F5');await page.locator('#receipt-form[data-voucher-type="payment"]').waitFor();
  assert.equal(await page.locator('#receipt-customer').evaluate(e=>e===document.activeElement),true);
  await page.locator('#receipt-customer').fill('SSF');await page.keyboard.press('Enter');await page.locator('#receipt-amount').fill('600');await bills();
  assert.match(await page.locator('.bill-dialog-heading').innerText(),/600.00 Dr/);
  await page.keyboard.press('Enter');await page.keyboard.press('Enter');await page.locator('#pending-picker').waitFor({state:'visible'});
  assert.match(await page.locator('#pending-picker').innerText(),/1,500.00 Cr/);await page.keyboard.press('Enter');
  assert.equal(await page.locator('#allocation-amount-0').inputValue(),'600.00');
  await acceptDialog();assert.equal((await state()).vouchers.length,5);assert.equal(await page.locator('#receipt-account').evaluate(e=>e===document.activeElement),true);
  await page.keyboard.press('Enter');await page.locator('#receipt-narration').fill('Fictional purchase settlement');await page.keyboard.press('Control+a');await saved('Saved Payment No. 1');
  book=await state();const payment=book.vouchers.find(v=>v.type==='payment');assert.equal(book.vouchers.length,6);assert.equal(book.payables[0].pending,90000);assert.equal(book.totals.balanced,true);

  step='reports and saved voucher drill-through';await home();await page.getByRole('button',{name:'Bills Payable',exact:true}).click();await page.locator('.outstanding-report').waitFor();
  assert.equal(await page.locator('#outstanding-total').innerText(),'900.00 Cr');await page.screenshot({path:join(output,'bookr-payable-900.png'),fullPage:true});
  await page.keyboard.press('Enter');await page.locator('#purchase-form').waitFor();assert.equal(await page.locator('#purchase-invoice').inputValue(),'SUP-001');assert.equal(await page.locator('#purchase-amount').inputValue(),'1500.00');
  await page.locator('#purchase-amount').focus();await page.screenshot({path:join(output,'bookr-purchase-reopened.png'),fullPage:true});
  await page.locator('#view-purchase-postings').click();await page.locator('.purchase-entries').waitFor();assert.equal(await page.locator('.purchase-entries tbody tr').count(),2);await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  await page.locator('.outstanding-report').waitFor();assert.equal(await page.locator('#outstanding-total').innerText(),'900.00 Cr');
  await statement('SSF');assert.equal(await page.locator('#statement-closing').innerText(),'900.00 Cr');assert.equal(await page.locator('.ledger-statement tbody tr').count(),2);
  await page.screenshot({path:join(output,'bookr-supplier-statement.png'),fullPage:true});
  await page.keyboard.press('F5');await page.locator('.outstanding-report').waitFor();await page.keyboard.press('Escape');await page.locator('.ledger-statement').waitFor();
  await page.locator(`[data-report-voucher="${payment.id}"]`).click();await page.locator('#receipt-form[data-voucher-type="payment"]').waitFor();
  assert.equal(await page.locator('#receipt-balance').innerText(),'900.00 Cr');assert.equal(await page.locator('#receipt-cash-balance').innerText(),'625.25 Dr');
  assert.ok((await page.locator('#receipt-account').boundingBox()).width>100);assert.equal(await page.locator('#receipt-account option:checked').innerText(),'Cash');
  assert.equal(await page.locator('#receipt-total').innerText(),'600.00');assert.equal(await page.locator('#payment-credit-total').innerText(),'600.00');
  await page.locator('#receipt-amount').focus();await page.screenshot({path:join(output,'bookr-payment-reopened.png'),fullPage:true});
  await page.locator('#view-receipt-postings').click();await page.locator('.receipt-entries').waitFor();assert.equal(await page.locator('.receipt-entries tbody tr').count(),2);await page.keyboard.press('Escape');

  step='payment edit and restore';await page.locator('#receipt-amount').fill('400');await bills();await page.locator('#allocation-amount-0').fill('400');await acceptDialog();await page.keyboard.press('Control+a');await saved('Saved changes to Payment No. 1');
  assert.equal(await page.locator('#statement-closing').innerText(),'1,100.00 Cr');assert.equal((await state()).vouchers.length,6);
  await page.locator(`[data-report-voucher="${payment.id}"]`).click();await page.locator('#receipt-amount').fill('600');await bills();await page.locator('#allocation-amount-0').fill('600');await acceptDialog();await page.keyboard.press('Control+a');await saved('Saved changes to Payment No. 1');
  assert.equal(await page.locator('#statement-closing').innerText(),'900.00 Cr');

  step='stale purchase and failed bill-context requests preserve drafts';await page.locator(`[data-report-voucher="${purchase.id}"]`).click();await page.locator('#purchase-form').waitFor();
  const currentPurchase=(await state()).vouchers.find(v=>v.id===purchase.id);
  const remote=await page.request.put(base+`/api/vouchers/${purchase.id}`,{data:{...currentPurchase,narration:'Updated in another session'}});assert.equal(remote.ok(),true);const afterRemote=await state();
  await page.locator('#purchase-amount').fill('1600');await page.keyboard.press('Control+a');await page.locator('#bill-details-dialog').waitFor();await page.keyboard.press('Control+a');await page.locator('#bill-details-dialog').waitFor({state:'detached'});await page.keyboard.press('Control+a');
  await page.locator('#purchase-error').filter({hasText:'changed after you opened'}).waitFor();assert.equal(await page.locator('#purchase-amount').inputValue(),'1600');assert.deepEqual(await state(),afterRemote);
  await page.getByRole('link',{name:'Bookr Gateway',exact:true}).click();await page.locator('#entry-dialog').waitFor();await page.keyboard.press('y');await page.getByRole('heading',{name:'Gateway of Bookr',exact:true}).waitFor();
  await page.getByRole('button',{name:'Day Book',exact:true}).click();await page.locator(`[data-open-sale="${payment.id}"]`).click();await page.locator('#receipt-form').waitFor();
  const route=/\/api\/payment-bills\?/;await page.route(route,r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Payment bills temporarily unavailable.'})}));
  await page.locator('#receipt-bill-details').click();await page.locator('#receipt-error').filter({hasText:'temporarily unavailable'}).waitFor();assert.equal(await page.locator('#receipt-amount').isEnabled(),true);assert.equal(await page.locator('#receipt-amount').inputValue(),'600.00');await page.unroute(route);
  await page.locator('#receipt-bill-details').click();await page.locator('#receipt-bills-dialog').waitFor();await page.locator('#cancel-allocations').click();await page.keyboard.press('Escape');await page.locator('.day-book').waitFor();
  await page.keyboard.press('F4');await page.locator('#voucher-type-search').fill('Payment');await page.keyboard.press('Enter');await page.locator('#voucher-type-dialog').waitFor({state:'detached'});assert.equal(await page.locator('.filtered-day-book tbody tr').count(),1);assert.match(await page.locator('#daybook-totals').innerText(),/600.00/);

  step='trial balance and period drill-through';await home();await page.getByRole('button',{name:'Display More Reports',exact:true}).click();await page.locator('#open-trial-balance').waitFor();await page.keyboard.press('Enter');await page.locator('.trial-balance').waitFor();
  assert.equal(await page.locator('#trial-debit').innerText(),'4,400.75');assert.equal(await page.locator('#trial-credit').innerText(),'4,400.75');assert.equal(await page.locator('#trial-status').innerText(),'Balanced');
  assert.equal(await page.locator('.trial-balance tbody tr').count(),5);await page.screenshot({path:join(output,'bookr-trial-balance.png'),fullPage:true});
  await page.locator('[data-trial-ledger="1"]').click();await page.locator('.ledger-statement').waitFor();assert.equal(await page.locator('#statement-closing').innerText(),'625.25 Dr');assert.equal(await page.locator('.ledger-statement tbody tr').count(),3);assert.equal(await page.locator('#statement-outstanding').count(),0);
  await page.keyboard.press('Escape');await page.locator('.trial-balance').waitFor();await page.keyboard.press('F2');await page.locator('#report-period-dialog').waitFor();
  await page.locator('#period-from').fill('2-4-2026');await page.locator('#period-to').fill('2-4-2026');await page.keyboard.press('Control+a');await page.locator('#report-period-dialog').waitFor({state:'detached'});
  assert.equal(await page.locator('#trial-debit').innerText(),'4,400.75');await page.locator(`[data-trial-ledger="${supplier.id}"]`).click();await page.locator('.ledger-statement').waitFor();
  assert.equal(await page.locator('.ledger-statement tbody tr').count(),0);assert.equal(await page.locator('#statement-opening').innerText(),'900.00 Cr');assert.equal(await page.locator('#statement-closing').innerText(),'900.00 Cr');
  await page.keyboard.press('Escape');await page.locator('.trial-balance').waitFor();assert.match(await page.locator('#trial-period-caption').innerText(),/2-Apr-2026/);await page.locator('#trial-all-dates').click();

  step='restart and mobile';const persisted=await state();await stopServer();await startServer();await page.reload({waitUntil:'networkidle'});assert.deepEqual(await state(),persisted);
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});await home();await page.getByRole('button',{name:'Day Book',exact:true}).click();await page.locator(`[data-open-sale="${purchase.id}"]`).click();await page.locator('#purchase-form').waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);if(width===390)await page.screenshot({path:join(output,'bookr-purchase-mobile.png'),fullPage:true});
    await page.keyboard.press('Escape');await page.locator('.day-book').waitFor();await page.locator(`[data-open-sale="${payment.id}"]`).click();await page.locator('#receipt-form').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    await page.locator('#receipt-bill-details').click();await page.locator('#receipt-bills-dialog').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);await page.locator('#cancel-allocations').click();await page.keyboard.press('Escape');
  }
  assert.deepEqual(errors,[]);assert.equal((await state()).vouchers.length,6);
  const result={application:'Bookr',testData:'Temporary fictional database; installed reference application and live web company untouched',checks:{supplierCreateAlterAlias:true,purchaseF9:true,supplierInvoiceSnapshot:true,receiptAndPartyDetails:true,newRefCredit:true,paymentF5:true,agstRefDebit:true,modalAcceptanceDoesNotPost:true,saveReopen:true,balancedEntries:true,supplierStatementAndPayable900:true,paymentEditRestore:true,stalePurchaseKeepsDraft:true,billContextFailureKeepsDraft:true,dayBookPaymentFilter:true,trialBalanceMatchesNative:true,cashDrillThrough:true,periodOpeningNoRows:true,restartPersistence:true,mobile320And390:true},observedResult:{purchase:150000,payment:60000,payable:90000,cash:62525,customer:227550,trialClosingDebit:440075,trialClosingCredit:440075},pageErrors:errors,screenshots:['bookr-purchase-reopened.png','bookr-payment-reopened.png','bookr-supplier-statement.png','bookr-payable-900.png','bookr-trial-balance.png','bookr-purchase-mobile.png']};
  await writeFile(join(output,'payables-check.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}catch(failure){console.error('Failed at: '+step);if(page){console.error(await page.locator('body').innerText().catch(()=>''));await page.screenshot({path:join(output,'payables-failure.png'),fullPage:true}).catch(()=>{});}console.error(serverOutput);throw failure;}
finally{await browser?.close();await stopServer();await rm(directory,{recursive:true,force:true});}
