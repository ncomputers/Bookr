import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {Book,BookError} from '../lib/accounting.mjs';

const bankAllocation=(bank,type,amount,number='')=>({account_id:bank.id,transaction_type:type,amount,instrument_number:number,instrument_date:'2026-04-01',bank_name:'Not Applicable',cheque_range:type==='Cheque'?'Not Applicable':''});
function fixture(book){
  const customer=book.createCustomer({name:'Demo Customer'}),supplier=book.saveSupplier({name:'Study Supplier Fictional'}),bank=book.saveBank({name:'Study Bank Fictional',bank:{account_number:'000123456789',branch:'Fictional Branch'}});
  const first=book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:100000});
  const second=book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:250075,bill:{reference:'STUDY-BILL-02'}});
  book.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1,amount:40000,allocations:[{bill_id:first.bill.id,amount:40000}]});
  book.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1,amount:82525,allocations:[{bill_id:second.bill.id,amount:62525},{bill_id:first.bill.id,amount:20000}]});
  const purchase=book.saveVoucher({type:'purchase',date:'2026-04-01',supplier_id:supplier.id,account_id:book.ledgers().find(l=>l.kind==='purchase').id,amount:150000,bill:{reference:'sup-001'}});
  book.saveVoucher({type:'payment',date:'2026-04-01',supplier_id:supplier.id,account_id:1,amount:60000,allocations:[{bill_id:purchase.bill.id,amount:60000}]});
  book.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:bank.id,amount:30000,allocations:[{bill_id:first.bill.id,amount:30000}],details:{bank:bankAllocation(bank,'Cheque/DD',30000,'000101')}});
  book.saveVoucher({type:'payment',date:'2026-04-01',supplier_id:supplier.id,account_id:bank.id,amount:10000,allocations:[{bill_id:purchase.bill.id,amount:10000}],details:{bank:bankAllocation(bank,'Cheque',10000,'000201')}});
  book.saveVoucher({type:'contra',date:'2026-04-01',source_id:1,destination_id:bank.id,amount:5000,details:{bank:{...bankAllocation(bank,'Cash',5000),denominations:{counts:{'50':1},others:0}}}});
  book.saveVoucher({type:'contra',date:'2026-04-01',source_id:bank.id,destination_id:1,amount:2000,details:{bank:bankAllocation(bank,'Cheque',2000,'000301')}});
  return {customer,supplier,bank,first,purchase};
}
const expenseLedger=book=>book.saveLedger({kind:'expense',name:'Study Office Expense',ledger_type:'Not Applicable'});
const expenseInput=expense=>({type:'payment',date:'2026-04-01',ledger_id:expense.id,account_id:1,amount:7500,allocations:[],narration:'Fictional office expense'});
const paymentInput=voucher=>({type:'payment',date:voucher.date,ledger_id:voucher.ledger_id,account_id:voucher.account_id,amount:voucher.amount,narration:voucher.narration,allocations:structuredClone(voucher.allocations),details:structuredClone(voucher.details),revision:voucher.revision});
const tableNames=['ledgers','vouchers','postings','bills','receipt_allocations','bank_accounts'];
const tableRows=db=>Object.fromEntries(tableNames.map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));

