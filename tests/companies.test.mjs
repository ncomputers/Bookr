import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,renameSync,writeFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,relative,sep,basename,dirname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Book,BookError} from '../lib/accounting.mjs';

const loadStore=async()=>(await import('../lib/companies.mjs')).CompanyStore;
const fixture=()=>{
 const directory=mkdtempSync(join(tmpdir(),'bookr-companies-')),defaultFile=join(directory,'book.sqlite'),book=new Book(defaultFile);
 try{const customer=book.createCustomer({name:'Preserved Default Customer Fictional'}),sale=book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:100000,bill:{reference:'PRESERVE-DEFAULT'}});book.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1,amount:40000,allocations:[{bill_id:sale.bill.id,amount:40000}]});return {directory,defaultFile,state:book.state()};}finally{book.close();}
};
function cleanup(directory){assert.ok(resolve(directory).startsWith(resolve(tmpdir())+sep));assert.ok(basename(directory).startsWith('bookr-companies-'));rmSync(directory,{recursive:true,force:true});}
const databaseFile=book=>book.db.prepare('PRAGMA database_list').all().find(row=>row.name==='main').file;
const isId=id=>/^[a-f0-9]{32}$/.test(id);
const profile=(name,patch={})=>({name,...patch});
const dated={financial_year_from:'2026-04-01',books_from:'2026-04-01',financial_year_to:'2027-03-31'};
const under=(directory,path)=>{const part=relative(resolve(directory),resolve(path));return part!==''&&!part.startsWith('..')&&!part.startsWith(sep);};

test('CompanyStore registers the populated existing database as default without changing accounting state or public Book shape',async()=>{
 const CompanyStore=await loadStore(),f=fixture();let store;
 try{
  store=new CompanyStore({defaultFile:f.defaultFile});const companies=store.list();assert.ok(Array.isArray(companies));assert.equal(companies.filter(row=>row.id==='default').length,1);assert.equal(store.profile('default').id,'default');assert.equal(resolve(databaseFile(store.book())),resolve(f.defaultFile));assert.equal(store.book(),store.book('default'));assert.deepEqual(store.book().state(),f.state);assert.equal(store.book().state().company,'Bookr Demo Fictional');assert.equal(store.book().outstanding()[0].pending,60000);
  store.close();store=new CompanyStore({defaultFile:f.defaultFile});assert.deepEqual(store.book('default').state(),f.state);assert.equal(store.list().length,1);
 }finally{store?.close();cleanup(f.directory);}
});

test('new company metadata, generated32hex IDs, own SQLite and company-specific bank defaults persist',async()=>{
 const CompanyStore=await loadStore(),f=fixture();let store;
 try{
  store=new CompanyStore({defaultFile:f.defaultFile});const created=store.create(profile('  Fictional North Trading  ',{mailing_name:' Fictional North Mailing ',address:'17 Fictional Road\nUnit 2',state:'Maharashtra',country:'India',pincode:'000001',...dated}));assert.ok(isId(created.id));assert.notEqual(created.id,'default');assert.equal(created.name,'Fictional North Trading');assert.equal(created.mailing_name,'Fictional North Mailing');assert.equal(created.address,'17 Fictional Road\nUnit 2');for(const [key,value]of Object.entries(dated))assert.equal(created[key],value);assert.equal(created.state,'Maharashtra');assert.equal(created.country,'India');assert.equal(created.pincode,'000001');assert.deepEqual(store.profile(created.id),created);
  const book=store.book(created.id),file=resolve(databaseFile(book));assert.notEqual(file,resolve(f.defaultFile));assert.ok(under(join(f.directory,'book.companies'),file));assert.equal(file.includes(created.name),false);assert.equal(book.state().company,created.name);assert.equal(book.state().vouchers.length,0);assert.equal(book.state().ledgers.find(row=>row.id===1).kind,'cash');assert.equal(book.state().ledgers.find(row=>row.id===2).kind,'sales');assert.equal(book.saveBank({name:'Fictional North Company Bank'}).bank.account_holder,created.name);assert.deepEqual(store.book().state(),f.state);
  const saved=book.state(),savedProfile=store.profile(created.id);store.close();store=new CompanyStore({defaultFile:f.defaultFile});assert.deepEqual(store.profile(created.id),savedProfile);assert.deepEqual(store.book(created.id).state(),saved);assert.equal(resolve(databaseFile(store.book(created.id))),file);assert.deepEqual(store.book().state(),f.state);
 }finally{store?.close();cleanup(f.directory);}
});

