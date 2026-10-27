import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,relative,isAbsolute} from 'node:path';
import {CompanyStore} from '../lib/companies.mjs';
import {exportCompanyBundle} from '../lib/company-backup.mjs';

const rows=db=>Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'" ORDER BY rowid').all().map(row=>({...row}))]));
function fixture(action){
 const temporary=realpathSync(tmpdir()),directory=mkdtempSync(join(temporary,'bookr-profile-origin-')),store=new CompanyStore({defaultFile:join(directory,'book.sqlite')});
 try{
  const defaultBook=store.book(),buyer=defaultBook.createCustomer({name:'Fictional Origin Buyer'}),sale=defaultBook.saveVoucher({type:'sale',date:'2026-04-01',customer_id:buyer.id,account_id:2,amount:100000});
  defaultBook.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:buyer.id,account_id:1,amount:40000,allocations:[{bill_id:sale.bill.id,amount:40000}]});
  const target=store.create({name:'Fictional Origin Target',financial_year_from:'2025-04-01',books_from:'2025-07-01'}),other=store.create({name:'Fictional Origin Other'}),books=new Map([['default',defaultBook],[target.id,store.book(target.id)],[other.id,store.book(other.id)]]);
  const snapshot=()=>({catalog:rows(store.catalog),books:Object.fromEntries([...books].map(([id,book])=>[id,rows(book.db)])),files:readdirSync(directory,{recursive:true}).sort()});
  const inject=extra=>{const previous=JSON.parse(store.catalog.prepare('SELECT details FROM companies WHERE id=?').get(target.id).details);store.catalog.prepare('UPDATE companies SET details=? WHERE id=?').run(JSON.stringify({...previous,...extra},null,3)+'  \n',target.id);};
  return action({store,target,other,books,snapshot,inject});
 }finally{store.close();const resolved=realpathSync(directory),part=relative(temporary,resolved);assert.ok(part&&!part.startsWith('..')&&!isAbsolute(part));rmSync(resolved,{recursive:true,force:true});}
}
const unsupported=error=>error.status===400&&/unsupported.*(?:stored|company|setting)|(?:stored|company|setting).*unsupported/i.test(error.message);

test('Valid stored metadata retains catalog identity, revision, contact fields and exact accounting rows',()=>fixture(({store,target,other,books,snapshot})=>{
 const before=snapshot(),profile=store.profile(target.id);assert.equal(profile.id,target.id);assert.equal(profile.revision,1);assert.equal(store.list().find(row=>row.id===target.id).name,target.name);
 const saved=store.update(target.id,{revision:1,email:'fictional@example.invalid'});assert.equal(saved.id,target.id);assert.equal(saved.revision,2);assert.equal(saved.email,'fictional@example.invalid');
 assert.equal(store.profile(other.id).id,other.id);assert.equal(store.profile(other.id).revision,1);assert.deepEqual(snapshot().books,before.books);assert.equal(books.get('default').outstandingReport().totals.pending,60000);
}));

for(const key of ['id','revision']){
 for(const operation of ['profile','list','update','export'])test('Raw details '+key+' is rejected before '+operation+' even when its value matches a trusted column',()=>{
  for(const matches of [false,true])fixture(({store,target,other,books,snapshot,inject})=>{
   const value=key==='id'?(matches?target.id:other.id):(matches?target.revision:999);inject({[key]:value});const before=snapshot(),otherBefore=store.profile(other.id);
   let emitted=false;const act=()=>{
    if(operation==='profile')return store.profile(target.id);
    if(operation==='list')return store.list();
    if(operation==='update')return store.update(target.id,{revision:target.revision,name:'Must Not Drop Raw '+key,address:'Must remain unpublished'});
    const bundle=exportCompanyBundle(store,target.id);emitted=true;return bundle;
   };
   assert.throws(act,unsupported,'Unrecognized raw '+key+' must be detected before composition loses its origin.');
   if(operation==='profile'){
    assert.throws(()=>store.summary(target.id),unsupported);assert.throws(()=>store.book(target.id),unsupported);
   }
   assert.equal(emitted,false);assert.equal(store.catalog.isTransaction,false);assert.deepEqual(snapshot(),before);assert.deepEqual(store.profile(other.id),otherBefore);assert.equal(store.profile(other.id).id,other.id);assert.equal(books.get('default').outstandingReport().totals.pending,60000);
  });
 });
}

test('Unrelated future settings retain readonly representation and existing atomic edit/export rejection',()=>fixture(({store,target,other,books,snapshot,inject})=>{
 inject({future_currency_policy:{symbol:'Fictional',precision:3}});const before=snapshot(),profile=store.profile(target.id);assert.equal(profile.id,target.id);assert.equal(profile.revision,1);assert.deepEqual(profile.future_currency_policy,{symbol:'Fictional',precision:3});assert.deepEqual(store.list().find(row=>row.id===target.id).future_currency_policy,profile.future_currency_policy);
 assert.throws(()=>store.update(target.id,{revision:1,address:'Must not erase unknown policy'}),unsupported);assert.throws(()=>exportCompanyBundle(store,target.id),unsupported);assert.equal(store.catalog.isTransaction,false);assert.deepEqual(snapshot(),before);assert.equal(store.profile(other.id).id,other.id);assert.equal(books.get('default').outstandingReport().totals.pending,60000);
}));
