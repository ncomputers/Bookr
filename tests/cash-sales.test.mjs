import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Book,BookError} from '../lib/accounting.mjs';

const cashInput=(amount=125050,patch={})=>({type:'sale',date:'2026-04-01',customer_id:1,account_id:2,amount,narration:'Fictional direct cash sale',...patch});
const update=(voucher,patch={})=>({type:'sale',date:voucher.date,customer_id:voucher.customer_id,account_id:voucher.account_id,amount:voucher.amount,narration:voucher.narration,revision:voucher.revision,...patch});
const count=(book,table)=>book.db.prepare('SELECT COUNT(*) AS count FROM '+table).get().count;
const raw=book=>Object.fromEntries(['vouchers','postings','bills','bill_terms','receipt_allocations','opening_bill_allocations'].map(table=>[table,book.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(row=>({...row}))]));
const cashPostings=(voucher,cashId=1,salesId=2)=>assert.deepEqual(voucher.postings.map(row=>[row.ledger_id,row.side,row.amount]),[[cashId,'debit',voucher.amount],[salesId,'credit',voucher.amount]]);

test('direct Cash Sales1250.50 posts CashDr/SalesCr once without Receipt, receivable or bill terms',()=>{
 const book=new Book();try{
  const voucher=book.saveVoucher(cashInput());assert.equal(voucher.type,'sale');assert.equal(voucher.number,1);assert.equal(voucher.customer_id,1);assert.equal(voucher.account_id,2);assert.equal(voucher.bill,null);assert.equal(voucher.sale_id,null);assert.deepEqual(voucher.allocations,[]);cashPostings(voucher);
  assert.equal(book.statement(1).balance,125050);assert.equal(book.statement(2).balance,-125050);assert.equal(count(book,'vouchers'),1);assert.equal(count(book,'postings'),2);assert.equal(count(book,'bills'),0);assert.equal(count(book,'bill_terms'),0);assert.equal(count(book,'receipt_allocations'),0);assert.deepEqual(book.outstanding(),[]);assert.deepEqual(book.receiptBills(book.createCustomer({name:'Unrelated Cash Sale Customer'}).id).bills,[]);
  assert.deepEqual(book.trialBalance().totals,{debit:125050,credit:125050,balanced:true});assert.equal(book.financialReports().profitAndLoss.netProfit,125050);assert.deepEqual(book.financialReports().balanceSheet.totals,{assets:125050,liabilities:125050,balanced:true});assert.equal(book.dayBook({type:'sale'}).rows[0].id,voucher.id);assert.equal(book.dayBook({type:'receipt'}).rows.length,0);
 }finally{book.close();}
});

test('Cash Sales preserve existing1000 credit sale/400 Receipt/600 pending and stay bill-free through repeated database reopen',()=>{
 const directory=mkdtempSync(join(tmpdir(),'bookr-cash-sales-')),file=join(directory,'book.sqlite');let book=new Book(file);
 try{
  const customer=book.createCustomer({name:'Cash Sale Existing Credit Customer'}),credit=book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:100000,bill:{reference:'CREDIT-1',terms:{mode:'days',days:5}}}),receipt=book.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1,amount:40000,allocations:[{bill_id:credit.bill.id,amount:40000}]});
  const outstanding=book.outstanding(),cash=book.saveVoucher(cashInput()),otherCash=book.saveLedger({kind:'cash',name:'Second Fictional Sales Cash'}),second=book.saveVoucher(cashInput(225,{customer_id:otherCash.id}));
  assert.equal(cash.number,2);assert.equal(second.number,3);assert.equal(book.voucher(receipt.id).amount,40000);assert.equal(book.statement(1).balance,165050);assert.equal(book.statement(otherCash.id).balance,225);assert.deepEqual(book.outstanding(),outstanding);assert.equal(outstanding[0].pending,60000);assert.equal(count(book,'bills'),1);assert.equal(count(book,'bill_terms'),1);
  const state=book.state(),cashSaved=book.voucher(cash.id),secondSaved=book.voucher(second.id);
  for(let i=0;i<3;i++){book.close();book=new Book(file);assert.deepEqual(book.state(),state);assert.deepEqual(book.voucher(cash.id),cashSaved);assert.deepEqual(book.voucher(second.id),secondSaved);assert.equal(count(book,'bills'),1);assert.equal(count(book,'bill_terms'),1);assert.equal(book.db.prepare('SELECT COUNT(*) AS count FROM bills WHERE sale_id IN (?,?)').get(cash.id,second.id).count,0);assert.equal(book.db.prepare('PRAGMA foreign_key_check').all().length,0);}
 }finally{book.close();assert.ok(directory.startsWith(join(tmpdir(),'bookr-cash-sales-')));rmSync(directory,{recursive:true,force:true});}
});

