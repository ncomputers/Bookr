import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {browserFixture} from './browser-fixture.mjs';

const test=await browserFixture({port:4777,name:'workspace-activity',seed:book=>{
 const supplier=book.saveLedger({kind:'supplier',name:'Fictional Activity Supplier'});
 const purchase=book.saveVoucher({type:'purchase',date:'2026-04-01',supplier_id:supplier.id,account_id:3,amount:60000,bill:{reference:'FICTIONAL-ACTIVITY'}});
 return {purchase};
}}),{page,get,fixture,errors,out}=test;
const directory=join(out,'workspace-activity',new Date().toISOString().replace(/[^0-9]/g,''));await mkdir(directory,{recursive:true});
const home=page.getByRole('link',{name:'Bookr Gateway',exact:true}),checks=[],writes=[];let release,step='startup';
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};}
async function openPurchase(){await page.getByRole('button',{name:'Day Book',exact:true}).click();await page.locator('.filtered-day-book').waitFor();await page.locator('[data-open-sale="'+fixture.purchase.id+'"]').click();await page.locator('#purchase-form').waitFor();}
try{
 const baseline={profile:await get('/api/companies/default'),state:await get('/api/state')};
 step='held Day Book makes Home unavailable and an ordinary click waits';await openPurchase();
 const gate=deferred(),entered=deferred();release=gate.resolve;let held=false;
 await page.route('**/api/day-book*',async route=>{if(!held){held=true;entered.resolve();await gate.promise;}await route.continue();});
 await page.keyboard.press('Escape');await entered.promise;
 assert.equal(await home.getAttribute('aria-disabled'),'true');assert.equal(await home.getAttribute('aria-busy'),'true');assert.equal(await home.isEnabled(),false);
 assert.equal(await home.evaluate(el=>getComputedStyle(el).cursor),'progress');
 let clicked=false;const clicking=home.click().then(()=>clicked=true);
 await page.screenshot({path:join(directory,'held-home.png')});assert.equal(clicked,false,'The normal click must await Home availability.');
 gate.resolve();await clicking;await page.locator('#main[data-screen="gateway"]').waitFor({timeout:2500});await page.unroute('**/api/day-book*');
 assert.equal(await home.isEnabled(),true);checks.push('Held return request disables Home; ordinary click waits and reaches Gateway');

 step='failed save clears activity while retaining the draft';await openPurchase();
 const draft='Fictional draft retained after rejected save';await page.locator('#purchase-narration').fill(draft);
 const rejected=deferred(),saving=deferred();release=rejected.resolve;
 await page.route('**/api/vouchers/**',async route=>{
  if(route.request().method()==='PUT'){
   writes.push({method:'PUT',path:new URL(route.request().url()).pathname,upstream:false});saving.resolve();await rejected.promise;
   return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Fictional save failure for activity test'})});
  }
  return route.continue();
 });
 await page.keyboard.press('Control+a');await saving.promise;assert.equal(await home.isEnabled(),false);rejected.resolve();
 await page.getByRole('alert').filter({hasText:'Fictional save failure for activity test'}).waitFor();assert.equal(await home.isEnabled(),true);
 assert.equal(await page.locator('#purchase-narration').inputValue(),draft);assert.equal(await page.locator('#main').getAttribute('data-screen'),'purchase');assert.equal(await page.locator('dialog').count(),0);
 checks.push('Rejected save restores Home without automatic navigation or draft loss');
 step='available Home preserves dirty confirmation and No retains the draft';await home.click();await page.locator('#entry-dialog').waitFor();
 assert.match(await page.locator('#entry-dialog').innerText(),/Discard unsaved changes and return to Gateway/);await page.getByRole('button',{name:'No',exact:true}).click();await page.locator('#entry-dialog').waitFor({state:'detached'});
 assert.equal(await page.locator('#purchase-narration').inputValue(),draft);assert.equal(await page.locator('#main').getAttribute('data-screen'),'purchase');
 await home.focus();await page.keyboard.press('Enter');await page.locator('#entry-dialog').waitFor();await page.keyboard.press('Escape');await page.locator('#entry-dialog').waitFor({state:'detached'});assert.equal(await page.locator('#purchase-narration').inputValue(),draft);
 checks.push('Home mouse and Enter retain confirmation; No and Escape retain failed-save draft');
 assert.deepEqual({profile:await get('/api/companies/default'),state:await get('/api/state')},baseline);assert.deepEqual(errors,[]);assert.equal(writes.length,1);assert.equal(writes[0].upstream,false);
 await page.mouse.move(0,0);await page.screenshot({path:join(directory,'retained-draft.png')});
 const result={application:'Bookr',passed:true,checkedAt:new Date().toISOString(),checks,pageErrors:errors,interceptedWrites:writes,upstreamWrites:0,savedDataExactlyPreserved:true,scope:'Owned fictional fixture 4777 only; no live preview or protected service access.'};
 await writeFile(join(directory,'green.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({directory,...result}));
}catch(error){await page.screenshot({path:join(directory,'failure.png')}).catch(()=>{});console.error('Workspace activity failed at '+step);throw error;}
finally{release?.();await test.close();}
