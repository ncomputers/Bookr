import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {browserFixture} from './browser-fixture.mjs';
import {outstandingAsOfFixture} from './outstanding-asof-fixture.mjs';

const test=await browserFixture({port:4357,name:'bill-terms-dirty-browser',seed:book=>{
  const fixture=outstandingAsOfFixture(book);
  fixture.supplier=book.saveLedger({name:fixture.supplier.name,revision:fixture.supplier.revision,opening_bills:fixture.supplier.opening_bills.map(row=>({id:row.id,reference:row.reference,date:row.date,amount:row.amount,terms:{mode:'days',days:0}}))},fixture.supplier.id);
  return fixture;
}});
const {page,fixture:f,get,out,errors}=test,writes=[];let step='startup';
page.on('request',request=>{if(request.url().includes('/api/')&&request.method()!=='GET')writes.push({method:request.method(),url:request.url()});});
async function openOpening(ledger,payable=false){
  await page.getByRole('link',{name:'Bookr Gateway',exact:true}).click();
  await page.getByRole('button',{name:payable?'Bills Payable':'Bills Receivable',exact:true}).click();
  await page.locator('[data-outstanding-sale="opening:'+ledger.opening_bills[0].id+'"]').click();
  await page.locator('#opening-bills-dialog').waitFor();
}
async function acceptLocal(){await page.keyboard.press('Control+a');await page.locator('#opening-bills-dialog').waitFor({state:'detached'});}
async function cleanEscape(){await page.keyboard.press('Escape');await page.waitForTimeout(100);assert.equal(await page.locator('#entry-dialog').count(),0,'Unchanged opening breakup must not mark the master dirty.');await page.locator('.outstanding-report').waitFor();}
try{
  const baseline=await get('/api/state');
  step='legacy blank term unchanged round trip remains clean';
  await openOpening(f.customer);assert.equal(await page.locator('#opening-bill-term-0').inputValue(),'');await acceptLocal();await cleanEscape();
  step='explicit zero-day unchanged round trip remains clean';
  await openOpening(f.supplier,true);assert.equal(await page.locator('#opening-bill-term-0').inputValue(),'0 Days');await acceptLocal();await cleanEscape();
  step='changed term remains dirty and keyboard No/discard works';
  await openOpening(f.customer);await page.locator('#opening-bill-term-0').fill('15 Days');await acceptLocal();await page.keyboard.press('Escape');await page.locator('#entry-dialog').waitFor();await page.keyboard.press('Escape');await page.locator('#entry-dialog').waitFor({state:'detached'});await page.locator('#ledger-form').waitFor();await page.locator('#ledger-opening-bills').click();await page.locator('#opening-bills-dialog').waitFor();assert.equal(await page.locator('#opening-bill-term-0').inputValue(),'15 Days');await page.keyboard.press('Escape');await page.locator('#opening-bills-dialog').waitFor({state:'detached'});await page.keyboard.press('Escape');await page.locator('#entry-dialog').waitFor();await page.keyboard.press('d');await page.locator('.outstanding-report').waitFor();assert.equal(await page.locator('#entry-dialog').count(),0);
  assert.deepEqual(await get('/api/state'),baseline);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  const result={application:'Bookr',passed:true,checkedAt:new Date().toISOString(),checks:['blank legacy terms unchanged acceptance stays clean','explicit zero-day unchanged acceptance stays clean','changed terms stay dirty','Escape means No and retains term draft','D discards from reusable confirmation','no API writes or saved state change'],pageErrors:errors,writes};
  await writeFile(join(out,'bill-terms-dirty-browser-check.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}catch(error){await page.screenshot({path:join(out,'bill-terms-dirty-browser-failure.png'),fullPage:true}).catch(()=>{});console.error('Bill terms dirty snapshot failed at '+step);throw error;}
finally{await test.close();}
