import {startOwnedTestServer,stopOwnedTestServer} from './owned-test-server.mjs';
import {chromium} from 'playwright-core';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),output=join(root,'evidence/web');
const directory=await mkdtemp(join(tmpdir(),'bookr-financial-browser-')),base='http://127.0.0.1:4325';
let server,browser,page,serverOutput='',step='startup';const errors=[];
async function start(){server=await startOwnedTestServer({root,port:4325,database:join(directory,'book.sqlite'),onOutput:text=>{serverOutput+=text;}});}
async function stop(){await stopOwnedTestServer(server);}
async function request(path,data,method='post'){const response=await page.request[method](base+path,{data});assert.equal(response.ok(),true,await response.text());return response.json();}
async function get(path){const response=await page.request.get(base+path);assert.equal(response.ok(),true);return response.json();}
async function home(){await page.getByRole('link',{name:'Bookr Gateway',exact:true}).click();await page.getByRole('heading',{name:'Gateway of Bookr',exact:true}).waitFor();}
async function report(name){await home();await page.getByRole('button',{name,exact:true}).click();await page.locator('.financial-report').waitFor();}
async function period(from,to){await page.keyboard.press('F2');await page.locator('#report-period-dialog').waitFor();await page.locator('#period-from').fill(from);await page.locator('#period-to').fill(to);await page.keyboard.press('Control+a');await page.locator('#report-period-dialog').waitFor({state:'detached'});}
async function key(name){await page.keyboard.press(name);}
try{
  await mkdir(output,{recursive:true});await start();
  browser=await chromium.launch({headless:true,executablePath:process.env.BOOKR_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'});
  page=await browser.newPage({viewport:{width:1229,height:655},deviceScaleFactor:1});page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base,{waitUntil:'networkidle'});
  const customer=await request('/api/customers',{name:'Demo Customer'}),supplier=await request('/api/suppliers',{name:'Study Supplier Fictional'});
  const purchaseAccount=(await get('/api/state')).ledgers.find(l=>l.kind==='purchase').id;
  const sale=amount=>request('/api/vouchers',{type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount});
  const first=await sale(100000),second=await sale(250075);
  await request('/api/vouchers',{type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1,amount:40000,allocations:[{bill_id:first.bill.id,amount:40000}]});
  await request('/api/vouchers',{type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1,amount:82525,allocations:[{bill_id:second.bill.id,amount:62525},{bill_id:first.bill.id,amount:20000}]});
  let purchase=await request('/api/vouchers',{type:'purchase',date:'2026-04-01',supplier_id:supplier.id,account_id:purchaseAccount,amount:150000,bill:{reference:'SUP-001'}});
  await request('/api/vouchers',{type:'payment',date:'2026-04-01',supplier_id:supplier.id,account_id:1,amount:60000,allocations:[{bill_id:purchase.bill.id,amount:60000}]});
  const original=await get('/api/state');

  step='Balance Sheet and keyboard drill-through';await report('Balance Sheet');
  assert.equal(await page.locator('#financial-assets').innerText(),'2,900.75');assert.equal(await page.locator('#financial-liabilities').innerText(),'2,900.75');
  assert.equal(await page.locator('#financial-status').innerText(),'Balanced');assert.match(await page.locator('#financial-period').innerText(),/As at 1-Apr-2026/);
  await page.screenshot({path:join(output,'bookr-balance-sheet.png'),fullPage:true});
  await key('ArrowDown');await key('ArrowDown');assert.equal(await page.locator('tr.selected button').innerText(),'Current Assets');
  await key('Enter');await page.locator('[data-financial-key="cash"]').waitFor();assert.equal(await page.locator('#financial-group-total').innerText(),'2,900.75');
  await key('Enter');await page.locator('[data-financial-key="1"]').waitFor();await key('Enter');await page.locator('.ledger-statement').waitFor();
  assert.equal(await page.locator('#statement-closing').innerText(),'625.25 Dr');assert.equal(await page.locator('.ledger-statement tbody tr').count(),3);
  await key('Escape');await page.locator('[data-financial-key="1"]').waitFor();await key('Escape');await page.locator('[data-financial-key="cash"]').waitFor();await key('Escape');await page.locator('#financial-assets').waitFor();

  step='Profit and Loss, ledger and saved voucher return';await page.locator('[data-financial-key="profit"]').click();await page.locator('#financial-result').waitFor();
  assert.equal(await page.locator('#financial-result').innerText(),'2,000.75');assert.equal(await page.locator('#financial-expenses-total').innerText(),'2,000.75');
  assert.equal(await page.locator('#financial-trading-debit').innerText(),'3,500.75');assert.equal(await page.locator('#financial-trading-credit').innerText(),'3,500.75');
  await page.screenshot({path:join(output,'bookr-profit-and-loss.png'),fullPage:true});
  await page.locator('[data-financial-key="purchases"]').click();await page.locator(`[data-financial-key="${purchaseAccount}"]`).waitFor();await key('Enter');await page.locator('.ledger-statement').waitFor();
  assert.equal(await page.locator('#statement-closing').innerText(),'1,500.00 Dr');await key('Enter');await page.locator('#purchase-amount').waitFor();
  assert.equal(await page.locator('#purchase-amount').inputValue(),'1500.00');await key('Escape');await page.locator('.ledger-statement').waitFor();await key('Escape');await page.locator('#financial-group-total').waitFor();
  assert.equal(await page.locator('#financial-group-total').innerText(),'1,500.00');await key('Escape');await page.locator('#financial-result').waitFor();await key('Escape');await page.locator('#financial-assets').waitFor();

  step='period activity versus closing position';await period('2-4-2026','2-4-2026');
  assert.equal(await page.locator('#financial-assets').innerText(),'2,900.75');assert.match(await page.locator('#financial-period').innerText(),/2-Apr-2026/);
  assert.equal(await page.locator('#financial-profit-opening').innerText(),'2,000.75');assert.equal(await page.locator('#financial-profit-current').innerText(),'');
  await page.locator('[data-financial-key="current-assets"]').click();await page.locator('[data-financial-key="debtors"]').click();await page.locator(`[data-financial-key="${customer.id}"]`).click();await page.locator('.ledger-statement').waitFor();
  assert.equal(await page.locator('.ledger-statement tbody tr').count(),4);assert.equal(await page.locator('#statement-opening').innerText(),'0.00 Dr');
  assert.equal(await page.locator('#statement-closing').innerText(),'2,275.50 Dr');await key('Escape');await page.locator('#financial-group-total').waitFor();
  assert.match(await page.locator('#financial-period').innerText(),/2-Apr-2026/);await key('Escape');await page.locator('[data-financial-key="cash"]').waitFor();await key('Escape');await page.locator('#financial-assets').waitFor();
  await page.locator('[data-financial-key="profit"]').click();await page.locator('#financial-result').waitFor();assert.equal(await page.locator('#financial-result').innerText(),'2,000.75');
  await period('2-4-2026','2-4-2026');assert.equal(await page.locator('#financial-result').count(),0);assert.equal(await page.locator('#financial-income-total').innerText(),'0.00');
  await page.locator('[data-financial-key="sales"]').click();await page.locator('.empty-report').waitFor();assert.equal(await page.locator('#financial-group-total').innerText(),'0.00');await key('Escape');await page.locator('#financial-income-total').waitFor();
  await page.locator('#financial-all-dates').click();await page.locator('#financial-result').waitFor();

  step='invalid period, cancel and unavailable report retry';await key('F2');await page.locator('#period-from').fill('3-4-2026');await page.locator('#period-to').fill('2-4-2026');await key('Control+a');await page.locator('#period-error').filter({hasText:'From date'}).waitFor();await key('Escape');await page.locator('#report-period-dialog').waitFor({state:'detached'});
  const route='**/api/financial-reports?*';await page.route(route,r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Financial report temporarily unavailable.'})}));
  await key('F2');await page.locator('#period-from').fill('1-4-2026');await page.locator('#period-to').fill('1-4-2026');await key('Control+a');await page.locator('#period-error').filter({hasText:'temporarily unavailable'}).waitFor();
  assert.equal(await page.locator('#period-from').isEnabled(),true);await page.unroute(route);await key('Control+a');await page.locator('#report-period-dialog').waitFor({state:'detached'});
  assert.equal(await page.locator('#financial-result').innerText(),'2,000.75');
  assert.equal((await page.request.get(base+'/api/financial-reports?from=2026-02-30')).status(),400);
  assert.deepEqual(await get('/api/state'),original);

  step='revised purchase and loss presentation';purchase=await request('/api/vouchers/'+purchase.id,{...purchase,amount:400076},'put');
  await report('Profit & Loss A/c');assert.equal(await page.locator('#financial-result').innerText(),'500.01');assert.match(await page.locator('.financial-net-result').innerText(),/Net Loss/);
  await report('Balance Sheet');assert.equal(await page.locator('#financial-assets').innerText(),'3,400.76');assert.equal(await page.locator('#financial-liabilities').innerText(),'3,400.76');
  assert.equal(await page.locator('.financial-side').nth(1).locator('[data-financial-key="profit"]').count(),1);
  await page.screenshot({path:join(output,'bookr-balance-sheet-loss.png'),fullPage:true});
  purchase=await request('/api/vouchers/'+purchase.id,{...purchase,amount:150000},'put');
  const persisted=await get('/api/financial-reports');await stop();await start();assert.deepEqual(await get('/api/financial-reports'),persisted);
  await page.reload({waitUntil:'networkidle'});await report('Balance Sheet');assert.equal(await page.locator('#financial-assets').innerText(),'2,900.75');

  step='mobile reports';for(const width of [390,320]){await page.setViewportSize({width,height:844});await report('Balance Sheet');assert.equal(await page.locator('#financial-assets').innerText(),'2,900.75');
    const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(dimensions.scroll<=dimensions.width,JSON.stringify(dimensions));
    if(width===390)await page.screenshot({path:join(output,'bookr-balance-sheet-mobile.png'),fullPage:true});
    await report('Profit & Loss A/c');assert.equal(await page.locator('#financial-result').innerText(),'2,000.75');}
  assert.deepEqual(errors,[]);
  const summary={passed:true,checkedAt:new Date().toISOString(),fictional:true,profit:200075,balanceSheetTotal:290075,pageErrors:errors,checks:['native fixture','keyboard groups and ledger','saved purchase reopen','report return paths','period activity versus closing position','empty period','invalid range and cancel','failed request recovery','report reads do not change vouchers','loss on asset side','revised purchase refresh','server restart','320 and 390 mobile']};
  await writeFile(join(output,'financial-check.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
}catch(error){if(page)await page.screenshot({path:join(output,'financial-failure.png'),fullPage:true}).catch(()=>{});console.error('Financial browser check failed at '+step);throw error;}
finally{await browser?.close();await stop();await rm(directory,{recursive:true,force:true});}
