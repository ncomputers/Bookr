import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,realpathSync} from 'node:fs';
import {join,relative,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {CompanyStore} from '../lib/companies.mjs';
import {BookError} from '../lib/accounting.mjs';

const keys=['telephone','mobile','fax','email','website'];
const contactValues={telephone:'  000 000-0000  ',mobile:'  +91 0000000000  ',fax:'  000/0000  ',email:'  company-study@example.invalid  ',website:'  https://example.invalid  '};
const trimmed=Object.fromEntries(Object.entries(contactValues).map(([key,value])=>[key,value.trim()])),blanks=Object.fromEntries(keys.map(key=>[key,'']));
const contacts=profile=>Object.fromEntries(keys.map(key=>[key,profile[key]]));
function fixture(action){const temporaryRoot=realpathSync(tmpdir()),directory=mkdtempSync(join(temporaryRoot,'bookr-company-contacts-')),defaultFile=join(directory,'book.sqlite');let store=new CompanyStore({defaultFile});try{return action({get store(){return store;},defaultFile,reopen(){store.close();store=new CompanyStore({defaultFile});return store;}});}finally{store.close();const target=realpathSync(directory),part=relative(temporaryRoot,target);assert.ok(part&&!part.startsWith('..')&&!isAbsolute(part));rmSync(target,{recursive:true,force:true});}}
const tables=db=>Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'" ORDER BY rowid').all().map(row=>({...row}))]));
function seed(book){const customer=book.createCustomer({name:'Fictional Company Contacts Customer'}),sale=book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:100000});book.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1,amount:40000,allocations:[{bill_id:sale.bill.id,amount:40000}]});}

test('Company creation preserves contact text including zeros and punctuation while trimming only outer whitespace',()=>fixture(({store})=>{
 const created=store.create({name:'Fictional Contact Creation',...contactValues});assert.deepEqual(contacts(created),trimmed);assert.deepEqual(contacts(store.profile(created.id)),trimmed);assert.deepEqual(contacts(store.list().find(row=>row.id===created.id)),trimmed);assert.equal(created.revision,1);assert.equal(store.book(created.id).state().vouchers.length,0);
 const other=store.create({name:'Fictional Blank Contacts'});assert.deepEqual(contacts(other),blanks);assert.deepEqual(contacts(store.profile()),blanks);
}));

test('Legacy company profiles project blank contacts on read without rewriting details, revision, catalog rows or accounting tables',()=>fixture(({store,reopen})=>{
 const company=store.create({name:'Fictional Legacy Contact Projection'});seed(store.book(company.id));
 const row=store.catalog.prepare('SELECT details,revision FROM companies WHERE id=?').get(company.id),legacy=JSON.parse(row.details);for(const key of keys)delete legacy[key];store.catalog.prepare('UPDATE companies SET details=? WHERE id=?').run(JSON.stringify(legacy),company.id);
 const before=tables(store.catalog),accounting=tables(store.book(company.id).db),revision=store.profile(company.id).revision;
 assert.deepEqual(contacts(store.profile(company.id)),blanks);assert.deepEqual(contacts(store.list().find(profile=>profile.id===company.id)),blanks);assert.equal(store.profile(company.id).revision,revision);assert.deepEqual(tables(store.catalog),before);assert.deepEqual(tables(store.book(company.id).db),accounting);
 const reopened=reopen();assert.deepEqual(contacts(reopened.profile(company.id)),blanks);assert.deepEqual(tables(reopened.catalog),before);assert.deepEqual(tables(reopened.book(company.id).db),accounting);assert.equal(reopened.book(company.id).outstanding()[0].pending,60000);
}));

