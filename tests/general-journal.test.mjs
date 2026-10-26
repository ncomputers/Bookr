import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {Book,BookError} from '../lib/accounting.mjs';
import {savedLedgerBalance} from '../public/ledger-balance.js';

function fixture(book){return {cash:book.ledger(1),sales:book.ledger(2),purchase:book.ledgers().find(row=>row.kind==='purchase'),cash2:book.saveLedger({kind:'cash',name:'General Journal Other Cash'}),expense:book.saveLedger({kind:'expense',name:'General Journal Rent Expense'}),expense2:book.saveLedger({kind:'expense',name:'General Journal Utility Expense'}),income:book.saveLedger({kind:'income',name:'General Journal Other Income'}),capital:book.saveLedger({kind:'capital',name:'General Journal Owner Capital'}),customer:book.createCustomer({name:'General Journal Excluded Customer'}),supplier:book.saveSupplier({name:'General Journal Legacy Supplier'}),bank:book.saveBank({name:'General Journal Excluded Bank'})};}
const row=(ledger,side,amount)=>({ledger_id:ledger.id,side,amount});
const entries=f=>[row(f.capital,'credit',100000),row(f.cash,'debit',80000),row(f.expense,'debit',20000)];
const input=(f,patch={})=>({type:'journal',date:'2026-04-01',entries:entries(f),narration:'Fictional general Journal',...patch});
const update=(voucher,patch={})=>({type:'journal',date:voucher.date,entries:voucher.entries.map(({ledger_id,side,amount})=>({ledger_id,side,amount})),narration:voucher.narration,revision:voucher.revision,...patch});
const cleanEntries=values=>values.map(({ledger_id,side,amount})=>({ledger_id,side,amount}));
const count=(book,table)=>book.db.prepare('SELECT COUNT(*) AS count FROM '+table).get().count;
const raw=book=>Object.fromEntries(['vouchers','postings','bills','bill_terms','receipt_allocations','journal_entry_order'].map(table=>[table,book.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(value=>({...value}))]));
const legacy=(f,patch={})=>({type:'journal',date:'2026-04-01',debit_ledger_id:f.expense.id,credit_ledger_id:f.supplier.id,debit_amount:12500,credit_amount:12500,bill:{reference:'LEGACY-JOURNAL',terms:{mode:'days',days:5}},narration:'Existing bill-wise Journal',...patch});

