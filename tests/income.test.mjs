import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Book,BookError} from '../lib/accounting.mjs';
import {journalFixture} from './journal-fixture.mjs';

function fixture(book){
  const f=journalFixture(book);
  const journal=book.saveVoucher({type:'journal',date:'2026-04-01',debit_ledger_id:f.expense.id,credit_ledger_id:f.supplier.id,debit_amount:12500,credit_amount:12500,bill:{reference:'JRN-001'}});
  const payment=book.saveVoucher({type:'payment',date:'2026-04-01',supplier_id:f.supplier.id,account_id:1,amount:5000,allocations:[{bill_id:journal.bill.id,amount:5000}]});
  return {...f,journal,payment};
}
const incomeLedger=book=>book.saveLedger({kind:'income',name:'Study Other Income',alias:'SOI',ledger_type:'Not Applicable'});
const receiptInput=(income,patch={})=>({type:'receipt',date:'2026-04-01',ledger_id:income.id,account_id:1,amount:12000,narration:'Fictional other income',...patch});
const receiptUpdate=(voucher,patch={})=>({type:'receipt',date:voucher.date,ledger_id:voucher.ledger_id,account_id:voucher.account_id,amount:voucher.amount,narration:voucher.narration,allocations:structuredClone(voucher.allocations),details:structuredClone(voucher.details),revision:voucher.revision,...patch});
const bankAllocation=(bank,amount,number='000501')=>({account_id:bank.id,transaction_type:'Cheque/DD',amount,instrument_number:number,instrument_date:'2026-04-01',bank_name:'Not Applicable',cheque_range:''});
const tables=['ledgers','vouchers','postings','bills','receipt_allocations','bank_accounts'];
const tableRows=db=>Object.fromEntries(tables.map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(row=>({...row}))]));
const cleanup=directory=>{assert.ok(directory.startsWith(join(tmpdir(),'bookr-income-')));rmSync(directory,{recursive:true,force:true});};

