import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Book,BookError} from '../lib/accounting.mjs';
import {exportCompanyBundle,restoreCompanyBundle} from '../lib/company-backup.mjs';

const bankAllocation=(bank,type,amount,number='')=>({
  account_id:bank.id,
  transaction_type:type,
  amount,
  instrument_number:number,
  instrument_date:'2026-04-01',
  bank_name:'Not Applicable',
  cheque_range:type==='Cheque'?'Not Applicable':''
});

function createBankFixture(book){
  const customer=book.createCustomer({name:'Demo Customer'});
  const supplier=book.saveSupplier({name:'Study Supplier Fictional'});
  const bank=book.saveBank({name:'Study Bank Fictional',bank:{account_number:'0000000001',branch:'Main Branch'}});

  // Sales and Purchase for bills
  const sale=book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:100000});
  const purchase=book.saveVoucher({type:'purchase',date:'2026-04-01',supplier_id:supplier.id,account_id:book.ledgers().find(l=>l.kind==='purchase').id,amount:150000,bill:{reference:'sup-001'}});

  // 1. Bank Receipt: 300.00 (30000 paise) - Demo Customer, Cheque/DD, 000101 -> Bank Debit
  const receipt=book.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:bank.id,amount:30000,allocations:[{bill_id:sale.bill.id,amount:30000}],details:{bank:bankAllocation(bank,'Cheque/DD',30000,'000101')}});

  // 2. Bank Payment: 100.00 (10000 paise) - Study Supplier, Cheque, 000201 -> Bank Credit
  const payment=book.saveVoucher({type:'payment',date:'2026-04-01',supplier_id:supplier.id,account_id:bank.id,amount:10000,allocations:[{bill_id:purchase.bill.id,amount:10000}],details:{bank:bankAllocation(bank,'Cheque',10000,'000201')}});

  // 3. Contra Deposit: 50.00 (5000 paise) - Cash -> Bank Debit
  const deposit=book.saveVoucher({type:'contra',date:'2026-04-01',source_id:1,destination_id:bank.id,amount:5000,narration:'Cash deposit',details:{bank:{...bankAllocation(bank,'Cash',5000),denominations:{counts:{'50':1},others:0}}}});

  // 4. Contra Withdrawal: 20.00 (2000 paise) - Bank -> Cash -> Bank Credit
  const withdrawal=book.saveVoucher({type:'contra',date:'2026-04-01',source_id:bank.id,destination_id:1,amount:2000,narration:'Cash withdrawal',details:{bank:bankAllocation(bank,'Cheque',2000,'000301')}});

  return {customer,supplier,bank,sale,purchase,receipt,payment,deposit,withdrawal};
}

test('BRS: Initial unreconciled state computes correct company balance and unreflected amounts matching Tally',()=>{
  const directory=mkdtempSync(join(tmpdir(),'bookr-brs-'));
  const file=join(directory,'book.sqlite');
  let book=new Book(file);
  try{
    const {bank,receipt,payment,deposit,withdrawal}=createBankFixture(book);
    const brs=book.bankReconciliation(bank.id,{asOfDate:'2026-04-01'});

    // Balance as per Company Books: 300 + 50 - 100 - 20 = 230.00 (23000 paise)
    assert.equal(brs.balance_as_per_company_books,23000);

    // Amounts not reflected in Bank:
    // Debits: Receipt (30000) + Deposit (5000) = 35000 (350.00)
    // Credits: Payment (10000) + Withdrawal (2000) = 12000 (120.00)
    assert.equal(brs.amounts_not_reflected.debit,35000);
    assert.equal(brs.amounts_not_reflected.credit,12000);

    // Balance as per Bank: 23000 - 35000 + 12000 = 0 (0.00)
    assert.equal(brs.balance_as_per_bank,0);

    // Rows: All 4 transactions are unreconciled
    assert.equal(brs.rows.length,4);
    assert.deepEqual(brs.rows.map(r=>[r.particulars,r.voucher_type,r.debit,r.credit]),[
      ['Demo Customer','Receipt',30000,0],
      ['Study Supplier Fictional','Payment',0,10000],
      ['Cash','Contra',5000,0],
      ['Cash','Contra',0,2000]
    ]);
  }finally{
    book.close();
    rmSync(directory,{recursive:true,force:true});
  }
});

