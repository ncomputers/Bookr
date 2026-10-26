import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {CompanyStore} from '../lib/companies.mjs';
import {Book,BookError} from '../lib/accounting.mjs';

const dates={financial_year_from:'2026-04-01',books_from:'2026-04-01',financial_year_to:'2027-03-31'};
function fixture(){const directory=mkdtempSync(join(tmpdir(),'bookr-company-alter-')),defaultFile=join(directory,'book.sqlite');return{directory,defaultFile,store:new CompanyStore({defaultFile})};}
function cleanup(f){f.store?.close();const part=relative(resolve(tmpdir()),resolve(f.directory));assert.ok(part&&!part.startsWith('..')&&!isAbsolute(part));assert.ok(f.directory.includes('bookr-company-alter-'));rmSync(f.directory,{recursive:true,force:true});}
const requireUpdate=store=>assert.equal(typeof store.update,'function','CompanyStore.update must support revision-checked identity/mailing edits.');
const profile=name=>({name,mailing_name:name+' Mailing',address:'1 Fictional Original Road',state:'Fictional State',country:'India',pincode:'000101'});
const databaseFile=book=>book.db.prepare('PRAGMA database_list').all().find(row=>row.name==='main').file;
const stateWithoutName=book=>{const {company,...accounting}=book.state();return accounting;};
function tables(db){return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'" ORDER BY rowid').all().map(row=>({...row}))]));}
function paths(directory,prefix=''){return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?paths(join(directory,entry.name),prefix+entry.name+'/'):[prefix+entry.name]).sort();}
function seed(book){
 const customer=book.createCustomer({name:'Company Alter Preserved Customer'}),sale=book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:100000,bill:{reference:'PRESERVED-SALE',terms:{mode:'days',days:7}}});
 book.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1,amount:40000,allocations:[{bill_id:sale.bill.id,amount:40000}]});
 const supplier=book.saveSupplier({name:'Company Alter Preserved Supplier'}),expense=book.saveLedger({kind:'expense',name:'Company Alter Preserved Expense'}),capital=book.saveLedger({kind:'capital',name:'Company Alter Preserved Capital'});
 book.saveVoucher({type:'journal',date:'2026-04-01',debit_ledger_id:expense.id,credit_ledger_id:supplier.id,debit_amount:12500,credit_amount:12500,bill:{reference:'PRESERVED-JOURNAL',terms:{mode:'days',days:3}}});
 book.saveVoucher({type:'journal',date:'2026-04-01',entries:[{ledger_id:capital.id,side:'credit',amount:100000},{ledger_id:1,side:'debit',amount:80000},{ledger_id:expense.id,side:'debit',amount:20000}],narration:'Preserved General Journal'});
 const bank=book.saveBank({name:'Company Alter Existing Bank'});return{customer,sale,supplier,bank};
}

test('Company profile patches preserve every accounting row and identity for named and legacy default books',()=>{
 const f=fixture();try{requireUpdate(f.store);const named=f.store.create(profile('Alter Named Fictional')),other=f.store.create(profile('Alter Untouched Fictional')),otherBefore=f.store.book(other.id).state();
  for(const id of ['default',named.id]){const beforeProfile=f.store.profile(id),book=f.store.book(id),refs=seed(book),file=databaseFile(book),before=tables(book.db),accounting=stateWithoutName(book),reports=book.financialReports(),newName=id==='default'?'Renamed Default Fictional':'Renamed Named Fictional';assert.equal(beforeProfile.revision,1);
   const saved=f.store.update(id,{revision:beforeProfile.revision,name:'  '+newName+'  ',mailing_name:' Updated Fictional Mailing ',address:' Updated Fictional Address\nUnit2 '});assert.equal(saved.id,id);assert.equal(saved.revision,2);assert.equal(saved.name,newName);assert.equal(saved.mailing_name,'Updated Fictional Mailing');assert.equal(saved.address,'Updated Fictional Address\nUnit2');for(const key of ['state','country','pincode',...Object.keys(dates)])assert.equal(saved[key],beforeProfile[key]);
   assert.equal(f.store.book(id),book);assert.equal(databaseFile(book),file);assert.equal(book.state().company,newName);assert.deepEqual(stateWithoutName(book),accounting);assert.deepEqual(tables(book.db),before);assert.deepEqual(book.financialReports(),reports);assert.equal(book.outstanding()[0].pending,60000);assert.equal(book.bank(refs.bank.id).bank.account_holder,beforeProfile.name);assert.equal(book.saveBank({name:'New Bank After '+id}).bank.account_holder,newName);
  }assert.deepEqual(f.store.book(other.id).state(),otherBefore);
 }finally{cleanup(f);}
});

