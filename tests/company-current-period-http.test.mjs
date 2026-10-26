import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm,realpath,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,resolve,join,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {startOwnedTestServer,stopOwnedTestServer} from './owned-test-server.mjs';

const taskRoot=dirname(fileURLToPath(import.meta.url)),root=resolve(taskRoot,'..'),port=4751,base='http://127.0.0.1:'+port;
const calendar={financial_year_from:'2025-04-01',books_from:'2025-07-01',financial_year_to:'2026-03-31'};
const initial='2025-04-01/2026-03-31',later='2026-04-01/2027-03-31';
const initialRange={from:'2025-04-01',to:'2026-03-31'},laterRange={from:'2026-04-01',to:'2027-03-31'};
const receipt=(capital,date,amount=100,extra={})=>({type:'receipt',date,ledger_id:capital.id,account_id:1,amount,...extra});
const rows=db=>Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'" ORDER BY rowid').all().map(row=>({...row}))]));
async function fixture(action){
 const temporary=await realpath(tmpdir()),directory=await mkdtemp(join(temporary,'bookr-current-period-http-')),database=join(directory,'book.sqlite');
 let child,output='';
 const start=async()=>{child=await startOwnedTestServer({root,port,database,env:{BOOKR_PREVIEW_LABEL:''},onOutput:text=>output+=text});};
 const stop=async()=>{await stopOwnedTestServer(child);child=null;};
 const request=async(path,{company,period,method='GET',data,headers={}}={})=>{
  const response=await fetch(base+path,{method,headers:{...(company===undefined?{}:{'X-Bookr-Company':company}),...(period===undefined?{}:{'X-Bookr-Period':period}),...(data===undefined?{}:{'Content-Type':'application/json'}),...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});
  return {status:response.status,data:await response.json()};
 };
 const expect=async(path,options={},status=200)=>{const actual=await request(path,options);assert.equal(actual.status,status,path+': '+JSON.stringify(actual.data));return actual.data;};
 const catalog=()=>{const file=join(directory,'book.companies.sqlite'),db=new DatabaseSync(file,{readOnly:true});try{return rows(db);}finally{db.close();}};
 const all=async()=>{const profiles=await expect('/api/companies'),books={};for(const profile of profiles.companies)books[profile.id]=await expect('/api/state',{company:profile.id});return {profiles,catalog:catalog(),books};};
 const create=async label=>{const profile=await expect('/api/companies',{method:'POST',data:{name:'Fictional Period HTTP '+label,...calendar}},201),capital=await expect('/api/ledgers',{company:profile.id,method:'POST',data:{kind:'capital',name:'Fictional Period Capital '+label}},201);return {profile,capital};};
 const raw=(path,headers,data,{hold=false,method='POST'}={})=>{
  const encoded=JSON.stringify(data);let resolveResponse,rejectResponse;
  const response=new Promise((done,reject)=>{resolveResponse=done;rejectResponse=reject;});
  const request=http.request({hostname:'127.0.0.1',port,path,method,headers:['Host','127.0.0.1:'+port,'Content-Type','application/json','Content-Length',String(Buffer.byteLength(encoded)),...headers]},res=>{let value='';res.setEncoding('utf8');res.on('data',part=>value+=part);res.on('end',()=>{try{resolveResponse({status:res.statusCode,data:JSON.parse(value)});}catch(error){rejectResponse(error);}});});
  request.once('error',rejectResponse);request.setTimeout(8000,()=>request.destroy(new Error('Owned delayed request timed out.')));
  if(hold){request.flushHeaders();request.write(encoded.slice(0,Math.floor(encoded.length/2)));return {response,finish:()=>request.end(encoded.slice(Math.floor(encoded.length/2))),destroy:()=>request.destroy()};}
  request.end(encoded);return {response};
 };
 try{
  await start();
  const customer=await expect('/api/customers',{method:'POST',data:{name:'Fictional Preserved Default Buyer'}},201),sale=await expect('/api/vouchers',{method:'POST',data:{type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:100000}},201);
  await expect('/api/vouchers',{method:'POST',data:{type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1,amount:40000,allocations:[{bill_id:sale.bill.id,amount:40000}]}},201);
  const defaultBefore=await expect('/api/state'),alpha=await create('Alpha'),beta=await create('Beta');assert.equal(defaultBefore.outstanding[0].pending,60000);
  await action({expect,request,raw,all,alpha,beta,defaultBefore,restart:async()=>{await stop();await start();}});
 }finally{await stop();const target=await realpath(directory),part=relative(temporary,target);assert.ok(part&&!part.startsWith('..')&&!isAbsolute(part));await rm(target,{recursive:true,force:true});}
}

test('HTTP request-local later period saves and edits the observed capital receipt, balances1/1, preserves masters/default and reopens',async()=>fixture(async({expect,all,alpha,beta,defaultBefore,restart})=>{
 const before=await all(),saved=await expect('/api/vouchers',{company:alpha.profile.id,period:later,method:'POST',data:receipt(alpha.capital,'2026-04-01')},201);
 assert.equal(saved.date,'2026-04-01');assert.equal(saved.type,'receipt');assert.equal(saved.amount,100);assert.equal(saved.postings.length,2);assert.deepEqual(saved.postings.map(({ledger_id,side,amount})=>({ledger_id,side,amount})).sort((a,b)=>a.ledger_id-b.ledger_id),[{ledger_id:1,side:'debit',amount:100},{ledger_id:alpha.capital.id,side:'credit',amount:100}]);
 assert.deepEqual((await expect('/api/trial-balance?from=2026-04-01&to=2027-03-31',{company:alpha.profile.id})).totals,{debit:100,credit:100,balanced:true});
 const edited=await expect('/api/vouchers/'+saved.id,{company:alpha.profile.id,period:later,method:'PUT',data:receipt(alpha.capital,'2026-04-01',100,{revision:saved.revision,narration:'Fictional later-period saved revision'})});assert.equal(edited.revision,saved.revision+1);
 const state=await expect('/api/state',{company:alpha.profile.id});assert.equal(state.vouchers.length,1);assert.deepEqual(state.calendar,calendar);assert.equal(state.opening_balances.difference,0);assert.deepEqual((await all()).catalog,before.catalog);assert.deepEqual(await expect('/api/state',{company:beta.profile.id}),before.books[beta.profile.id]);assert.deepEqual(await expect('/api/state'),defaultBefore);
 await restart();assert.deepEqual(await expect('/api/vouchers/'+saved.id,{company:alpha.profile.id}),edited);assert.deepEqual(await expect('/api/state',{company:alpha.profile.id}),state);assert.deepEqual(await expect('/api/state'),defaultBefore);
}));

test('HTTP missing period header preserves existing initial Books policy while selected period cannot permit before-Books posting',async()=>fixture(async({expect,all,alpha})=>{
 await expect('/api/vouchers',{company:alpha.profile.id,method:'POST',data:receipt(alpha.capital,'2025-07-01')},201);const before=await all();
 await expect('/api/vouchers',{company:alpha.profile.id,method:'POST',data:receipt(alpha.capital,'2026-04-01')},400);
 await expect('/api/vouchers',{company:alpha.profile.id,period:initial,method:'POST',data:receipt(alpha.capital,'2025-06-30')},400);
 assert.deepEqual(await all(),before);
}));

test('HTTP same later date rejects with the initial period on POST and PUT, without changes to any book or company metadata',async()=>fixture(async({expect,all,alpha})=>{
 const initialSaved=await expect('/api/vouchers',{company:alpha.profile.id,method:'POST',data:receipt(alpha.capital,'2025-07-01')},201),before=await all();
 await expect('/api/vouchers',{company:alpha.profile.id,period:initial,method:'POST',data:receipt(alpha.capital,'2026-04-01')},400);
 await expect('/api/vouchers/'+initialSaved.id,{company:alpha.profile.id,period:initial,method:'PUT',data:receipt(alpha.capital,'2026-04-01',100,{revision:initialSaved.revision})},400);
 assert.deepEqual(await all(),before);
}));

test('HTTP malformed, reversed and duplicate period headers reject400 before POST or PUT publication',async()=>fixture(async({expect,raw,all,alpha})=>{
 const saved=await expect('/api/vouchers',{company:alpha.profile.id,method:'POST',data:receipt(alpha.capital,'2025-07-01')},201),before=await all();
 for(const period of ['', '2026-04-01', '2026-04-01/2026-02-29','2027-03-31/2026-04-01','2026-04-01//2027-03-31',later+', '+initial]){
  await expect('/api/vouchers',{company:alpha.profile.id,period,method:'POST',data:receipt(alpha.capital,'2025-07-01')},400);
  await expect('/api/vouchers/'+saved.id,{company:alpha.profile.id,period,method:'PUT',data:receipt(alpha.capital,'2025-07-01',100,{revision:saved.revision})},400);
  assert.deepEqual(await all(),before);
 }
 for(const method of ['POST','PUT']){const repeated=await raw('/api/vouchers'+(method==='PUT'?'/'+saved.id:''),['X-Bookr-Company',alpha.profile.id,'X-Bookr-Period',initial,'X-Bookr-Period',initial],receipt(alpha.capital,'2025-07-01',100,method==='PUT'?{revision:saved.revision}:{}),{method}).response;assert.equal(repeated.status,400,JSON.stringify(repeated));assert.deepEqual(await all(),before);}
}));

for(const heldLater of [true,false])test('HTTP delayed '+(heldLater?'later':'initial')+' body and opposite-period request share one book without leaking context',async()=>fixture(async({expect,raw,all,alpha,defaultBefore})=>{
 const before=await all(),heldPeriod=heldLater?later:initial,heldDate=heldLater?'2026-04-01':'2025-07-01',fastPeriod=heldLater?initial:later,fastDate=heldLater?'2025-07-01':'2026-04-01';
 const held=raw('/api/vouchers',['X-Bookr-Company',alpha.profile.id,'X-Bookr-Period',heldPeriod],receipt(alpha.capital,heldDate,100),{hold:true});
 try{await new Promise(done=>setTimeout(done,100));const fast=await expect('/api/vouchers',{company:alpha.profile.id,period:fastPeriod,method:'POST',data:receipt(alpha.capital,fastDate,200)},201);held.finish();const slow=await held.response;assert.equal(slow.status,201,JSON.stringify(slow));assert.equal(slow.data.date,heldDate);assert.equal(fast.date,fastDate);assert.notEqual(slow.data.id,fast.id);
  const state=await expect('/api/state',{company:alpha.profile.id});assert.equal(state.vouchers.length,2);assert.deepEqual(state.totals,{debit:300,credit:300,balanced:true});assert.deepEqual((await all()).catalog,before.catalog);assert.deepEqual(await expect('/api/state'),defaultBefore);
 }finally{held.destroy();await held.response.catch(()=>{});}
}));

test('HTTP period context stays scoped to the selected company despite colliding ledger and voucher IDs',async()=>fixture(async({expect,all,alpha,beta,defaultBefore})=>{
 assert.equal(alpha.capital.id,beta.capital.id);const before=await all();
 const a=await expect('/api/vouchers',{company:alpha.profile.id,period:later,method:'POST',data:receipt(alpha.capital,'2026-04-01',100)},201),b=await expect('/api/vouchers',{company:beta.profile.id,period:initial,method:'POST',data:receipt(beta.capital,'2025-07-01',200)},201);assert.equal(a.id,b.id);
 assert.equal((await expect('/api/vouchers/'+a.id,{company:alpha.profile.id})).amount,100);assert.equal((await expect('/api/vouchers/'+b.id,{company:beta.profile.id})).amount,200);assert.deepEqual((await all()).catalog,before.catalog);assert.deepEqual(await expect('/api/state'),defaultBefore);
 const stable=await all();await expect('/api/vouchers',{company:beta.profile.id,method:'POST',data:receipt(beta.capital,'2026-04-01')},400);assert.deepEqual(await all(),stable);
}));

test('HTTP monthly selected From/To carries earlier receipt and includes later receipt without replacing the default initial FY',async()=>fixture(async({expect,all,alpha})=>{
 await expect('/api/vouchers',{company:alpha.profile.id,method:'POST',data:receipt(alpha.capital,'2025-07-01',100)},201);
 await expect('/api/vouchers',{company:alpha.profile.id,period:later,method:'POST',data:receipt(alpha.capital,'2026-04-01',200)},201);const before=await all();
 const selected=await expect('/api/monthly-summary?ledger=1&from=2026-04-01&to=2027-03-31',{company:alpha.profile.id});assert.deepEqual(selected.period,laterRange);assert.equal(selected.opening,100);assert.equal(selected.rows.length,12);assert.deepEqual(selected.rows.map(row=>[row.from,row.to])[0],['2026-04-01','2026-04-30']);assert.equal(selected.rows[0].debit,200);assert.equal(selected.rows[0].credit,0);assert.equal(selected.rows[0].closing,300);assert.equal(selected.rows[0].display_active,true);assert.deepEqual(selected.totals,{debit:200,credit:0,closing:300});
 const fromHeader=await expect('/api/monthly-summary?ledger=1',{company:alpha.profile.id,period:later});assert.deepEqual(fromHeader,selected,'Header-only current period must select the same monthly report as explicit From/To.');
 const defaultReport=await expect('/api/monthly-summary?ledger=1',{company:alpha.profile.id});assert.deepEqual(defaultReport.period,initialRange);assert.equal(defaultReport.opening,0);assert.deepEqual(defaultReport.totals,{debit:100,credit:0,closing:100});
 const explicitInitial=await expect('/api/monthly-summary?ledger=1&from=2025-04-01&to=2026-03-31',{company:alpha.profile.id,period:later});assert.deepEqual(explicitInitial,defaultReport,'Explicit complete monthly query must take precedence over a different selected-period header.');assert.deepEqual(await all(),before);
}));

test('HTTP monthly filters require both valid ordered From/To dates and exactly one ledger/from/to, before any changes',async()=>fixture(async({expect,all,alpha})=>{
 const before=await all();
 for(const query of ['ledger=1&from=2026-04-01','ledger=1&to=2027-03-31','ledger=1&from=2026-02-29&to=2027-03-31','ledger=1&from=2027-03-31&to=2026-04-01','ledger=1&ledger=1','ledger=1&from=2026-04-01&from=2026-04-01&to=2027-03-31','ledger=1&from=2026-04-01&to=2027-03-31&to=2027-03-31','ledger=1&from=2026-04-01&to=2027-03-31&extra=true'])await expect('/api/monthly-summary?'+query,{company:alpha.profile.id},400);
 assert.deepEqual(await all(),before);
}));