test('BRS: Setting bank date reconciles entries, updates summary, and excludes from unreconciled view',()=>{
  const directory=mkdtempSync(join(tmpdir(),'bookr-brs-'));
  const file=join(directory,'book.sqlite');
  let book=new Book(file);
  try{
    const {bank,receipt,payment}=createBankFixture(book);

    // Reconcile receipt with bank date 2026-04-01
    book.reconcileBankVouchers(bank.id,[
      {voucher_id:receipt.id,bank_date:'2026-04-01'}
    ]);

    let brs=book.bankReconciliation(bank.id,{asOfDate:'2026-04-01'});
    // Remaining unreflected debits: 5000 (Contra deposit only)
    assert.equal(brs.amounts_not_reflected.debit,5000);
    assert.equal(brs.amounts_not_reflected.credit,12000);
    // Balance as per Bank: 23000 - 5000 + 12000 = 30000 (300.00) - matches Tally exactly!
    assert.equal(brs.balance_as_per_bank,30000);
    // Unreconciled rows count = 3
    assert.equal(brs.rows.length,3);
    assert.ok(!brs.rows.some(r=>r.voucher_id===receipt.id));

    // When include_reconciled is true, all 4 rows appear with bank_date set on receipt
    const allBrs=book.bankReconciliation(bank.id,{asOfDate:'2026-04-01',includeReconciled:true});
    assert.equal(allBrs.rows.length,4);
    const receiptRow=allBrs.rows.find(r=>r.voucher_id===receipt.id);
    assert.equal(receiptRow.bank_date,'2026-04-01');

    // Reconcile payment as well
    book.reconcileBankVouchers(bank.id,[
      {voucher_id:payment.id,bank_date:'2026-04-01'}
    ]);

    brs=book.bankReconciliation(bank.id,{asOfDate:'2026-04-01'});
    assert.equal(brs.amounts_not_reflected.debit,5000);
    assert.equal(brs.amounts_not_reflected.credit,2000);
    // Balance as per Bank: 23000 - 5000 + 2000 = 20000 (200.00) - matches Tally exactly!
    assert.equal(brs.balance_as_per_bank,20000);
    assert.equal(brs.rows.length,2);

    // Persistence check across close and reopen
    book.close();
    book=new Book(file);
    brs=book.bankReconciliation(bank.id,{asOfDate:'2026-04-01'});
    assert.equal(brs.balance_as_per_bank,20000);
    assert.equal(brs.rows.length,2);
  }finally{
    book.close();
    rmSync(directory,{recursive:true,force:true});
  }
});

test('BRS: Clearing bank date un-reconciles transactions',()=>{
  const directory=mkdtempSync(join(tmpdir(),'bookr-brs-'));
  const file=join(directory,'book.sqlite');
  let book=new Book(file);
  try{
    const {bank,receipt}=createBankFixture(book);
    book.reconcileBankVouchers(bank.id,[{voucher_id:receipt.id,bank_date:'2026-04-01'}]);
    assert.equal(book.bankReconciliation(bank.id).rows.length,3);

    // Clear bank date
    book.reconcileBankVouchers(bank.id,[{voucher_id:receipt.id,bank_date:null}]);
    const brs=book.bankReconciliation(bank.id);
    assert.equal(brs.rows.length,4);
    assert.equal(brs.amounts_not_reflected.debit,35000);
  }finally{
    book.close();
    rmSync(directory,{recursive:true,force:true});
  }
});

test('BRS: Validation rejects invalid bank dates and back-dated bank dates',()=>{
  const directory=mkdtempSync(join(tmpdir(),'bookr-brs-'));
  const file=join(directory,'book.sqlite');
  let book=new Book(file);
  try{
    const {bank,receipt}=createBankFixture(book);
    // Invalid format
    assert.throws(()=>{
      book.reconcileBankVouchers(bank.id,[{voucher_id:receipt.id,bank_date:'not-a-date'}]);
    },/valid bank date/i);

    // Bank date earlier than voucher date (voucher is 2026-04-01)
    assert.throws(()=>{
      book.reconcileBankVouchers(bank.id,[{voucher_id:receipt.id,bank_date:'2026-03-31'}]);
    },/cannot be earlier than voucher date/i);
  }finally{
    book.close();
    rmSync(directory,{recursive:true,force:true});
  }
});