test('three-line general Journal uses authoritative ordered postings, no fake supplier or bill, and one shared Journal amount',()=>{
 const book=new Book();try{
  const f=fixture(book),voucher=book.saveVoucher(input(f));assert.equal(voucher.type,'journal');assert.equal(voucher.number,1);assert.equal(voucher.amount,100000);assert.equal(voucher.account_id,f.cash.id);assert.equal(voucher.customer_id,f.capital.id);assert.equal(voucher.details.journal_mode,'general');assert.equal(Object.hasOwn(voucher.details,'entries'),false);assert.deepEqual(cleanEntries(voucher.entries),entries(f));assert.equal(voucher.bill,null);assert.deepEqual(voucher.allocations,[]);assert.equal(voucher.sale_id,null);assert.equal(Object.hasOwn(voucher,'supplier_id'),false);assert.equal(Object.hasOwn(voucher,'supplier_name'),false);
  assert.deepEqual(cleanEntries(voucher.postings).sort((a,b)=>a.ledger_id-b.ledger_id),entries(f).sort((a,b)=>a.ledger_id-b.ledger_id));assert.equal(count(book,'postings'),3);assert.equal(count(book,'journal_entry_order'),3);assert.equal(count(book,'bills'),0);assert.equal(count(book,'bill_terms'),0);assert.equal(count(book,'receipt_allocations'),0);assert.equal(book.dayBook({type:'receipt'}).rows.length,0);assert.deepEqual(book.outstanding(),[]);assert.deepEqual(book.payables(),[]);
  assert.equal(book.statement(f.cash.id).balance,80000);assert.equal(book.statement(f.capital.id).balance,-100000);assert.equal(book.statement(f.expense.id).balance,20000);assert.deepEqual(book.trialBalance().totals,{debit:100000,credit:100000,balanced:true});assert.equal(book.financialReports().profitAndLoss.netProfit,-20000);assert.deepEqual(book.financialReports().balanceSheet.totals,{assets:100000,liabilities:100000,balanced:true});assert.deepEqual(cleanEntries(book.state().vouchers[0].entries),entries(f));
  const order=book.db.prepare('SELECT ledger_id,position FROM journal_entry_order WHERE voucher_id=? ORDER BY position').all(voucher.id);assert.deepEqual(order.map(value=>value.ledger_id),entries(f).map(value=>value.ledger_id));assert.equal(new Set(order.map(value=>value.position)).size,3);const columns=book.db.prepare('PRAGMA table_info(journal_entry_order)').all().map(value=>value.name);assert.equal(columns.includes('amount'),false);assert.equal(columns.includes('side'),false);assert.equal(book.db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{book.close();}
});

test('multi-debit/credit general Journal covers all six supported kinds and reports each actual posting rather than its header amount',()=>{
 const book=new Book();try{
  const f=fixture(book),values=[row(f.expense,'debit',20000),row(f.income,'credit',15000),row(f.purchase,'debit',30000),row(f.sales,'credit',25000),row(f.cash,'debit',50000),row(f.capital,'credit',60000)],voucher=book.saveVoucher(input(f,{entries:values}));assert.deepEqual(cleanEntries(voucher.entries),values);assert.equal(voucher.amount,100000);
  for(const entry of values){const statement=book.statement(entry.ledger_id),movement=entry.side==='debit'?entry.amount:-entry.amount;assert.equal(statement.rows.length,1);assert.equal(statement.rows[0].amount,entry.amount);assert.equal(statement.rows[0].side,entry.side);assert.equal(statement.balance,movement);assert.equal(savedLedgerBalance(book.state(),entry.ledger_id),movement);const monthly=book.monthlySummary(entry.ledger_id);assert.equal(monthly.rows[0][entry.side],entry.amount);assert.equal(monthly.totals.closing,movement);}
  assert.notEqual(book.statement(f.sales.id).rows[0].particulars,f.income.name,'A secondary credit row cannot label another credit header as its sole counterparty.');assert.notEqual(book.statement(f.capital.id).rows[0].particulars,f.income.name);const day=book.dayBook({type:'journal'}).rows[0];assert.equal(day.id,voucher.id);assert.equal(day.amount,100000);assert.equal(Object.hasOwn(day,'supplier_id'),false);assert.equal(book.financialReports().profitAndLoss.netProfit,-10000);assert.deepEqual(book.financialReports().balanceSheet.totals,{assets:60000,liabilities:60000,balanced:true});assert.deepEqual(book.trialBalance().totals,{debit:100000,credit:100000,balanced:true});
 }finally{book.close();}
});

test('general Journal and its entry order survive repeated reopen without ghost bills while paid legacy Journal references stay unchanged',()=>{
 const directory=mkdtempSync(join(tmpdir(),'bookr-general-journal-')),file=join(directory,'book.sqlite');let book=new Book(file);
 try{
  const f=fixture(book),old=book.saveVoucher(legacy(f));book.saveVoucher({type:'payment',date:'2026-04-01',supplier_id:f.supplier.id,account_id:1,amount:5000,allocations:[{bill_id:old.bill.id,amount:5000}]});const voucher=book.saveVoucher(input(f));assert.equal(old.number,1);assert.equal(voucher.number,2);assert.equal(count(book,'bills'),1);assert.equal(count(book,'bill_terms'),1);const state=book.state(),saved=book.voucher(voucher.id),legacySaved=book.voucher(old.id);
  for(let i=0;i<3;i++){book.close();book=new Book(file);assert.deepEqual(book.state(),state);assert.deepEqual(book.voucher(voucher.id),saved);assert.deepEqual(book.voucher(old.id),legacySaved);assert.equal(count(book,'bills'),1);assert.equal(count(book,'bill_terms'),1);assert.equal(book.billForSale(voucher.id),null);assert.equal(book.allocated(old.id),5000);assert.equal(book.payables()[0].pending,7500);assert.equal(count(book,'journal_entry_order'),3);assert.equal(Object.hasOwn(book.voucher(old.id),'entries'),false);assert.equal(book.voucher(old.id).supplier_id,f.supplier.id);assert.equal(book.db.prepare('PRAGMA foreign_key_check').all().length,0);}
 }finally{book.close();assert.ok(resolve(directory).startsWith(resolve(tmpdir())+sep));assert.ok(directory.includes('bookr-general-journal-'));rmSync(directory,{recursive:true,force:true});}
});

test('general Journal edits replace all entries and order atomically, preserve identity/number and enforce stale revisions and immutable mode',()=>{
 const book=new Book();try{
  const f=fixture(book),old=book.saveVoucher(legacy(f)),first=book.saveVoucher(input(f));let voucher=first;const replacement=[row(f.income,'credit',30000),row(f.cash2,'debit',40000),row(f.purchase,'debit',10000),row(f.capital,'credit',20000)];voucher=book.saveVoucher(update(voucher,{date:'2026-04-02',entries:replacement,narration:'Replaced general lines'}),voucher.id);assert.equal(voucher.id,first.id);assert.equal(voucher.number,2);assert.equal(voucher.revision,2);assert.equal(voucher.amount,50000);assert.equal(voucher.account_id,f.cash2.id);assert.equal(voucher.customer_id,f.income.id);assert.deepEqual(cleanEntries(voucher.entries),replacement);assert.equal(voucher.bill,null);assert.equal(book.statement(f.cash.id).balance,0);assert.equal(book.statement(f.cash2.id).balance,40000);assert.equal(book.statement(f.expense.id).balance,12500);assert.equal(book.db.prepare('SELECT COUNT(*) AS count FROM postings WHERE voucher_id=?').get(voucher.id).count,4);assert.equal(book.db.prepare('SELECT COUNT(*) AS count FROM journal_entry_order WHERE voucher_id=?').get(voucher.id).count,4);
  const before=book.state(),tables=raw(book);assert.throws(()=>book.saveVoucher(update(first),first.id),error=>error.status===409);assert.throws(()=>book.saveVoucher(input(f,{revision:old.revision}),old.id),BookError);assert.throws(()=>book.saveVoucher(legacy(f,{revision:voucher.revision}),voucher.id),BookError);assert.deepEqual(book.state(),before);assert.deepEqual(raw(book),tables);assert.equal(book.voucher(old.id).bill.id,old.bill.id);assert.equal(count(book,'bills'),1);const next=book.saveVoucher(legacy(f,{bill:{reference:'NEXT-LEGACY'}}));assert.equal(next.number,3);
 }finally{book.close();}
});

test('general Journal rejects malformed, unbalanced, repeated, unsupported and conflicting entries without changing rows or revisions',()=>{
 const book=new Book();try{
  const f=fixture(book),saved=book.saveVoucher(input(f)),invalid=[{entries:null},{entries:{}},{entries:[]},{entries:[row(f.cash,'debit',1)]},{entries:[null,row(f.capital,'credit',1)]},{entries:[row(f.cash,'Debit',1),row(f.capital,'credit',1)]},{entries:[row(f.cash,'debit',0),row(f.capital,'credit',1)]},{entries:[row(f.cash,'debit',-1),row(f.capital,'credit',1)]},{entries:[row(f.cash,'debit',1.5),row(f.capital,'credit',1.5)]},{entries:[row(f.cash,'debit','1'),row(f.capital,'credit',1)]},{entries:[row(f.cash,'debit',100000000001),row(f.capital,'credit',100000000001)]},{entries:[row(f.cash,'debit',100),row(f.capital,'credit',99)]},{entries:[row(f.cash,'debit',100),row(f.capital,'debit',100)]},{entries:[row(f.cash,'debit',100),row(f.cash,'credit',100)]},{entries:[row(f.expense,'debit',50),row(f.expense,'debit',50),row(f.cash,'credit',100)]},{entries:[{ledger_id:999999,side:'debit',amount:100},row(f.cash,'credit',100)]},...['customer','supplier','bank'].map(kind=>({entries:[row(f[kind],'debit',100),row(f.cash,'credit',100)]})),{entries:[row(f.cash,'debit',60000000000),row(f.expense,'debit',60000000000),row(f.capital,'credit',60000000000),row(f.income,'credit',60000000000)]},{bill:{reference:'FORBIDDEN'}},{allocations:[{bill_id:999,amount:100}]},{details:{bank:{account_id:f.bank.id}}},{details:{journal_mode:'legacy'}},{amount:100000},{debit_ledger_id:f.expense.id},{credit_ledger_id:f.capital.id},{debit_amount:100000},{credit_amount:100000},{account_id:f.cash.id},{customer_id:f.capital.id},{supplier_id:f.supplier.id},{sale_id:999}];
  for(const patch of invalid){const before=book.state(),tables=raw(book);assert.throws(()=>book.saveVoucher(input(f,patch)),BookError,JSON.stringify(patch));assert.deepEqual(book.state(),before);assert.deepEqual(raw(book),tables);}assert.equal(book.voucher(saved.id).revision,1);
 }finally{book.close();}
});

test('general Journal accepts the exact100-row and total amount limits but rejects101 balanced unique rows and larger totals',()=>{
 const book=new Book();try{
  const f=fixture(book),ledgers=Array.from({length:101},(_,i)=>book.saveLedger({kind:i<50?'expense':'capital',name:'General Limit Ledger '+String(i).padStart(3,'0')})),hundred=ledgers.slice(0,100).map((ledger,i)=>row(ledger,i<50?'debit':'credit',100));const voucher=book.saveVoucher(input(f,{entries:hundred}));assert.equal(voucher.entries.length,100);assert.equal(voucher.amount,5000);assert.deepEqual(cleanEntries(voucher.entries),hundred);
  const hundredOne=ledgers.map((ledger,i)=>row(ledger,i<50?'debit':'credit',i<50?100:i===100?100:98));assert.equal(hundredOne.filter(e=>e.side==='debit').reduce((sum,e)=>sum+e.amount,0),hundredOne.filter(e=>e.side==='credit').reduce((sum,e)=>sum+e.amount,0));const before=book.state();assert.throws(()=>book.saveVoucher(input(f,{entries:hundredOne})),BookError);assert.deepEqual(book.state(),before);
  const max=[row(f.cash,'debit',50000000000),row(f.expense,'debit',50000000000),row(f.capital,'credit',50000000000),row(f.income,'credit',50000000000)];assert.equal(book.saveVoucher(input(f,{entries:max})).amount,100000000000);
 }finally{book.close();}
});

test('late general posting failure restores every posting, order row, voucher revision and marker on creation and edit',()=>{
 const book=new Book();try{
  const f=fixture(book),old=book.saveVoucher(legacy(f)),trigger="CREATE TRIGGER fail_general_second_post BEFORE INSERT ON postings WHEN (SELECT COUNT(*) FROM postings WHERE voucher_id=NEW.voucher_id)>=1 BEGIN SELECT RAISE(ABORT,'simulated general Journal second posting failure'); END;";book.db.exec(trigger);const before=book.state(),tables=raw(book);assert.throws(()=>book.saveVoucher(input(f)),/simulated general Journal second posting failure/);assert.deepEqual(book.state(),before);assert.deepEqual(raw(book),tables);book.db.exec('DROP TRIGGER fail_general_second_post');
  const saved=book.saveVoucher(input(f));assert.equal(saved.number,old.number+1);book.db.exec(trigger);const stable=book.state(),savedRows=raw(book);assert.throws(()=>book.saveVoucher(update(saved,{entries:[row(f.expense2,'debit',30000),row(f.cash,'credit',30000)],narration:'Must roll back replacement'}),saved.id),/simulated general Journal second posting failure/);assert.deepEqual(book.state(),stable);assert.deepEqual(raw(book),savedRows);assert.deepEqual(book.voucher(saved.id),saved);assert.equal(book.db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{book.close();}
});

test('general Journal validates dated openings on non-header entry ledgers and preserves the new-company period guard',()=>{
 const book=new Book();try{
  const f=fixture(book),openingCash=book.saveLedger({kind:'cash',name:'General Nonheader Opening Cash',opening_balance:5000}),openingCapital=book.saveLedger({kind:'capital',name:'General Nonheader Opening Capital',opening_balance:-5000}),values=[row(f.expense,'debit',100),row(f.income,'credit',100),row(openingCash,'debit',50),row(openingCapital,'credit',50)],before=book.state();assert.throws(()=>book.saveVoucher(input(f,{date:'2026-03-31',entries:values})),error=>error instanceof BookError&&/opening|books|date/i.test(error.message));assert.deepEqual(book.state(),before);const saved=book.saveVoucher(input(f,{entries:values}));assert.equal(saved.account_id,f.expense.id);assert.equal(saved.customer_id,f.income.id);assert.equal(saved.amount,150);
 }finally{book.close();}
 const bounded=new Book(':memory:',{companyName:'General Bounded Company',booksFrom:'2026-04-01',financialYearTo:'2027-03-31'});try{const f=fixture(bounded);for(const date of ['2026-03-31','2027-04-01']){const before=bounded.state();assert.throws(()=>bounded.saveVoucher(input(f,{date})),error=>error instanceof BookError&&/period/i.test(error.message));assert.deepEqual(bounded.state(),before);}for(const date of ['2026-04-01','2027-03-31'])assert.equal(bounded.saveVoucher(input(f,{date})).date,date);}finally{bounded.close();}
});

test('savedLedgerBalance follows every general posting alongside legacy vouchers and excludes all edited Journal movements once',()=>{
 const book=new Book();try{
  const f=fixture(book);book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:1,account_id:2,amount:10000});book.saveVoucher(legacy(f));const voucher=book.saveVoucher(input(f,{entries:[row(f.expense,'debit',1000),row(f.cash2,'debit',2000),row(f.income,'credit',500),row(f.capital,'credit',2500)]})),state=book.state();assert.deepEqual(cleanEntries(state.vouchers.find(row=>row.id===voucher.id).entries),cleanEntries(voucher.entries));
  for(const ledger of state.ledgers){assert.equal(savedLedgerBalance(state,ledger.id),book.statement(ledger.id).balance,ledger.name+' total');const without=book.db.prepare("SELECT COALESCE(SUM(CASE WHEN side='debit' THEN amount ELSE -amount END),0) AS movement FROM postings WHERE ledger_id=? AND voucher_id<>?").get(ledger.id,voucher.id).movement+(ledger.opening_balance ?? 0);assert.equal(savedLedgerBalance(state,ledger.id,voucher.id),without,ledger.name+' edited voucher exclusion');}
 }finally{book.close();}
});

test('secondary general Journal lines prevent incompatible later ledger opening edits and retain truthful DayBook mode',()=>{
 const book=new Book();try{
  const f=fixture(book),values=[row(f.expense,'debit',100),row(f.income,'credit',100),row(f.cash2,'debit',50),row(f.capital,'credit',50)],saved=book.saveVoucher(input(f,{date:'2026-03-31',entries:values}));
  assert.notEqual(saved.account_id,f.cash2.id);assert.notEqual(saved.customer_id,f.capital.id);
  for(const ledger of [f.cash2,f.capital]){const before=book.state(),tables=raw(book);assert.throws(()=>book.saveLedger({...ledger,opening_balance:ledger.kind==='cash'?5000:-5000},ledger.id),error=>error instanceof BookError&&/opening|before/i.test(error.message));assert.deepEqual(book.state(),before);assert.deepEqual(raw(book),tables);}
  const changed=book.saveLedger({...f.cash2,name:'Renamed Secondary General Cash',opening_balance:0},f.cash2.id);assert.equal(changed.revision,f.cash2.revision+1);assert.equal(book.voucher(saved.id).entries.find(entry=>entry.ledger_id===changed.id).name,changed.name);
  const day=book.dayBook({type:'journal'}).rows[0];assert.equal(day.journal_mode,'general');assert.equal(day.particulars,'Multiple Accounts');assert.equal(Object.hasOwn(day,'supplier_id'),false);assert.equal(Object.hasOwn(day,'debit_ledger_id'),false);assert.equal(book.statement(f.cash2.id).rows[0].particulars,'Multiple Accounts');assert.equal(book.statement(f.capital.id).rows[0].particulars,'Multiple Accounts');
 }finally{book.close();}
});