test('native cash expense75 skips bill allocation and preserves observed cash, gross/net profit and Balance Sheet after reopening',()=>{
  const directory=mkdtempSync(join(tmpdir(),'bookr-expenses-')),file=join(directory,'book.sqlite');let book=new Book(file);
  try{
    const {customer,supplier,bank}=fixture(book),expense=expenseLedger(book),before=book.state();
    assert.equal(expense.kind,'expense');assert.equal(expense.ledger_type,'Not Applicable');
    const settlement=book.settlementBills;book.settlementBills=()=>{throw new Error('Expense must not request bill allocation.');};
    const saved=book.saveVoucher(expenseInput(expense));book.settlementBills=settlement;
    assert.equal(saved.number,3);assert.equal(saved.ledger_id,expense.id);assert.equal(saved.ledger_name,expense.name);assert.equal(saved.ledger_kind,'expense');
    assert.equal(Object.hasOwn(saved,'supplier_id'),false);assert.equal(Object.hasOwn(saved,'supplier_name'),false);assert.deepEqual(saved.allocations,[]);assert.equal(saved.bill,null);assert.equal(saved.sale_id,null);
    assert.deepEqual(saved.postings.map(p=>[p.ledger_id,p.side,p.amount]),[[expense.id,'debit',7500],[1,'credit',7500]]);
    assert.equal(book.statement(1).balance,52025);assert.equal(book.statement(expense.id).balance,7500);assert.equal(book.statement(bank.id).balance,23000);
    assert.equal(book.statement(customer.id).balance,197550);assert.equal(book.statement(supplier.id).balance,-80000);
    assert.deepEqual(book.outstanding(),before.outstanding);assert.deepEqual(book.payables(),before.payables);
    const report=book.financialReports(),pl=report.profitAndLoss;assert.equal(pl.income,350075);assert.equal(pl.expenses,150000);assert.equal(pl.grossProfit,200075);assert.equal(pl.indirectExpenses,7500);assert.equal(pl.profit,192575);assert.equal(pl.netProfit,192575);
    assert.deepEqual(pl.tradingTotals,{debit:350075,credit:350075});assert.deepEqual(pl.totals,{debit:200075,credit:200075});assert.equal(pl.groups[2].key,'indirect-expenses');assert.deepEqual(pl.groups[2].ledgers,[{id:expense.id,name:expense.name,amount:7500}]);
    assert.deepEqual(report.balanceSheet.totals,{assets:272575,liabilities:272575,balanced:true});assert.deepEqual(report.balanceSheet.profit,{opening:0,current:192575,closing:192575});
    assert.deepEqual(book.trialBalance().totals,{debit:430075,credit:430075,balanced:true});
    const daybook=book.dayBook({type:'payment'});assert.deepEqual(daybook.totals,{debit:77500,credit:0});assert.equal(daybook.rows.find(row=>row.id===saved.id).ledger_kind,'expense');
    const statement=book.statement(expense.id);assert.deepEqual(statement.rows.map(r=>[r.type,r.particulars,r.side,r.amount]),[['payment','Cash','debit',7500]]);
    const renamed=book.saveLedger({...expense,name:'Renamed Study Office Expense'},expense.id);assert.equal(renamed.ledger_type,'Not Applicable');assert.equal(book.voucher(saved.id).ledger_name,renamed.name);
    const stable=book.state();book.close();book=new Book(file);assert.deepEqual(book.state(),stable);assert.deepEqual(book.voucher(saved.id).details,saved.details);assert.equal(book.masterLedger(expense.id).ledger_type,'Not Applicable');
    assert.equal(book.db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{book.close();assert.ok(directory.startsWith(join(tmpdir(),'bookr-expenses-')));rmSync(directory,{recursive:true,force:true});}
});

test('expense and supplier payment validation keep direct costs separate from bill settlements',()=>{
  const book=new Book();try{
    const {customer,supplier,bank,first,purchase}=fixture(book),expense=expenseLedger(book),input=expenseInput(expense),before=book.state();
    const invalid=[{...input,ledger_id:customer.id},{...input,ledger_id:1},{...input,ledger_id:2},{...input,ledger_id:bank.id},
      {...input,ledger_id:undefined,supplier_id:expense.id},{...input,supplier_id:supplier.id},
      {...input,bill:{reference:'No expense bill'}},{...input,sale_id:purchase.id},{...input,allocations:[{bill_id:purchase.bill.id,amount:7500}]},
      {...input,allocations:[{bill_id:first.bill.id,amount:7500}]},{...input,allocations:null},{...input,allocations:{}},
      {...input,type:'purchase',supplier_id:expense.id,account_id:book.ledgers().find(l=>l.kind==='purchase').id},
      {...input,type:'receipt',customer_id:expense.id}];
    for(const value of invalid){assert.throws(()=>book.saveVoucher(value),BookError);assert.deepEqual(book.state(),before);}
    assert.throws(()=>book.saveLedger({kind:'expense',name:'No rounding',ledger_type:'Invoice Rounding'}),BookError);assert.deepEqual(book.state(),before);
    const omitted={...input};delete omitted.allocations;const saved=book.saveVoucher(omitted);assert.deepEqual(saved.allocations,[]);
    assert.throws(()=>book.saveVoucher({...input,ledger_id:supplier.id}),BookError);
    const supplierPayment=book.saveVoucher({...input,ledger_id:supplier.id,supplier_id:supplier.id,allocations:[{bill_id:purchase.bill.id,amount:7500}]});
    assert.equal(supplierPayment.ledger_kind,'supplier');assert.equal(supplierPayment.supplier_id,supplier.id);assert.equal(supplierPayment.ledger_id,supplier.id);
  }finally{book.close();}
});

test('bank expense payments preserve full cheque details, exact paise, stale protection and transaction rollback',()=>{
  // The native expense was cash; this bank-account variation is an original
  // supported extension combining the observed bank payment and expense sides.
  const book=new Book();try{
    const {bank}=fixture(book),expense=expenseLedger(book),input={...expenseInput(expense),account_id:bank.id,amount:7525,details:{bank:bankAllocation(bank,'Cheque',7525,'000401')}};
    let saved=book.saveVoucher(input);assert.deepEqual(saved.details.bank,input.details.bank);assert.equal(book.statement(bank.id).balance,15475);assert.equal(book.statement(1).balance,59525);
    assert.equal(book.financialReports().profitAndLoss.profit,192550);
    const stable=book.state();
    assert.throws(()=>book.saveVoucher({...paymentInput(saved),amount:7526},saved.id),BookError);assert.deepEqual(book.state(),stable);
    assert.throws(()=>book.saveVoucher({...paymentInput(saved),account_id:1},saved.id),BookError);assert.deepEqual(book.state(),stable);
    const noDetails=paymentInput(saved);delete noDetails.details;saved=book.saveVoucher({...noDetails,narration:'Retain cheque'},saved.id);assert.deepEqual(saved.details.bank,input.details.bank);
    const before=book.state();book.db.exec(`CREATE TRIGGER fail_expense_credit BEFORE INSERT ON postings WHEN NEW.ledger_id=1 AND NEW.side='credit' BEGIN SELECT RAISE(ABORT,'simulated expense credit failure'); END;`);
    assert.throws(()=>book.saveVoucher({...paymentInput(saved),account_id:1,details:{bank:null}},saved.id),/simulated/);assert.deepEqual(book.state(),before);book.db.exec('DROP TRIGGER fail_expense_credit');
    const cash=book.saveVoucher({...paymentInput(saved),account_id:1,details:{bank:null}},saved.id);assert.equal(Object.hasOwn(cash.details,'bank'),false);assert.equal(book.statement(bank.id).balance,23000);assert.equal(book.statement(1).balance,52000);
    assert.throws(()=>book.saveVoucher({...paymentInput(saved),narration:'Stale expense'},saved.id),e=>e.status===409);
    const bankAgain=book.saveVoucher({...paymentInput(cash),account_id:bank.id,details:{bank:bankAllocation(bank,'Cheque',7525,'000402')}},cash.id);assert.equal(bankAgain.number,saved.number);assert.equal(bankAgain.postings.length,2);assert.equal(book.statement(1).balance,59525);
  }finally{book.close();}
});

test('correcting a payment between supplier and expense releases or creates bill allocations atomically',()=>{
  const book=new Book();try{
    const {supplier,purchase}=fixture(book),expense=expenseLedger(book),payment=book.saveVoucher(expenseInput(expense));
    const supplierPayment=book.saveVoucher({...paymentInput(payment),ledger_id:supplier.id,allocations:[{bill_id:purchase.bill.id,amount:7500}]},payment.id);
    assert.equal(book.statement(expense.id).balance,0);assert.equal(book.payables()[0].pending,72500);assert.equal(supplierPayment.ledger_kind,'supplier');
    const again=book.saveVoucher({...paymentInput(supplierPayment),ledger_id:expense.id,allocations:[]},payment.id);
    assert.equal(again.ledger_kind,'expense');assert.equal(Object.hasOwn(again,'supplier_id'),false);assert.equal(book.payables()[0].pending,80000);assert.equal(book.statement(expense.id).balance,7500);
    const before=book.payables();book.db.prepare('INSERT INTO receipt_allocations(receipt_id,bill_id,amount,position) VALUES(?,?,?,0)').run(again.id,purchase.bill.id,7500);
    assert.deepEqual(book.payables(),before);assert.equal(book.allocated(purchase.id),70000);assert.deepEqual(book.allocations(again.id),[]);
  }finally{book.close();}
});

test('expense report periods distinguish gross and net losses and keep prior net profit in the Balance Sheet',()=>{
  const book=new Book();try{
    fixture(book);const expense=expenseLedger(book);book.saveVoucher({...expenseInput(expense),date:'2026-04-02'});
    book.saveVoucher({...expenseInput(expense),date:'2026-04-03',amount:200000});
    const april1=book.financialReports({from:'2026-04-01',to:'2026-04-01'});assert.equal(april1.profitAndLoss.indirectExpenses,0);assert.equal(april1.profitAndLoss.grossProfit,200075);assert.equal(april1.profitAndLoss.profit,200075);
    const april2=book.financialReports({from:'2026-04-02',to:'2026-04-02'});assert.equal(april2.profitAndLoss.grossProfit,0);assert.equal(april2.profitAndLoss.indirectExpenses,7500);assert.equal(april2.profitAndLoss.netProfit,-7500);assert.deepEqual(april2.profitAndLoss.totals,{debit:7500,credit:7500});
    assert.deepEqual(april2.balanceSheet.profit,{opening:200075,current:-7500,closing:192575});assert.deepEqual(april2.balanceSheet.totals,{assets:272575,liabilities:272575,balanced:true});
    const all=book.financialReports();assert.equal(all.profitAndLoss.grossProfit,200075);assert.equal(all.profitAndLoss.indirectExpenses,207500);assert.equal(all.profitAndLoss.profit,-7425);assert.deepEqual(all.profitAndLoss.totals,{debit:207500,credit:207500});assert.equal(all.balanceSheet.totals.balanced,true);
    const after=book.financialReports({from:'2026-04-04',to:'2026-04-04'});assert.equal(after.profitAndLoss.profit,0);assert.equal(after.balanceSheet.profit.opening,-7425);
  }finally{book.close();}
  const loss=new Book();try{
    const supplier=loss.saveSupplier({name:'Fictional Gross Loss Supplier'}),expense=expenseLedger(loss);
    loss.saveVoucher({type:'purchase',date:'2026-04-01',supplier_id:supplier.id,account_id:loss.ledgers().find(l=>l.kind==='purchase').id,amount:5000});loss.saveVoucher({...expenseInput(expense),amount:750});
    const pl=loss.financialReports().profitAndLoss;assert.equal(pl.grossProfit,-5000);assert.equal(pl.netProfit,-5750);assert.deepEqual(pl.totals,{debit:5750,credit:5750});assert.deepEqual(pl.tradingTotals,{debit:5000,credit:5000});assert.equal(loss.financialReports().balanceSheet.totals.balanced,true);
  }finally{loss.close();}
});

test('pre-expense six-kind schema migration preserves populated Contra, bank metadata, vouchers and references exactly',()=>{
  const directory=mkdtempSync(join(tmpdir(),'bookr-expense-migration-')),file=join(directory,'old.sqlite'),source=new Book();let book;
  try{
    fixture(source);const expectedRows=tableRows(source.db),expectedState=source.state(),old=new DatabaseSync(file);old.exec('PRAGMA foreign_keys=ON');
    try{
      for(const table of tableNames){let sql=source.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table).sql;if(table==='ledgers')sql=sql.replace(",'expense'",'');old.exec(sql);}
      for(const table of tableNames){const values=expectedRows[table];if(!values.length)continue;const columns=Object.keys(values[0]),insert=old.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`);for(const row of values)insert.run(...columns.map(column=>row[column]));}
      assert.equal(old.prepare("SELECT sql FROM sqlite_master WHERE name='ledgers'").get().sql.includes("'expense'"),false);
    }finally{old.close();}
    book=new Book(file);assert.deepEqual(tableRows(book.db),expectedRows);assert.deepEqual(book.state(),expectedState);assert.equal(book.db.prepare('PRAGMA foreign_key_check').all().length,0);assert.equal(book.db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
    const expense=expenseLedger(book),payment=book.saveVoucher(expenseInput(expense));assert.equal(payment.number,3);assert.equal(book.statement(1).balance,52025);
    const stable=book.state();book.close();book=new Book(file);assert.deepEqual(book.state(),stable);assert.equal(book.masterLedger(expense.id).ledger_type,'Not Applicable');
  }finally{source.close();book?.close();assert.ok(directory.startsWith(join(tmpdir(),'bookr-expense-migration-')));rmSync(directory,{recursive:true,force:true});}
});
