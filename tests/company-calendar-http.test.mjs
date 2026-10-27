import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,relative,isAbsolute,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Book} from '../lib/accounting.mjs';
import {CompanyStore} from '../lib/companies.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),base='http://127.0.0.1:4454',calendar={financial_year_from:'2025-04-01',books_from:'2025-07-01',financial_year_to:'2026-03-31'};
const dates=profile=>Object.fromEntries(Object.keys(calendar).map(key=>[key,profile[key]]));
function catalogRows(file){const store=new CompanyStore({defaultFile:file});try{return store.catalog.prepare('SELECT * FROM companies ORDER BY id').all().map(row=>({...row}));}finally{store.close();}}
async function fixture(action){const temporaryRoot=await realpath(tmpdir()),directory=await mkdtemp(join(temporaryRoot,'bookr-calendar-http-')),file=join(directory,'book.sqlite');let server,output='';
 const stop=async()=>{if(server&&server.exitCode===null&&server.signalCode===null){const ended=new Promise(done=>server.once('exit',done));server.kill();await ended;}};
 const start=async()=>{server=spawn(process.execPath,[join(root,'server.mjs')],{cwd:root,windowsHide:true,env:{...process.env,PORT:'4454',BOOKR_DB:file,BOOKR_TAILSCALE_IP:'',BOOKR_PREVIEW_LABEL:''},stdio:['ignore','pipe','pipe']});server.stdout.on('data',bytes=>output+=bytes);server.stderr.on('data',bytes=>output+=bytes);for(let i=0;i<80;i++){if(server.exitCode!==null)throw new Error(output);try{if((await fetch(base+'/api/state')).ok)return;}catch{}await new Promise(done=>setTimeout(done,100));}throw new Error(output||'Owned calendar test server failed to start.');};
 const json=async(path,{company,method='GET',data,status=200}={})=>{const response=await fetch(base+path,{method,headers:{...(company===undefined?{}:{'X-Bookr-Company':company}),...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})}),result=await response.json();assert.equal(response.status,status,path+': '+JSON.stringify(result));return result;};
 try{try{await fetch(base+'/api/state');throw new Error('Owned calendar test port4454 occupied.');}catch(error){if(!error.message.includes('fetch failed'))throw error;}
  const book=new Book(file);try{const customer=book.createCustomer({name:'Fictional Calendar HTTP Preserved Customer'}),sale=book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:100000});book.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1,amount:40000,allocations:[{bill_id:sale.bill.id,amount:40000}]});}finally{book.close();}
  await start();await action({json,file,restart:async()=>{await stop();await start();}});
 }finally{await stop();const target=await realpath(directory),part=relative(temporaryRoot,target);assert.ok(part&&!part.startsWith('..')&&!isAbsolute(part));await rm(target,{recursive:true,force:true});}
}

