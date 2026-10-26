import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,realpathSync,existsSync,renameSync,readdirSync} from 'node:fs';
import {join,relative,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {CompanyStore} from '../lib/companies.mjs';
import {BookError} from '../lib/accounting.mjs';

function fixture(action){const temporaryRoot=realpathSync(tmpdir()),directory=mkdtempSync(join(temporaryRoot,'bookr-company-layer-'));try{return action({directory,defaultFile:join(directory,'book.sqlite')});}finally{const target=realpathSync(directory),part=relative(temporaryRoot,target);assert.ok(part&&!part.startsWith('..')&&!isAbsolute(part));rmSync(target,{recursive:true,force:true});}}
const paths=(directory,prefix='')=>readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?paths(join(directory,entry.name),prefix+entry.name+'/'):[prefix+entry.name]).sort();
function catalogRows(file){const catalog=new DatabaseSync(file,{readOnly:true});try{return Object.fromEntries(catalog.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,catalog.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'" ORDER BY rowid').all().map(row=>({...row}))]));}finally{catalog.close();}}

test('A fresh company storage workspace can initialize its first default book and create a named company',()=>fixture(({defaultFile})=>{
 assert.equal(existsSync(defaultFile),false);const store=new CompanyStore({defaultFile});try{assert.equal(existsSync(defaultFile),true);assert.equal(store.list().length,1);assert.equal(store.profile().id,'default');assert.equal(store.book().state().vouchers.length,0);const named=store.create({name:'Fictional First Company'});assert.equal(store.book(named.id).state().vouchers.length,0);assert.equal(store.list().length,2);}finally{store.close();}
}));

test('An established company catalog fails closed when its default book is missing and can reopen after the original is restored',()=>fixture(({directory,defaultFile})=>{
 let store=new CompanyStore({defaultFile}),attempted;
 try{
  const customer=store.book().createCustomer({name:'Fictional Preserved Default Customer'}),sale=store.book().saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:100000});
  store.book().saveVoucher({type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1,amount:40000,allocations:[{bill_id:sale.bill.id,amount:40000}]});
  const named=store.create({name:'Fictional Preserved Named Company'});store.book(named.id).saveVoucher({type:'sale',date:'2026-04-01',customer_id:1,account_id:2,amount:5000});
  store.update('default',{revision:store.profile().revision,address:'Preserved default mailing details'});
  const profiles=store.list(),beforeDefault=store.book().state(),beforeNamed=store.book(named.id).state();assert.equal(beforeDefault.outstanding[0].pending,60000);
  store.close();store=null;
  const retained=join(directory,'book.owned-original.sqlite'),catalogFile=join(directory,'book.companies.sqlite');renameSync(defaultFile,retained);
  const beforeCatalog=catalogRows(catalogFile),beforePaths=paths(directory);
  assert.throws(()=>{attempted=new CompanyStore({defaultFile});},error=>error instanceof BookError&&error.status===404,'A known default company must never silently become a replacement empty book.');
  assert.equal(existsSync(defaultFile),false);assert.equal(existsSync(defaultFile+'-wal'),false);assert.equal(existsSync(defaultFile+'-shm'),false);assert.deepEqual(catalogRows(catalogFile),beforeCatalog);assert.deepEqual(paths(directory),beforePaths);
  renameSync(retained,defaultFile);store=new CompanyStore({defaultFile});assert.deepEqual(store.list(),profiles);assert.deepEqual(store.book().state(),beforeDefault);assert.deepEqual(store.book(named.id).state(),beforeNamed);assert.equal(store.book().outstanding()[0].pending,60000);
 }finally{attempted?.close();store?.close();}
}));
