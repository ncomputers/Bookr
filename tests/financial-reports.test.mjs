import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Book,BookError} from '../lib/accounting.mjs';

function fixture(book){
  const customer=book.createCustomer({name:'Demo Customer'}),supplier=book.saveSupplier({name:'Study Supplier Fictional'});
  const purchaseAccount=book.ledgers().find(l=>l.kind==='purchase').id;
  const first=book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:100000});
  const second=book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:250075});
  const purchase=book.saveVoucher({type:'purchase',date:'2026-04-01',supplier_id:supplier.id,account_id:purchaseAccount,amount:150000});
  return {customer,supplier,purchaseAccount,first,second,purchase};
}
const group=(report,key)=>report.balanceSheet.groups.flatMap(g=>[g,...(g.groups ?? [])]).find(g=>g.key===key);

test('native fictional balances reconcile to 2000.75 profit and 2900.75 Balance Sheet; settlements do not create income or cost',()=>{
  const book=new Book();try{
    const {customer,supplier,first,second,purchase}=fixture(book);
    const before=book.financialReports();
    assert.equal(before.profitAndLoss.income,350075);assert.equal(before.profitAndLoss.expenses,150000);
    assert.equal(before.profitAndLoss.profit,200075);assert.deepEqual(before.profitAndLoss.tradingTotals,{debit:350075,credit:350075});
    assert.deepEqual(before.profitAndLoss.totals,{debit:200075,credit:200075});
    book.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1,amount:40000,allocations:[{bill_id:first.bill.id,amount:40000}]});
    book.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1,amount:82525,allocations:[{bill_id:second.bill.id,amount:62525},{bill_id:first.bill.id,amount:20000}]});
    book.saveVoucher({type:'payment',date:'2026-04-01',supplier_id:supplier.id,account_id:1,amount:60000,allocations:[{bill_id:purchase.bill.id,amount:60000}]});
    const report=book.financialReports();assert.deepEqual(report.profitAndLoss,before.profitAndLoss);
    assert.deepEqual(report.balanceSheet.totals,{assets:290075,liabilities:290075,balanced:true});
    assert.equal(group(report,'cash').amount,62525);assert.equal(group(report,'debtors').amount,227550);assert.equal(group(report,'creditors').amount,90000);
    assert.deepEqual(report.balanceSheet.profit,{opening:0,current:200075,closing:200075});
  }finally{book.close();}
});

test('period activity and as-at closing positions stay distinct, including an empty period and later vouchers',()=>{
  const book=new Book();try{
    const {customer,supplier,purchaseAccount,first}=fixture(book);
    book.saveVoucher({type:'receipt',date:'2026-04-02',customer_id:customer.id,account_id:1,amount:40000,allocations:[{bill_id:first.bill.id,amount:40000}]});
    book.saveVoucher({type:'purchase',date:'2026-04-03',supplier_id:supplier.id,account_id:purchaseAccount,amount:250025});
    const april1=book.financialReports({from:'2026-04-01',to:'2026-04-01'});
    assert.equal(april1.balanceSheet.totals.assets,350075);assert.equal(group(april1,'cash').amount,0);assert.equal(april1.profitAndLoss.profit,200075);
    const april2=book.financialReports({from:'2026-04-02',to:'2026-04-02'});
    assert.equal(april2.profitAndLoss.profit,0);assert.equal(april2.profitAndLoss.income,0);assert.equal(april2.profitAndLoss.expenses,0);
    assert.equal(group(april2,'cash').amount,40000);assert.equal(group(april2,'debtors').amount,310075);
    assert.deepEqual(april2.balanceSheet.profit,{opening:200075,current:0,closing:200075});
    assert.deepEqual(april2.balanceSheet.totals,{assets:350075,liabilities:350075,balanced:true});
    const april3=book.financialReports({from:'2026-04-03',to:'2026-04-03'});
    assert.equal(april3.profitAndLoss.profit,-250025);assert.deepEqual(april3.balanceSheet.profit,{opening:200075,current:-250025,closing:-49950});
    assert.equal(april3.balanceSheet.totals.assets,400025);assert.equal(april3.balanceSheet.totals.liabilities,400025);
    const before=book.financialReports({to:'2026-03-31'});assert.equal(before.balanceSheet.totals.assets,0);assert.equal(before.profitAndLoss.profit,0);
    const after=book.financialReports({from:'2026-04-04',to:'2026-04-04'});assert.equal(after.profitAndLoss.profit,0);assert.equal(after.balanceSheet.profit.closing,-49950);
  }finally{book.close();}
});

test('one-paisa loss appears on assets and a net-credit asset group is presented on liabilities while retaining its signed ledger amounts',()=>{
  const book=new Book();try{
    const customer=book.createCustomer({name:'Fictional Buyer'}),supplier=book.saveSupplier({name:'Fictional Supplier'});
    book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:10000});
    const purchase=book.saveVoucher({type:'purchase',date:'2026-04-01',supplier_id:supplier.id,account_id:book.ledgers().find(l=>l.kind==='purchase').id,amount:10001});
    let report=book.financialReports();assert.equal(report.profitAndLoss.profit,-1);
    assert.deepEqual(report.profitAndLoss.tradingTotals,{debit:10001,credit:10001});
    assert.deepEqual(report.profitAndLoss.totals,{debit:1,credit:1});
    assert.deepEqual(report.balanceSheet.totals,{assets:10001,liabilities:10001,balanced:true});
    book.saveVoucher({type:'payment',date:'2026-04-01',supplier_id:supplier.id,account_id:1,amount:10001,allocations:[{bill_id:purchase.bill.id,amount:10001}]});
    report=book.financialReports();assert.equal(group(report,'cash').amount,-10001);assert.equal(group(report,'current-assets').amount,-1);
    assert.deepEqual(report.balanceSheet.totals,{assets:1,liabilities:1,balanced:true});assert.equal(report.profitAndLoss.profit,-1);
    assert.ok(report.balanceSheet.presentation.liabilities.some(group=>group.key==='current-assets' && group.amount===1));
  }finally{book.close();}
});

test('reports are read-only, reflect revised vouchers, and retain exact results after reopening the database',()=>{
  const directory=mkdtempSync(join(tmpdir(),'bookr-financial-')),file=join(directory,'book.sqlite');let book=new Book(file);
  try{
    const {purchase}=fixture(book);const original=book.state();
    for(const period of [[],{from:'2026-02-30'},{to:'invalid'},{from:'2026-04-02',to:'2026-04-01'}])assert.throws(()=>book.financialReports(period),BookError);
    book.financialReports();assert.deepEqual(book.state(),original);
    book.saveVoucher({...purchase,amount:160001},purchase.id);
    const reports=book.financialReports({from:'2026-04-01',to:'2026-04-01'});assert.equal(reports.profitAndLoss.profit,190074);
    const state=book.state();book.close();book=new Book(file);assert.deepEqual(book.state(),state);
    assert.deepEqual(book.financialReports({from:'2026-04-01',to:'2026-04-01'}),reports);
    assert.equal(book.financialReports().balanceSheet.totals.balanced,true);
  }finally{book.close();rmSync(directory,{recursive:true,force:true});}
});
