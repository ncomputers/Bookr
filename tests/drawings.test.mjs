import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Book,BookError} from '../lib/accounting.mjs';
import {capitalFixture} from './capital-fixture.mjs';

function fixture(book){
  const f=capitalFixture(book),capital=book.saveLedger({kind:'capital',name:'Study Owner Capital',alias:'SOC'});
  const funding=book.saveVoucher({type:'receipt',date:'2026-04-01',ledger_id:capital.id,account_id:1,amount:500000});
  const drawings=book.saveLedger({kind:'capital',name:'Study Owner Drawings',alias:'SOD'});
  return {...f,capital,funding,drawings};
}
const withdrawal=(drawings,patch={})=>({type:'payment',date:'2026-04-01',ledger_id:drawings.id,account_id:1,amount:20000,narration:'Fictional owner drawings',...patch});
const update=(payment,patch={})=>({type:'payment',date:payment.date,ledger_id:payment.ledger_id,account_id:payment.account_id,amount:payment.amount,narration:payment.narration,allocations:structuredClone(payment.allocations),details:structuredClone(payment.details),revision:payment.revision,...patch});
const capitalGroup=report=>report.balanceSheet.groups.find(group=>group.key==='capital');
const tables=['ledgers','vouchers','postings','bills','receipt_allocations','bank_accounts'];
const rows=book=>Object.fromEntries(tables.map(table=>[table,book.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(row=>({...row}))]));

