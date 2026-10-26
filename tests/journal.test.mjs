import test from 'node:test';
import {journalFixture as fixture} from './journal-fixture.mjs';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Book,BookError} from '../lib/accounting.mjs';


const input=({expense,supplier},amount=12500)=>({type:'journal',date:'2026-04-01',debit_ledger_id:expense.id,credit_ledger_id:supplier.id,debit_amount:amount,credit_amount:amount,bill:{reference:'JRN-001'},narration:'Fictional credit office expense'});
const update=(voucher,patch={})=>({type:'journal',date:voucher.date,debit_ledger_id:voucher.debit_ledger_id,credit_ledger_id:voucher.credit_ledger_id,debit_amount:voucher.amount,credit_amount:voucher.amount,bill:{reference:voucher.bill.reference},narration:voucher.narration,revision:voucher.revision,...patch});
const tables=['ledgers','vouchers','postings','bills','receipt_allocations','bank_accounts'];
const tableRows=db=>Object.fromEntries(tables.map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(row=>({...row}))]));

test('observed Journal125 and Payment50 preserve native cash, supplier, expense and profit after reopening',()=>{
  const directory=mkdtempSync(join(tmpdir(),'bookr-journal-')),file=join(directory,'book.sqlite');let book=new Book(file);
  try{
    const f=fixture(book),before=book.state(),journal=book.saveVoucher(input(f));
    assert.equal(journal.number,1);assert.equal(journal.supplier_id,f.supplier.id);assert.equal(journal.bill.reference,'JRN-001');assert.equal(journal.bill.amount,12500);assert.deepEqual(journal.allocations,[]);
    assert.deepEqual(journal.postings.map(p=>[p.ledger_id,p.side,p.amount]).sort(),[[f.expense.id,'debit',12500],[f.supplier.id,'credit',12500]].sort());
    assert.equal(book.statement(1).balance,52025);assert.equal(book.statement(f.bank.id).balance,23000);assert.equal(book.statement(f.customer.id).balance,197550);assert.equal(book.statement(f.expense.id).balance,20000);assert.equal(book.statement(f.supplier.id).balance,-92500);
    const report=book.financialReports();assert.equal(report.profitAndLoss.grossProfit,200075);assert.equal(report.profitAndLoss.indirectExpenses,20000);assert.equal(report.profitAndLoss.netProfit,180075);assert.deepEqual(report.balanceSheet.totals,{assets:272575,liabilities:272575,balanced:true});assert.deepEqual(book.outstanding(),before.outstanding);
    assert.equal(book.paymentBills(f.supplier.id).bills.find(b=>b.id===journal.id).pending,12500);
    const payment=book.saveVoucher({type:'payment',date:'2026-04-01',supplier_id:f.supplier.id,account_id:1,amount:5000,allocations:[{bill_id:journal.bill.id,amount:5000}]});
    assert.equal(payment.number,4);assert.equal(payment.sale_id,journal.id);assert.equal(book.statement(1).balance,47025);assert.equal(book.statement(f.supplier.id).balance,-87500);assert.equal(book.payables().find(b=>b.id===journal.id).pending,7500);assert.equal(book.payables().find(b=>b.id===f.purchase.id).pending,80000);assert.equal(book.financialReports().profitAndLoss.netProfit,180075);
    assert.equal(book.monthlySummary(f.expense.id).rows[0].debit,20000);assert.equal(book.dayBook({type:'journal'}).rows[0].id,journal.id);assert.equal(book.dayBook({type:'journal'}).totals.credit,12500);assert.equal(book.state().totals.balanced,true);
    const saved=book.state(),savedJournal=book.voucher(journal.id);book.close();book=new Book(file);assert.deepEqual(book.state(),saved);assert.deepEqual(book.voucher(journal.id),savedJournal);assert.equal(book.db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{book.close();assert.ok(directory.startsWith(join(tmpdir(),'bookr-journal-')));rmSync(directory,{recursive:true,force:true});}
});
test('Journal rejects unequal amounts, unsupported ledgers/details and settlement inputs without partial writes',()=>{
  const book=new Book();try{
    const f=fixture(book),base=input(f),stable=book.state();
    for(const patch of [{credit_amount:10000},{debit_amount:0,credit_amount:0},{debit_amount:-1,credit_amount:-1},{debit_amount:'12500'},{credit_amount:'12500'},{debit_amount:100000000001,credit_amount:100000000001},{debit_ledger_id:1},{debit_ledger_id:2},{credit_ledger_id:f.customer.id},{debit_ledger_id:String(f.expense.id)},{date:'2026-02-30'},{entries:[]},{allocations:[]},{amount:12500},{account_id:1},{supplier_id:f.supplier.id},{details:{bank:null}},{bill:{reference:''}},{bill:{reference:'Bad',method:'Agst Ref'}},{bill:{reference:'Bad',credit_period:30}}]){
      assert.throws(()=>book.saveVoucher({...base,...patch}),BookError,JSON.stringify(patch));assert.deepEqual(book.state(),stable);
    }
    const omitted={...base};delete omitted.bill;assert.equal(book.saveVoucher(omitted).bill.reference,'1');
  }finally{book.close();}
});
test('allocated Journal revisions preserve bill identity, supplier and minimum paid amount, with stale edit protection',()=>{
  const book=new Book();try{
    const f=fixture(book);let journal=book.saveVoucher(input(f));const other=book.saveSupplier({name:'Other Fictional Supplier'});
    book.saveVoucher({type:'payment',date:'2026-04-01',supplier_id:f.supplier.id,account_id:1,amount:5000,allocations:[{bill_id:journal.bill.id,amount:5000}]});
    const stable=book.state();for(const patch of [{debit_amount:4999,credit_amount:4999},{credit_ledger_id:other.id},{type:'purchase'},{revision:0}]){assert.throws(()=>book.saveVoucher(update(journal,patch),journal.id),BookError);assert.deepEqual(book.state(),stable);}
    const original=journal;journal=book.saveVoucher(update(journal,{debit_amount:12525,credit_amount:12525,bill:{reference:'JRN-RENAMED'},date:'2026-04-02'}),journal.id);
    assert.equal(journal.bill.id,original.bill.id);assert.equal(journal.number,original.number);assert.equal(journal.revision,2);assert.equal(book.payables().find(b=>b.id===journal.id).pending,7525);assert.equal(book.allocated(journal.id),5000);
    assert.equal(book.statement(f.expense.id,{from:'2026-04-02',to:'2026-04-02'}).opening,7500);assert.equal(book.financialReports({from:'2026-04-02',to:'2026-04-02'}).profitAndLoss.indirectExpenses,12525);
    const saved=book.state();assert.throws(()=>book.saveVoucher(update(original),journal.id),e=>e.status===409);assert.deepEqual(book.state(),saved);
  }finally{book.close();}
});
test('a failed credit posting rolls back Journal creation and edits, including its bill and earlier debit',()=>{
  const book=new Book();try{
    const f=fixture(book),before=book.state();book.db.exec("CREATE TRIGGER fail_journal_credit BEFORE INSERT ON postings WHEN NEW.side='credit' BEGIN SELECT RAISE(ABORT,'simulated Journal credit failure'); END;");
    assert.throws(()=>book.saveVoucher(input(f)),/simulated Journal/);assert.deepEqual(book.state(),before);book.db.exec('DROP TRIGGER fail_journal_credit');
    const journal=book.saveVoucher(input(f)),stable=book.state(),rows=tableRows(book.db);book.db.exec("CREATE TRIGGER fail_journal_credit BEFORE INSERT ON postings WHEN NEW.side='credit' BEGIN SELECT RAISE(ABORT,'simulated Journal credit failure'); END;");
    assert.throws(()=>book.saveVoucher(update(journal,{debit_amount:12600,credit_amount:12600,bill:{reference:'Must roll back'}}),journal.id),/simulated Journal/);assert.deepEqual(book.state(),stable);assert.deepEqual(tableRows(book.db),rows);
  }finally{book.close();}
});
test('one supplier payment can allocate between a purchase and Journal bill without double-counting expense',()=>{
  const book=new Book();try{
    const f=fixture(book),journal=book.saveVoucher(input(f)),profit=book.financialReports().profitAndLoss.netProfit;
    let payment=book.saveVoucher({type:'payment',date:'2026-04-01',supplier_id:f.supplier.id,account_id:1,amount:5025,allocations:[{bill_id:f.purchase.bill.id,amount:25},{bill_id:journal.bill.id,amount:5000}]});
    assert.equal(payment.sale_id,null);assert.equal(payment.postings.length,2);assert.equal(book.payables().find(b=>b.id===journal.id).pending,7500);assert.equal(book.payables().find(b=>b.id===f.purchase.id).pending,79975);assert.equal(book.financialReports().profitAndLoss.netProfit,profit);
    const context=book.paymentBills(f.supplier.id,payment.id);assert.equal(context.bills.find(b=>b.id===journal.id).available,12500);
    const before=book.state();assert.throws(()=>book.saveVoucher({type:'payment',date:'2026-04-01',supplier_id:f.supplier.id,account_id:1,amount:7501,allocations:[{bill_id:journal.bill.id,amount:7501}]}),BookError);assert.deepEqual(book.state(),before);
  }finally{book.close();}
});
test('populated pre-Journal schema migration preserves expenses, Contra, bank metadata, bills and allocations exactly',()=>{
  const directory=mkdtempSync(join(tmpdir(),'bookr-journal-migration-')),file=join(directory,'old.sqlite'),source=new Book();let book;
  try{
    const f=fixture(source),expected=tableRows(source.db),state=source.state(),old=new DatabaseSync(file);
    try{
      old.exec('PRAGMA foreign_keys=ON');for(const table of tables){let sql=source.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table).sql;if(table==='vouchers')sql=sql.replace(",'journal'",'');old.exec(sql);}
      for(const table of tables){const rows=expected[table];if(!rows.length)continue;const columns=Object.keys(rows[0]),insert=old.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`);for(const row of rows)insert.run(...columns.map(c=>row[c]));}
      assert.equal(old.prepare("SELECT sql FROM sqlite_master WHERE name='vouchers'").get().sql.includes("'journal'"),false);
    }finally{old.close();}
    book=new Book(file);assert.deepEqual(tableRows(book.db),expected);assert.deepEqual(book.state(),state);assert.equal(book.db.prepare('PRAGMA foreign_key_check').all().length,0);assert.equal(book.db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
    assert.equal(book.saveVoucher(input(f)).number,1);const stable=book.state();book.close();book=new Book(file);assert.deepEqual(book.state(),stable);
  }finally{source.close();book?.close();assert.ok(directory.startsWith(join(tmpdir(),'bookr-journal-migration-')));rmSync(directory,{recursive:true,force:true});}
});
