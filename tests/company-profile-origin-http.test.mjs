import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Book} from '../lib/accounting.mjs';
import {startOwnedTestServer,stopOwnedTestServer} from './owned-test-server.mjs';
import {seedProfileOrigin,snapshotProfileOrigin,injectProfileOrigin} from './company-profile-origin-fixture.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),port=4772,base='http://127.0.0.1:'+port;
for(const key of ['id','revision'])test('HTTP rejects raw '+key+' before returning forged profile, mutation or exported bundle; exact books survive restart',async()=>{
 const temporary=await realpath(tmpdir()),directory=await mkdtemp(join(temporary,'bookr-profile-origin-http-')),database=join(directory,'book.sqlite');let server,fixture,output='';
 const start=async()=>{server=await startOwnedTestServer({root,port,database,onOutput:chunk=>output+=chunk,env:{BOOKR_PREVIEW_LABEL:''}});};
 async function json(path,{company='default',method='GET',data,status=200}={}){
  const response=await fetch(base+path,{method,headers:{'X-Bookr-Company':company,...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})}),body=await response.json();assert.equal(response.status,status,path+': '+JSON.stringify(body));return body;
 }
 async function rejected(path,options={}){const body=await json(path,{...options,status:400});assert.deepEqual(Object.keys(body),['error']);assert.match(body.error,/unsupported.*(?:stored|company|setting)|(?:stored|company|setting).*unsupported/i);assert.equal(Object.hasOwn(body,'format'),false);assert.equal(Object.hasOwn(body,'id'),false);}
 try{
  const book=new Book(database);try{fixture=seedProfileOrigin(book);}finally{book.close();}
  await start();const other=await json('/api/companies/'+fixture.other.id),normal=await json('/api/companies/'+fixture.target.id);
  for(const id of ['default',fixture.target.id,fixture.other.id])await json('/api/state',{company:id});
  const injection=injectProfileOrigin(fixture,key),before=snapshotProfileOrigin(fixture);assert.equal(normal.id,fixture.target.id);
  for(const request of [()=>rejected('/api/companies/'+fixture.target.id),()=>rejected('/api/companies'),()=>rejected('/api/companies/'+fixture.target.id+'/summary'),()=>rejected('/api/state',{company:fixture.target.id}),()=>rejected('/api/companies/'+fixture.target.id,{method:'PUT',company:fixture.other.id,data:{revision:normal.revision,address:'Must not silently remove raw '+key}}),()=>rejected('/api/companies/'+fixture.target.id+'/backup')]){
   await request();assert.deepEqual(snapshotProfileOrigin(fixture),before);assert.deepEqual(await json('/api/companies/'+fixture.other.id),other);assert.equal((await json('/api/outstanding')).totals.pending,60000);
  }
  assert.equal(before.catalog.companies.find(row=>row.id===fixture.target.id).details,injection.after);
  await stopOwnedTestServer(server);server=null;await start();await rejected('/api/companies/'+fixture.target.id);await rejected('/api/companies/'+fixture.target.id+'/backup');assert.deepEqual(snapshotProfileOrigin(fixture),before);assert.deepEqual(await json('/api/companies/'+fixture.other.id),other);assert.equal((await json('/api/outstanding')).totals.pending,60000);
 }finally{await stopOwnedTestServer(server);const actual=await realpath(directory),part=relative(temporary,actual);assert.ok(part&&!part.startsWith('..')&&!isAbsolute(part));await rm(actual,{recursive:true,force:true});}
});
