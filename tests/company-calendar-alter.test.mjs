import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,unlinkSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {CompanyStore} from '../lib/companies.mjs';
import {exportCompanyBundle,restoreCompanyBundle} from '../lib/company-backup.mjs';
import {initialCalendar,changedCalendar,calendarOf,ownedCalendarDirectory,rowsFrom,seedCalendarAlter,snapshotCalendarAlter} from './company-calendar-alter-fixture.mjs';

function fixture(action){
 const directory=mkdtempSync(join(tmpdir(),'bookr-calendar-alter-unit-'));let store;
 try{const f=seedCalendarAlter(join(directory,'book.sqlite'));store=new CompanyStore({defaultFile:f.database});const context={...f,get store(){return store;},snapshot:()=>snapshotCalendarAlter(f),reopen(){store.close();store=new CompanyStore({defaultFile:f.database});return store;}};return action(context);}
 finally{store?.close();rmSync(ownedCalendarDirectory(directory),{recursive:true,force:true});}
}
const badRequest=error=>error.status===400;
const calendarUpdate=(store,profile,patch=changedCalendar)=>store.update(profile.id,{revision:profile.revision,...patch});

test('An empty named company publishes new dates once, preserving masters, bank metadata and the comparison600',()=>fixture(f=>{
 const before=f.snapshot(),saved=calendarUpdate(f.store,f.target);
 assert.deepEqual(calendarOf(saved),changedCalendar);assert.equal(saved.revision,2);assert.equal(saved.id,f.target.id);
 assert.deepEqual(f.store.profile(saved.id),saved);assert.deepEqual(f.store.list().find(row=>row.id===saved.id),saved);assert.deepEqual(f.store.summary(saved.id).calendar,changedCalendar);
 assert.deepEqual(f.snapshot().books,before.books);assert.deepEqual(f.snapshot().files,before.files);assert.equal(f.store.book(f.comparison.id).outstandingReport().totals.pending,60000);
 f.reopen();assert.deepEqual(f.store.profile(saved.id),saved);assert.deepEqual(f.store.book(saved.id).state().calendar,changedCalendar);assert.deepEqual(f.snapshot().books,before.books);
}));

test('Partial FY resets omitted Books, explicit Books overrides it, and the end is always derived',()=>fixture(f=>{
 const reset=calendarUpdate(f.store,f.target,{financial_year_from:'2025-04-01'});assert.deepEqual(calendarOf(reset),{financial_year_from:'2025-04-01',books_from:'2025-04-01',financial_year_to:'2026-03-31'});
 const later=calendarUpdate(f.store,reset,{books_from:'2025-07-01'});assert.deepEqual(calendarOf(later),changedCalendar);
 const earlier=calendarUpdate(f.store,later,{books_from:'2025-05-01'});assert.equal(earlier.financial_year_from,'2025-04-01');assert.equal(earlier.books_from,'2025-05-01');
 const explicit=calendarUpdate(f.store,earlier,{financial_year_from:'2024-04-01',books_from:'2024-08-01'});assert.deepEqual(calendarOf(explicit),{financial_year_from:'2024-04-01',books_from:'2024-08-01',financial_year_to:'2025-03-31'});
 const before=f.snapshot();assert.throws(()=>calendarUpdate(f.store,explicit,{financial_year_to:'2026-03-31'}),badRequest);assert.deepEqual(f.snapshot(),before);
}));

test('Empty default-company date alteration retains its legacy posting-window policy',()=>fixture(f=>{
 const original=f.store.profile(),book=f.store.book(),before=f.snapshot();assert.equal(book.companyPeriod,null);
 const saved=calendarUpdate(f.store,original);assert.equal(f.store.book(),book);assert.equal(book.companyPeriod,null);assert.deepEqual(book.calendar,changedCalendar);assert.equal(book.openingDate,'2025-07-01');
 assert.deepEqual(f.snapshot().books,before.books);f.reopen();assert.deepEqual(f.store.profile(),saved);assert.equal(f.store.book().companyPeriod,null);assert.deepEqual(f.store.book().calendar,changedCalendar);
}));

test('Warm cached Book identity is preserved and a second store refreshes its own cache on lookup',()=>fixture(f=>{
 const first=f.store.book(f.target.id),firstDb=first.db,secondStore=new CompanyStore({defaultFile:f.database});
 try{
  const second=secondStore.book(f.target.id),secondDb=second.db,before=f.snapshot();calendarUpdate(f.store,f.target);
  assert.equal(f.store.book(f.target.id),first);assert.equal(first.db,firstDb);assert.deepEqual(first.calendar,changedCalendar);assert.equal(first.openingDate,'2025-07-01');assert.deepEqual(first.companyPeriod,{from:'2025-07-01',to:'2026-03-31'});
  assert.equal(secondStore.book(f.target.id),second);assert.equal(second.db,secondDb);assert.deepEqual(second.calendar,changedCalendar);assert.equal(second.openingDate,'2025-07-01');assert.deepEqual(second.companyPeriod,{from:'2025-07-01',to:'2026-03-31'});assert.deepEqual(f.snapshot().books,before.books);
 }finally{secondStore.close();}
}));

