import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm,unlink,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startOwnedTestServer,stopOwnedTestServer} from './owned-test-server.mjs';
import {initialCalendar,changedCalendar,calendarOf,ownedCalendarDirectory,seedCalendarAlter,snapshotCalendarAlter,injectOpeningForCalendarPolicy,tableRows} from './company-calendar-alter-fixture.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),port=4774,base='http://127.0.0.1:'+port;
async function fixture(action){
 const directory=await mkdtemp(join(tmpdir(),'bookr-calendar-alter-http-'));let server,output='';
 const stop=async()=>{await stopOwnedTestServer(server);server=null;};
 try{
  const f=seedCalendarAlter(join(directory,'book.sqlite')),start=async()=>{server=await startOwnedTestServer({root,port,database:f.database,onOutput:text=>{output+=text;}});};
  async function json(path,{id='default',method='GET',data,status=200,headers={}}={}){
   const response=await fetch(base+path,{method,headers:{'X-Bookr-Company':id,...(data===undefined?{}:{'Content-Type':'application/json'}),...headers},...(data===undefined?{}:{body:JSON.stringify(data)}),signal:AbortSignal.timeout(10000)}),result=await response.json();
   assert.equal(response.status,status,path+': '+JSON.stringify(result));return result;
  }
  await start();await action({...f,json,snapshot:()=>snapshotCalendarAlter(f),restart:async()=>{await stop();await start();}});
 }catch(error){error.message+='\nOwned server output: '+output;throw error;}
 finally{await stop();await rm(ownedCalendarDirectory(directory),{recursive:true,force:true});}
}
const policyPath=id=>'/api/companies/'+id+'/calendar-editability';
const put=(f,profile,patch,status=200)=>f.json('/api/companies/'+profile.id,{method:'PUT',data:{revision:profile.revision,...patch},status});

test('HTTP advertises date alteration and reads only the explicit target policy without row changes',async()=>fixture(async f=>{
 const before=f.snapshot(),capabilities=await f.json('/api/capabilities');assert.equal(capabilities.capabilities.company_calendar_alteration,true);
 const policy=await f.json(policyPath(f.target.id),{id:f.comparison.id});assert.deepEqual(policy,{company_id:f.target.id,revision:f.target.revision,editable:true});
 assert.deepEqual(await f.json(policyPath('default')),{company_id:'default',revision:1,editable:true});assert.equal((await f.json(policyPath(f.comparison.id))).editable,false);assert.deepEqual(f.snapshot(),before);
 await f.json(policyPath(f.target.id)+'?editable=true',{status:400});await f.json(policyPath(f.target.id),{method:'POST',data:{},status:405});await f.json(policyPath('invalid'),{status:400});await f.json(policyPath('f'.repeat(32)),{status:404});assert.deepEqual(f.snapshot(),before);
}));

test('HTTP alters empty named and default dates, retains600 and round-trips version2 through restart',async()=>fixture(async f=>{
 const before=f.snapshot(),saved=await put(f,f.target,changedCalendar);assert.deepEqual(calendarOf(saved),changedCalendar);assert.equal(saved.revision,2);assert.equal((await f.json(policyPath(saved.id))).revision,2);
 assert.deepEqual((await f.json('/api/state',{id:saved.id})).calendar,changedCalendar);assert.deepEqual((await f.json('/api/companies/'+saved.id+'/summary')).calendar,changedCalendar);assert.deepEqual(f.snapshot().books,before.books);
 const currentDefault=await f.json('/api/companies/default'),newDefault=await put(f,currentDefault,{financial_year_from:'2025-04-01'});assert.deepEqual(calendarOf(newDefault),{financial_year_from:'2025-04-01',books_from:'2025-04-01',financial_year_to:'2026-03-31'});assert.deepEqual(f.snapshot().books,before.books);
 const bundle=await f.json('/api/companies/'+saved.id+'/backup');assert.equal(bundle.version,2);assert.deepEqual(calendarOf(bundle.company),changedCalendar);
 const restored=await f.json('/api/companies/restore',{method:'POST',status:201,data:{name:'Fictional Calendar HTTP Restored',bundle}});assert.notEqual(restored.id,saved.id);assert.deepEqual(calendarOf(restored),changedCalendar);
 const persisted=await f.json('/api/companies/'+saved.id);await f.restart();assert.deepEqual(await f.json('/api/companies/'+saved.id),persisted);assert.deepEqual((await f.json('/api/state',{id:saved.id})).calendar,changedCalendar);assert.equal((await f.json('/api/outstanding',{id:f.comparison.id})).totals.pending,60000);assert.deepEqual(f.snapshot().books,before.books);
}));