test('Cash Sales enriched round-trip and amount/cash-account/sales-account edits retain identity and exact replacement postings',()=>{
 const book=new Book();try{
  const initial=book.saveVoucher(cashInput()),otherCash=book.saveLedger({kind:'cash',name:'Cash Sale Alternate Cash'}),otherSales=book.saveLedger({kind:'sales',name:'Cash Sale Alternate Sales'});let voucher=initial;
  voucher=book.saveVoucher(update(voucher,{bill:null,allocations:[],sale_id:null,details:voucher.details,narration:'Round-trip saved Cash Sale'}),voucher.id);assert.equal(voucher.id,initial.id);assert.equal(voucher.number,initial.number);assert.equal(voucher.revision,2);assert.equal(voucher.bill,null);assert.deepEqual(voucher.allocations,[]);
  voucher=book.saveVoucher(update(voucher,{customer_id:otherCash.id,account_id:otherSales.id,amount:34567}),voucher.id);assert.equal(voucher.revision,3);cashPostings(voucher,otherCash.id,otherSales.id);assert.equal(book.statement(1).balance,0);assert.equal(book.statement(2).balance,0);assert.equal(book.statement(otherCash.id).balance,34567);assert.equal(book.statement(otherSales.id).balance,-34567);assert.equal(count(book,'postings'),2);assert.equal(count(book,'bills'),0);assert.equal(count(book,'vouchers'),1);
  const state=book.state();assert.throws(()=>book.saveVoucher(update(initial),initial.id),error=>error.status===409);assert.deepEqual(book.state(),state);
 }finally{book.close();}
});

test('unpaid credit-to-Cash conversion deletes its receivable/terms and Cash-to-credit creates a new reference without a Receipt',()=>{
 const book=new Book();try{
  const customer=book.createCustomer({name:'Cash Conversion Customer'});let voucher=book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:120000,bill:{reference:'UNPAID-CREDIT',terms:{mode:'days',days:30}}});const identity={id:voucher.id,number:voucher.number};assert.equal(count(book,'bills'),1);assert.equal(count(book,'bill_terms'),1);
  voucher=book.saveVoucher(update(voucher,{customer_id:1,bill:null,allocations:[],sale_id:null}),voucher.id);assert.equal(voucher.bill,null);assert.equal(count(book,'bills'),0);assert.equal(count(book,'bill_terms'),0);assert.equal(book.statement(customer.id).balance,0);assert.equal(book.statement(1).balance,120000);assert.deepEqual(book.outstanding(),[]);cashPostings(voucher);
  voucher=book.saveVoucher(update(voucher,{customer_id:customer.id}),voucher.id);assert.equal(voucher.bill.reference,String(identity.number));assert.equal(voucher.bill.amount,120000);assert.equal(voucher.bill.terms ?? null,null);assert.equal(book.statement(1).balance,0);assert.equal(book.outstanding()[0].pending,120000);assert.equal(count(book,'bill_terms'),0);
  voucher=book.saveVoucher(update(voucher,{customer_id:1,bill:null}),voucher.id);voucher=book.saveVoucher(update(voucher,{customer_id:customer.id,bill:{reference:'CASH-TO-CREDIT',terms:{mode:'days',days:7}}}),voucher.id);assert.equal(voucher.bill.reference,'CASH-TO-CREDIT');assert.equal(count(book,'bill_terms'),1);assert.equal(voucher.id,identity.id);assert.equal(voucher.number,identity.number);assert.equal(voucher.revision,5);assert.equal(count(book,'vouchers'),1);assert.equal(count(book,'postings'),2);assert.equal(book.dayBook({type:'receipt'}).rows.length,0);assert.equal(book.db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{book.close();}
});

test('partly settled credit Sales cannot convert to Cash or orphan existing receipts, bills, terms and revisions',()=>{
 const book=new Book();try{
  const customer=book.createCustomer({name:'Cash Protected Settled Customer'}),sale=book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:100000,bill:{reference:'PAID-PART',terms:{mode:'days',days:10}}});book.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1,amount:40000,allocations:[{bill_id:sale.bill.id,amount:40000}]});
  const stable=book.state(),tables=raw(book);assert.throws(()=>book.saveVoucher(update(sale,{customer_id:1,bill:null,allocations:[],sale_id:null}),sale.id),BookError);assert.deepEqual(book.state(),stable);assert.deepEqual(raw(book),tables);assert.equal(book.voucher(sale.id).revision,1);assert.equal(book.outstanding()[0].pending,60000);
 }finally{book.close();}
});

