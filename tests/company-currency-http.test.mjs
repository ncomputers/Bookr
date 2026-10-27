import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Book} from '../lib/accounting.mjs';
import {startOwnedTestServer,stopOwnedTestServer} from './owned-test-server.mjs';
import {GBP,INR,seedCurrencyFixture,currencySnapshot,legacyV1} from './company-currency-fixture.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),port=4776,base='http://127.0.0.1:'+port,labels=value=>({currency_symbol:value.currency_symbol,currency_name:value.currency_name});
const cashTransfer=bank=>({type:'contra',date:'2025-05-01',source_id:1,destination_id:bank.id,amount:100,details:{bank:{account_id:bank.id,transaction_type:'Cash',amount:100,instrument_number:'',instrument_date:'2025-05-01',bank_name:'Not Applicable',cheque_range:''}}});
async function fixture(action){
 const temporary=await realpath(tmpdir()),directory=await mkdtemp(join(temporary,'bookr-currency-http-')),database=join(directory,'book.sqlite');let server,f;
 const start=async()=>{server=await startOwnedTestServer({root,port,database,env:{BOOKR_PREVIEW_LABEL:''}});};
 async function json(path,{company='default',method='GET',data,status=200,ack=true,awareness='1',context}={}){const response=await fetch(base+path,{method,headers:{'X-Bookr-Company':company,...(ack?{'X-Bookr-Currency-Labels':awareness}:{}),...(context===undefined?{}:{'X-Bookr-Currency-Context':typeof context==='string'?context:encodeURIComponent(JSON.stringify(context))}),...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})}),body=await response.json();assert.equal(response.status,status,path+': '+JSON.stringify(body));return body;}
 try{const book=new Book(database);try{f=seedCurrencyFixture(book);}finally{book.close();}await start();for(const id of ['default',f.target.id,f.other.id])await json('/api/state',{company:id});await action({f,json,restart:async()=>{await stopOwnedTestServer(server);server=null;await start();}});}finally{await stopOwnedTestServer(server);const actual=await realpath(directory),part=relative(temporary,actual);assert.ok(part&&!part.startsWith('..')&&!isAbsolute(part));await rm(actual,{recursive:true,force:true});}
}
test('HTTP labels are target-scoped, revision guarded, persistent and limited to actual empty-book changes',async()=>fixture(async({f,json,restart})=>{
 const capabilities=await json('/api/capabilities');assert.equal(capabilities.capabilities.company_currency_labels,true);assert.equal(capabilities.capabilities.company_backup_v2,true);const before=currencySnapshot(f),saved=await json('/api/companies/'+f.target.id,{method:'PUT',company:'default',data:{revision:1,...GBP}});assert.deepEqual(labels(saved),GBP);assert.deepEqual(labels(await json('/api/state',{company:f.target.id})),GBP);assert.deepEqual(labels(await json('/api/state')),INR);assert.deepEqual(currencySnapshot(f).books,before.books);
 const after=currencySnapshot(f);for(const [id,data,status]of [[f.target.id,{revision:1,currency_symbol:'$'},409],['default',{revision:1,...GBP},400],[f.target.id,{revision:2,currency_name:''},400]]){await json('/api/companies/'+id,{method:'PUT',data,status});assert.deepEqual(currencySnapshot(f),after);}await json('/api/companies/default',{method:'PUT',data:{revision:1,email:'fictional@example.invalid',...INR}});assert.equal((await json('/api/outstanding')).totals.pending,60000);
 await restart();assert.deepEqual(labels(await json('/api/companies/'+f.target.id)),GBP);assert.deepEqual(labels(await json('/api/state',{company:f.target.id})),GBP);await json('/api/state',{company:f.target.id,ack:false,status:400});assert.deepEqual(labels(await json('/api/state',{ack:false})),INR);
}));
test('HTTP V3 export and strictV1 restore preserve labels, original rows and source isolation',async()=>fixture(async({f,json})=>{
 const before=currencySnapshot(f),v2=await json('/api/companies/default/backup');assert.equal(v2.version,3);assert.deepEqual(labels(v2.company),INR);const legacy=legacyV1(v2),created=await json('/api/companies/restore',{method:'POST',status:201,data:{name:'Fictional HTTP V1 Currency Copy',bundle:legacy}});assert.deepEqual(labels(created),INR);assert.equal((await json('/api/outstanding',{company:created.id})).totals.pending,60000);assert.deepEqual((await json('/api/companies/'+created.id+'/backup')).tables,v2.tables);assert.deepEqual(currencySnapshot(f).books,before.books);
 const invalid=structuredClone(v2);invalid.checksum.value='0'.repeat(64);const after=currencySnapshot(f);await json('/api/companies/restore',{method:'POST',status:400,data:{name:'Must Not Publish HTTP Currency',bundle:invalid}});assert.deepEqual(currencySnapshot(f),after);
}));