test('A captured same-store Book validates a resumed voucher against the committed Books date',()=>fixture(f=>{
 const captured=f.store.book(f.target.id),buyer=captured.createCustomer({name:'Fictional Pending Calendar Buyer'}),before=f.snapshot();
 calendarUpdate(f.store,f.target,{books_from:'2026-07-01'});
 assert.throws(()=>captured.saveVoucher({type:'sale',date:'2026-04-01',customer_id:buyer.id,account_id:2,amount:100}),badRequest);assert.deepEqual(f.snapshot().books,before.books);
 const sale=captured.saveVoucher({type:'sale',date:'2026-07-01',customer_id:buyer.id,account_id:2,amount:100});assert.equal(sale.date,'2026-07-01');assert.equal(captured.outstandingReport().totals.pending,100);assert.equal(f.store.book(f.comparison.id).outstandingReport().totals.pending,60000);
}));

test('Cold eligibility and date publication neither construct nor seed a Book',()=>fixture(f=>{
 assert.equal(f.store.books.has(f.target.id),false);const before=f.snapshot(),keys=[...f.store.books.keys()],original=f.store.book;
 f.store.book=()=>{throw new Error('Policy and cold metadata publication must not construct a Book.');};
 try{
  assert.equal(typeof f.store.calendarEditability,'function','Implement a read-only calendarEditability method.');
  assert.deepEqual(f.store.calendarEditability(f.target.id),{company_id:f.target.id,revision:f.target.revision,editable:true});calendarUpdate(f.store,f.target);assert.deepEqual([...f.store.books.keys()],keys);assert.deepEqual(f.snapshot().books,before.books);assert.deepEqual(f.snapshot().files,before.files);
 }finally{f.store.book=original;}
 assert.deepEqual(f.store.book(f.target.id).calendar,changedCalendar);
}));

test('Invalid dates, stale revision and duplicate names leave the catalog, rows and warm cache unchanged',()=>fixture(f=>{
 const book=f.store.book(f.target.id),calendar=book.calendar;
 for(const patch of [{books_from:'2026-03-31'},{books_from:'2027-04-01'},{books_from:'2026-02-30'},{books_from:null},{financial_year_from:2025},{financial_year_from:'2025-04-01',financial_year_to:'2027-03-31'},{revision:999,books_from:'2026-07-01'},{name:f.other.name,books_from:'2026-07-01'}]){
  const before=f.snapshot();assert.throws(()=>f.store.update(f.target.id,{revision:f.target.revision,...patch}));assert.deepEqual(f.snapshot(),before);assert.equal(book.calendar,calendar);assert.equal(f.store.catalog.isTransaction,false);
 }
 const raw=JSON.parse(f.store.catalog.prepare('SELECT details FROM companies WHERE id=?').get(f.target.id).details);f.store.catalog.prepare('UPDATE companies SET details=? WHERE id=?').run(JSON.stringify({...raw,financial_year_to:'2028-03-31'}),f.target.id);
 const corrupted=f.snapshot();assert.throws(()=>f.store.update(f.target.id,{revision:f.target.revision,email:'must-not-repair@example.invalid'}),badRequest);assert.deepEqual(f.snapshot(),corrupted);assert.equal(book.calendar,calendar);
}));

test('A late catalog failure rolls back dates and keeps the existing cached object usable',()=>fixture(f=>{
 const book=f.store.book(f.target.id),calendar=book.calendar;f.store.catalog.exec("CREATE TRIGGER fictional_calendar_abort BEFORE UPDATE ON companies BEGIN SELECT RAISE(ABORT,'Fictional calendar publication denied'); END");
 try{const before=f.snapshot();assert.throws(()=>calendarUpdate(f.store,f.target),/Fictional calendar publication denied/);assert.deepEqual(f.snapshot(),before);assert.equal(book.calendar,calendar);assert.equal(book.db.isTransaction,false);assert.equal(f.store.catalog.isTransaction,false);}finally{f.store.catalog.exec('DROP TRIGGER fictional_calendar_abort');}
 const saved=calendarUpdate(f.store,f.target);assert.deepEqual(calendarOf(saved),changedCalendar);assert.equal(f.store.book(f.target.id),book);
}));

test('An existing target writer excludes date publication until it releases its lock',()=>fixture(f=>{
 const book=f.store.book(f.target.id),blocker=new DatabaseSync(f.store.fileFor(f.target.id));book.db.exec('PRAGMA busy_timeout=20');
 try{blocker.exec('BEGIN IMMEDIATE');const before=f.snapshot(),calendar=book.calendar;assert.throws(()=>calendarUpdate(f.store,f.target),error=>error.status===409||/locked|busy/i.test(error.message));assert.deepEqual(f.snapshot(),before);assert.equal(book.calendar,calendar);assert.equal(f.store.catalog.isTransaction,false);}
 finally{if(blocker.isTransaction)blocker.exec('ROLLBACK');blocker.close();}
 assert.deepEqual(calendarOf(calendarUpdate(f.store,f.target)),changedCalendar);
}));

