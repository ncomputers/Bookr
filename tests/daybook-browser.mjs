import {startOwnedTestServer,stopOwnedTestServer} from './owned-test-server.mjs';
import {chromium} from 'playwright-core';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),output=join(root,'evidence/web');
const directory=await mkdtemp(join(tmpdir(),'bookr-daybook-browser-')),base='http://127.0.0.1:4322';
let server,browser,page,serverOutput='';const errors=[];
async function start(){server=await startOwnedTestServer({root,port:4322,database:join(directory,'daybook.sqlite'),onOutput:text=>{serverOutput+=text;}});}
async function stop(){await stopOwnedTestServer(server);}
async function post(path,data){const response=await page.request.post(base+path,{data});assert.equal(response.status(),201);return response.json();}
const state=async()=>await(await page.request.get(base+'/api/state')).json();
async function type(name){await page.keyboard.press('F4');await page.locator('#voucher-type-dialog').waitFor();await page.locator('#voucher-type-search').fill(name);await page.keyboard.press('Enter');await page.locator('#voucher-type-dialog').waitFor({state:'detached'});}
try{
  await mkdir(output,{recursive:true});await start();browser=await chromium.launch({headless:true,executablePath:process.env.BOOKR_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'});
  page=await browser.newPage({viewport:{width:1229,height:655},deviceScaleFactor:1});page.on('pageerror',e=>errors.push(e.message));
  const customer=await post('/api/customers',{name:'Demo Customer'});
  const sale=(date,amount,reference)=>post('/api/vouchers',{type:'sale',date,customer_id:customer.id,account_id:2,amount,bill:{reference}});
  const first=await sale('2026-04-01',100000,'1');
  const receipt=(date,amount,allocations)=>post('/api/vouchers',{type:'receipt',date,customer_id:customer.id,account_id:1,amount,allocations});
  const initialReceipt=await receipt('2026-04-01',40000,[{bill_id:first.bill.id,amount:40000}]);
  const second=await sale('2026-04-01',250075,'STUDY-BILL-02');
  await receipt('2026-04-01',82525,[{bill_id:second.bill.id,amount:62525},{bill_id:first.bill.id,amount:20000}]);
  await sale('2026-04-03',35000,'LATER-SALE');
  await receipt('2026-04-04',15000,[{bill_id:first.bill.id,amount:15000}]);
  const before=await state();
  await page.goto(base,{waitUntil:'networkidle'});await page.getByRole('button',{name:'Day Book',exact:true}).click();await page.locator('.filtered-day-book').waitFor();
  assert.equal(await page.locator('[data-sale-row]').count(),6);
  assert.match(await page.locator('[data-sale-row="0"]').innerText(),/Receipt/);assert.match(await page.locator('[data-sale-row="2"]').innerText(),/Sales/);
  await type('Sales');assert.equal(await page.locator('[data-sale-row]').count(),3);assert.match(await page.locator('#daybook-totals').innerText(),/3,850\.75/);
  await page.screenshot({path:join(output,'bookr-daybook-sales-filter.png'),fullPage:true});
  await page.keyboard.press('F2');await page.locator('#report-date-dialog').waitFor();assert.equal(await page.locator('#report-date-dialog input').count(),1);
  await page.locator('#period-from').fill('2-4-2026');await page.keyboard.press('Enter');await page.locator('#report-date-dialog').waitFor({state:'detached'});
  assert.equal(await page.locator('[data-sale-row]').count(),0);assert.match(await page.locator('#daybook-period-caption').innerText(),/For 2-Apr-2026/);assert.match(await page.locator('.report-ledger-name').innerText(),/List of Sales/);
  await page.keyboard.press('Alt+F2');await page.locator('#report-period-dialog').waitFor();await page.locator('#period-from').fill('1-4-2026');await page.keyboard.press('Enter');await page.locator('#period-to').fill('3-4-2026');await page.keyboard.press('Control+a');await page.locator('#report-period-dialog').waitFor({state:'detached'});
  assert.equal(await page.locator('[data-sale-row]').count(),3);await type('Receipt');assert.equal(await page.locator('[data-sale-row]').count(),2);assert.match(await page.locator('#daybook-totals').innerText(),/1,225\.25/);
  await page.screenshot({path:join(output,'bookr-daybook-receipt-period.png'),fullPage:true});
  await page.keyboard.press('F4');await page.locator('#voucher-type-search').fill('Credit Note');await page.keyboard.press('Enter');await page.locator('#voucher-type-error').filter({hasText:'Choose one of the supported'}).waitFor();await page.keyboard.press('Escape');await page.locator('#voucher-type-dialog').waitFor({state:'detached'});
  assert.equal(await page.locator('[data-sale-row]').count(),2);assert.deepEqual(await state(),before);

  // Reopen/edit/return keeps filters and refreshes their rows and totals.
  await page.keyboard.press('Enter');await page.locator('#receipt-form').waitFor();assert.equal(await page.locator('#receipt-number').innerText(),'1');
  await page.locator('#receipt-narration').fill('Edited through filtered Day Book');await page.keyboard.press('Control+a');
  await page.locator('.filtered-day-book').waitFor();assert.equal(await page.locator('[data-sale-row]').count(),2);assert.match(await page.locator('#daybook-period-caption').innerText(),/1-Apr-2026 to 3-Apr-2026/);
  await page.keyboard.press('Enter');await page.locator('#receipt-form').waitFor();await page.locator('#receipt-date').fill('4-4-2026');await page.keyboard.press('Control+a');
  await page.locator('.filtered-day-book').waitFor();assert.equal(await page.locator('[data-sale-row]').count(),1);assert.match(await page.locator('#daybook-totals').innerText(),/825\.25/);
  const changed=await state();assert.equal(changed.vouchers.find(v=>v.id===initialReceipt.id).date,'2026-04-04');assert.equal(changed.vouchers.length,6);assert.equal(changed.totals.balanced,true);
  await type('All Items');assert.equal(await page.locator('[data-sale-row]').count(),4);assert.equal(await page.locator('#daybook-totals').innerText(),'');
  await page.keyboard.press('F8');assert.equal(await page.locator('.filtered-day-book').count(),1);assert.match(await page.locator('#screen-hint').innerText(),/Columnar/);
  await page.locator('#new-sale').click();await page.locator('#sales-form').waitFor();await page.keyboard.press('F6');await page.locator('#receipt-form').waitFor();await page.keyboard.press('F8');await page.locator('#sales-form').waitFor();await page.locator('#sale-narration').focus();await page.keyboard.press('Escape');await page.locator('.filtered-day-book').waitFor();

  // Small-screen filters remain usable without document overflow.
  await page.setViewportSize({width:320,height:740});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.locator('#daybook-type').click();await page.locator('#voucher-type-dialog').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:join(output,'bookr-daybook-mobile.png'),fullPage:true});await page.keyboard.press('Escape');await page.locator('#voucher-type-dialog').waitFor({state:'detached'});
  await page.locator('#daybook-all-dates').click();await page.waitForFunction(()=>document.querySelector('#daybook-period-caption')?.textContent==='All dates');assert.equal(await page.locator('[data-sale-row]').count(),6);
  for(const query of ['type=credit-note','from=2026-02-30','from=2026-04-04&to=2026-04-01'])assert.equal((await page.request.get(base+'/api/day-book?'+query)).status(),400);
  await stop();await start();await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'Day Book',exact:true}).click();await page.locator('.filtered-day-book').waitFor();assert.equal(await page.locator('[data-sale-row]').count(),6);assert.equal((await state()).totals.balanced,true);assert.equal(errors.length,0);
  const report={application:'Bookr',testData:'Temporary fictional database; no installed reference application or live web data used',nativeStudy:'evidence/native-study/daybook-study.json',checks:{sameDateReceiptBeforeSales:true,f4VoucherTypePicker:true,salesTotal385075:true,f2SingleDate:true,emptyDateKeepsType:true,altF2InclusivePeriod:true,receiptPeriodTotal122525:true,invalidTypeRejected:true,cancelKeepsFilter:true,reopenSaveKeepsFilter:true,editingDateRefreshesMembershipAndTotal:true,f8ContextCorrect:true,allDatesClearsDateFilter:true,apiInvalidFiltersReturn400:true,mobile320NoDocumentOverflow:true,restartPersistence:true},finalTotals:(await state()).totals,pageErrors:errors,screenshots:['bookr-daybook-sales-filter.png','bookr-daybook-receipt-period.png','bookr-daybook-mobile.png']};
  await writeFile(join(output,'daybook-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(failure){if(page){await page.screenshot({path:join(output,'bookr-daybook-failure.png'),fullPage:true}).catch(()=>{});console.error(await page.locator('body').innerText().catch(()=>''));}console.error(serverOutput);throw failure;}
finally{await browser?.close();await stop();await rm(directory,{recursive:true,force:true});}