test('Aware refresh ignores stale context while numeric writes require exact current labels',async()=>fixture(async({f,json})=>{
 const bank=await json('/api/banks',{company:f.target.id,method:'POST',status:201,data:{name:'Fictional Currency Context Bank'}});await json('/api/companies/'+f.target.id,{method:'PUT',data:{revision:1,...GBP}});
 assert.deepEqual(labels(await json('/api/state',{company:f.target.id,context:INR})),GBP);const before=currencySnapshot(f),voucher=cashTransfer(bank);
 for(const context of [undefined,INR,null,{currency_symbol:'£'},'%not-valid-json',encodeURIComponent(JSON.stringify({...GBP,decimal_places:2}))]){await json('/api/vouchers',{company:f.target.id,method:'POST',data:voucher,context,status:409});assert.deepEqual(currencySnapshot(f),before);}
 await json('/api/vouchers',{company:f.target.id,method:'POST',data:voucher,context:GBP,ack:false,status:400});assert.deepEqual(currencySnapshot(f),before);
 const metadata=await json('/api/companies/'+f.target.id,{company:'default',method:'PUT',context:INR,data:{revision:2,address:'Fictional target metadata, no monetary context'}});assert.equal(metadata.revision,3);assert.deepEqual(labels(metadata),GBP);assert.deepEqual(currencySnapshot(f).books,before.books);
 await json('/api/vouchers',{company:f.target.id,method:'POST',data:voucher,context:GBP,status:201});assert.equal((await json('/api/state',{company:f.target.id})).vouchers.length,1);assert.equal((await json('/api/outstanding')).totals.pending,60000);
 const legacyOpening={name:'Fictional Legacy Default Opening',kind:'capital',opening_balance:-100},beforeLegacy=currencySnapshot(f);await json('/api/ledgers',{company:f.other.id,method:'POST',ack:false,context:GBP,data:legacyOpening,status:409});assert.deepEqual(currencySnapshot(f),beforeLegacy);const legacy=await json('/api/ledgers',{company:f.other.id,method:'POST',ack:false,data:legacyOpening,status:201});assert.equal(legacy.opening_balance,-100);
}));

// Node sends100Continue and dispatches the request handler synchronously. The
// incomplete body keeps that handler at await body while another owned request
// changes the empty company's labels. No sleeps or production test hooks.
function incompleteJson(path,{company,data,ack,context}){
 const encoded=Buffer.from(JSON.stringify(data)),headers={'Content-Type':'application/json','Content-Length':String(encoded.length),'Expect':'100-continue','X-Bookr-Company':company,...(ack?{'X-Bookr-Currency-Labels':'1'}:{}),...(context===undefined?{}:{'X-Bookr-Currency-Context':encodeURIComponent(JSON.stringify(context))})};let resolveReady,rejectReady,resolveDone,rejectDone,continued=false;
 const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;}),result=new Promise((resolve,reject)=>{resolveDone=resolve;rejectDone=reject;});result.catch(()=>{});ready.catch(()=>{});
 const request=http.request(base+path,{method:'POST',headers,agent:false},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>{try{const value={status:response.statusCode,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))};if(!continued)rejectReady(new Error('Server returned before the delayed-body barrier: '+JSON.stringify(value)));resolveDone(value);}catch(error){rejectDone(error);rejectReady(error);}});response.on('error',rejectDone);});
 request.once('continue',()=>{continued=true;request.write(encoded.subarray(0,1));resolveReady();});request.on('error',error=>{rejectReady(error);rejectDone(error);});request.setTimeout(8000,()=>request.destroy(new Error('Owned delayed currency request timed out')));request.flushHeaders();return {ready,result,finish:()=>request.end(encoded.subarray(1)),abort:()=>request.destroy()};
}
async function delayedCurrencyChange({aware,opening}){await fixture(async({f,json})=>{
 const bank=await json('/api/banks',{company:f.target.id,method:'POST',status:201,data:{name:'Fictional Delayed Currency Bank'}}),data=opening?{name:'Fictional Delayed Currency Opening',kind:'capital',opening_balance:-100}:cashTransfer(bank),pending=incompleteJson(opening?'/api/ledgers':'/api/vouchers',{company:f.target.id,data,ack:aware,context:aware?INR:undefined});
 try{await pending.ready;assert.deepEqual(labels(await json('/api/state',{company:f.target.id})),INR);await json('/api/companies/'+f.target.id,{method:'PUT',data:{revision:1,...GBP}});const afterCurrency=currencySnapshot(f);pending.finish();const response=await pending.result;assert.equal(response.status,aware?409:400,JSON.stringify(response.body));assert.match(response.body.error,/currenc|labels|reopen|aware|support/i);assert.deepEqual(currencySnapshot(f),afterCurrency);assert.deepEqual(labels(await json('/api/state',{company:f.target.id,context:INR})),GBP);assert.equal((await json('/api/outstanding')).totals.pending,60000);}finally{pending.abort();}
});}
test('A delayed legacy voucher cannot bypass awareness when empty-book labels change during its body',async()=>delayedCurrencyChange({aware:false,opening:false}));
test('A delayed aware voucher rechecks its original label context after its body completes',async()=>delayedCurrencyChange({aware:true,opening:false}));
test('A delayed aware opening write rechecks label context before creating any ledger or opening row',async()=>delayedCurrencyChange({aware:true,opening:true}));
test('Unknown present awareness versions reject default scoped reads while global recovery and truly absent legacy reads remain usable',async()=>fixture(async({f,json})=>{
 const before=currencySnapshot(f);for(const awareness of ['2','0','']){for(const path of ['/api/state','/api/companies/default','/api/companies/default/summary']){await json(path,{awareness,status:400});assert.deepEqual(currencySnapshot(f),before);}assert.equal((await json('/api/capabilities',{awareness})).capabilities.company_currency_labels,true);assert.ok((await json('/api/companies',{awareness})).companies.some(row=>row.id==='default'));}assert.deepEqual(labels(await json('/api/state',{ack:false})),INR);assert.deepEqual(currencySnapshot(f),before);
}));
test('Only an absent awareness header can use the legacy default numeric-write exception',async()=>fixture(async({f,json})=>{
 const before=currencySnapshot(f);for(const awareness of ['2','0','']){await json('/api/ledgers',{method:'POST',awareness,data:{name:'Fictional Unknown Awareness Must Not Publish',kind:'capital',opening_balance:-100},status:400});assert.deepEqual(currencySnapshot(f),before);}assert.equal((await json('/api/outstanding',{ack:false})).totals.pending,60000);assert.deepEqual(currencySnapshot(f),before);
}));
