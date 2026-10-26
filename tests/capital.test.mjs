import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Book,BookError} from '../lib/accounting.mjs';
import {incomeFixture} from './income-fixture.mjs';

function fixture(book){
  const f=incomeFixture(book),income=book.saveLedger({kind:'income',name:'Study Other Income',alias:'SOI'});
  const incomeReceipt=book.saveVoucher({type:'receipt',date:'2026-04-01',ledger_id:income.id,account_id:1,amount:12000});
  return {...f,income,incomeReceipt};
}
const capitalLedger=(book,name='Study Owner Capital')=>book.saveLedger({kind:'capital',name,alias:'SOC'});
const funding=(capital,patch={})=>({type:'receipt',date:'2026-04-01',ledger_id:capital.id,account_id:1,amount:500000,narration:'Fictional owner capital funding',...patch});
const receiptUpdate=(receipt,patch={})=>({type:'receipt',date:receipt.date,ledger_id:receipt.ledger_id,account_id:receipt.account_id,amount:receipt.amount,narration:receipt.narration,allocations:structuredClone(receipt.allocations),details:structuredClone(receipt.details),revision:receipt.revision,...patch});
const capitalGroup=report=>report.balanceSheet.groups.find(group=>group.key==='capital');
const tables=['ledgers','vouchers','postings','bills','receipt_allocations','bank_accounts'];
const tableRows=db=>Object.fromEntries(tables.map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(row=>({...row}))]));
const cleanup=directory=>{assert.ok(directory.startsWith(join(tmpdir(),'bookr-capital-')));rmSync(directory,{recursive:true,force:true});};

