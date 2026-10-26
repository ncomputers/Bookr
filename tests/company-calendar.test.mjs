import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,realpathSync,readdirSync} from 'node:fs';
import {join,relative,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {CompanyStore} from '../lib/companies.mjs';
import {BookError} from '../lib/accounting.mjs';
import {normalizeCompanyCalendar} from '../lib/company-calendar.mjs';

const legacyDates={financial_year_from:'2026-04-01',books_from:'2026-04-01',financial_year_to:'2027-03-31'};
const dates=profile=>Object.fromEntries(Object.keys(legacyDates).map(key=>[key,profile[key]]));
const tables=db=>Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'" ORDER BY rowid').all().map(row=>({...row}))]));
const paths=(directory,prefix='')=>readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?paths(join(directory,entry.name),prefix+entry.name+'/'):[prefix+entry.name]).sort();
function fixture(action){const temporaryRoot=realpathSync(tmpdir()),directory=mkdtempSync(join(temporaryRoot,'bookr-calendar-')),defaultFile=join(directory,'book.sqlite');let store=new CompanyStore({defaultFile});try{return action({get store(){return store;},directory,defaultFile,reopen(){store.close();store=new CompanyStore({defaultFile});return store;}});}finally{store.close();const target=realpathSync(directory),part=relative(temporaryRoot,target);assert.ok(part&&!part.startsWith('..')&&!isAbsolute(part));rmSync(target,{recursive:true,force:true});}}
function seed(book){const customer=book.createCustomer({name:'Fictional Calendar Preserved Customer'}),sale=book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:100000});book.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1,amount:40000,allocations:[{bill_id:sale.bill.id,amount:40000}]});}

test('A new company can save the observed FY2025 and July books dates without changing the existing default book',()=>fixture(({store})=>{
 seed(store.book());const before=tables(store.book().db),defaultProfile=store.profile();
 const created=store.create({name:'Fictional Calendar July2025',financial_year_from:'2025-04-01',books_from:'2025-07-01',telephone:'0000000000'});
 assert.deepEqual(dates(created),{financial_year_from:'2025-04-01',books_from:'2025-07-01',financial_year_to:'2026-03-31'});assert.equal(created.revision,1);assert.equal(created.telephone,'0000000000');assert.deepEqual(store.profile(created.id),created);assert.deepEqual(store.list().find(profile=>profile.id===created.id),created);
 const book=store.book(created.id);assert.equal(book.state().company,created.name);assert.equal(book.state().vouchers.length,0);assert.deepEqual(book.companyPeriod,{from:'2025-07-01',to:'2026-03-31'});
 assert.deepEqual(store.profile(),defaultProfile);assert.deepEqual(tables(store.book().db),before);assert.equal(store.book().outstanding()[0].pending,60000);
}));

test('Omitted books beginning defaults to the supplied FY start and a matching derived end remains accepted for API compatibility',()=>fixture(({store})=>{
 const april=store.create({name:'Fictional Calendar Default Books',financial_year_from:'2025-04-01'});assert.deepEqual(dates(april),{financial_year_from:'2025-04-01',books_from:'2025-04-01',financial_year_to:'2026-03-31'});
 const january=store.create({name:'Fictional Calendar January',financial_year_from:'2024-01-01',financial_year_to:'2024-12-31'});assert.deepEqual(dates(january),{financial_year_from:'2024-01-01',books_from:'2024-01-01',financial_year_to:'2024-12-31'});
 const unchanged=store.create({name:'Fictional Legacy Default Calendar'});assert.deepEqual(dates(unchanged),legacyDates);
}));

test('Malformed calendar fields, unknown keys and a supplied mismatching derived end reject without publishing files or changing existing rows',()=>fixture(({store,directory})=>{
 store.create({name:'Fictional Valid Calendar Before Invalid',financial_year_from:'2025-04-01',books_from:'2025-07-01'});seed(store.book());
 for(const patch of [{financial_year_from:null},{financial_year_from:''},{financial_year_from:2025},{financial_year_from:'1-Apr-2025'},{financial_year_from:'2025-02-29'},{books_from:null},{books_from:[]},{books_from:'2025-04-31'},{financial_year_to:'2027-03-31'},{financial_year_to:123},{calendar_override:true}]){
  const before=tables(store.catalog),money=tables(store.book().db),files=paths(directory);assert.throws(()=>store.create({name:'Must Not Publish Invalid Calendar',financial_year_from:'2025-04-01',books_from:'2025-07-01',...patch}),error=>error instanceof BookError&&error.status===400);assert.deepEqual(tables(store.catalog),before);assert.deepEqual(tables(store.book().db),money);assert.deepEqual(paths(directory),files);assert.equal(store.catalog.isTransaction,false);
 }
}));