test('observed cash Drawings Payment5 saves without bills and reopens with capital debit, lower cash and unchanged profit',()=>{
  const directory=mkdtempSync(join(tmpdir(),'bookr-drawings-')),file=join(directory,'book.sqlite');let book=new Book(file);
  try{
    const f=fixture(book),before=book.state(),profit=book.financialReports().profitAndLoss,oldRows=rows(book);assert.equal(before.vouchers.length,15);assert.equal(book.statement(1).balance,559025);
    const settle=book.settlementBills;book.settlementBills=()=>{throw new Error('Capital payment must not request bills.');};
    const payment=book.saveVoucher(withdrawal(f.drawings));book.settlementBills=settle;
    assert.equal(payment.number,5);assert.equal(payment.ledger_id,f.drawings.id);assert.equal(payment.ledger_name,f.drawings.name);assert.equal(payment.ledger_kind,'capital');assert.equal(Object.hasOwn(payment,'supplier_id'),false);assert.equal(Object.hasOwn(payment,'supplier_name'),false);
    assert.equal(payment.bill,null);assert.equal(payment.sale_id,null);assert.deepEqual(payment.allocations,[]);assert.deepEqual(payment.postings.map(p=>[p.ledger_id,p.side,p.amount]).sort(),[[f.drawings.id,'debit',20000],[1,'credit',20000]].sort());
    assert.equal(book.statement(f.drawings.id).balance,20000);assert.equal(book.statement(f.capital.id).balance,-500000);assert.equal(book.statement(1).balance,539025);assert.equal(book.statement(f.bank.id).balance,23000);assert.equal(book.statement(f.customer.id).balance,197550);assert.equal(book.statement(f.supplier.id).balance,-87500);
    assert.deepEqual(book.outstanding(),before.outstanding);assert.deepEqual(book.payables(),before.payables);assert.deepEqual(rows(book).bills,oldRows.bills);assert.deepEqual(rows(book).receipt_allocations,oldRows.receipt_allocations);
    const report=book.financialReports();assert.deepEqual(report.profitAndLoss,profit);assert.equal(report.profitAndLoss.netProfit,192075);assert.deepEqual(report.balanceSheet.profit,{opening:0,current:192075,closing:192075});
    assert.equal(capitalGroup(report).amount,480000);assert.equal(capitalGroup(report).ledgers.find(ledger=>ledger.id===f.drawings.id).amount,-20000);assert.deepEqual(report.balanceSheet.totals,{assets:759575,liabilities:759575,balanced:true});assert.equal(book.state().totals.balanced,true);
    const day=book.dayBook({type:'payment'});assert.equal(day.rows.find(row=>row.id===payment.id).ledger_kind,'capital');assert.deepEqual(book.statement(f.drawings.id).rows.map(row=>[row.type,row.particulars,row.side,row.amount]),[['payment','Cash','debit',20000]]);
    const monthly=book.monthlySummary(f.drawings.id);assert.equal(monthly.rows[0].debit,20000);assert.equal(monthly.rows[0].credit,0);assert.equal(monthly.rows[0].closing,20000);
    const renamed=book.saveLedger({...f.drawings,name:'Renamed Owner Drawings'},f.drawings.id);assert.equal(book.voucher(payment.id).ledger_name,renamed.name);assert.equal(book.masterLedger(renamed.id).kind,'capital');assert.equal(Object.hasOwn(renamed,'ledger_type'),false);
    const saved=book.state(),savedPayment=book.voucher(payment.id),savedReport=book.financialReports();book.close();book=new Book(file);assert.deepEqual(book.state(),saved);assert.deepEqual(book.voucher(payment.id),savedPayment);assert.deepEqual(book.financialReports(),savedReport);assert.equal(book.db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{book.close();assert.ok(directory.startsWith(join(tmpdir(),'bookr-drawings-')));rmSync(directory,{recursive:true,force:true});}
});

test('drawings periods retain capital debit as opening movement and cumulative capital without changing period profit',()=>{
  const book=new Book();try{
    const f=fixture(book);book.saveVoucher(withdrawal(f.drawings,{date:'2026-04-02'}));book.saveVoucher(withdrawal(f.drawings,{date:'2026-04-03',amount:25}));
    const april1=book.financialReports({from:'2026-04-01',to:'2026-04-01'});assert.equal(capitalGroup(april1).amount,500000);assert.equal(april1.profitAndLoss.netProfit,192075);assert.deepEqual(april1.balanceSheet.totals,{assets:779575,liabilities:779575,balanced:true});
    const april2=book.financialReports({from:'2026-04-02',to:'2026-04-02'});assert.equal(april2.profitAndLoss.grossProfit,0);assert.equal(april2.profitAndLoss.netProfit,0);assert.equal(april2.profitAndLoss.indirectExpenses,0);assert.equal(april2.profitAndLoss.indirectIncome,0);assert.equal(capitalGroup(april2).amount,480000);assert.deepEqual(april2.balanceSheet.profit,{opening:192075,current:0,closing:192075});assert.deepEqual(april2.balanceSheet.totals,{assets:759575,liabilities:759575,balanced:true});
    const statement=book.statement(f.drawings.id,{from:'2026-04-03',to:'2026-04-03'});assert.equal(statement.opening,20000);assert.equal(statement.balance,20025);assert.deepEqual(statement.rows.map(row=>[row.side,row.amount]),[['debit',25]]);
    const april3=book.financialReports({from:'2026-04-03',to:'2026-04-03'});assert.equal(capitalGroup(april3).amount,479975);assert.equal(april3.profitAndLoss.netProfit,0);assert.equal(april3.balanceSheet.profit.closing,192075);assert.deepEqual(april3.balanceSheet.totals,{assets:759550,liabilities:759550,balanced:true});
    const empty=book.financialReports({from:'2026-04-04',to:'2026-04-04'});assert.deepEqual(empty.balanceSheet,april3.balanceSheet);assert.equal(empty.profitAndLoss.netProfit,0);assert.equal(book.monthlySummary(f.drawings.id).rows[0].closing,20025);
  }finally{book.close();}
});

test('supplier to drawings and back corrections release only supplier allocations and require bills when returning',()=>{
  const book=new Book();try{
    const f=fixture(book),payables=book.payables(),outstanding=book.outstanding(),profit=book.financialReports().profitAndLoss;
    let payment=book.saveVoucher({type:'payment',date:'2026-04-01',supplier_id:f.supplier.id,account_id:1,amount:20000,allocations:[{bill_id:f.purchase.bill.id,amount:20000}]});assert.equal(book.payables().find(bill=>bill.id===f.purchase.id).pending,60000);
    payment=book.saveVoucher(update(payment,{ledger_id:f.drawings.id,allocations:[]}),payment.id);assert.equal(payment.ledger_kind,'capital');assert.equal(payment.sale_id,null);assert.deepEqual(payment.allocations,[]);assert.deepEqual(book.payables(),payables);assert.deepEqual(book.outstanding(),outstanding);assert.deepEqual(book.financialReports().profitAndLoss,profit);assert.equal(book.statement(f.drawings.id).balance,20000);
    const before=book.state();for(const allocations of [undefined,[],[{bill_id:f.journal.bill.id,amount:20000}],[{bill_id:f.funding.id,amount:20000}]]){assert.throws(()=>book.saveVoucher(update(payment,{ledger_id:f.supplier.id,allocations}),payment.id),BookError);assert.deepEqual(book.state(),before);}
    payment=book.saveVoucher(update(payment,{ledger_id:f.supplier.id,allocations:[{bill_id:f.purchase.bill.id,amount:20000}]}),payment.id);assert.equal(payment.ledger_kind,'supplier');assert.equal(payment.supplier_id,f.supplier.id);assert.equal(book.statement(f.drawings.id).balance,0);assert.equal(book.payables().find(bill=>bill.id===f.purchase.id).pending,60000);assert.equal(capitalGroup(book.financialReports()).amount,500000);assert.deepEqual(book.financialReports().profitAndLoss,profit);
    payment=book.saveVoucher(update(payment,{ledger_id:f.drawings.id,allocations:[]}),payment.id);const stablePayables=book.payables();book.db.prepare('INSERT INTO receipt_allocations(receipt_id,bill_id,amount,position) VALUES(?,?,?,0)').run(payment.id,f.purchase.bill.id,1000);assert.deepEqual(book.payables(),stablePayables);assert.deepEqual(book.allocations(payment.id),[]);assert.equal(book.allocated(f.purchase.id),70000);assert.deepEqual(book.outstanding(),outstanding);
  }finally{book.close();}
});

test('drawings payments reject bill payloads, supplier aliases and malformed inputs without partial writes',()=>{
  const book=new Book();try{
    const f=fixture(book),base=withdrawal(f.drawings),before=book.state(),beforeRows=rows(book);
    const invalid=[{ledger_id:undefined},{ledger_id:0},{ledger_id:-1},{ledger_id:1.5},{ledger_id:'missing'},{ledger_id:f.customer.id},{ledger_id:f.income.id},{ledger_id:1},{ledger_id:2},{ledger_id:f.bank.id},{supplier_id:f.supplier.id},{supplier_id:f.drawings.id},{ledger_id:undefined,supplier_id:f.drawings.id},{account_id:f.drawings.id},{account_id:f.supplier.id},{amount:0},{amount:-1},{amount:0.5},{amount:'20000'},{amount:100000000001},{date:'2026-02-30'},{details:[]},{bill:{reference:'No drawings bill'}},{sale_id:f.purchase.id},{allocations:[{bill_id:f.purchase.bill.id,amount:20000}]},{allocations:[{bill_id:f.journal.bill.id,amount:20000}]},{allocations:null},{allocations:{}}];
    for(const patch of invalid){assert.throws(()=>book.saveVoucher({...base,...patch}),BookError,JSON.stringify(patch));assert.deepEqual(book.state(),before);assert.deepEqual(rows(book),beforeRows);}
    assert.throws(()=>book.paymentBills(f.drawings.id),BookError);assert.throws(()=>book.receiptBills(f.drawings.id),BookError);
    for(const allocations of [undefined,[]]){const payment=book.saveVoucher({...base,allocations});assert.equal(payment.ledger_kind,'capital');assert.deepEqual(payment.allocations,[]);}
    const stable=book.state();for(const allocations of [undefined,[]]){assert.throws(()=>book.saveVoucher({...base,ledger_id:f.supplier.id,allocations}),BookError);assert.deepEqual(book.state(),stable);}
  }finally{book.close();}
});

test('drawings creation and edits roll back both postings and preserve exact paise, voucher number and stale guards',()=>{
  const book=new Book();try{
    const f=fixture(book),before=rows(book),trigger="CREATE TRIGGER fail_drawings_credit BEFORE INSERT ON postings WHEN NEW.ledger_id=1 AND NEW.side='credit' BEGIN SELECT RAISE(ABORT,'simulated drawings credit failure'); END;";
    book.db.exec(trigger);assert.throws(()=>book.saveVoucher(withdrawal(f.drawings)),/simulated drawings/);assert.deepEqual(rows(book),before);book.db.exec('DROP TRIGGER fail_drawings_credit');
    let payment=book.saveVoucher(withdrawal(f.drawings));const old=payment,stable=rows(book);book.db.exec(trigger);assert.throws(()=>book.saveVoucher(update(payment,{date:'2026-04-02',amount:20025,narration:'Must roll back'}),payment.id),/simulated drawings/);assert.deepEqual(rows(book),stable);book.db.exec('DROP TRIGGER fail_drawings_credit');
    payment=book.saveVoucher(update(payment,{date:'2026-04-02',amount:20025}),payment.id);assert.equal(payment.id,old.id);assert.equal(payment.number,5);assert.equal(payment.revision,2);assert.equal(payment.postings.length,2);assert.equal(book.statement(f.drawings.id).balance,20025);assert.equal(book.statement(1).balance,539000);assert.equal(capitalGroup(book.financialReports()).amount,479975);assert.equal(book.financialReports().profitAndLoss.netProfit,192075);
    const saved=book.state();assert.throws(()=>book.saveVoucher(update(old),payment.id),error=>error.status===409);assert.deepEqual(book.state(),saved);assert.throws(()=>book.saveVoucher(update(payment,{type:'receipt'}),payment.id),BookError);assert.deepEqual(book.state(),saved);
    payment=book.saveVoucher(update(payment,{ledger_id:f.capital.id}),payment.id);assert.equal(book.statement(f.drawings.id).balance,0);assert.equal(book.statement(f.capital.id).balance,-479975);assert.equal(capitalGroup(book.financialReports()).amount,479975);assert.equal(book.state().totals.balanced,true);
  }finally{book.close();}
});

test('bank drawings compose existing Cheque validation, preserve leading zeros and clear metadata on cash correction',()=>{
  // Native drawings were Cash. This tests the composition with separately
  // observed Payment Cheque details; it does not assert native bank drawings.
  const book=new Book();try{
    const f=fixture(book),amount=20025,base=withdrawal(f.drawings,{account_id:f.bank.id,amount}),bank={account_id:f.bank.id,transaction_type:'Cheque',amount,instrument_number:'000701',instrument_date:'2026-04-01',bank_name:'Not Applicable',cheque_range:'Not Applicable'},before=book.state(),beforeRows=rows(book),profit=book.financialReports().profitAndLoss;
    for(const details of [undefined,{bank:null},{bank:{...bank,account_id:1}},{bank:{...bank,amount:20000}},{bank:{...bank,transaction_type:'Cheque/DD'}}]){assert.throws(()=>book.saveVoucher({...base,details}),BookError);assert.deepEqual(book.state(),before);assert.deepEqual(rows(book),beforeRows);}
    let payment=book.saveVoucher({...base,details:{bank}});assert.deepEqual(payment.details.bank,bank);assert.equal(book.voucher(payment.id).details.bank.instrument_number,'000701');assert.equal(book.statement(f.bank.id).balance,2975);assert.equal(book.statement(1).balance,559025);assert.equal(book.statement(f.drawings.id).balance,20025);assert.deepEqual(payment.postings.map(row=>[row.ledger_id,row.side,row.amount]).sort(),[[f.drawings.id,'debit',20025],[f.bank.id,'credit',20025]].sort());assert.deepEqual(payment.allocations,[]);assert.equal(payment.sale_id,null);assert.equal(payment.bill,null);assert.deepEqual(book.financialReports().profitAndLoss,profit);assert.deepEqual(book.outstanding(),before.outstanding);assert.deepEqual(book.payables(),before.payables);assert.equal(book.financialReports().balanceSheet.totals.balanced,true);
    const bankPayment=payment,saved=book.state();assert.throws(()=>book.saveVoucher(update(payment,{amount:20026}),payment.id),BookError);assert.deepEqual(book.state(),saved);assert.throws(()=>book.saveVoucher(update(payment,{account_id:1}),payment.id),BookError);assert.deepEqual(book.state(),saved);
    payment=book.saveVoucher(update(payment,{account_id:1,details:{bank:null}}),payment.id);assert.equal(Object.hasOwn(payment.details,'bank'),false);assert.equal(payment.number,5);assert.equal(book.statement(f.bank.id).balance,23000);assert.equal(book.statement(1).balance,539000);assert.equal(capitalGroup(book.financialReports()).amount,479975);assert.deepEqual(book.financialReports().profitAndLoss,profit);
    const stable=book.state();assert.throws(()=>book.saveVoucher(update(bankPayment),payment.id),error=>error.status===409);assert.deepEqual(book.state(),stable);
  }finally{book.close();}
});
