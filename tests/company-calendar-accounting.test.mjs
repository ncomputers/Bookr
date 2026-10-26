import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,realpathSync} from 'node:fs';
import {join,relative,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {CompanyStore} from '../lib/companies.mjs';
import {Book,BookError} from '../lib/accounting.mjs';

const calendar={financial_year_from:'2025-04-01',books_from:'2025-07-01',financial_year_to:'2026-03-31'},fullYear={from:calendar.financial_year_from,to:calendar.financial_year_to};
const tables=db=>Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'" ORDER BY rowid').all().map(row=>({...row}))]));
function fixture(action){const temporaryRoot=realpathSync(tmpdir()),directory=mkdtempSync(join(temporaryRoot,'bookr-calendar-accounting-')),defaultFile=join(directory,'book.sqlite');let store=new CompanyStore({defaultFile});try{const profile=store.create({name:'Fictional Calendar Opening Study',financial_year_from:calendar.financial_year_from,books_from:calendar.books_from});return action({get store(){return store;},getDefault:()=>store.book(),profile,book:store.book(profile.id),reopen(){store.close();store=new CompanyStore({defaultFile});return store.book(profile.id);}});}finally{store.close();const target=realpathSync(directory),part=relative(temporaryRoot,target);assert.ok(part&&!part.startsWith('..')&&!isAbsolute(part));rmSync(target,{recursive:true,force:true});}}
function nativeOpenings(book){const cash=book.saveLedger({...book.masterLedger(1),opening_balance:10000,opening_date:calendar.books_from},1),capital=book.saveLedger({kind:'capital',name:'Fictional Calendar Opening Capital',opening_balance:-10000,opening_date:calendar.books_from});return {cash,capital};}

test('Managed company opening masters display the saved Books date and preserve a balanced zero-voucher book across reopen',()=>fixture(({getDefault,book,reopen})=>{
 const defaultBefore=tables(getDefault().db),{cash,capital}=nativeOpenings(book);assert.equal(cash.opening_date,calendar.books_from);assert.equal(capital.opening_date,calendar.books_from);assert.equal(cash.opening_balance,10000);assert.equal(capital.opening_balance,-10000);
 const state=book.state();assert.deepEqual(state.opening_balances,{date:calendar.books_from,debit:10000,credit:10000,difference:0,balanced:true});assert.equal(state.vouchers.length,0);assert.equal(book.db.prepare('SELECT COUNT(*) AS count FROM postings').get().count,0);const before=tables(book.db),opened=reopen();assert.deepEqual(opened.state(),state);assert.deepEqual(tables(opened.db),before);assert.deepEqual(tables(getDefault().db),defaultBefore);
}));

test('Native-observed managed master openings remain in full-year, pre-Books and pre-FY Trial reports without mutating accounting rows',()=>fixture(({book})=>{
 const {capital}=nativeOpenings(book),before=tables(book.db);
 for(const period of [fullYear,{from:'2025-04-01',to:'2025-06-30'},{from:'2025-07-01',to:'2026-03-31'},{from:'2025-03-01',to:'2025-03-31'}]){const trial=book.trialBalance(period);assert.deepEqual(trial.period,period);assert.deepEqual(trial.totals,{debit:10000,credit:10000,balanced:true});assert.equal(trial.rows.find(row=>row.id===1).balance,10000);assert.equal(trial.rows.find(row=>row.id===capital.id).balance,-10000);}
 for(const period of [fullYear,{from:'2025-04-01',to:'2025-06-30'}]){const statement=book.statement(1,period);assert.deepEqual(statement.period,period);assert.equal(statement.opening,10000);assert.equal(statement.balance,10000);assert.deepEqual(statement.rows,[]);}
 assert.deepEqual(tables(book.db),before);assert.equal(book.state().vouchers.length,0);
}));

test('Native-observed zero-voucher Cash monthly summary carries the opening through the initial July working month',()=>fixture(({book})=>{
 nativeOpenings(book);const before=tables(book.db),report=book.monthlySummary(1);assert.deepEqual(report.period,fullYear);assert.equal(report.rows.length,12);assert.equal(report.opening,10000);assert.equal(report.last_voucher_date,null);
 assert.deepEqual(report.rows.slice(0,4).map(({month,debit,credit,closing,display_active})=>({month,debit,credit,closing,display_active})),[{month:'2025-04',debit:0,credit:0,closing:10000,display_active:true},{month:'2025-05',debit:0,credit:0,closing:10000,display_active:true},{month:'2025-06',debit:0,credit:0,closing:10000,display_active:true},{month:'2025-07',debit:0,credit:0,closing:10000,display_active:true}]);assert.equal(report.rows.slice(4).every(row=>row.display_active===false),true);assert.deepEqual(report.totals,{debit:0,credit:0,closing:10000});assert.deepEqual(tables(book.db),before);
}));

