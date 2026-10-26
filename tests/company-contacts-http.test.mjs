import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,relative,isAbsolute,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {Book} from '../lib/accounting.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),base='http://127.0.0.1:4443',keys=['telephone','mobile','fax','email','website'],blanks=Object.fromEntries(keys.map(key=>[key,'']));
const values={telephone:'0000000000',mobile:'+91 0000000000',fax:'000/0000',email:'company-study@example.invalid',website:'https://example.invalid'};
const contacts=profile=>Object.fromEntries(keys.map(key=>[key,profile[key]]));
function catalogRows(file){const db=new DatabaseSync(join(resolve(file,'..'),'book.companies.sqlite'),{readOnly:true});try{return db.prepare('SELECT * FROM companies ORDER BY id').all().map(row=>({...row}));}finally{db.close();}}
async function fixture(action){const temporaryRoot=await realpath(tmpdir()),directory=await mkdtemp(join(temporaryRoot,'bookr-company-contacts-http-')),file=join(directory,'book.sqlite');let server,output='';
 const stop=async()=>{if(server&&server.exitCode===null&&server.signalCode===null){const ended=new Promise(done=>server.once('exit',done));server.kill();await ended;}};
 const start=async()=>{server=spawn(process.execPath,[join(root,'server.mjs')],{cwd:root,windowsHide:true,env:{...process.env,PORT:'4443',BOOKR_DB:file,BOOKR_TAILSCALE_IP:'',BOOKR_PREVIEW_LABEL:''},stdio:['ignore','pipe','pipe']});server.stdout.on('data',bytes=>output+=bytes);server.stderr.on('data',bytes=>output+=bytes);for(let i=0;i<80;i++){if(server.exitCode!==null)throw new Error(output);try{if((await fetch(base+'/api/state')).ok)return;}catch{}await new Promise(done=>setTimeout(done,100));}throw new Error(output||'Owned contact test server failed to start.');};
 const json=async(path,{company,method='GET',data,status=200}={})=>{const response=await fetch(base+path,{method,headers:{...(company===undefined?{}:{'X-Bookr-Company':company}),...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})}),result=await response.json();assert.equal(response.status,status,path+': '+JSON.stringify(result));return result;};
 try{try{await fetch(base+'/api/state');throw new Error('Owned contact test port4443 occupied.');}catch(error){if(!error.message.includes('fetch failed'))throw error;}
  const book=new Book(file);try{const customer=book.createCustomer({name:'Fictional Contact HTTP Customer'}),sale=book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:100000});book.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1,amount:40000,allocations:[{bill_id:sale.bill.id,amount:40000}]});}finally{book.close();}
  await start();await action({json,file,restart:async()=>{await stop();await start();}});
 }finally{await stop();const target=await realpath(directory),part=relative(temporaryRoot,target);assert.ok(part&&!part.startsWith('..')&&!isAbsolute(part));await rm(target,{recursive:true,force:true});}
}

test('HTTP contact create/read/update preserves exact text, explicit URL company scope, money and reopened profiles',async()=>fixture(async({json,restart})=>{
 const original=await json('/api/state'),created=await json('/api/companies',{method:'POST',status:201,data:{name:'Fictional Contact HTTP Alpha',...Object.fromEntries(Object.entries(values).map(([key,value])=>[key,'  '+value+'  ']))}});assert.deepEqual(contacts(created),values);assert.deepEqual(contacts(await json('/api/companies/'+created.id)),values);assert.deepEqual(contacts((await json('/api/companies')).companies.find(row=>row.id===created.id)),values);
 const other=await json('/api/companies',{method:'POST',status:201,data:{name:'Fictional Contact HTTP Beta',telephone:'001'}}),otherBefore=await json('/api/companies/'+other.id);await json('/api/vouchers',{method:'POST',status:201,company:created.id,data:{type:'sale',date:'2026-04-01',customer_id:1,account_id:2,amount:5000}});const namedBefore=await json('/api/state',{company:created.id});
 const changed=await json('/api/companies/'+created.id,{method:'PUT',company:other.id,data:{revision:created.revision,telephone:'  000 111  ',email:''}});assert.deepEqual(contacts(changed),{...values,telephone:'000 111',email:''});assert.equal(changed.revision,2);assert.deepEqual(await json('/api/companies/'+other.id),otherBefore);assert.deepEqual(await json('/api/state',{company:created.id}),namedBefore);assert.deepEqual(await json('/api/state'),original);
 const defaultBefore=await json('/api/companies/default'),defaultChanged=await json('/api/companies/default',{method:'PUT',company:created.id,data:{revision:defaultBefore.revision,mobile:'0000000009'}});assert.equal(defaultChanged.mobile,'0000000009');assert.deepEqual(await json('/api/state'),original);assert.equal((await json('/api/outstanding')).totals.pending,60000);const profiles=(await json('/api/companies')).companies;await restart();assert.deepEqual((await json('/api/companies')).companies,profiles);assert.deepEqual(await json('/api/state'),original);assert.deepEqual(await json('/api/state',{company:created.id}),namedBefore);
}));

test('HTTP legacy contact projection is read-only and invalid contact writes reject atomically',async()=>fixture(async({json,file})=>{
 const catalogFile=join(resolve(file,'..'),'book.companies.sqlite'),catalog=new DatabaseSync(catalogFile);try{const row=catalog.prepare("SELECT details FROM companies WHERE id='default'").get(),legacy=JSON.parse(row.details);for(const key of keys)delete legacy[key];catalog.prepare("UPDATE companies SET details=? WHERE id='default'").run(JSON.stringify(legacy));}finally{catalog.close();}
 const beforeRows=catalogRows(file),original=await json('/api/state'),profile=await json('/api/companies/default');assert.deepEqual(contacts(profile),blanks);assert.deepEqual(contacts((await json('/api/companies')).companies[0]),blanks);assert.deepEqual(catalogRows(file),beforeRows);
 const saved=await json('/api/companies/default',{method:'PUT',data:{revision:profile.revision,telephone:'001'}}),stable=await json('/api/companies'),rows=catalogRows(file);
 for(const [data,status] of [[{revision:profile.revision,mobile:'stale'},409],[{revision:saved.revision,email:123},400],[{revision:saved.revision,fax:null},400],[{revision:saved.revision,website:[]},400],[{revision:saved.revision,mobile:'x'.repeat(121)},400],[{revision:saved.revision,unknown_contact:'not allowed'},400]]){await json('/api/companies/default',{method:'PUT',data,status});assert.deepEqual(await json('/api/companies'),stable);assert.deepEqual(catalogRows(file),rows);assert.deepEqual(await json('/api/state'),original);}
 await json('/api/companies',{method:'POST',status:400,data:{name:'Must Not Publish Bad Contact',telephone:123}});assert.deepEqual(await json('/api/companies'),stable);assert.deepEqual(catalogRows(file),rows);
}));