test('different companies can reuse ledger IDs, voucher IDs and numbering without leaking postings, bills or balances',async()=>{
 const CompanyStore=await loadStore(),f=fixture();let store;
 try{
  store=new CompanyStore({defaultFile:f.defaultFile});const a=store.create(profile('Company A Fictional')),b=store.create(profile('Company B Fictional')),first=store.book(a.id),second=store.book(b.id);assert.notEqual(first,second);assert.notEqual(databaseFile(first),databaseFile(second));assert.equal(a.mailing_name,a.name);for(const [key,value]of Object.entries(dated))assert.equal(a[key],value);
  const customerA=first.createCustomer({name:'Shared Customer Fictional'}),customerB=second.createCustomer({name:'Shared Customer Fictional'});assert.equal(customerA.id,customerB.id);
  const saleA=first.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customerA.id,account_id:2,amount:100000,bill:{reference:'SAME-REF'}}),saleB=second.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customerB.id,account_id:2,amount:200000,bill:{reference:'SAME-REF'}});assert.equal(saleA.id,saleB.id);assert.equal(saleA.number,1);assert.equal(saleB.number,1);
  first.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:customerA.id,account_id:1,amount:40000,allocations:[{bill_id:saleA.bill.id,amount:40000}]});second.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:customerB.id,account_id:1,amount:50000,allocations:[{bill_id:saleB.bill.id,amount:50000}]});
  assert.equal(first.outstanding()[0].pending,60000);assert.equal(second.outstanding()[0].pending,150000);assert.equal(first.statement(1).balance,40000);assert.equal(second.statement(1).balance,50000);assert.equal(first.financialReports().profitAndLoss.netProfit,100000);assert.equal(second.financialReports().profitAndLoss.netProfit,200000);assert.equal(first.trialBalance().totals.balanced,true);assert.equal(second.trialBalance().totals.balanced,true);assert.deepEqual(store.book().state(),f.state);
  const savedA=first.state(),savedB=second.state();store.close();store=new CompanyStore({defaultFile:f.defaultFile});assert.deepEqual(store.book(a.id).state(),savedA);assert.deepEqual(store.book(b.id).state(),savedB);assert.deepEqual(store.book().state(),f.state);assert.equal(store.list().length,3);
 }finally{store?.close();cleanup(f.directory);}
});

test('company IDs are explicit and malformed, empty, unknown or path-like selectors never fall back or create files',async()=>{
 const CompanyStore=await loadStore(),f=fixture();let store;
 try{
  store=new CompanyStore({defaultFile:f.defaultFile});const created=store.create(profile('ID Validation Fictional')),before=store.list(),files=readdirSync(f.directory).sort();
  for(const id of ['',null,7,{},[], '../book.sqlite','..\\book.sqlite','C:\\Users\\arbitrary.sqlite','DEFAULT','bad-id'])for(const method of ['profile','book']){assert.throws(()=>store[method](id),error=>error instanceof BookError&&error.status===400,String(id));assert.deepEqual(store.list(),before);assert.deepEqual(store.book().state(),f.state);}
  for(const method of ['profile','book'])assert.throws(()=>store[method]('f'.repeat(32)),error=>error instanceof BookError&&error.status===404);assert.deepEqual(readdirSync(f.directory).sort(),files);assert.equal(store.profile(created.id).name,'ID Validation Fictional');
 }finally{store?.close();cleanup(f.directory);}
});