test('observed cash income Receipt4 saves without bills and reopens with native cash, income, gross/net profit and Balance Sheet',()=>{
  const directory=mkdtempSync(join(tmpdir(),'bookr-income-')),file=join(directory,'book.sqlite');let book=new Book(file);
  try{
    const f=fixture(book),income=incomeLedger(book),before=book.state();assert.equal(before.vouchers.length,13);assert.equal(book.statement(1).balance,47025);
    const settle=book.settlementBills;book.settlementBills=()=>{throw new Error('Income must not request bill allocations.');};
    const receipt=book.saveVoucher(receiptInput(income));book.settlementBills=settle;
    assert.equal(receipt.number,4);assert.equal(receipt.ledger_id,income.id);assert.equal(receipt.ledger_name,'Study Other Income');assert.equal(receipt.ledger_kind,'income');assert.equal(Object.hasOwn(receipt,'supplier_id'),false);
    assert.deepEqual(receipt.allocations,[]);assert.equal(receipt.bill,null);assert.equal(receipt.sale_id,null);
    assert.deepEqual(receipt.postings.map(p=>[p.ledger_id,p.side,p.amount]).sort(),[[1,'debit',12000],[income.id,'credit',12000]].sort());
    assert.equal(book.statement(1).balance,59025);assert.equal(book.statement(income.id).balance,-12000);assert.equal(book.statement(f.expense.id).balance,20000);assert.equal(book.statement(f.bank.id).balance,23000);assert.equal(book.statement(f.customer.id).balance,197550);assert.equal(book.statement(f.supplier.id).balance,-87500);
    assert.deepEqual(book.outstanding(),before.outstanding);assert.deepEqual(book.payables(),before.payables);
    const report=book.financialReports(),pl=report.profitAndLoss;
    assert.equal(pl.income,350075);assert.equal(pl.expenses,150000);assert.equal(pl.grossProfit,200075);assert.equal(pl.indirectExpenses,20000);assert.equal(pl.indirectIncome,12000);assert.equal(pl.netProfit,192075);assert.equal(pl.profit,192075);
    assert.deepEqual(pl.tradingTotals,{debit:350075,credit:350075});assert.deepEqual(pl.totals,{debit:212075,credit:212075});
    assert.deepEqual(pl.groups.map(g=>g.key),['purchases','sales','indirect-expenses','indirect-incomes']);assert.deepEqual(pl.groups[3].ledgers,[{id:income.id,name:income.name,amount:12000}]);
    assert.deepEqual(report.balanceSheet.profit,{opening:0,current:192075,closing:192075});assert.deepEqual(report.balanceSheet.totals,{assets:279575,liabilities:279575,balanced:true});
    const monthly=book.monthlySummary(income.id);assert.equal(monthly.rows[0].credit,12000);assert.equal(monthly.rows[0].debit,0);assert.equal(monthly.totals.closing,-12000);
    const day=book.dayBook({type:'receipt'}),row=day.rows.find(row=>row.id===receipt.id);assert.equal(row.ledger_kind,'income');assert.equal(row.ledger_name,income.name);assert.equal(book.state().totals.balanced,true);
    const renamed=book.saveLedger({...income,name:'Renamed Other Income'},income.id);assert.equal(book.voucher(receipt.id).ledger_name,renamed.name);assert.equal(book.masterLedger(income.id).ledger_type,'Not Applicable');
    const saved=book.state(),savedReceipt=book.voucher(receipt.id);book.close();book=new Book(file);assert.deepEqual(book.state(),saved);assert.deepEqual(book.voucher(receipt.id),savedReceipt);assert.equal(book.db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{book.close();cleanup(directory);}
});

test('customer and income receipt corrections release and restore only customer bill allocations',()=>{
  const book=new Book();try{
    const f=fixture(book),income=incomeLedger(book),sale=book.state().vouchers.find(v=>v.type==='sale'),original=book.outstanding(),payables=book.payables();
    let receipt=book.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:f.customer.id,account_id:1,amount:5000,allocations:[{bill_id:sale.bill.id,amount:5000}]});
    assert.equal(receipt.ledger_kind,'customer');assert.equal(book.outstanding().find(b=>b.id===sale.id).pending,5000);
    receipt=book.saveVoucher(receiptUpdate(receipt,{ledger_id:income.id,amount:12000,allocations:[]}),receipt.id);
    assert.equal(receipt.ledger_kind,'income');assert.deepEqual(receipt.allocations,[]);assert.equal(receipt.sale_id,null);assert.deepEqual(book.outstanding(),original);assert.deepEqual(book.payables(),payables);assert.equal(book.statement(income.id).balance,-12000);
    const stable=book.state();
    for(const patch of [{ledger_id:f.customer.id,allocations:[]},{ledger_id:f.customer.id,allocations:undefined},{ledger_id:f.customer.id,allocations:[{bill_id:f.journal.bill.id,amount:12000}]},{ledger_id:f.customer.id,allocations:[{bill_id:sale.bill.id,amount:12000}]}]){
      assert.throws(()=>book.saveVoucher(receiptUpdate(receipt,patch),receipt.id),BookError);assert.deepEqual(book.state(),stable);
    }
    receipt=book.saveVoucher(receiptUpdate(receipt,{ledger_id:f.customer.id,amount:5000,allocations:[{bill_id:sale.bill.id,amount:5000}]}),receipt.id);
    assert.equal(receipt.ledger_kind,'customer');assert.equal(receipt.sale_id,sale.id);assert.equal(book.statement(income.id).balance,0);assert.equal(book.statement(1).balance,52025);assert.equal(book.financialReports().profitAndLoss.netProfit,180075);
    receipt=book.saveVoucher(receiptUpdate(receipt,{ledger_id:income.id,amount:12000,allocations:[]}),receipt.id);
    const outstanding=book.outstanding();book.db.prepare('INSERT INTO receipt_allocations(receipt_id,bill_id,amount,position) VALUES(?,?,?,0)').run(receipt.id,sale.bill.id,1000);
    assert.deepEqual(book.outstanding(),outstanding);assert.deepEqual(book.allocations(receipt.id),[]);assert.equal(book.allocated(sale.id),90000);assert.deepEqual(book.payables(),payables);
  }finally{book.close();}
});