test('HTTP rejects bad, stale and duplicate date edits atomically but keeps posted metadata edits',async()=>fixture(async f=>{
 for(const [patch,status]of [[{books_from:'2026-03-31'},400],[{books_from:'2027-04-01'},400],[{books_from:'2026-02-30'},400],[{financial_year_from:'2025-04-01',financial_year_to:'2027-03-31'},400],[{revision:999,books_from:'2026-07-01'},409],[{name:f.other.name,books_from:'2026-07-01'},409]]){
  const before=f.snapshot();await put(f,f.target,patch,status);assert.deepEqual(f.snapshot(),before);
 }
 const posted=await f.json('/api/companies/'+f.comparison.id),same=await put(f,posted,{...initialCalendar,email:'fictional-calendar-http@example.invalid'});assert.equal(same.revision,posted.revision+1);
 const before=f.snapshot();await put(f,same,changedCalendar,400);assert.deepEqual(f.snapshot(),before);assert.equal((await f.json('/api/outstanding',{id:posted.id})).totals.pending,60000);
}));

test('A previously editable HTTP flag cannot bypass a newly nonempty book at PUT time',async()=>fixture(async f=>{
 assert.equal((await f.json(policyPath(f.target.id))).editable,true);injectOpeningForCalendarPolicy(f);const before=f.snapshot();assert.equal((await f.json(policyPath(f.target.id))).editable,false);await put(f,f.target,changedCalendar,400);assert.deepEqual(f.snapshot(),before);assert.equal((await f.json('/api/outstanding',{id:f.comparison.id})).totals.pending,60000);
}));

test('HTTP policy and mutation refuse missing or incomplete books without reseeding',async()=>fixture(async f=>{
 const file=f.bookFiles.find(row=>row.id===f.target.id).file,db=new DatabaseSync(file);try{db.exec('DROP TABLE journal_entry_order');}finally{db.close();}
 const incomplete=f.snapshot();await f.json(policyPath(f.target.id),{status:400});await put(f,f.target,changedCalendar,400);assert.deepEqual(f.snapshot(),incomplete);
 await f.restart();await unlink(file);const beforeCatalog=tableRows(f.catalog);await f.json(policyPath(f.target.id),{status:404});await put(f,f.target,changedCalendar,404);await assert.rejects(access(file),error=>error.code==='ENOENT');assert.deepEqual(tableRows(f.catalog),beforeCatalog);
 // The comparison book stays available; do not ask a snapshot helper to open a deliberately missing file.
 assert.equal((await f.json('/api/outstanding',{id:f.comparison.id})).totals.pending,60000);
}));

function delayedVoucher(body,id){
 const bytes=Buffer.from(JSON.stringify(body));let request,resolveStarted,rejectStarted;
 const started=new Promise((done,reject)=>{resolveStarted=done;rejectStarted=reject;});
 const response=new Promise((done,reject)=>{
  request=http.request(base+'/api/vouchers',{method:'POST',headers:{'X-Bookr-Company':id,'Content-Type':'application/json','Content-Length':bytes.length,Expect:'100-continue'}},res=>{
   let text='';res.setEncoding('utf8');res.on('data',chunk=>{text+=chunk;});res.once('end',()=>{try{done({status:res.statusCode,body:JSON.parse(text)});}catch(error){reject(error);}});res.once('error',reject);
  });
  request.setTimeout(10000,()=>request.destroy(new Error('Owned delayed-body request timed out.')));request.once('error',error=>{rejectStarted(error);reject(error);});
  // The server's route obtains its Book synchronously before awaiting this body.
  // Receiving100Continue lets the update request run while that first body remains incomplete.
  request.once('continue',()=>{request.write(bytes.subarray(0,1));resolveStarted();});request.flushHeaders();
 });
 response.catch(()=>{});
 return {started,response,finish(){request.end(bytes.subarray(1));},close(){request.destroy();}};
}
test('A voucher body resumed after date publication uses the updated cached Book and writes nothing',async()=>fixture(async f=>{
 const before=f.snapshot(),pending=delayedVoucher({type:'sale',date:'2026-04-01',customer_id:1,account_id:2,amount:100},f.target.id);
 try{
  await pending.started;const saved=await put(f,f.target,{books_from:'2026-07-01'});assert.equal(saved.books_from,'2026-07-01');pending.finish();const result=await pending.response;assert.equal(result.status,400,JSON.stringify(result));assert.match(result.body.error,/books|date|period/i);assert.deepEqual(f.snapshot().books,before.books);assert.equal((await f.json('/api/outstanding',{id:f.comparison.id})).totals.pending,60000);
 }finally{pending.close();}
}));