test('A caller-owned target transaction is not rolled back or committed by a rejected calendar edit',()=>fixture(f=>{
 const book=f.store.book(f.target.id),calendar=book.calendar;book.db.exec('BEGIN IMMEDIATE');
 try{const before=f.snapshot();assert.throws(()=>calendarUpdate(f.store,f.target));assert.equal(book.db.isTransaction,true);assert.equal(f.store.catalog.isTransaction,false);assert.deepEqual(f.snapshot(),before);assert.equal(book.calendar,calendar);}finally{book.db.exec('ROLLBACK');}
}));

test('A missing cold target file fails without creating a replacement or changing the catalog',()=>fixture(f=>{
 const file=f.store.fileFor(f.target.id);assert.equal(f.store.books.has(f.target.id),false);unlinkSync(file);const catalog=rowsFrom(f.store.catalog);
 assert.equal(typeof f.store.calendarEditability,'function','Implement the policy read before using it.');assert.throws(()=>f.store.calendarEditability(f.target.id),error=>error.status===404);assert.throws(()=>calendarUpdate(f.store,f.target),error=>error.status===404);assert.deepEqual(rowsFrom(f.store.catalog),catalog);assert.equal(f.store.books.has(f.target.id),false);assert.equal(existsSync(file),false);
}));

test('Changed dates round-trip through portable version2 without rewriting master or financial records',()=>fixture(f=>{
 const before=f.snapshot(),saved=calendarUpdate(f.store,f.target),bundle=exportCompanyBundle(f.store,f.target.id);assert.equal(bundle.version,2);assert.deepEqual(calendarOf(bundle.company),changedCalendar);
 const restored=restoreCompanyBundle(f.store,bundle,{name:'Fictional Calendar Alter Restored'});assert.notEqual(restored.id,saved.id);assert.deepEqual(calendarOf(restored),changedCalendar);assert.deepEqual(rowsFrom(f.store.book(restored.id).db),before.books[f.target.id]);assert.deepEqual(f.store.profile(saved.id),saved);assert.equal(f.store.book(f.comparison.id).outstandingReport().totals.pending,60000);
}));

test('Posted companies keep ordinary metadata and same-date edits while changed dates are rejected',()=>fixture(f=>{
 const profile=f.store.profile(f.comparison.id),before=f.snapshot(),same=f.store.update(profile.id,{revision:profile.revision,...initialCalendar,email:'fictional-calendar@example.invalid'});assert.equal(same.revision,profile.revision+1);assert.deepEqual(calendarOf(same),initialCalendar);assert.deepEqual(f.snapshot().books,before.books);
 const snapshot=f.snapshot();assert.throws(()=>calendarUpdate(f.store,same),badRequest);assert.deepEqual(f.snapshot(),snapshot);assert.equal(f.store.book(profile.id).outstandingReport().totals.pending,60000);
}));

const financialRows={
 vouchers:"INSERT INTO vouchers(id,type,number,date,customer_id,account_id,amount) VALUES(99,'sale',99,'2026-04-01',1,2,1)",
 postings:"INSERT INTO postings(voucher_id,ledger_id,side,amount) VALUES(99,1,'debit',1)",
 bills:"INSERT INTO bills(id,sale_id,reference,amount) VALUES(99,99,'FICTIONAL-CALENDAR',1)",
 receipt_allocations:'INSERT INTO receipt_allocations(receipt_id,bill_id,amount,position) VALUES(99,99,1,0)',
 ledger_openings:'INSERT INTO ledger_openings(ledger_id,amount) VALUES(1,1)',
 opening_bills:"INSERT INTO opening_bills(id,ledger_id,reference,date,amount) VALUES(99,1,'FICTIONAL-OPENING','2026-03-31',1)",
 opening_bill_allocations:'INSERT INTO opening_bill_allocations(receipt_id,opening_bill_id,amount,position) VALUES(99,99,1,0)',
 bill_terms:"INSERT INTO bill_terms(bill_id,mode,days,date) VALUES(99,'days',1,NULL)",
 opening_bill_terms:"INSERT INTO opening_bill_terms(opening_bill_id,mode,days,date) VALUES(99,'days',1,NULL)",
 journal_entry_order:'INSERT INTO journal_entry_order(voucher_id,ledger_id,position) VALUES(99,1,0)'
};
for(const [table,sql]of Object.entries(financialRows))test('Any existing '+table+' row blocks changed dates, including an orphaned synthetic safety fixture',()=>fixture(f=>{
 const book=f.store.book(f.target.id);book.db.exec('PRAGMA foreign_keys=OFF');try{book.db.exec(sql);}finally{book.db.exec('PRAGMA foreign_keys=ON');}
 const before=f.snapshot();assert.equal(typeof f.store.calendarEditability,'function','Implement read-only eligibility.');assert.equal(f.store.calendarEditability(f.target.id).editable,false);assert.throws(()=>calendarUpdate(f.store,f.target),badRequest);assert.deepEqual(f.snapshot(),before);assert.equal(f.store.catalog.isTransaction,false);assert.equal(book.db.isTransaction,false);assert.equal(f.store.book(f.comparison.id).outstandingReport().totals.pending,60000);
}));
