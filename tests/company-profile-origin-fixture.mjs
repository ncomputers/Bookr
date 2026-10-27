import assert from 'node:assert/strict';
import {realpathSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,isAbsolute,join,relative} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {CompanyStore} from '../lib/companies.mjs';

function owned(directory){
 const temporary=realpathSync.native(tmpdir()),actual=realpathSync.native(directory),part=relative(temporary,actual);
 assert.ok(part&&!part.startsWith('..')&&!isAbsolute(part)&&basename(actual).startsWith('bookr-profile-origin-'),'Use only a new owned profile-origin temporary fixture: '+JSON.stringify({temporary,actual,part,name:basename(actual)}));return actual;
}
export function seedProfileOrigin(defaultBook){
 const database=defaultBook.db.prepare('PRAGMA database_list').all().find(row=>row.name==='main').file,directory=owned(dirname(database));
 const buyer=defaultBook.createCustomer({name:'Fictional Origin Transport Buyer'}),sale=defaultBook.saveVoucher({type:'sale',date:'2026-04-01',customer_id:buyer.id,account_id:2,amount:100000});
 defaultBook.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:buyer.id,account_id:1,amount:40000,allocations:[{bill_id:sale.bill.id,amount:40000}]});
 const store=new CompanyStore({defaultFile:database});try{
  const target=store.create({name:'Fictional Origin Transport Target',mailing_name:'Fictional saved mailing',financial_year_from:'2025-04-01',books_from:'2025-07-01'}),other=store.create({name:'Fictional Origin Transport Other'});
  return {directory,database,catalog:join(directory,'book.companies.sqlite'),target,other,bookFiles:[database,join(directory,'book.companies',target.id+'.sqlite'),join(directory,'book.companies',other.id+'.sqlite')]};
 }finally{store.close();}
}
function tableRows(file){const db=new DatabaseSync(file,{readOnly:true});try{return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'" ORDER BY rowid').all().map(row=>({...row}))]));}finally{db.close();}}
export function snapshotProfileOrigin(fixture){
 owned(fixture.directory);return {catalog:tableRows(fixture.catalog),books:fixture.bookFiles.map(file=>({file,tables:tableRows(file)})),files:readdirSync(fixture.directory,{recursive:true}).filter(file=>!/-wal$|-shm$/.test(file)).sort()};
}
export function injectProfileOrigin(fixture,key){
 owned(fixture.directory);assert.ok(['id','revision'].includes(key));const db=new DatabaseSync(fixture.catalog);try{
  const row=db.prepare('SELECT name,details,revision FROM companies WHERE id=?').get(fixture.target.id);assert.equal(row.name,fixture.target.name);assert.equal(row.revision,fixture.target.revision);
  const before=row.details,details=JSON.parse(before);assert.ok(!Object.hasOwn(details,key));const value=key==='id'?fixture.other.id:999,after=JSON.stringify({...details,[key]:value},null,3)+'  \n';
  db.prepare('UPDATE companies SET details=? WHERE id=?').run(after,fixture.target.id);return {key,value,before,after};
 }finally{db.close();}
}