test('income receipts reject unsupported parties, bills and malformed amounts without bypassing customer or Journal rules',()=>{
  const book=new Book();try{
    const f=fixture(book),income=incomeLedger(book),base=receiptInput(income),sale=book.state().vouchers.find(v=>v.type==='sale'),stable=book.state();
    const bad=[{ledger_id:undefined},{ledger_id:0},{ledger_id:-1},{ledger_id:1.5},{ledger_id:'unknown'},{ledger_id:f.supplier.id},{ledger_id:f.expense.id},{ledger_id:1},{ledger_id:2},{ledger_id:f.bank.id},{ledger_id:income.id,customer_id:f.customer.id},{ledger_id:undefined,customer_id:income.id},{customer_id:income.id},
      {account_id:income.id},{account_id:f.customer.id},{amount:0},{amount:-1},{amount:1.5},{amount:'12000'},{amount:100000000001},{date:'2026-02-30'},{details:[]},
      {bill:{reference:'Not a bill'}},{sale_id:sale.id},{allocations:[{bill_id:sale.bill.id,amount:12000}]},{allocations:[{bill_id:f.journal.bill.id,amount:12000}]},{allocations:null},{allocations:{}},{details:{bank:bankAllocation(f.bank,12000)}}];
    for(const patch of bad){assert.throws(()=>book.saveVoucher({...base,...patch}),BookError,JSON.stringify(patch));assert.deepEqual(book.state(),stable);}
    assert.throws(()=>book.receiptBills(income.id),BookError);assert.throws(()=>book.paymentBills(income.id),BookError);
    for(const request of [{type:'payment',date:base.date,ledger_id:income.id,account_id:1,amount:12000},{type:'sale',date:base.date,customer_id:income.id,account_id:2,amount:12000},{type:'journal',date:base.date,debit_ledger_id:income.id,credit_ledger_id:f.supplier.id,debit_amount:12000,credit_amount:12000}]){assert.throws(()=>book.saveVoucher(request),BookError);assert.deepEqual(book.state(),stable);}
    for(const allocations of [[],undefined])assert.throws(()=>book.saveVoucher({type:'receipt',date:base.date,customer_id:f.customer.id,account_id:1,amount:1,allocations}),BookError);
    const valid=book.saveVoucher({...base,allocations:[]});assert.equal(valid.allocations.length,0);assert.equal(valid.ledger_kind,'income');
    const customerReceipt=book.saveVoucher({type:'receipt',date:base.date,ledger_id:f.customer.id,customer_id:f.customer.id,account_id:1,amount:1,allocations:[{bill_id:sale.bill.id,amount:1}]});assert.equal(customerReceipt.ledger_kind,'customer');
  }finally{book.close();}
});

test('bank income composition preserves DD metadata and paise, and rolls back incomplete writes and stale alterations',()=>{
  // Native income was Cash; bank uses the independently observed Cheque/DD path.
  const book=new Book();try{
    const f=fixture(book),income=incomeLedger(book),amount=12025,input=receiptInput(income,{account_id:f.bank.id,amount,details:{bank:bankAllocation(f.bank,amount)}});
    let receipt=book.saveVoucher(input);assert.deepEqual(receipt.details.bank,input.details.bank);assert.equal(book.statement(f.bank.id).balance,35025);assert.equal(book.statement(1).balance,47025);assert.equal(book.statement(income.id).balance,-12025);
    const stable=book.state();for(const patch of [{details:{bank:{...input.details.bank,transaction_type:'Cheque'}}},{details:{bank:{...input.details.bank,amount:12000}}},{details:{bank:{...input.details.bank,account_id:1}}},{details:{bank:{...input.details.bank,instrument_date:'2026-02-30'}}},{amount:12026},{account_id:1}]){assert.throws(()=>book.saveVoucher(receiptUpdate(receipt,patch),receipt.id),BookError);assert.deepEqual(book.state(),stable);}
    const unchanged=receiptUpdate(receipt,{narration:'Keep bank metadata'});delete unchanged.details;receipt=book.saveVoucher(unchanged,receipt.id);assert.deepEqual(receipt.details.bank,input.details.bank);
    const before=tableRows(book.db);book.db.exec(`CREATE TRIGGER fail_income_credit BEFORE INSERT ON postings WHEN NEW.ledger_id=${income.id} AND NEW.side='credit' BEGIN SELECT RAISE(ABORT,'simulated income credit failure'); END;`);
    assert.throws(()=>book.saveVoucher(receiptInput(income)),/simulated income/);assert.deepEqual(tableRows(book.db),before);
    assert.throws(()=>book.saveVoucher(receiptUpdate(receipt,{account_id:1,details:{bank:null}}),receipt.id),/simulated income/);assert.deepEqual(tableRows(book.db),before);book.db.exec('DROP TRIGGER fail_income_credit');
    const old=receipt;receipt=book.saveVoucher(receiptUpdate(receipt,{account_id:1,details:{bank:null}}),receipt.id);assert.equal(Object.hasOwn(receipt.details,'bank'),false);assert.equal(book.statement(f.bank.id).balance,23000);assert.equal(book.statement(1).balance,59050);assert.equal(receipt.number,4);assert.equal(receipt.postings.length,2);
    const saved=book.state();assert.throws(()=>book.saveVoucher(receiptUpdate(old),receipt.id),e=>e.status===409);assert.deepEqual(book.state(),saved);
    const otherBank=book.saveBank({name:'Other Fictional Income Bank'}),beforeBank=book.state();assert.throws(()=>book.saveVoucher(receiptUpdate(receipt,{account_id:otherBank.id}),receipt.id),BookError);assert.deepEqual(book.state(),beforeBank);
    receipt=book.saveVoucher(receiptUpdate(receipt,{account_id:otherBank.id,details:{bank:bankAllocation(otherBank,amount,'000502')}}),receipt.id);assert.equal(receipt.details.bank.instrument_number,'000502');assert.equal(book.statement(1).balance,47025);assert.equal(book.statement(otherBank.id).balance,12025);
    const typeStable=book.state();assert.throws(()=>book.saveVoucher(receiptUpdate(receipt,{type:'payment'}),receipt.id),BookError);assert.deepEqual(book.state(),typeStable);
  }finally{book.close();}
});