test('native cash Capital Receipt5 saves without bills and reopens with capital5000, cash5590.25 and unchanged profit1920.75',()=>{
  const directory=mkdtempSync(join(tmpdir(),'bookr-capital-')),file=join(directory,'book.sqlite');let book=new Book(file);
  try{
    const f=fixture(book),capital=capitalLedger(book),before=book.state(),previousReport=book.financialReports();assert.equal(before.vouchers.length,14);assert.equal(book.statement(1).balance,59025);
    const settle=book.settlementBills;book.settlementBills=()=>{throw new Error('Capital funding must not request bill allocations.');};
    const receipt=book.saveVoucher(funding(capital));book.settlementBills=settle;
    assert.equal(receipt.number,5);assert.equal(receipt.ledger_id,capital.id);assert.equal(receipt.ledger_name,capital.name);assert.equal(receipt.ledger_kind,'capital');assert.equal(Object.hasOwn(receipt,'supplier_id'),false);assert.equal(receipt.bill,null);assert.equal(receipt.sale_id,null);assert.deepEqual(receipt.allocations,[]);
    assert.deepEqual(receipt.postings.map(row=>[row.ledger_id,row.side,row.amount]).sort(),[[1,'debit',500000],[capital.id,'credit',500000]].sort());
    assert.equal(book.statement(1).balance,559025);assert.equal(book.statement(capital.id).balance,-500000);assert.equal(book.statement(f.customer.id).balance,197550);assert.equal(book.statement(f.supplier.id).balance,-87500);assert.equal(book.statement(f.bank.id).balance,23000);assert.equal(book.statement(f.expense.id).balance,20000);assert.equal(book.statement(f.income.id).balance,-12000);
    assert.deepEqual(book.outstanding(),before.outstanding);assert.deepEqual(book.payables(),before.payables);
    const report=book.financialReports();assert.deepEqual(report.profitAndLoss,previousReport.profitAndLoss);assert.equal(report.profitAndLoss.grossProfit,200075);assert.equal(report.profitAndLoss.netProfit,192075);assert.deepEqual(report.balanceSheet.profit,{opening:0,current:192075,closing:192075});
    assert.deepEqual(report.balanceSheet.groups.map(group=>group.key),['current-assets','current-liabilities','capital']);assert.equal(report.balanceSheet.groups[1].amount,87500);assert.deepEqual(capitalGroup(report),{key:'capital',name:'Capital Account',amount:500000,ledgers:[{id:capital.id,name:capital.name,amount:500000}]});assert.deepEqual(report.balanceSheet.totals,{assets:779575,liabilities:779575,balanced:true});
    const monthly=book.monthlySummary(capital.id);assert.equal(monthly.rows[0].debit,0);assert.equal(monthly.rows[0].credit,500000);assert.equal(monthly.rows[0].closing,-500000);assert.equal(book.dayBook({type:'receipt'}).rows.find(row=>row.id===receipt.id).ledger_kind,'capital');assert.equal(book.state().totals.balanced,true);
    const renamed=book.saveLedger({...capital,name:'Renamed Owner Capital'},capital.id);assert.equal(book.voucher(receipt.id).ledger_name,renamed.name);assert.equal(capitalGroup(book.financialReports()).ledgers[0].name,renamed.name);
    const saved=book.state(),savedReceipt=book.voucher(receipt.id),savedReport=book.financialReports();book.close();book=new Book(file);assert.deepEqual(book.state(),saved);assert.deepEqual(book.voucher(receipt.id),savedReceipt);assert.deepEqual(book.financialReports(),savedReport);assert.equal(book.db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{book.close();cleanup(directory);}
});

test('capital uses cumulative closing balances across periods without entering sales, indirect income or accumulated profit',()=>{
  const book=new Book();try{
    fixture(book);const capital=capitalLedger(book),other=capitalLedger(book,'Second Fictional Owner');
    book.saveVoucher(funding(capital,{date:'2026-04-02'}));book.saveVoucher(funding(other,{date:'2026-04-03',amount:25}));
    const before=book.financialReports({from:'2026-04-01',to:'2026-04-01'});assert.equal(capitalGroup(before).amount,0);assert.deepEqual(before.balanceSheet.totals,{assets:279575,liabilities:279575,balanced:true});assert.equal(before.profitAndLoss.netProfit,192075);
    const day2=book.financialReports({from:'2026-04-02',to:'2026-04-02'});assert.equal(capitalGroup(day2).amount,500000);assert.equal(day2.profitAndLoss.income,0);assert.equal(day2.profitAndLoss.indirectIncome,0);assert.equal(day2.profitAndLoss.netProfit,0);assert.deepEqual(day2.profitAndLoss.totals,{debit:0,credit:0});assert.deepEqual(day2.balanceSheet.profit,{opening:192075,current:0,closing:192075});assert.deepEqual(day2.balanceSheet.totals,{assets:779575,liabilities:779575,balanced:true});
    const day3=book.financialReports({from:'2026-04-03',to:'2026-04-03'});assert.equal(capitalGroup(day3).amount,500025);assert.equal(day3.profitAndLoss.grossProfit,0);assert.equal(day3.profitAndLoss.netProfit,0);assert.equal(day3.balanceSheet.profit.closing,192075);assert.deepEqual(day3.balanceSheet.totals,{assets:779600,liabilities:779600,balanced:true});assert.equal(book.statement(capital.id,{from:'2026-04-03',to:'2026-04-03'}).opening,-500000);
    const empty=book.financialReports({from:'2026-04-04',to:'2026-04-04'});assert.equal(capitalGroup(empty).amount,500025);assert.equal(empty.profitAndLoss.netProfit,0);assert.equal(empty.balanceSheet.profit.opening,192075);assert.deepEqual(empty.balanceSheet.totals,day3.balanceSheet.totals);
  }finally{book.close();}
  const loss=new Book();try{
    const capital=capitalLedger(loss);loss.saveVoucher(funding(capital,{amount:1000}));let report=loss.financialReports();assert.equal(report.profitAndLoss.netProfit,0);assert.deepEqual(report.balanceSheet.profit,{opening:0,current:0,closing:0});assert.deepEqual(report.balanceSheet.totals,{assets:1000,liabilities:1000,balanced:true});
    const expense=loss.saveLedger({kind:'expense',name:'Fictional Loss Expense'});loss.saveVoucher({type:'payment',date:'2026-04-02',ledger_id:expense.id,account_id:1,amount:1500});report=loss.financialReports();assert.equal(report.profitAndLoss.netProfit,-1500);assert.equal(report.balanceSheet.profit.closing,-1500);assert.equal(capitalGroup(report).amount,1000);assert.deepEqual(report.balanceSheet.totals,{assets:1500,liabilities:1500,balanced:true});assert.ok(report.balanceSheet.presentation.liabilities.some(group=>group.key==='current-assets' && group.amount===500));
  }finally{loss.close();}
});

test('customer to capital and back corrections release allocations atomically and retain customer receipt bill requirements',()=>{
  const book=new Book();try{
    const f=fixture(book),capital=capitalLedger(book),sale=book.state().vouchers.find(v=>v.type==='sale'),before=book.outstanding(),payables=book.payables(),profit=book.financialReports().profitAndLoss;
    let receipt=book.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:f.customer.id,account_id:1,amount:5000,allocations:[{bill_id:sale.bill.id,amount:5000}]});assert.equal(book.outstanding().find(b=>b.id===sale.id).pending,5000);
    receipt=book.saveVoucher(receiptUpdate(receipt,{ledger_id:capital.id,amount:500000,allocations:[]}),receipt.id);assert.equal(receipt.ledger_kind,'capital');assert.equal(receipt.bill,null);assert.equal(receipt.sale_id,null);assert.deepEqual(receipt.allocations,[]);assert.deepEqual(book.outstanding(),before);assert.deepEqual(book.payables(),payables);assert.deepEqual(book.financialReports().profitAndLoss,profit);
    const stable=book.state();for(const patch of [{ledger_id:f.customer.id,allocations:[]},{ledger_id:f.customer.id,allocations:undefined},{ledger_id:f.customer.id,allocations:[{bill_id:f.journal.bill.id,amount:500000}]},{ledger_id:f.customer.id,allocations:[{bill_id:sale.bill.id,amount:500000}]}]){assert.throws(()=>book.saveVoucher(receiptUpdate(receipt,patch),receipt.id),BookError);assert.deepEqual(book.state(),stable);}
    receipt=book.saveVoucher(receiptUpdate(receipt,{ledger_id:f.customer.id,amount:5000,allocations:[{bill_id:sale.bill.id,amount:5000}]}),receipt.id);assert.equal(receipt.ledger_kind,'customer');assert.equal(receipt.sale_id,sale.id);assert.equal(book.statement(capital.id).balance,0);assert.equal(book.statement(1).balance,64025);assert.equal(capitalGroup(book.financialReports()).amount,0);assert.deepEqual(book.financialReports().profitAndLoss,profit);
    receipt=book.saveVoucher(receiptUpdate(receipt,{ledger_id:capital.id,amount:500000,allocations:[]}),receipt.id);const outstanding=book.outstanding();
    book.db.prepare('INSERT INTO receipt_allocations(receipt_id,bill_id,amount,position) VALUES(?,?,?,0)').run(receipt.id,sale.bill.id,1000);assert.deepEqual(book.outstanding(),outstanding);assert.equal(book.allocated(sale.id),90000);assert.deepEqual(book.allocations(receipt.id),[]);assert.deepEqual(book.payables(),payables);
  }finally{book.close();}
});

