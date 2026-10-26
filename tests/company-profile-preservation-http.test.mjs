import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,resolve,join,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {CompanyStore} from '../lib/companies.mjs';
import {startOwnedTestServer,stopOwnedTestServer} from './owned-test-server.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),port=4765,base='http://127.0.0.1:'+port;
function rows(file){const db=new DatabaseSync(file,{readOnly:true});try{return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'" ORDER BY rowid').all().map(row=>({...row}))]));}finally{db.close();}}
test('HTTP company PUT reports400 for unknown persisted settings and leaves exact details/profile/revision/all books unchanged through restart',async()=>{
 const temporary=await realpath(tmpdir()),directory=await mkdtemp(join(temporary,'bookr-profile-preservation-http-')),database=join(directory,'book.sqlite');let server,output='',profile;const store=new CompanyStore({defaultFile:database});
 try{profile=store.create({name:'Fictional HTTP Future Profile Setting',financial_year_from:'2025-04-01',books_from:'2025-07-01'});const original=JSON.parse(store.catalog.prepare('SELECT details FROM companies WHERE id=?').get(profile.id).details);store.catalog.prepare('UPDATE companies SET details=? WHERE id=?').run(JSON.stringify({...original,future_write_policy:{unknown:true,enabled:false}},null,3)+'  \n',profile.id);}finally{store.close();}
 async function json(path,{method='GET',data,status=200,company}={}){const response=await fetch(base+path,{method,headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...(company?{'X-Bookr-Company':company}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),body=await response.json();assert.equal(response.status,status,JSON.stringify(body));return body;}
 async function snapshot(){const registry=await json('/api/companies'),books={};for(const row of registry.companies){books[row.id]={profile:await json('/api/companies/'+row.id),state:await json('/api/state',{company:row.id}),rows:rows(row.id==='default'?database:join(directory,'book.companies',row.id+'.sqlite'))};}return {registry,books,catalog:rows(join(directory,'book.companies.sqlite')),files:(await readdir(join(directory,'book.companies'))).sort()};}
 const start=async()=>{server=await startOwnedTestServer({root,port,database,onOutput:value=>output+=value,env:{BOOKR_PREVIEW_LABEL:''}});};
 try{
  await start();const before=await snapshot(),saved=before.books[profile.id].profile;
  const rejected=await json('/api/companies/'+profile.id,{method:'PUT',company:'default',status:400,data:{revision:saved.revision,name:'Must Not Drop Unknown HTTP Setting',email:'fictional@example.invalid'}});assert.match(rejected.error,/unsupported.*settings/i);assert.deepEqual(await snapshot(),before);
  await json('/api/companies/'+profile.id+'/backup',{status:400});assert.deepEqual(await snapshot(),before);
  await stopOwnedTestServer(server);server=null;await start();assert.deepEqual(await snapshot(),before);
 }finally{await stopOwnedTestServer(server);const target=await realpath(directory),part=relative(temporary,target);assert.ok(part&&!part.startsWith('..')&&!isAbsolute(part));await rm(target,{recursive:true,force:true});}
});