test('company creation validation and case-insensitive duplicate names cannot mutate existing companies or the default book',async()=>{
 const CompanyStore=await loadStore(),f=fixture();let store;
 try{
  store=new CompanyStore({defaultFile:f.defaultFile});store.create(profile('Duplicate Company Fictional'));const before=store.list(),bookBefore=store.book().state();
  const invalid=[null,[],42,'Company',{},profile(''),profile('   '),profile(5),profile('x'.repeat(10000)),profile(' duplicate company fictional '),profile('Another Fictional',{mailing_name:{}}),profile('Another Fictional',{address:[]}),profile('Another Fictional',{state:1}),profile('Another Fictional',{country:{}}),profile('Another Fictional',{pincode:99}),profile('Another Fictional',{id:'default'}),profile('Another Fictional',{data_path:'../book.sqlite'}),profile('Another Fictional',{currency:'USD'})];
  for(const value of invalid){assert.throws(()=>store.create(value),BookError,JSON.stringify(value));assert.deepEqual(store.list(),before);assert.deepEqual(store.book().state(),bookBefore);}assert.deepEqual(bookBefore,f.state);
 }finally{store?.close();cleanup(f.directory);}
});

test('unsupported financial year and books dates reject rather than storing metadata inconsistent with the accounting engine',async()=>{
 const CompanyStore=await loadStore(),f=fixture();let store;
 try{
  store=new CompanyStore({defaultFile:f.defaultFile});const before=store.list();for(const patch of [{financial_year_from:'2025-04-01'},{financial_year_from:'2026-01-01'},{books_from:'2026-04-02'},{books_from:'2026-03-31'},{financial_year_to:'2027-12-31'},{financial_year_to:'2026-03-31'},{books_from:null},{financial_year_from:'1-Apr-2026'}]){assert.throws(()=>store.create(profile('Unsupported Date Fictional',patch)),BookError);assert.deepEqual(store.list(),before);assert.deepEqual(store.book().state(),f.state);}
  const valid=store.create(profile('Supported Dates Fictional',dated));for(const [key,value]of Object.entries(dated))assert.equal(valid[key],value);
 }finally{store?.close();cleanup(f.directory);}
});

test('a missing nondefault SQLite file fails without silently creating an empty replacement company',async()=>{
 const CompanyStore=await loadStore(),f=fixture();let store,moved,missingFile;
 try{
  store=new CompanyStore({defaultFile:f.defaultFile});const a=store.create(profile('Missing Book Fictional')),b=store.create(profile('Healthy Book Fictional'));missingFile=resolve(databaseFile(store.book(a.id)));moved=missingFile+'.owned-test-missing';assert.ok(under(f.directory,missingFile));assert.ok(under(f.directory,moved));store.close();store=null;renameSync(missingFile,moved);
  store=new CompanyStore({defaultFile:f.defaultFile});assert.throws(()=>store.book(a.id),error=>error instanceof BookError&&error.status>=400);assert.equal(existsSync(missingFile),false);assert.equal(store.profile(a.id).name,'Missing Book Fictional');assert.equal(store.book(b.id).state().company,b.name);assert.deepEqual(store.book().state(),f.state);
 }finally{store?.close();if(moved&&existsSync(moved)){assert.ok(under(f.directory,moved));assert.ok(under(f.directory,missingFile));renameSync(moved,missingFile);}cleanup(f.directory);}
});

test('book-storage initialization failure publishes no company and preserves existing catalog and default accounting data',async()=>{
 const CompanyStore=await loadStore(),f=fixture();let store,attempt,managed,backup,blocked=false;
 try{
  store=new CompanyStore({defaultFile:f.defaultFile});const created=store.create(profile('Before Failure Fictional'));store.book(created.id);const before=store.list();managed=join(f.directory,'book.companies');backup=join(f.directory,'book.companies.owned-test-backup');assert.ok(under(f.directory,managed));assert.ok(under(f.directory,backup));store.close();store=null;renameSync(managed,backup);writeFileSync(managed,'Owned test blocker: this is a file, not a company-book directory.');blocked=true;
  assert.throws(()=>{attempt=new CompanyStore({defaultFile:f.defaultFile});attempt.create(profile('Must Not Publish Fictional'));});attempt?.close();attempt=null;rmSync(managed);renameSync(backup,managed);blocked=false;
  store=new CompanyStore({defaultFile:f.defaultFile});assert.deepEqual(store.list(),before);assert.equal(store.list().some(row=>row.name==='Must Not Publish Fictional'),false);assert.deepEqual(store.book().state(),f.state);assert.equal(store.book(created.id).state().company,created.name);
 }finally{attempt?.close();store?.close();if(blocked){assert.ok(under(f.directory,managed));assert.ok(under(f.directory,backup));if(existsSync(managed))rmSync(managed);if(existsSync(backup))renameSync(backup,managed);}cleanup(f.directory);}
});