test('capital receipts reject bill references, malformed input and other voucher roles without partial writes',()=>{
  const book=new Book();try{
    const f=fixture(book),capital=capitalLedger(book),base=funding(capital),sale=book.state().vouchers.find(v=>v.type==='sale'),stable=book.state();
    for(const patch of [{ledger_id:undefined},{ledger_id:0},{ledger_id:-1},{ledger_id:1.5},{ledger_id:'missing'},{ledger_id:f.supplier.id},{ledger_id:f.expense.id},{ledger_id:1},{ledger_id:2},{ledger_id:f.bank.id},{customer_id:f.customer.id},{ledger_id:undefined,customer_id:capital.id},{customer_id:capital.id},{account_id:capital.id},{account_id:f.customer.id},{amount:0},{amount:-1},{amount:0.5},{amount:'500000'},{amount:100000000001},{date:'2026-02-30'},{details:[]},{bill:{reference:'No capital bill'}},{sale_id:sale.id},{allocations:[{bill_id:sale.bill.id,amount:500000}]},{allocations:[{bill_id:f.journal.bill.id,amount:500000}]},{allocations:null},{allocations:{}}]){assert.throws(()=>book.saveVoucher({...base,...patch}),BookError,JSON.stringify(patch));assert.deepEqual(book.state(),stable);}
    assert.throws(()=>book.receiptBills(capital.id),BookError);assert.throws(()=>book.paymentBills(capital.id),BookError);
    const invalid=[{type:'sale',date:base.date,customer_id:capital.id,account_id:2,amount:500000},{type:'purchase',date:base.date,supplier_id:capital.id,account_id:book.ledgers().find(l=>l.kind==='purchase').id,amount:500000},{type:'contra',date:base.date,source_id:capital.id,destination_id:1,amount:500000},{type:'journal',date:base.date,debit_ledger_id:capital.id,credit_ledger_id:f.supplier.id,debit_amount:500000,credit_amount:500000},{type:'journal',date:base.date,debit_ledger_id:f.expense.id,credit_ledger_id:capital.id,debit_amount:500000,credit_amount:500000}];
    for(const request of invalid){assert.throws(()=>book.saveVoucher(request),BookError);assert.deepEqual(book.state(),stable);}
    const saved=book.saveVoucher({...base,allocations:[]});assert.equal(saved.ledger_kind,'capital');assert.equal(saved.allocations.length,0);assert.equal(book.state().totals.balanced,true);
  }finally{book.close();}
});

