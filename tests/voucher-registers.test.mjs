import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Book} from '../lib/accounting.mjs';

function createRegistersFixture(book){
  const customer=book.createCustomer({name:'Demo Customer'});
  const supplier=book.saveSupplier({name:'Study Supplier Fictional'});
  const salesAccount=book.ledgers().find(l=>l.kind==='sales').id;
  const purchaseAccount=book.ledgers().find(l=>l.kind==='purchase').id;

  // Sales in April:
  // 1. Credit Sale 1000.00
  book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:salesAccount,amount:100000});
  // 2. Credit Sale 2500.75
  book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:salesAccount,amount:250075});
  // 3. Cash Sale 25.00
  book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:1,account_id:salesAccount,amount:2500});

  // Purchase in April:
  // 1. Credit Purchase 1500.00
  book.saveVoucher({type:'purchase',date:'2026-04-01',supplier_id:supplier.id,account_id:purchaseAccount,amount:150000});
  // 2. Cash Purchase 50.00
  book.saveVoucher({type:'purchase',date:'2026-04-01',supplier_id:1,account_id:purchaseAccount,amount:5000});

  // Journal in April:
  // 1. Expense adjustment 125.00
  const expense=book.saveAccount({name:'Study Office Expense',kind:'expense'});
  book.saveVoucher({type:'journal',date:'2026-04-01',debit_ledger_id:expense.id,credit_ledger_id:supplier.id,debit_amount:12500,credit_amount:12500});
  // 2. General journal 800.00
  const capital=book.saveAccount({name:'Study Owner Capital',kind:'capital'});
  book.saveVoucher({
    type:'journal',
    date:'2026-04-01',
    entries:[
      {ledger_id:capital.id,side:'credit',amount:80000},
      {ledger_id:1,side:'debit',amount:80000}
    ],
    narration:'General Journal entry'
  });

  return {customer,supplier,salesAccount,purchaseAccount};
}

test('Sales Register: Monthly summary and drill-down match Tally Prime',()=>{
  const directory=mkdtempSync(join(tmpdir(),'bookr-registers-'));
  const file=join(directory,'book.sqlite');
  let book=new Book(file);
  try{
    createRegistersFixture(book);

    // Summary
    const summary=book.voucherRegisterSummary('sales');
    assert.equal(summary.months.length,12);
    assert.equal(summary.months[0].month_name,'April');
    assert.equal(summary.months[0].voucher_count,3);
    // Credit: 1000 + 2500.75 + 25 = 3525.75 (352575 paise)
    assert.equal(summary.months[0].credit,352575);
    assert.equal(summary.months[0].debit,0);
    assert.equal(summary.months[0].closing_balance,352575);
    assert.equal(summary.totals.credit,352575);

    // May to March should have 0
    for(let i=1;i<12;i++){
      assert.equal(summary.months[i].voucher_count,0);
      assert.equal(summary.months[i].credit,0);
    }

    // Drill-down into April
    const aprilVouchers=book.voucherRegisterMonth('sales',2026,4);
    assert.equal(aprilVouchers.rows.length,3);
    assert.deepEqual(aprilVouchers.rows.map(r=>[r.particulars,r.voucher_number,r.debit]),[
      ['Demo Customer',1,100000],
      ['Demo Customer',2,250075],
      ['Cash',3,2500]
    ]);
    assert.equal(aprilVouchers.total_amount,352575);

    // Columnar view
    const columnar=book.voucherRegisterMonth('sales',2026,4,{columnar:true});
    assert.ok(columnar.column_headers.includes('Demo Sales'));
    assert.equal(columnar.rows[0].columns['Demo Sales'],100000);
    assert.equal(columnar.rows[1].columns['Demo Sales'],250075);
    assert.equal(columnar.rows[2].columns['Demo Sales'],2500);
  }finally{
    book.close();
    rmSync(directory,{recursive:true,force:true});
  }
});

test('Purchase Register: Monthly summary and drill-down match Tally Prime',()=>{
  const directory=mkdtempSync(join(tmpdir(),'bookr-registers-'));
  const file=join(directory,'book.sqlite');
  let book=new Book(file);
  try{
    createRegistersFixture(book);

    const summary=book.voucherRegisterSummary('purchase');
    assert.equal(summary.months.length,12);
    assert.equal(summary.months[0].month_name,'April');
    assert.equal(summary.months[0].voucher_count,2);
    // Debit: 1500 + 50 = 1550.00 (155000 paise)
    assert.equal(summary.months[0].debit,155000);
    assert.equal(summary.months[0].credit,0);
    assert.equal(summary.months[0].closing_balance,155000);
    assert.equal(summary.totals.debit,155000);

    const aprilVouchers=book.voucherRegisterMonth('purchase',2026,4);
    assert.equal(aprilVouchers.rows.length,2);
    assert.deepEqual(aprilVouchers.rows.map(r=>[r.particulars,r.voucher_number,r.credit]),[
      ['Study Supplier Fictional',1,150000],
      ['Cash',2,5000]
    ]);
  }finally{
    book.close();
    rmSync(directory,{recursive:true,force:true});
  }
});

test('Journal Register: Monthly summary counts vouchers and lists transactions',()=>{
  const directory=mkdtempSync(join(tmpdir(),'bookr-registers-'));
  const file=join(directory,'book.sqlite');
  let book=new Book(file);
  try{
    createRegistersFixture(book);

    const summary=book.voucherRegisterSummary('journal');
    assert.equal(summary.months.length,12);
    assert.equal(summary.months[0].month_name,'April');
    assert.equal(summary.months[0].voucher_count,2);
    assert.equal(summary.totals.voucher_count,2);

    const aprilVouchers=book.voucherRegisterMonth('journal',2026,4);
    assert.equal(aprilVouchers.rows.length,2);
  }finally{
    book.close();
    rmSync(directory,{recursive:true,force:true});
  }
});
