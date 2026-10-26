import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {browserFixture} from './browser-fixture.mjs';
import {captureVerifiedScreen} from './screen-evidence.mjs';

const nativeMode=process.env.BOOKR_NATIVE_CATALOG;
assert.ok(nativeMode===undefined || nativeMode==='none','BOOKR_NATIVE_CATALOG must be unset or none.');
const catalogPath=resolve('evidence/native-study/screen-reference-catalog.json');let nativeAvailable=false,nativeReason;
if(nativeMode==='none')nativeReason='Portable mode explicitly disables optional local native evidence.';
else{
 let bytes;
 try{bytes=await readFile(catalogPath);}catch(error){if(error.code!=='ENOENT')throw error;nativeReason='Optional audited native catalog is absent from this source distribution.';}
 if(bytes){const catalog=JSON.parse(bytes);assert.ok(catalog && typeof catalog==='object' && catalog.schemaVersion===1 && Array.isArray(catalog.entries),'Existing native catalog must be valid.');nativeAvailable=true;}
}
const nativeAudit={available:nativeAvailable,mode:nativeMode ?? 'local-if-present',reason:nativeReason ?? 'Using corresponding audited native context.'};
const test=await browserFixture({port:4364,name:'screen-visibility-browser',seed:book=>{
 const customer=book.createCustomer({name:'Demo Customer'});
 const sale=book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:100000,bill:{reference:'1'}});
 const receipt=book.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1,amount:40000,allocations:[{bill_id:sale.bill.id,amount:40000}]});
 return {customer,sale,receipt};
}});
const {page,fixture:f,get,out}=test,directory=await mkdtemp(join(tmpdir(),'bookr-screen-visibility-output-'));
const results=[],screenshot=page.screenshot.bind(page),reference=nativeAvailable?{catalogPath,id:'receipt-1-400'}:null;let positiveControl;
const expected={view:'receipt',root:'#receipt-form',caption:'Accounting Voucher Alteration',context:{type:'receipt',number:1,date:'2026-04-01',partyName:'Demo Customer',accountName:'Cash',amount:40000,reference:'1'},contextBindings:{type:{api:0,path:'type'},number:{api:0,path:'number',field:'#receipt-number',read:'text'},date:{api:0,path:'date',field:'#receipt-date',format:'entry-date'},partyName:{api:0,path:'customer_name',field:'#receipt-customer'},accountName:{api:0,path:'account_name',field:'#receipt-account',read:'selectedText'},amount:{api:0,path:'amount',field:'#receipt-amount',format:'rupees'},reference:{api:0,path:'allocations.0.reference',field:'#receipt-allocation-summary strong',read:'text'}},fields:[{selector:'#receipt-number',read:'text',equals:'1'},{selector:'#receipt-customer',read:'value',equals:'Demo Customer'},{selector:'#receipt-amount',read:'value',equals:'400.00'},{selector:'#receipt-balance',read:'text',equals:'600.00 Dr'}],api:[{path:'vouchers',where:{id:f.receipt.id},equals:{type:'receipt',date:'2026-04-01',amount:40000,customer_id:f.customer.id}},{path:'outstanding',where:{bill_id:f.sale.bill.id},equals:{pending:60000}}]};
async function rejectCase(id,code,setup,cleanup){
 const outputDir=join(directory,id);let result;
 try{
  await setup();
  try{const record=await captureVerifiedScreen({page,outputDir,id,expected,reference,readState:()=>get('/api/state')});result={id,expectedCode:code,accepted:true,referenceStatus:record.reference.status,captureSha256:record.capture.sha256};}
  catch(error){result={id,expectedCode:code,accepted:false,actualCode:error.code,message:error.message};}
  const files=await readdir(outputDir).catch(error=>error.code==='ENOENT'?[]:Promise.reject(error));result.outputCount=files.length;result.passed=!result.accepted&&result.actualCode===code&&files.length===0;results.push(result);
 }finally{await cleanup();}
}
try{
 await page.getByRole('button',{name:'Day Book',exact:true}).click();await page.locator('[data-open-sale="'+f.receipt.id+'"]').click();await page.locator('#receipt-form').waitFor();
 const visible=await captureVerifiedScreen({page,outputDir:join(directory,'visible-receipt'),id:'visible-receipt',expected,reference,readState:()=>get('/api/state')});
 assert.equal(visible.reference.status,nativeAvailable?'verified-context':'unverified');assert.equal(visible.fields.length,4);positiveControl={id:'visible-receipt',passed:true,referenceStatus:visible.reference.status,captureSha256:visible.capture.sha256,fieldCount:visible.fields.length,contextBindingCount:Object.keys(visible.screen.contextBindings).length};
 await rejectCase('covered-receipt','FIELD_MISMATCH',()=>page.evaluate(()=>{const overlay=document.createElement('div');overlay.id='visibility-test-overlay';overlay.textContent='UNRELATED COVERING SCREEN — NEGATIVE CONTROL';overlay.style.cssText='position:fixed;inset:0;z-index:2147483647;background:white;color:black;display:grid;place-items:center;font-size:32px';document.body.append(overlay);}),()=>page.locator('#visibility-test-overlay').evaluate(el=>el.remove()));
 await rejectCase('transparent-receipt','FIELD_MISMATCH',()=>page.locator('#main').evaluate(el=>el.style.opacity='0'),()=>page.locator('#main').evaluate(el=>el.style.removeProperty('opacity')));
 await page.route('**/visibility-negative-control.css',route=>route.fulfill({contentType:'text/css',body:'body.visibility-test-blocked::after{content:"UNRELATED COVERING SCREEN — NEGATIVE CONTROL";position:fixed;inset:0;z-index:2147483647;background:white;color:black;display:grid;place-items:center;font-size:32px}'}));
 await page.addStyleTag({url:test.base+'/visibility-negative-control.css'});
 await rejectCase('transient-style-cover','SCREEN_CHANGED',async()=>{
  page.screenshot=async options=>{await page.locator('body').evaluate(el=>el.classList.add('visibility-test-blocked'));try{return await screenshot(options);}finally{await page.locator('body').evaluate(el=>el.classList.remove('visibility-test-blocked'));}};
 },async()=>{page.screenshot=screenshot;await page.locator('body').evaluate(el=>el.classList.remove('visibility-test-blocked'));});
 await rejectCase('transient-inline-opacity','SCREEN_CHANGED',async()=>{
  page.screenshot=async options=>{await page.locator('#main').evaluate(el=>el.style.opacity='0');try{return await screenshot(options);}finally{await page.locator('#main').evaluate(el=>el.style.removeProperty('opacity'));}};
 },async()=>{page.screenshot=screenshot;await page.locator('#main').evaluate(el=>el.style.removeProperty('opacity'));});
 const summary={application:'Bookr',checkedAt:new Date().toISOString(),passed:positiveControl.passed&&results.every(row=>row.passed),fixture:{sale:100000,receipt:40000,pending:60000},nativeAudit,positiveControl,cases:results,temporaryImagesRemoved:true};
 await writeFile(join(out,'screen-visibility-check.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));assert.equal(summary.passed,true,'Covered or transparent screen must never be emitted as verified Receipt evidence.');
}finally{page.screenshot=screenshot;await test.close();assert.ok(directory.startsWith(join(tmpdir(),'bookr-screen-visibility-output-')));await rm(directory,{recursive:true,force:true});}