test('partial Company mailing patches preserve omitted fields and persist revision/name/path across multiple reopenings',()=>{
 const f=fixture();try{requireUpdate(f.store);const created=f.store.create(profile('Persistent Profile Fictional')),book=f.store.book(created.id);seed(book);const file=databaseFile(book),before=stateWithoutName(book),saved=f.store.update(created.id,{revision:created.revision,address:'Only the fictional address changed'});assert.equal(saved.revision,2);for(const key of ['name','mailing_name','state','country','pincode',...Object.keys(dates)])assert.equal(saved[key],created[key]);
  f.store.update('default',{revision:f.store.profile().revision,name:'Persistent Renamed Default'});for(let i=0;i<3;i++){f.store.close();f.store=new CompanyStore({defaultFile:f.defaultFile});assert.deepEqual(f.store.profile(created.id),saved);assert.equal(f.store.list().find(row=>row.id===created.id).revision,2);assert.equal(databaseFile(f.store.book(created.id)),file);assert.deepEqual(stateWithoutName(f.store.book(created.id)),before);assert.equal(f.store.book().state().company,'Persistent Renamed Default');}
 }finally{cleanup(f);}
});

test('Company update rejects invalid identity, stale/missing revision, unknown fields and date changes atomically',()=>{
 const f=fixture();try{requireUpdate(f.store);const created=f.store.create(profile('Validation Profile Fictional'));seed(f.store.book(created.id));const invalid=[null,[],{}, {address:'Missing revision'}, {revision:'1',address:'Bad revision'}, {revision:0,address:'Bad revision'}, {revision:1,name:''}, {revision:1,name:' '.repeat(3)}, {revision:1,name:'x'.repeat(121)}, {revision:1,mailing_name:5}, {revision:1,address:'x'.repeat(1001)}, {revision:1,country:[]}, {revision:1,pincode:'x'.repeat(21)}, {revision:1,id:'default'}, {revision:1,defaultFile:'../../must-not-create.sqlite'}, {revision:1,books_from:'2026-04-02'}, {revision:1,financial_year_from:'2025-04-01'}, {revision:1,financial_year_to:'2028-03-31'}, {revision:1,security:{password:'fictional'}}, {revision:1,currency:'USD'}];
  for(const patch of invalid){const catalog=tables(f.store.catalog),accounting=tables(f.store.book(created.id).db),profileBefore=f.store.profile(created.id),files=paths(f.directory);assert.throws(()=>f.store.update(created.id,patch),BookError,JSON.stringify(patch));assert.deepEqual(f.store.profile(created.id),profileBefore);assert.deepEqual(tables(f.store.catalog),catalog);assert.deepEqual(tables(f.store.book(created.id).db),accounting);assert.deepEqual(paths(f.directory),files);assert.equal(f.store.catalog.isTransaction,false);}
 }finally{cleanup(f);}
});

test('case-insensitive duplicate names and stale writers reject with409 while own-name case changes remain valid',()=>{
 const f=fixture();let second;try{requireUpdate(f.store);const a=f.store.create(profile('Company Alpha Fictional')),b=f.store.create(profile('Company Beta Fictional'));second=new CompanyStore({defaultFile:f.defaultFile});
  const before=tables(f.store.catalog);assert.throws(()=>f.store.update(a.id,{revision:a.revision,name:'  company beta fictional '}),error=>error instanceof BookError&&error.status===409);assert.deepEqual(tables(f.store.catalog),before);
  const saved=f.store.update(a.id,{revision:a.revision,name:'COMPANY ALPHA FICTIONAL'});assert.equal(saved.revision,2);const stable=tables(f.store.catalog);assert.throws(()=>second.update(a.id,{revision:a.revision,address:'Stale must not persist'}),error=>error instanceof BookError&&error.status===409);assert.deepEqual(tables(f.store.catalog),stable);assert.deepEqual(second.profile(a.id),saved);assert.equal(f.store.profile(b.id).revision,1);
 }finally{second?.close();cleanup(f);}
});

test('a second long-lived CompanyStore refreshes cached Book name and new bank defaults without rewriting existing holders',()=>{
 const f=fixture();let second;try{requireUpdate(f.store);const company=f.store.create(profile('Cross Process Original Fictional'));seed(f.store.book(company.id));second=new CompanyStore({defaultFile:f.defaultFile});const cached=second.book(company.id),oldBank=cached.ledgers().find(row=>row.kind==='bank'),rows=tables(cached.db);
  const updated=f.store.update(company.id,{revision:company.revision,name:'Cross Process Updated Fictional',address:'Updated elsewhere'});assert.deepEqual(second.profile(company.id),updated);assert.equal(second.book(company.id),cached);assert.equal(cached.state().company,updated.name);assert.deepEqual(tables(cached.db),rows);assert.equal(cached.bank(oldBank.id).bank.account_holder,company.name);assert.equal(cached.saveBank({name:'New Bank Other Cached Store'}).bank.account_holder,updated.name);
  const defaultCached=second.book(),oldDefault=f.store.profile(),renamedDefault=f.store.update('default',{revision:oldDefault.revision,name:'Default Changed In Other Store'});assert.equal(second.book(),defaultCached);assert.equal(defaultCached.state().company,renamedDefault.name);assert.equal(defaultCached.saveBank({name:'New Default Cached Bank'}).bank.account_holder,renamedDefault.name);
 }finally{second?.close();cleanup(f);}
});