test('different default-file basenames create separate company catalogs and namespaces in the same workspace',async()=>{
 const CompanyStore=await loadStore(),f=fixture();let first,second;
 try{
  const previewFile=join(f.directory,'review-preview.sqlite');first=new CompanyStore({defaultFile:f.defaultFile});second=new CompanyStore({defaultFile:previewFile});const a=first.create(profile('Book Namespace Fictional')),b=second.create(profile('Review Namespace Fictional'));
  assert.ok(existsSync(join(f.directory,'book.companies.sqlite')));assert.ok(existsSync(join(f.directory,'review-preview.companies.sqlite')));assert.ok(under(join(f.directory,'book.companies'),databaseFile(first.book(a.id))));assert.ok(under(join(f.directory,'review-preview.companies'),databaseFile(second.book(b.id))));assert.equal(first.list().some(row=>row.id===b.id),false);assert.equal(second.list().some(row=>row.id===a.id),false);assert.throws(()=>first.book(b.id),error=>error instanceof BookError&&error.status===404);assert.throws(()=>second.book(a.id),error=>error instanceof BookError&&error.status===404);assert.deepEqual(first.book().state(),f.state);assert.equal(second.book().state().vouchers.length,0);
 }finally{first?.close();second?.close();cleanup(f.directory);}
});

test('one company catalog cannot silently rebind its default to a different same-stem database file',async()=>{
 const CompanyStore=await loadStore(),f=fixture();let store,other;
 try{
  const otherFile=join(f.directory,'book.db'),otherBook=new Book(otherFile);let otherState;
  try{otherBook.createCustomer({name:'Different Default Book Fictional'});otherState=otherBook.state();}finally{otherBook.close();}
  store=new CompanyStore({defaultFile:f.defaultFile});const created=store.create(profile('Original Default Namespace Fictional')),before=store.list();store.close();store=null;
  assert.throws(()=>{other=new CompanyStore({defaultFile:otherFile});},error=>error instanceof BookError&&error.status>=400,'A shared stem must not associate another default database with an existing catalog.');other?.close();other=null;
  store=new CompanyStore({defaultFile:f.defaultFile});assert.deepEqual(store.list(),before);assert.equal(store.profile(created.id).name,created.name);assert.deepEqual(store.book().state(),f.state);const checkOther=new Book(otherFile);try{assert.deepEqual(checkOther.state(),otherState);}finally{checkOther.close();}
 }finally{other?.close();store?.close();cleanup(f.directory);}
});

test('late catalog insertion failure rolls back publication and removes only the newly initialized company book files',async()=>{
 const CompanyStore=await loadStore(),f=fixture();let store;
 try{
  store=new CompanyStore({defaultFile:f.defaultFile});const existing=store.create(profile('Existing Cleanup Company Fictional')),existingState=store.book(existing.id).state(),before=store.list(),managed=join(f.directory,'book.companies'),beforeFiles=readdirSync(managed).sort();
  let catalog=new DatabaseSync(join(f.directory,'book.companies.sqlite'));try{catalog.exec("CREATE TRIGGER company_insert_failure BEFORE INSERT ON companies WHEN NEW.id<>'default' BEGIN SELECT RAISE(ABORT,'simulated company catalog insertion failure'); END;");}finally{catalog.close();}
  assert.throws(()=>store.create(profile('Must Not Publish After Book Init Fictional')),/simulated company catalog insertion failure/);assert.deepEqual(store.list(),before);assert.deepEqual(readdirSync(managed).sort(),beforeFiles);assert.deepEqual(store.book(existing.id).state(),existingState);assert.deepEqual(store.book().state(),f.state);
  catalog=new DatabaseSync(join(f.directory,'book.companies.sqlite'));try{catalog.exec('DROP TRIGGER company_insert_failure');}finally{catalog.close();}const recovered=store.create(profile('Successful Company After Failure Fictional'));assert.equal(store.book(recovered.id).state().company,recovered.name);assert.equal(store.list().length,before.length+1);
 }finally{store?.close();cleanup(f.directory);}
});

