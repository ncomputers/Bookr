import assert from 'node:assert/strict';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {browserFixture} from './browser-fixture.mjs';
import {captureVerifiedScreen} from './screen-evidence.mjs';
import {CompanyStore} from '../lib/companies.mjs';
import {OPENING_LIMIT} from '../lib/opening-balances.mjs';
import {formatBalance} from '../public/entry-values.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const stamp=new Date().toISOString().replace(/[^0-9]/g,'');
const out=join(root,'evidence/web/monthly-mobile-label',stamp);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const cases=[],checks=[],captures=[],writes=[];
async function financialSources(){
  const paths=['server.mjs'];
  async function walk(directory){for(const entry of await readdir(join(root,directory),{withFileTypes:true})){const path=directory+'/'+entry.name;if(entry.isDirectory())await walk(path);else paths.push(path);}}
  await walk('lib');
  return Object.fromEntries(await Promise.all(paths.sort().map(async path=>[path,hash(await readFile(join(root,path)))])));
}
const financialBefore=await financialSources();
const test=await browserFixture({port:4466,name:'monthly-mobile-label',seed:defaultBook=>{
  const file=defaultBook.db.prepare('PRAGMA database_list').all().find(row=>row.name==='main').file;
  const store=new CompanyStore({defaultFile:file});
  try{
    const company=store.create({name:'Bookr Mobile Maximum Opening Fictional',financial_year_from:'2025-04-01',books_from:'2025-10-01'});
    const book=store.book(company.id);
    const cash=book.saveLedger({...book.masterLedger(1),opening_balance:OPENING_LIMIT},1);
    const capital=book.saveLedger({kind:'capital',name:'Maximum Opening Capital',opening_balance:-OPENING_LIMIT});
    assert.equal(book.state().vouchers.length,0);
    assert.equal(book.state().opening_balances.difference,0);
    return {company,cash,capital};
  }finally{store.close();}
}});
const {page,base,fixture:f,errors}=test;
await page.context().route('**/*',async route=>{
  const request=route.request();
  if(request.method()!=='GET'){writes.push({method:request.method(),path:new URL(request.url()).pathname});await route.abort('blockedbyclient');}
  else await route.continue();
});
async function get(path,id=f.company.id){const response=await page.request.get(base+path,{headers:{'X-Bookr-Company':id}});assert.equal(response.ok(),true,await response.text());return response.json();}
async function state(){return {registry:await get('/api/companies','default'),profile:await get('/api/companies/'+f.company.id),book:await get('/api/state'),defaultBook:await get('/api/state','default')};}
async function monthly(ledger){
  await page.getByRole('link',{name:'Bookr Gateway',exact:true}).click();
  await page.getByRole('button',{name:'Ledger Vouchers',exact:true}).click();
  await page.locator('#report-ledger-search').fill(ledger.name);
  await page.locator('#report-ledger-options button').filter({hasText:new RegExp('^'+ledger.name+'$')}).click();
  await page.locator('.ledger-statement').waitFor();
  await page.keyboard.press('F6');await page.locator('.monthly-summary').waitFor();
}
async function visibility(){
  return page.locator('[data-month="2025-09"]').evaluate(row=>{
    const scroll=row.closest('.monthly-table-scroll'),clip=scroll.getBoundingClientRect();
    const rect=r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height});
    function visible(element,r){
      if(r.left<Math.max(0,clip.left)||r.right>Math.min(innerWidth,clip.right)||r.top<Math.max(0,clip.top)||r.bottom>Math.min(innerHeight,clip.bottom))return false;
      return [r.left+Math.min(1,r.width/2),r.left+r.width/2,r.right-Math.min(1,r.width/2)].every(x=>{const hit=document.elementFromPoint(x,r.top+r.height/2);return !!hit&&(hit===element||element.contains(hit));});
    }
    function text(element){
      const range=document.createRange();range.selectNodeContents(element);
      const glyphs=[...range.getClientRects()].filter(r=>r.width&&r.height);
      return {text:element.textContent,elementRect:rect(element.getBoundingClientRect()),glyphRects:glyphs.map(rect),glyphsVisible:glyphs.length>0&&glyphs.every(r=>visible(element,r))};
    }
    const label=row.querySelector('button'),amount=row.querySelector('.monthly-closing');
    return {label:text(label),amount:text(amount),labelButtonVisible:visible(label,label.getBoundingClientRect()),clip:rect(clip),scrollLeft:scroll.scrollLeft,documentOverflow:document.documentElement.scrollWidth>innerWidth};
  });
}
async function capture(ledger,width){
  const readState=async()=>({...await state(),report:await get('/api/monthly-summary?ledger='+ledger.id)});
  const saved=await readState(),row=saved.report.rows.find(item=>item.month==='2025-09'),index=saved.report.rows.indexOf(row);
  assert.equal(saved.report.ledger.id,ledger.id);assert.equal(row.closing,ledger.opening_balance);
  const amount=formatBalance(row.closing),monthSelector='[data-month="2025-09"]';
  const record=await captureVerifiedScreen({page,outputDir:join(out,'captures'),id:'monthly-max-'+(row.closing<0?'cr':'dr')+'-'+width,reference:null,readState,expected:{
    view:'monthly-summary',root:'.monthly-summary',caption:'Ledger Monthly Summary',
    context:{companyName:f.company.name,companyId:f.company.id,ledgerName:ledger.name,ledgerId:ledger.id,month:row.month,closingPaise:row.closing,closingText:amount,vouchers:0},
    contextBindings:{companyName:{api:0,path:'name',field:'.monthly-heading strong',read:'text'},companyId:{api:0,path:'id'},ledgerName:{api:2,path:'ledger.name',field:'.monthly-heading em',read:'text'},ledgerId:{api:2,path:'ledger.id'},month:{api:2,path:'rows.'+index+'.month'},closingPaise:{api:2,path:'rows.'+index+'.closing'},closingText:{field:monthSelector+' .monthly-closing',read:'text'},vouchers:{api:1,path:'vouchers.length'}},
    fields:[{selector:'.monthly-heading strong',read:'text',equals:f.company.name},{selector:'.monthly-heading em',read:'text',equals:ledger.name},{selector:monthSelector+' button',read:'text',equals:'September'},{selector:monthSelector+' .monthly-closing',read:'text',equals:amount}],
    api:[{path:'profile',equals:saved.profile},{path:'book',equals:saved.book},{path:'report',equals:saved.report},{path:'defaultBook',equals:saved.defaultBook},{path:'registry',equals:saved.registry}]
  }});
  captures.push({file:record.capture.file,recordFile:record.recordFile,sha256:record.capture.sha256,nativeStatus:record.reference.status});
}
await mkdir(out,{recursive:true});let step='select isolated maximum-opening company';
try{
  const before=await state();await page.keyboard.press('F3');await page.locator('#company-search').fill(f.company.name);await page.locator('[data-company-id="'+f.company.id+'"]').click();await page.waitForFunction(name=>document.querySelector('.company-name')?.textContent===name,f.company.name);
  for(const ledger of [f.cash,f.capital]){
    step='desktop maximum '+ledger.name;await page.setViewportSize({width:1229,height:654});await monthly(ledger);await page.mouse.move(5,5);
    assert.equal(await page.locator('.monthly-table [data-month]').count(),12);
    assert.equal(await page.locator('[data-month="2025-09"] .monthly-closing').innerText(),formatBalance(ledger.opening_balance));
    const desktop=await visibility();assert.equal(desktop.labelButtonVisible,true);assert.equal(desktop.documentOverflow,false);
    for(const width of [390,320]){
      step='mobile maximum '+ledger.name+' at'+width;await page.setViewportSize({width,height:844});await monthly(ledger);
      const month=page.locator('[data-month="2025-09"] button'),amount=page.locator('[data-month="2025-09"] .monthly-closing');
      await amount.scrollIntoViewIfNeeded();await page.mouse.move(width-5,5);
      const geometry=await visibility();assert.equal(geometry.label.text,'September');assert.equal(geometry.amount.text,formatBalance(ledger.opening_balance));assert.equal(geometry.labelButtonVisible,true,'Month button remains usable beside the closing amount.');assert.equal(geometry.label.glyphsVisible,true,'Every month-label glyph stays visible.');assert.equal(geometry.amount.glyphsVisible,true,'Every maximum-amount glyph stays visible.');assert.equal(geometry.documentOverflow,false);
      const selected=await page.locator('.monthly-table tr.selected').evaluate(row=>({row:getComputedStyle(row).backgroundColor,cell:getComputedStyle(row.cells[0]).backgroundColor}));assert.equal(selected.cell,selected.row);assert.notEqual(selected.cell,'rgba(0, 0, 0, 0)');
      await month.hover();const hover=await month.evaluate(button=>({row:getComputedStyle(button.closest('tr')).backgroundColor,cell:getComputedStyle(button.closest('td')).backgroundColor}));assert.equal(hover.cell,hover.row);assert.notEqual(hover.cell,'rgba(0, 0, 0, 0)');await page.mouse.move(width-5,5);
      await capture(ledger,width);cases.push({width,ledger:ledger.name,closingPaise:ledger.opening_balance,...geometry,selected,hover});
      await month.focus();await page.keyboard.press('Enter');await page.locator('.ledger-statement').waitFor();assert.match(await page.locator('.report-ledger-name').innerText(),/1-Sep-2025 to 30-Sep-2025/);await page.keyboard.press('Escape');await page.locator('.monthly-summary').waitFor();assert.equal(await page.locator('[data-report-row].selected').getAttribute('data-month'),'2025-09');
    }
  }
  checks.push('Real balanced maximum Cash/Capital openings have no vouchers.','Month buttons and maximum Dr/Cr glyphs remain visible and hit-testable at320/390.','Selected/hover month backgrounds stay consistent.','Keyboard month drill and return retain September.','Desktop retains twelve month values; mobile captures bind company and saved report.');
  assert.deepEqual(await state(),before);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);assert.deepEqual(await financialSources(),financialBefore);await test.restart();assert.deepEqual(await state(),before);checks.push('All saved accounting/profile/registry state, financial source hashes and zero-write policy survive restart.');
  const result={application:'Bookr',passed:true,checkedAt:new Date().toISOString(),checks,cases,captures,openingLimitPaise:OPENING_LIMIT,vouchers:0,writes,pageErrors:errors,financialSourceInventory:financialBefore,financialSourcesUnchanged:true,savedStateUnchanged:true,scope:'Original web mobile report usability, using real isolated accounting data; no native pixel-equality claim.',limitations:['Maximum-amount glyph visibility is checked at320/390. Existing desktop maximum-amount clipping is outside this mobile increment.']};await writeFile(join(out,'green.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({passed:true,checks:checks.length,cases:cases.length,captures:captures.length,vouchers:0,writes:0,pageErrors:errors}));
}catch(error){await writeFile(join(out,'red.json'),JSON.stringify({application:'Bookr',passed:false,checkedAt:new Date().toISOString(),step,error:error.message,cases,captures,writes,pageErrors:errors},null,2)+'\n',{flag:'wx'});console.error('Monthly mobile-label check failed at '+step);throw error;}
finally{await test.close();}