test('Identity and contact patches preserve a custom calendar while date alteration remains immutable in this creation-only increment',()=>fixture(({store})=>{
 const created=store.create({name:'Fictional Calendar Immutable Dates',financial_year_from:'2025-04-01',books_from:'2025-07-01',mobile:'0000000000'}),book=store.book(created.id),money=tables(book.db);
 const updated=store.update(created.id,{revision:created.revision,name:'Fictional Calendar Contact Updated',email:'calendar@example.invalid'});assert.deepEqual(dates(updated),dates(created));assert.equal(updated.revision,2);assert.equal(updated.mobile,'0000000000');
 const same=store.update(created.id,{revision:updated.revision,...dates(updated),address:'Same-date compatible full profile update'});assert.deepEqual(dates(same),dates(created));
 for(const patch of [{financial_year_from:'2024-04-01'},{books_from:'2025-08-01'},{financial_year_to:'2027-03-31'}]){const before=tables(store.catalog);assert.throws(()=>store.update(created.id,{revision:same.revision,...patch}),error=>error instanceof BookError&&error.status===400);assert.deepEqual(tables(store.catalog),before);assert.deepEqual(tables(book.db),money);}
 const before=tables(store.catalog);assert.throws(()=>store.update(created.id,{revision:created.revision,address:'Stale calendar profile'}),error=>error instanceof BookError&&error.status===409);assert.deepEqual(tables(store.catalog),before);
}));

test('Existing catalog dates, revisions and accounting rows do not change when custom profiles are read or storage reopens',()=>fixture(({store,reopen})=>{
 seed(store.book());const legacy=store.create({name:'Fictional Existing Calendar2026'});store.book(legacy.id).saveVoucher({type:'sale',date:'2026-04-01',customer_id:1,account_id:2,amount:2500});
 const custom=store.create({name:'Fictional Calendar Read Preservation',financial_year_from:'2025-04-01',books_from:'2025-07-01'}),expected=store.list(),catalog=tables(store.catalog),defaultRows=tables(store.book().db),legacyRows=tables(store.book(legacy.id).db),customRows=tables(store.book(custom.id).db);
 for(let index=0;index<3;index++){const reopened=reopen();assert.deepEqual(reopened.list(),expected);assert.deepEqual(tables(reopened.catalog),catalog);assert.deepEqual(tables(reopened.book().db),defaultRows);assert.deepEqual(tables(reopened.book(legacy.id).db),legacyRows);assert.deepEqual(tables(reopened.book(custom.id).db),customRows);assert.deepEqual(dates(reopened.profile(legacy.id)),legacyDates);assert.deepEqual(reopened.book(custom.id).companyPeriod,{from:'2025-07-01',to:'2026-03-31'});}
}));

test('Two long-lived stores retain separate custom calendars and existing default date behavior without cross-company changes',()=>fixture(({store,defaultFile})=>{
 const alpha=store.create({name:'Fictional Calendar Alpha',financial_year_from:'2025-04-01',books_from:'2025-07-01'}),beta=store.create({name:'Fictional Calendar Beta',financial_year_from:'2024-01-01',books_from:'2024-02-01'}),second=new CompanyStore({defaultFile});
 try{assert.deepEqual(second.book(alpha.id).companyPeriod,{from:'2025-07-01',to:'2026-03-31'});assert.deepEqual(second.book(beta.id).companyPeriod,{from:'2024-02-01',to:'2024-12-31'});assert.equal(second.book().companyPeriod,null);const beforeBeta=second.profile(beta.id),updated=store.update(alpha.id,{revision:alpha.revision,website:'https://example.invalid/calendar'});assert.deepEqual(second.profile(alpha.id),updated);assert.deepEqual(second.profile(beta.id),beforeBeta);assert.deepEqual(dates(second.profile()),legacyDates);}finally{second.close();}
}));

test('A late custom-calendar publication failure preserves profiles and existing money while removing only the newly initialized book',()=>fixture(({store,directory})=>{
 seed(store.book());const existing=store.create({name:'Fictional Calendar Existing Before Failure'}),beforeProfiles=store.list(),beforeDefault=tables(store.book().db),beforeExisting=tables(store.book(existing.id).db),beforePaths=paths(directory);
 store.catalog.exec("CREATE TRIGGER fail_custom_calendar_insert BEFORE INSERT ON companies WHEN NEW.id<>'default' BEGIN SELECT RAISE(ABORT,'fictional custom calendar publication failure'); END;");
 assert.throws(()=>store.create({name:'Fictional Calendar Must Not Publish',financial_year_from:'2025-04-01',books_from:'2025-07-01'}),/fictional custom calendar publication failure/);assert.deepEqual(store.list(),beforeProfiles);assert.deepEqual(tables(store.book().db),beforeDefault);assert.deepEqual(tables(store.book(existing.id).db),beforeExisting);assert.deepEqual(paths(directory),beforePaths);assert.equal(store.catalog.isTransaction,false);
}));

test('New-company Books beginning rejects dates outside the initial financial year atomically while both endpoints are accepted',()=>fixture(({store,directory})=>{
 const before=tables(store.catalog),money=tables(store.book().db),files=paths(directory);
 for(const books_from of ['2025-03-31','2026-04-01']){const input={financial_year_from:'2025-04-01',books_from};assert.throws(()=>normalizeCompanyCalendar(input),error=>error instanceof BookError&&error.status===400);assert.throws(()=>store.create({name:'Must Not Publish Outside Calendar',...input}),error=>error instanceof BookError&&error.status===400);assert.deepEqual(tables(store.catalog),before);assert.deepEqual(tables(store.book().db),money);assert.deepEqual(paths(directory),files);}
 for(const books_from of ['2025-04-01','2026-03-31']){const profile=store.create({name:'Fictional Calendar Inclusive '+books_from,financial_year_from:'2025-04-01',books_from});assert.equal(profile.books_from,books_from);assert.equal(profile.financial_year_to,'2026-03-31');assert.equal(store.book(profile.id).state().vouchers.length,0);assert.deepEqual(tables(store.book().db),money);}
}));