test('A custom-calendar1000 sale and400 receipt leave600 pending with balanced money and atomic initial-period date guards',()=>fixture(({getDefault,book,reopen})=>{
 const defaultBefore=tables(getDefault().db);nativeOpenings(book);const customer=book.createCustomer({name:'Fictional Calendar Cycle Customer'}),sale=book.saveVoucher({type:'sale',date:calendar.books_from,customer_id:customer.id,account_id:2,amount:100000,bill:{reference:'CALENDAR-CYCLE'}}),receipt=book.saveVoucher({type:'receipt',date:calendar.books_from,customer_id:customer.id,account_id:1,amount:40000,allocations:[{bill_id:sale.bill.id,amount:40000}]});
 assert.equal(book.outstanding()[0].pending,60000);assert.equal(book.statement(1,fullYear).balance,50000);assert.deepEqual(book.trialBalance(fullYear).totals,{debit:110000,credit:110000,balanced:true});assert.equal(book.state().vouchers.length,2);assert.equal(book.db.prepare('SELECT COUNT(*) AS count FROM postings').get().count,4);assert.deepEqual(book.outstandingReport({as_of:'2025-06-30'}).rows,[]);assert.equal(book.outstandingReport({as_of:'2025-07-01'}).totals.pending,60000);
 const preserved=tables(book.db),savedState=book.state();for(const date of ['2025-06-30','2026-04-01']){assert.throws(()=>book.saveVoucher({type:'sale',date,customer_id:customer.id,account_id:2,amount:1}),BookError);assert.throws(()=>book.saveVoucher({type:'sale',date,customer_id:customer.id,account_id:2,amount:sale.amount,revision:sale.revision},sale.id),BookError);assert.deepEqual(tables(book.db),preserved);}
 const statement=book.statement(1,{from:'2025-04-01',to:'2025-06-30'});assert.equal(statement.opening,10000);assert.equal(statement.balance,10000);assert.deepEqual(statement.rows,[]);assert.deepEqual(book.monthlySummary(1).totals,{debit:40000,credit:0,closing:50000});assert.equal(book.voucher(receipt.id).allocations[0].bill_id,sale.bill.id);const opened=reopen();assert.deepEqual(opened.state(),savedState);assert.deepEqual(tables(opened.db),preserved);assert.deepEqual(tables(getDefault().db),defaultBefore);
}));

test('Bookr party-opening validation and historical outstanding policy use Books beginning while preserving opening bill IDs and settlements',()=>fixture(({book})=>{
 const {capital}=nativeOpenings(book),customer=book.saveCustomer({name:'Fictional Calendar Opening Buyer',opening_date:calendar.books_from,opening_balance:100000,opening_bills:[{reference:'HISTORICAL-JUNE',date:'2025-06-30',amount:100000}]});book.saveLedger({...book.masterLedger(capital.id),opening_date:calendar.books_from,opening_balance:-110000},capital.id);
 assert.equal(customer.opening_date,calendar.books_from);assert.equal(customer.opening_bills[0].date,'2025-06-30');const before=tables(book.db);assert.throws(()=>book.saveCustomer({...customer,opening_bills:[{...customer.opening_bills[0],date:'2025-07-01'}]},customer.id),BookError);assert.deepEqual(tables(book.db),before);
 // This cutoff is an existing Bookr policy being parameterized. Its native
 // party-opening as-of equivalent was not established by the Cash study.
 assert.equal(book.outstandingReport({as_of:'2025-06-30'}).totals.pending,0);assert.equal(book.outstandingReport({as_of:'2025-07-01'}).totals.pending,100000);const billId=customer.opening_bills[0].id;book.saveVoucher({type:'receipt',date:calendar.books_from,customer_id:customer.id,account_id:1,amount:40000,allocations:[{opening_bill_id:billId,amount:40000}]});assert.equal(book.outstandingReport().totals.pending,60000);assert.equal(book.customer(customer.id).opening_bills[0].id,billId);assert.deepEqual(book.trialBalance(fullYear).totals,{debit:110000,credit:110000,balanced:true});assert.equal(book.db.prepare('PRAGMA foreign_key_check').all().length,0);
}));

test('Direct legacy Books retain their existing opening activation and crossing-period guards',()=>{
 const book=new Book();try{book.saveLedger({...book.masterLedger(1),opening_balance:10000,opening_date:'2026-04-01'},1);book.saveLedger({kind:'capital',name:'Fictional Legacy Calendar Capital',opening_balance:-10000});assert.equal(book.companyPeriod,null);assert.equal(book.masterLedger(1).opening_date,'2026-04-01');assert.deepEqual(book.trialBalance({to:'2026-03-31'}).totals,{debit:0,credit:0,balanced:true});assert.equal(book.statement(1,{to:'2026-03-31'}).balance,0);assert.throws(()=>book.trialBalance({from:'2026-03-01',to:'2026-04-30'}),BookError);}finally{book.close();}
});
