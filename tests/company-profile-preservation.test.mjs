import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,relative,isAbsolute} from 'node:path';
import {CompanyStore} from '../lib/companies.mjs';
import {exportCompanyBundle} from '../lib/company-backup.mjs';

const dates={financial_year_from:'2025-04-01',books_from:'2025-07-01'};
const rows=db=>Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'" ORDER BY rowid').all().map(row=>({...row}))]));

test('Ordinary company edits reject unknown persisted settings atomically without dropping details, changing revisions or weakening the export guard',()=>{
 const temporary=realpathSync(tmpdir()),directory=mkdtempSync(join(temporary,'bookr-profile-preservation-')),store=new CompanyStore({defaultFile:join(directory,'book.sqlite')});
 try{
  const buyer=store.book().createCustomer({name:'Fictional Preserved Profile Buyer'}),sale=store.book().saveVoucher({type:'sale',date:'2026-04-01',customer_id:buyer.id,account_id:2,amount:100000});store.book().saveVoucher({type:'receipt',date:'2026-04-01',customer_id:buyer.id,account_id:1,amount:40000,allocations:[{bill_id:sale.bill.id,amount:40000}]});
  const named=store.create({name:'Fictional Stored Future Settings',...dates}),other=store.create({name:'Fictional Other Preserved Profile',...dates});
  for(const id of ['default',named.id]){
   const original=store.catalog.prepare('SELECT details FROM companies WHERE id=?').get(id).details,unknown=id==='default'?{future_write_policy:false}:{future_currency:{symbol:'FICTIONAL',precision:3}};
   const encoded=JSON.stringify({...JSON.parse(original),...unknown},null,3)+'  \n';store.catalog.prepare('UPDATE companies SET details=? WHERE id=?').run(encoded,id);
  }
  const profiles=store.list(),beforeCatalog=rows(store.catalog),books=Object.fromEntries(profiles.map(profile=>[profile.id,rows(store.book(profile.id).db)])),states=Object.fromEntries(profiles.map(profile=>[profile.id,store.book(profile.id).state()])),files=readdirSync(directory,{recursive:true}).sort();
  for(const id of ['default',named.id]){
   const profile=store.profile(id);assert.throws(()=>store.update(id,{revision:profile.revision,name:'Must Not Replace Stored Future Settings '+id,address:'Must not publish ordinary metadata'}),error=>error.status===400&&/unsupported.*settings/i.test(error.message),'A supported-looking edit must not silently discard an unrecognized persisted setting.');
   assert.equal(store.profile(id).revision,profile.revision);assert.deepEqual(store.list(),profiles);assert.deepEqual(rows(store.catalog),beforeCatalog);for(const candidate of profiles){assert.deepEqual(rows(store.book(candidate.id).db),books[candidate.id]);assert.deepEqual(store.book(candidate.id).state(),states[candidate.id]);}assert.deepEqual(readdirSync(directory,{recursive:true}).sort(),files);assert.equal(store.catalog.isTransaction,false);assert.throws(()=>exportCompanyBundle(store,id),/Unsupported source company settings/);assert.deepEqual(rows(store.catalog),beforeCatalog);
  }
  assert.equal(store.profile(other.id).revision,1);assert.equal(store.book().outstanding()[0].pending,60000);
 }finally{store.close();const target=realpathSync(directory),part=relative(temporary,target);assert.ok(part&&!part.startsWith('..')&&!isAbsolute(part));rmSync(target,{recursive:true,force:true});}
});