test('Contact patches preserve omitted values and all accounting rows across default/named companies and support intentional blank clearing',()=>fixture(({store})=>{
 const named=store.create({name:'Fictional Named Contact Patch',...contactValues}),other=store.create({name:'Fictional Untouched Contact Company',telephone:'001'}),otherBefore=store.profile(other.id);seed(store.book());seed(store.book(named.id));
 for(const id of ['default',named.id]){const initial=store.profile(id),before=tables(store.book(id).db),file=store.fileFor(id),saved=store.update(id,{revision:initial.revision,telephone:'  000 111  ',email:'  explicit arbitrary text  '});assert.equal(saved.revision,initial.revision+1);assert.equal(saved.telephone,'000 111');assert.equal(saved.email,'explicit arbitrary text');for(const key of ['mobile','fax','website'])assert.equal(saved[key],initial[key]);assert.equal(saved.id,id);assert.equal(store.fileFor(id),file);assert.deepEqual(tables(store.book(id).db),before);assert.equal(store.book(id).outstanding()[0].pending,60000);
  const cleared=store.update(id,{revision:saved.revision,telephone:'',email:'   '});assert.equal(cleared.telephone,'');assert.equal(cleared.email,'');for(const key of ['mobile','fax','website'])assert.equal(cleared[key],saved[key]);assert.deepEqual(tables(store.book(id).db),before);
 }assert.deepEqual(store.profile(other.id),otherBefore);
}));

test('Contact validation rejects non-text and more than120 characters atomically without inventing phone/email format rules',()=>fixture(({store})=>{
 const created=store.create({name:'Fictional Contact Validation',...trimmed});seed(store.book(created.id));
 for(const key of keys){const maximum='x'.repeat(120),current=store.profile(created.id),accepted=store.update(created.id,{revision:current.revision,[key]:maximum});assert.equal(accepted[key],maximum);
  for(const value of [null,0,123,[],{},'x'.repeat(121)]){const before=tables(store.catalog),accounting=tables(store.book(created.id).db);assert.throws(()=>store.update(created.id,{revision:accepted.revision,[key]:value}),BookError);assert.deepEqual(tables(store.catalog),before);assert.deepEqual(tables(store.book(created.id).db),accounting);assert.equal(store.catalog.isTransaction,false);assert.throws(()=>store.create({name:'Must Not Publish Invalid '+key,[key]:value}),BookError);assert.deepEqual(tables(store.catalog),before);}
 }const before=tables(store.catalog);assert.throws(()=>store.update(created.id,{revision:store.profile(created.id).revision,unknown_contact:'not allowed'}),BookError);assert.deepEqual(tables(store.catalog),before);
}));

test('Contact revisions reject stale concurrent writers and persist independent company profiles across reopen',()=>fixture(({store,defaultFile,reopen})=>{
 const created=store.create({name:'Fictional Contact Revision',...trimmed}),other=store.create({name:'Fictional Contact Revision Other'});seed(store.book(created.id));const second=new CompanyStore({defaultFile});
 try{const stale=second.profile(created.id),book=second.book(created.id),accounting=tables(book.db),saved=store.update(created.id,{revision:created.revision,mobile:'0000000001',fax:'0000000002'});assert.throws(()=>second.update(created.id,{revision:stale.revision,website:'stale value'}),error=>error instanceof BookError&&error.status===409);assert.deepEqual(second.profile(created.id),saved);assert.deepEqual(tables(book.db),accounting);assert.deepEqual(contacts(store.profile(other.id)),blanks);}finally{second.close();}
 const expected=store.list(),before=tables(store.book(created.id).db),reopened=reopen();assert.deepEqual(reopened.list(),expected);assert.deepEqual(contacts(reopened.profile(created.id)),{...trimmed,mobile:'0000000001',fax:'0000000002'});assert.deepEqual(tables(reopened.book(created.id).db),before);
}));

test('A late contact metadata failure rolls back the full profile and revision while leaving money tables untouched',()=>fixture(({store})=>{
 const created=store.create({name:'Fictional Atomic Contacts',...trimmed});seed(store.book(created.id));const before=tables(store.catalog),accounting=tables(store.book(created.id).db);store.catalog.exec("CREATE TRIGGER fail_contact_update AFTER UPDATE ON companies BEGIN SELECT RAISE(ABORT,'fictional late contact write failure'); END;");
 assert.throws(()=>store.update(created.id,{revision:created.revision,address:'must roll back with contacts',mobile:'0000000009',email:'must not persist'}),/fictional late contact write failure/);assert.deepEqual(tables(store.catalog),before);assert.deepEqual(tables(store.book(created.id).db),accounting);assert.deepEqual(store.profile(created.id),created);assert.equal(store.catalog.isTransaction,false);
}));