test('HTTP creates a custom-calendar company, preserves the existing book and reopens the isolated1000/400/600 cycle',async()=>fixture(async({json,file,restart})=>{
 const original=await json('/api/state'),defaultProfile=await json('/api/companies/default'),created=await json('/api/companies',{method:'POST',status:201,data:{name:'Fictional Calendar HTTP July2025',financial_year_from:calendar.financial_year_from,books_from:calendar.books_from,telephone:'0000000000'}});
 assert.deepEqual(dates(created),calendar);assert.equal(created.revision,1);assert.deepEqual(await json('/api/companies/'+created.id),created);assert.deepEqual((await json('/api/companies')).companies.find(profile=>profile.id===created.id),created);assert.deepEqual(await json('/api/state'),original);
 const customer=await json('/api/customers',{company:created.id,method:'POST',status:201,data:{name:'Fictional Calendar2025 Customer'}}),sale=await json('/api/vouchers',{company:created.id,method:'POST',status:201,data:{type:'sale',date:calendar.books_from,customer_id:customer.id,account_id:2,amount:100000}});await json('/api/vouchers',{company:created.id,method:'POST',status:201,data:{type:'receipt',date:calendar.books_from,customer_id:customer.id,account_id:1,amount:40000,allocations:[{bill_id:sale.bill.id,amount:40000}]}});
 const saved=await json('/api/state',{company:created.id});assert.equal(saved.vouchers.length,2);assert.equal(saved.outstanding[0].pending,60000);assert.equal(saved.totals.balanced,true);assert.equal((await json('/api/outstanding?as_of=2025-07-01',{company:created.id})).totals.pending,60000);assert.deepEqual(await json('/api/state'),original);assert.deepEqual(await json('/api/companies/default'),defaultProfile);
 const patched=await json('/api/companies/'+created.id,{company:'default',method:'PUT',data:{revision:created.revision,email:'calendar-http@example.invalid'}});assert.deepEqual(dates(patched),calendar);assert.equal(patched.revision,2);const catalog=catalogRows(file);await json('/api/companies/'+created.id,{method:'PUT',status:400,data:{revision:patched.revision,books_from:'2025-08-01'}});assert.deepEqual(catalogRows(file),catalog);assert.deepEqual(await json('/api/state',{company:created.id}),saved);
 await restart();assert.deepEqual(await json('/api/companies/'+created.id),patched);assert.deepEqual(await json('/api/state',{company:created.id}),saved);assert.deepEqual(await json('/api/state'),original);assert.equal((await json('/api/outstanding',{company:created.id})).totals.pending,60000);
}));

test('HTTP defaults omitted books, accepts a matching derived end and rejects malformed or mismatched calendar metadata atomically',async()=>fixture(async({json,file})=>{
 const original=await json('/api/state'),created=await json('/api/companies',{method:'POST',status:201,data:{name:'Fictional Calendar HTTP Default Books',financial_year_from:'2025-04-01',financial_year_to:'2026-03-31'}});assert.deepEqual(dates(created),{financial_year_from:'2025-04-01',books_from:'2025-04-01',financial_year_to:'2026-03-31'});const profiles=await json('/api/companies'),catalog=catalogRows(file);
 for(const patch of [{financial_year_from:null},{financial_year_from:'2025-02-29'},{books_from:123},{books_from:'2025-04-31'},{financial_year_to:'2027-03-31'},{calendar_override:true}]){await json('/api/companies',{method:'POST',status:400,data:{name:'Must Not Publish Invalid Calendar HTTP',financial_year_from:'2025-04-01',books_from:'2025-07-01',...patch}});assert.deepEqual(await json('/api/companies'),profiles);assert.deepEqual(catalogRows(file),catalog);assert.deepEqual(await json('/api/state'),original);}
 const altered=await json('/api/companies/'+created.id,{method:'PUT',data:{revision:created.revision,financial_year_from:'2024-04-01'}});assert.deepEqual(dates(altered),{financial_year_from:'2024-04-01',books_from:'2024-04-01',financial_year_to:'2025-03-31'});assert.deepEqual(await json('/api/state'),original);
}));

test('HTTP Books bounds reject before and after the initial financial year without publication, with both inclusive boundaries accepted',async()=>fixture(async({json,file})=>{
 const original=await json('/api/state'),before=await json('/api/companies'),rows=catalogRows(file);
 for(const books_from of ['2025-03-31','2026-04-01']){const result=await json('/api/companies',{method:'POST',status:400,data:{name:'Must Not Publish HTTP Outside Calendar',financial_year_from:'2025-04-01',books_from}});assert.equal(result.error,'Choose a books-beginning date within the initial financial year.');assert.deepEqual(await json('/api/companies'),before);assert.deepEqual(catalogRows(file),rows);assert.deepEqual(await json('/api/state'),original);}
 for(const books_from of ['2025-04-01','2026-03-31']){const profile=await json('/api/companies',{method:'POST',status:201,data:{name:'Fictional HTTP Inclusive '+books_from,financial_year_from:'2025-04-01',books_from}});assert.equal(profile.books_from,books_from);assert.equal(profile.financial_year_to,'2026-03-31');assert.deepEqual(await json('/api/state'),original);}
 assert.equal((await json('/api/companies')).companies.length,before.companies.length+2);
}));