test('capital funding creation and edits roll back both postings and preserve number, revision, exact paise and stale protection',()=>{
  const book=new Book();try{
    fixture(book);const capital=capitalLedger(book),before=tableRows(book.db),trigger=`CREATE TRIGGER fail_capital_credit BEFORE INSERT ON postings WHEN NEW.ledger_id=${capital.id} AND NEW.side='credit' BEGIN SELECT RAISE(ABORT,'simulated capital credit failure'); END;`;
    book.db.exec(trigger);assert.throws(()=>book.saveVoucher(funding(capital)),/simulated capital/);assert.deepEqual(tableRows(book.db),before);book.db.exec('DROP TRIGGER fail_capital_credit');
    let receipt=book.saveVoucher(funding(capital));const original=receipt,stable=tableRows(book.db);book.db.exec(trigger);assert.throws(()=>book.saveVoucher(receiptUpdate(receipt,{date:'2026-04-02',amount:500025,narration:'Must roll back'}),receipt.id),/simulated capital/);assert.deepEqual(tableRows(book.db),stable);book.db.exec('DROP TRIGGER fail_capital_credit');
    receipt=book.saveVoucher(receiptUpdate(receipt,{date:'2026-04-02',amount:500025}),receipt.id);assert.equal(receipt.id,original.id);assert.equal(receipt.number,5);assert.equal(receipt.revision,2);assert.equal(receipt.postings.length,2);assert.equal(book.statement(capital.id).balance,-500025);assert.equal(book.statement(1).balance,559050);assert.equal(capitalGroup(book.financialReports()).amount,500025);assert.equal(book.financialReports().profitAndLoss.netProfit,192075);
    const saved=book.state();assert.throws(()=>book.saveVoucher(receiptUpdate(original),receipt.id),error=>error.status===409);assert.deepEqual(book.state(),saved);assert.throws(()=>book.saveVoucher(receiptUpdate(receipt,{type:'payment'}),receipt.id),BookError);assert.deepEqual(book.state(),saved);
    const other=capitalLedger(book,'Another Owner Capital');receipt=book.saveVoucher(receiptUpdate(receipt,{ledger_id:other.id}),receipt.id);assert.equal(book.statement(capital.id).balance,0);assert.equal(book.statement(other.id).balance,-500025);assert.equal(capitalGroup(book.financialReports()).amount,500025);assert.equal(book.state().totals.balanced,true);
  }finally{book.close();}
});

test('bank capital funding composes Cheque/DD validation with capital credit and clears bank metadata when changed to cash',()=>{
  // Native capital funding was Cash. This tests an original composition with
  // the separately observed Receipt Cheque/DD allocation, not native bank capital.
  const book=new Book();try{
    const f=fixture(book),capital=capitalLedger(book),amount=500025,base=funding(capital,{account_id:f.bank.id,amount});
    const bank={account_id:f.bank.id,transaction_type:'Cheque/DD',amount,instrument_number:'000601',instrument_date:'2026-04-01',bank_name:'Not Applicable',cheque_range:''};
    const stable=book.state(),before=tableRows(book.db),profit=book.financialReports().profitAndLoss;
    for(const details of [undefined,{bank:null},{bank:{...bank,account_id:1}},{bank:{...bank,amount:500000}},{bank:{...bank,transaction_type:'Cheque'}}]){
      assert.throws(()=>book.saveVoucher({...base,details}),BookError);assert.deepEqual(book.state(),stable);assert.deepEqual(tableRows(book.db),before);
    }
    let receipt=book.saveVoucher({...base,details:{bank}});assert.deepEqual(receipt.details.bank,bank);assert.equal(book.voucher(receipt.id).details.bank.instrument_number,'000601');
    assert.deepEqual(receipt.postings.map(row=>[row.ledger_id,row.side,row.amount]).sort(),[[f.bank.id,'debit',amount],[capital.id,'credit',amount]].sort());assert.equal(book.statement(f.bank.id).balance,523025);assert.equal(book.statement(1).balance,59025);assert.equal(book.statement(capital.id).balance,-500025);
    assert.equal(receipt.bill,null);assert.equal(receipt.sale_id,null);assert.deepEqual(receipt.allocations,[]);assert.deepEqual(tableRows(book.db).bills,before.bills);assert.deepEqual(tableRows(book.db).receipt_allocations,before.receipt_allocations);assert.deepEqual(book.financialReports().profitAndLoss,profit);assert.equal(capitalGroup(book.financialReports()).amount,500025);assert.equal(book.financialReports().balanceSheet.totals.balanced,true);
    const bankReceipt=receipt;receipt=book.saveVoucher(receiptUpdate(receipt,{account_id:1,details:{bank:null}}),receipt.id);assert.equal(Object.hasOwn(receipt.details,'bank'),false);assert.equal(book.statement(f.bank.id).balance,23000);assert.equal(book.statement(1).balance,559050);assert.equal(receipt.number,5);assert.equal(receipt.postings.length,2);assert.deepEqual(book.financialReports().profitAndLoss,profit);
    const saved=book.state();assert.throws(()=>book.saveVoucher(receiptUpdate(bankReceipt),receipt.id),error=>error.status===409);assert.deepEqual(book.state(),saved);
  }finally{book.close();}
});

