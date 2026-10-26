import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Book,BookError} from '../lib/accounting.mjs';

function sale(book,date='2026-04-01',amount=100000){
  const customer=book.createCustomer({name:'Fictional Monthly Buyer'});
  const voucher=book.saveVoucher({type:'sale',date,customer_id:customer.id,account_id:2,amount});
  return {customer,voucher};
}
test('monthly debit/credit totals preserve the observed 1000 sale, 400 receipt, 600 outstanding result',()=>{
  const book=new Book();try{
    const {customer,voucher}=sale(book);
    book.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1,amount:40000,allocations:[{bill_id:voucher.bill.id,amount:40000}]});
    const before=book.state(),report=book.monthlySummary(customer.id);
    assert.equal(report.rows.length,12);assert.deepEqual(report.period,{from:'2026-04-01',to:'2027-03-31'});
    assert.deepEqual(report.totals,{debit:100000,credit:40000,closing:60000});
    assert.deepEqual(report.rows[0],{month:'2026-04',from:'2026-04-01',to:'2026-04-30',opening:0,debit:100000,credit:40000,closing:60000,display_active:true});
    assert.equal(report.rows[1].closing,60000);assert.equal(report.rows[1].display_active,false);
    assert.deepEqual(book.monthlySummary(2).totals,{debit:0,credit:100000,closing:-100000});
    assert.deepEqual(book.monthlySummary(1).totals,{debit:40000,credit:0,closing:40000});
    assert.equal(book.outstanding()[0].pending,60000);assert.deepEqual(book.state(),before);
  }finally{book.close();}
});
test('closing visibility uses the company last voucher date, with empty-month carry before that date',()=>{
  const book=new Book();try{
    const {customer}=sale(book),expense=book.saveLedger({kind:'expense',name:'Fictional Monthly Expense'});
    book.saveVoucher({type:'payment',date:'2026-06-02',ledger_id:expense.id,account_id:1,amount:1});
    const report=book.monthlySummary(customer.id);
    assert.equal(report.last_voucher_date,'2026-06-02');
    assert.deepEqual(report.rows.slice(0,4).map(row=>[row.debit,row.credit,row.closing,row.display_active]),[[100000,0,100000,true],[0,0,100000,true],[0,0,100000,true],[0,0,100000,false]]);
    const empty=book.monthlySummary(book.ledgers().find(l=>l.kind==='purchase').id);assert.equal(empty.rows[1].closing,0);assert.equal(empty.rows[1].display_active,true);
    assert.equal(empty.rows.at(-1).from,'2027-03-01');assert.equal(empty.rows[10].to,'2027-02-28');
  }finally{book.close();}
});
test('opening balances and fiscal boundaries retain exact paise without leaking later-year movements',()=>{
  const book=new Book();try{
    const {customer,voucher}=sale(book,'2026-03-31',100001);
    book.saveVoucher({type:'receipt',date:'2026-03-31',customer_id:customer.id,account_id:1,amount:100001,allocations:[{bill_id:voucher.bill.id,amount:100001}]});
    const expense=book.saveLedger({kind:'expense',name:'Fictional Monthly Expense'});
    book.saveVoucher({type:'payment',date:'2026-04-01',ledger_id:expense.id,account_id:1,amount:1});
    book.saveVoucher({type:'payment',date:'2027-03-31',ledger_id:expense.id,account_id:1,amount:20000});
    book.saveVoucher({type:'payment',date:'2027-04-01',ledger_id:expense.id,account_id:1,amount:30000});
    const report=book.monthlySummary(1);
    assert.equal(report.opening,100001);assert.equal(report.rows[0].closing,100000);assert.equal(report.rows[1].opening,100000);
    assert.equal(report.rows.at(-1).credit,20000);assert.deepEqual(report.totals,{debit:0,credit:20001,closing:80000});
    assert.equal(report.rows.every(row=>row.display_active),true);
    for(const row of report.rows){const statement=book.statement(1,{from:row.from,to:row.to});assert.equal(row.opening,statement.opening);assert.equal(row.closing,statement.balance);}
  }finally{book.close();}
});
test('voucher revisions move between months atomically and monthly reports survive a database reopen',()=>{
  const directory=mkdtempSync(join(tmpdir(),'bookr-monthly-')),file=join(directory,'book.sqlite');let book=new Book(file);
  try{
    const expense=book.saveLedger({kind:'expense',name:'Study Office Expense'});
    const payment=book.saveVoucher({type:'payment',date:'2026-04-01',ledger_id:expense.id,account_id:1,amount:7500});
    let report=book.monthlySummary(expense.id);assert.equal(report.rows[0].debit,7500);assert.equal(report.totals.closing,7500);
    book.saveVoucher({type:'payment',date:'2026-05-31',ledger_id:expense.id,account_id:1,amount:7525,revision:payment.revision},payment.id);
    report=book.monthlySummary(expense.id);assert.equal(report.rows[0].debit,0);assert.equal(report.rows[1].debit,7525);assert.equal(report.totals.closing,7525);
    const state=book.state();book.close();book=new Book(file);assert.deepEqual(book.monthlySummary(expense.id),report);assert.deepEqual(book.state(),state);
    assert.equal(book.db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{book.close();assert.ok(directory.startsWith(join(tmpdir(),'bookr-monthly-')));rmSync(directory,{recursive:true,force:true});}
});
test('invalid ledgers are rejected and a company with no vouchers returns twelve inactive zero months',()=>{
  const book=new Book();try{
    for(const id of [null,'bad',-1,99999])assert.throws(()=>book.monthlySummary(id),BookError);
    const report=book.monthlySummary(1);assert.equal(report.last_voucher_date,null);assert.equal(report.opening,0);assert.deepEqual(report.totals,{debit:0,credit:0,closing:0});assert.equal(report.rows.length,12);assert.equal(report.rows.every(row=>!row.display_active && row.debit===0 && row.credit===0 && row.closing===0),true);
  }finally{book.close();}
});