test('Cash Sales reject receivable, settlement and bank metadata plus unsupported kinds and invalid values atomically',()=>{
 const book=new Book();try{
  const saved=book.saveVoucher(cashInput()),customer=book.createCustomer({name:'Cash Validation Customer'}),supplier=book.saveSupplier({name:'Cash Validation Supplier'}),bank=book.saveBank({name:'Cash Validation Bank'}),expense=book.saveLedger({kind:'expense',name:'Cash Validation Expense'}),capital=book.saveLedger({kind:'capital',name:'Cash Validation Capital'});
  const invalid=[{bill:{reference:'CASH-BILL'}},{bill:{reference:'CASH-BILL',terms:{mode:'days',days:1}}},{bill:{terms:{mode:'days',days:1}}},{bill:{reference:'CASH-BILL',due_date:'2026-04-02'}},{allocations:[{bill_id:999,amount:125050}]},{sale_id:999},{details:{bank:{account_id:bank.id,transaction_type:'Cheque/DD',amount:125050,instrument_date:'2026-04-01'}}},{details:{source_bank:null}},{customer_id:bank.id},{customer_id:supplier.id},{customer_id:expense.id},{customer_id:capital.id},{customer_id:2},{account_id:1},{account_id:bank.id},{account_id:customer.id},{account_id:supplier.id},{account_id:expense.id},{amount:0},{amount:-1},{amount:1.1},{amount:100000000001},{date:'2026-02-30'}];
  for(const patch of invalid){const stable=book.state(),tables=raw(book);assert.throws(()=>book.saveVoucher(cashInput(125050,patch)),BookError,JSON.stringify(patch));assert.deepEqual(book.state(),stable);assert.deepEqual(raw(book),tables);}
  assert.equal(book.voucher(saved.id).revision,1);assert.equal(count(book,'vouchers'),1);assert.equal(count(book,'bills'),0);
 }finally{book.close();}
});

test('late Cash Sales credit failure rolls back creation, voucher number, edit revision, metadata and original postings',()=>{
 const book=new Book();try{
  const trigger="CREATE TRIGGER fail_cash_sale_credit BEFORE INSERT ON postings WHEN NEW.side='credit' BEGIN SELECT RAISE(ABORT,'simulated cash-sale credit failure'); END;";book.db.exec(trigger);const before=book.state(),tables=raw(book);assert.throws(()=>book.saveVoucher(cashInput()),/simulated cash-sale credit failure/);assert.deepEqual(book.state(),before);assert.deepEqual(raw(book),tables);book.db.exec('DROP TRIGGER fail_cash_sale_credit');
  const sale=book.saveVoucher(cashInput());assert.equal(sale.number,1);book.db.exec(trigger);const stable=book.state(),saved=book.voucher(sale.id),savedRows=raw(book);assert.throws(()=>book.saveVoucher(update(sale,{amount:250001,narration:'Must roll back',details:{party:{mailing_name:'Not saved'}}}),sale.id),/simulated cash-sale credit failure/);assert.deepEqual(book.state(),stable);assert.deepEqual(book.voucher(sale.id),saved);assert.deepEqual(raw(book),savedRows);
 }finally{book.close();}
});

test('Cash Sales obey nonzero Cash opening date guards and financial reports separate earlier positions from period sales',()=>{
 const book=new Book();try{
  const cash=book.saveLedger({kind:'cash',name:'Cash Sale Opening Cash',opening_balance:5000});book.saveLedger({kind:'capital',name:'Cash Sale Opening Capital',opening_balance:-5000});const before=book.state();assert.throws(()=>book.saveVoucher(cashInput(10000,{date:'2026-03-31',customer_id:cash.id})),BookError);assert.deepEqual(book.state(),before);
  const sale=book.saveVoucher(cashInput(10000,{date:'2026-04-02',customer_id:cash.id}));assert.equal(sale.bill,null);const previous=book.statement(cash.id,{from:'2026-04-01',to:'2026-04-01'}),current=book.statement(cash.id,{from:'2026-04-02',to:'2026-04-02'});assert.equal(previous.balance,5000);assert.equal(previous.rows.length,0);assert.equal(current.opening,5000);assert.equal(current.balance,15000);assert.equal(current.rows.length,1);assert.equal(book.financialReports({from:'2026-04-01',to:'2026-04-01'}).profitAndLoss.netProfit,0);assert.equal(book.financialReports({from:'2026-04-02',to:'2026-04-02'}).profitAndLoss.netProfit,10000);assert.deepEqual(book.outstanding(),[]);assert.equal(book.trialBalance().totals.balanced,true);
  const zero=book.saveVoucher(cashInput(100,{date:'2026-03-31'}));assert.equal(zero.bill,null);assert.equal(zero.amount,100);
 }finally{book.close();}
});