test('late catalog failure restores profile revision and cached Book identity without touching books or creating paths',()=>{
 const f=fixture();try{requireUpdate(f.store);const created=f.store.create(profile('Atomic Profile Fictional')),cached=f.store.book(created.id);seed(cached);const before=tables(f.store.catalog),rows=tables(cached.db),files=paths(f.directory);f.store.catalog.exec("CREATE TRIGGER fail_company_profile_update AFTER UPDATE ON companies BEGIN SELECT RAISE(ABORT,'simulated late Company metadata failure'); END;");
  assert.throws(()=>f.store.update(created.id,{revision:created.revision,name:'Must Not Leak Failed Name',address:'Must Not Persist'}),/simulated late Company metadata failure/);assert.deepEqual(tables(f.store.catalog),before);assert.deepEqual(tables(cached.db),rows);assert.equal(cached.state().company,created.name);assert.equal(f.store.book(created.id),cached);assert.deepEqual(paths(f.directory),files);assert.equal(f.store.catalog.isTransaction,false);f.store.catalog.exec('DROP TRIGGER fail_company_profile_update');const saved=f.store.update(created.id,{revision:created.revision,address:'Valid after rollback'});assert.equal(saved.revision,2);
 }finally{cleanup(f);}
});

test('invalid and unknown Company IDs never select default or create another book during profile update',()=>{
 const f=fixture();try{requireUpdate(f.store);const created=f.store.create(profile('ID Guard Profile Fictional')),before=tables(f.store.catalog),defaultRows=tables(f.store.book().db),files=paths(f.directory);for(const id of ['',null,undefined,'../default','DEFAULT','__proto__','a'.repeat(32)]){assert.throws(()=>f.store.update(id,{revision:1,address:'Must Not Apply'}),error=>error instanceof BookError&&[400,404].includes(error.status));assert.deepEqual(tables(f.store.catalog),before);assert.deepEqual(tables(f.store.book().db),defaultRows);assert.deepEqual(paths(f.directory),files);}assert.equal(f.store.profile(created.id).revision,1);
 }finally{cleanup(f);}
});

test('legacy catalog profiles gain revision1 safely and Company edits preserve fixed-period and legacy-date behavior',()=>{
 const directory=mkdtempSync(join(tmpdir(),'bookr-company-alter-')),defaultFile=join(directory,'book.sqlite'),legacy=new Book(defaultFile);legacy.saveVoucher({type:'sale',date:'2026-03-31',customer_id:1,account_id:2,amount:1000});const legacyState=stateWithoutName(legacy);legacy.close();const catalog=new DatabaseSync(join(directory,'book.companies.sqlite'));catalog.exec('CREATE TABLE companies(id TEXT PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE,details TEXT NOT NULL)');const old={...profile('Legacy Catalog Original Fictional'),...dates};catalog.prepare('INSERT INTO companies(id,name,details) VALUES(?,?,?)').run('default',old.name,JSON.stringify(old));catalog.close();const f={directory,defaultFile,store:new CompanyStore({defaultFile})};
 try{requireUpdate(f.store);assert.equal(f.store.profile().revision,1);assert.deepEqual(stateWithoutName(f.store.book()),legacyState);const named=f.store.create(profile('Date Bound Metadata Fictional')),saved=f.store.update(named.id,{revision:named.revision,name:'Date Bound Renamed Fictional'});for(const [key,value]of Object.entries(dates))assert.equal(saved[key],value);for(const date of ['2026-03-31','2027-04-01'])assert.throws(()=>f.store.book(named.id).saveVoucher({type:'sale',date,customer_id:1,account_id:2,amount:1000}),error=>error instanceof BookError&&/period/i.test(error.message));assert.equal(f.store.book().saveVoucher({type:'sale',date:'2026-03-31',customer_id:1,account_id:2,amount:1000}).date,'2026-03-31');const updated=f.store.update('default',{revision:1,address:'Legacy profile mail only'});assert.equal(updated.revision,2);f.store.close();f.store=new CompanyStore({defaultFile});assert.deepEqual(f.store.profile(),updated);assert.equal(f.store.book(named.id).state().company,saved.name);
 }finally{cleanup(f);}
});