test('income periods retain prior accumulated profit and distinguish gross loss, offset net profit, zero and equal expense/income',()=>{
  const book=new Book();try{
    const supplier=book.saveSupplier({name:'Period Supplier'}),income=incomeLedger(book),expense=book.saveLedger({kind:'expense',name:'Period Expense'}),purchase=book.ledgers().find(l=>l.kind==='purchase');
    book.saveVoucher({type:'purchase',date:'2026-04-01',supplier_id:supplier.id,account_id:purchase.id,amount:5000});
    book.saveVoucher(receiptInput(income,{amount:7500}));
    const first=book.financialReports({from:'2026-04-01',to:'2026-04-01'});assert.equal(first.profitAndLoss.grossProfit,-5000);assert.equal(first.profitAndLoss.netProfit,2500);assert.deepEqual(first.profitAndLoss.tradingTotals,{debit:5000,credit:5000});assert.deepEqual(first.profitAndLoss.totals,{debit:7500,credit:7500});assert.equal(first.balanceSheet.totals.balanced,true);
    book.saveVoucher(receiptInput(income,{date:'2026-04-02',amount:12025}));book.saveVoucher({type:'payment',date:'2026-04-02',ledger_id:expense.id,account_id:1,amount:12025});
    const equal=book.financialReports({from:'2026-04-02',to:'2026-04-02'});assert.equal(equal.profitAndLoss.grossProfit,0);assert.equal(equal.profitAndLoss.indirectIncome,12025);assert.equal(equal.profitAndLoss.indirectExpenses,12025);assert.equal(equal.profitAndLoss.netProfit,0);assert.deepEqual(equal.profitAndLoss.totals,{debit:12025,credit:12025});assert.deepEqual(equal.balanceSheet.profit,{opening:2500,current:0,closing:2500});
    book.saveVoucher(receiptInput(income,{date:'2026-04-03',amount:333}));
    const pure=book.financialReports({from:'2026-04-03',to:'2026-04-03'});assert.equal(pure.profitAndLoss.income,0);assert.equal(pure.profitAndLoss.indirectIncome,333);assert.equal(pure.profitAndLoss.netProfit,333);assert.deepEqual(pure.profitAndLoss.totals,{debit:333,credit:333});assert.deepEqual(pure.balanceSheet.profit,{opening:2500,current:333,closing:2833});assert.equal(pure.balanceSheet.totals.balanced,true);
    const empty=book.financialReports({from:'2026-04-04',to:'2026-04-04'});assert.equal(empty.profitAndLoss.netProfit,0);assert.deepEqual(empty.profitAndLoss.totals,{debit:0,credit:0});assert.deepEqual(empty.balanceSheet.profit,{opening:2833,current:0,closing:2833});assert.equal(empty.balanceSheet.totals.balanced,true);
    const before=book.financialReports({to:'2026-04-01'});assert.equal(before.profitAndLoss.indirectIncome,7500);assert.equal(before.balanceSheet.profit.closing,2500);
  }finally{book.close();}
  for(const amount of [2500,5000]){
    const loss=new Book();try{
      const supplier=loss.saveSupplier({name:'Loss Supplier'}),income=incomeLedger(loss);loss.saveVoucher({type:'purchase',date:'2026-04-01',supplier_id:supplier.id,account_id:loss.ledgers().find(l=>l.kind==='purchase').id,amount:5000});loss.saveVoucher(receiptInput(income,{amount}));
      const report=loss.financialReports();assert.equal(report.profitAndLoss.grossProfit,-5000);assert.equal(report.profitAndLoss.netProfit,amount-5000);assert.deepEqual(report.profitAndLoss.totals,{debit:5000,credit:5000});assert.equal(report.balanceSheet.totals.balanced,true);
    }finally{loss.close();}
  }
});