test('new companies enforce inclusive fixed books dates across all voucher paths while legacy books retain their earlier date behavior',async()=>{
 const CompanyStore=await loadStore(),f=fixture();let store;
 try{
  store=new CompanyStore({defaultFile:f.defaultFile});const company=store.create(profile('Fixed Working Period Fictional')),book=store.book(company.id),customer=book.createCustomer({name:'Period Customer Fictional'}),supplier=book.saveSupplier({name:'Period Supplier Fictional'}),expense=book.saveLedger({kind:'expense',name:'Period Expense Fictional'}),bank=book.saveBank({name:'Period Bank Fictional'}),purchaseAccount=book.ledgers().find(row=>row.kind==='purchase');
  const sale=book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:200000}),purchase=book.saveVoucher({type:'purchase',date:'2026-04-01',supplier_id:supplier.id,account_id:purchaseAccount.id,amount:200000});
  const inputs=[{type:'sale',customer_id:1,account_id:2,amount:100},{type:'sale',customer_id:customer.id,account_id:2,amount:100},{type:'purchase',supplier_id:supplier.id,account_id:purchaseAccount.id,amount:100},{type:'receipt',customer_id:customer.id,account_id:1,amount:100,allocations:[{bill_id:sale.bill.id,amount:100}]},{type:'payment',supplier_id:supplier.id,account_id:1,amount:100,allocations:[{bill_id:purchase.bill.id,amount:100}]},{type:'contra',source_id:1,destination_id:bank.id,amount:100,details:{bank:{account_id:bank.id,transaction_type:'Cash',amount:100,instrument_number:'',instrument_date:'2026-04-01',bank_name:'Not Applicable',cheque_range:''}}},{type:'journal',debit_ledger_id:expense.id,credit_ledger_id:supplier.id,debit_amount:100,credit_amount:100,bill:{reference:'PERIOD-JOURNAL'}}];
  for(const input of inputs){for(const date of ['2026-03-31','2027-04-01']){const before=book.state();assert.throws(()=>book.saveVoucher({...input,date}),error=>error instanceof BookError&&/date|books|period/i.test(error.message),input.type+' must reject '+date);assert.deepEqual(book.state(),before);}let saved;for(const date of ['2026-04-01','2027-03-31']){saved=book.saveVoucher({...input,date});assert.equal(saved.date,date);}for(const date of ['2026-03-31','2027-04-01']){const before=book.state();assert.throws(()=>book.saveVoucher({...input,date,revision:saved.revision},saved.id),error=>error instanceof BookError&&/date|books|period/i.test(error.message),input.type+' edit must reject '+date);assert.deepEqual(book.state(),before);}}
  const saved=book.state();store.close();store=new CompanyStore({defaultFile:f.defaultFile});assert.deepEqual(store.book(company.id).state(),saved);for(const date of ['2026-03-31','2027-04-01']){const before=store.book(company.id).state();assert.throws(()=>store.book(company.id).saveVoucher({type:'sale',date,customer_id:1,account_id:2,amount:100}),BookError);assert.deepEqual(store.book(company.id).state(),before);assert.equal(store.book().saveVoucher({type:'sale',date,customer_id:1,account_id:2,amount:100}).date,date);}
  const direct=new Book();try{for(const date of ['2026-03-31','2027-04-01'])assert.equal(direct.saveVoucher({type:'sale',date,customer_id:1,account_id:2,amount:100}).date,date);}finally{direct.close();}
 }finally{store?.close();cleanup(f.directory);}
});