test('capital master has native mailing defaults, alias, no ledger-type field and protected invalid-opening alterations',()=>{
  const book=new Book();try{
    let capital=capitalLedger(book);assert.equal(capital.alias,'SOC');assert.equal(capital.mailing_name,capital.name);assert.equal(capital.state,'Not Applicable');assert.equal(capital.country,'India');assert.equal(capital.address,'');assert.equal(capital.pincode,'');assert.equal(Object.hasOwn(capital,'ledger_type'),false);assert.equal(Object.hasOwn(capital,'bank'),false);
    const old=capital;capital=book.saveLedger({...capital,name:'Renamed Capital',mailing_name:'Fictional Owner',address:'Fictional Address',state:'Fictional State',country:'Fictional Country',pincode:'000001'},capital.id);
    const custom=capital;capital=book.saveLedger({name:'Capital Again',revision:capital.revision},capital.id);for(const key of ['mailing_name','address','state','country','pincode'])assert.equal(capital[key],custom[key],key);
    const stable=book.state();for(const patch of [{kind:'income'},{kind:'supplier'},{opening_balance:0.5},{name:''},{mailing_name:123}]){assert.throws(()=>book.saveLedger({name:capital.name,revision:capital.revision,...patch},capital.id),BookError);assert.deepEqual(book.state(),stable);}
    assert.throws(()=>book.saveLedger({name:old.name,revision:old.revision},old.id),error=>error.status===409);assert.deepEqual(book.state(),stable);assert.throws(()=>capitalLedger(book,capital.name.toUpperCase()),BookError);assert.deepEqual(book.state(),stable);
    assert.equal(book.masterLedger(capital.id).kind,'capital');assert.equal(book.masterLedger(capital.id).mailing_name,'Fictional Owner');
  }finally{book.close();}
});

test('populated pre-capital migration preserves income, Journal, bank metadata, Contra, bills and settlement allocations exactly',()=>{
  const directory=mkdtempSync(join(tmpdir(),'bookr-capital-migration-')),file=join(directory,'old.sqlite'),source=new Book();let book;
  try{
    const f=fixture(source);source.saveBank({...f.bank,bank:{account_holder:'Fictional Holder',account_number:'000123456789',ifs_code:'FAKE0000001',swift_code:'FICTIONAL',branch:'Fictional Branch'}},f.bank.id);
    const expected=tableRows(source.db),state=source.state(),report=source.financialReports(),old=new DatabaseSync(file);
    try{
      old.exec('PRAGMA foreign_keys=ON');for(const table of tables){let sql=source.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table).sql;if(table==='ledgers')sql=sql.replace(",'capital'",'');old.exec(sql);}
      for(const table of tables){const rows=expected[table];if(!rows.length)continue;const columns=Object.keys(rows[0]),insert=old.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`);for(const row of rows)insert.run(...columns.map(column=>row[column]));}
      assert.equal(old.prepare("SELECT sql FROM sqlite_master WHERE name='ledgers'").get().sql.includes("'capital'"),false);
    }finally{old.close();}
    book=new Book(file);assert.deepEqual(tableRows(book.db),expected);assert.deepEqual(book.state(),state);assert.deepEqual(book.financialReports(),report);assert.equal(book.db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);assert.equal(book.db.prepare('PRAGMA foreign_key_check').all().length,0);assert.equal(book.payables().find(b=>b.id===f.journal.id).pending,7500);
    const capital=capitalLedger(book),receipt=book.saveVoucher(funding(capital));assert.equal(receipt.number,5);assert.equal(book.statement(1).balance,559025);assert.equal(book.masterLedger(f.bank.id).bank.account_number,'000123456789');assert.deepEqual(book.voucher(f.incomeReceipt.id),source.voucher(f.incomeReceipt.id));
    const saved=book.state(),savedReport=book.financialReports();book.close();book=new Book(file);assert.deepEqual(book.state(),saved);assert.deepEqual(book.financialReports(),savedReport);assert.equal(book.masterLedger(capital.id).kind,'capital');assert.equal(book.db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{source.close();book?.close();cleanup(directory);}
});