test('income and expense masters preserve blank mailing defaults and omitted saved mailing fields across revision-protected renames',()=>{
  const book=new Book();try{
    for(const kind of ['income','expense']){
      let ledger=book.saveLedger({kind,name:'Blank '+kind});assert.equal(ledger.ledger_type,'Not Applicable');for(const key of ['mailing_name','address','state','country','pincode'])assert.equal(ledger[key],'',key);
      const old=ledger;ledger=book.saveLedger({name:'Renamed '+kind,revision:ledger.revision},ledger.id);for(const key of ['mailing_name','address','state','country','pincode'])assert.equal(ledger[key],'',key);
      ledger=book.saveLedger({name:ledger.name,revision:ledger.revision,mailing_name:'Fictional Mailing',address:'Fictional Address',state:'Fictional State',country:'Fictional Country',pincode:'000001'},ledger.id);
      const custom=ledger;ledger=book.saveLedger({name:'Again '+kind,revision:ledger.revision},ledger.id);for(const key of ['mailing_name','address','state','country','pincode'])assert.equal(ledger[key],custom[key],key);
      const stable=book.state();for(const change of [{kind:kind==='income'?'expense':'income'},{ledger_type:'Invoice Rounding'},{opening_balance:1},{mailing_name:123}]){assert.throws(()=>book.saveLedger({name:ledger.name,revision:ledger.revision,...change},ledger.id),BookError);assert.deepEqual(book.state(),stable);}
      assert.throws(()=>book.saveLedger({name:old.name,revision:old.revision},old.id),e=>e.status===409);assert.deepEqual(book.state(),stable);assert.throws(()=>book.saveLedger({kind,name:ledger.name.toUpperCase()}),BookError);assert.deepEqual(book.state(),stable);
    }
    for(const ledger_type of ['Invoice Rounding',null,42])assert.throws(()=>book.saveLedger({kind:'income',name:'Invalid '+ledger_type,ledger_type}),BookError);
    const customer=book.createCustomer({name:'Mailing Customer'});assert.equal(customer.mailing_name,customer.name);assert.equal(customer.state,'Not Applicable');assert.equal(customer.country,'India');
  }finally{book.close();}
});

test('populated pre-income schema migration preserves Journal, bank metadata, Contra and bill allocations exactly',()=>{
  const directory=mkdtempSync(join(tmpdir(),'bookr-income-migration-')),file=join(directory,'old.sqlite'),source=new Book();let book;
  try{
    const f=fixture(source);source.saveBank({...f.bank,bank:{account_holder:'Fictional Holder',account_number:'000123456789',ifs_code:'FAKE0000001',swift_code:'FICTIONAL',branch:'Fictional Branch'}},f.bank.id);
    const expected=tableRows(source.db),state=source.state(),old=new DatabaseSync(file);
    try{
      old.exec('PRAGMA foreign_keys=ON');for(const table of tables){let sql=source.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table).sql;if(table==='ledgers')sql=sql.replace(",'income'",'');old.exec(sql);}
      for(const table of tables){const rows=expected[table];if(!rows.length)continue;const columns=Object.keys(rows[0]),insert=old.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`);for(const row of rows)insert.run(...columns.map(c=>row[c]));}
      assert.equal(old.prepare("SELECT sql FROM sqlite_master WHERE name='ledgers'").get().sql.includes("'income'"),false);
    }finally{old.close();}
    book=new Book(file);assert.deepEqual(tableRows(book.db),expected);assert.deepEqual(book.state(),state);assert.equal(book.db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);assert.equal(book.db.prepare('PRAGMA foreign_key_check').all().length,0);assert.equal(book.payables().find(b=>b.id===f.journal.id).pending,7500);
    const income=incomeLedger(book),receipt=book.saveVoucher(receiptInput(income));assert.equal(receipt.number,4);assert.equal(book.statement(1).balance,59025);const saved=book.state();book.close();book=new Book(file);assert.deepEqual(book.state(),saved);assert.equal(book.masterLedger(income.id).ledger_type,'Not Applicable');assert.equal(book.masterLedger(f.bank.id).bank.account_number,'000123456789');assert.equal(book.db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{source.close();book?.close();cleanup(directory);}
});
