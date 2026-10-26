import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Book,BookError} from '../lib/accounting.mjs';
import {openingFixture} from './opening-fixture.mjs';

const DATE='2026-04-01';
const tables=['ledgers','vouchers','postings','bills','receipt_allocations','bank_accounts'];
const rows=book=>Object.fromEntries(tables.map(table=>[table,book.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(row=>({...row}))]));
const allRows=book=>({...rows(book),ledger_openings:book.db.prepare('SELECT * FROM ledger_openings ORDER BY ledger_id').all().map(row=>({...row}))});
const opening=(book,id,amount)=>book.saveLedger({...book.masterLedger(id),opening_balance:amount},id);
const summary=(debit,credit)=>({date:DATE,debit,credit,difference:debit-credit,balanced:debit===credit});
const capitalGroup=report=>report.balanceSheet.groups.find(group=>group.key==='capital');
const emptyPostings={debit:0,credit:0,balanced:true};
const bad400=error=>error instanceof BookError && error.status===400;

test('documented Cash and Capital master openings show unmatched differences without inventing vouchers and persist when matched',()=>{
  const directory=mkdtempSync(join(tmpdir(),'bookr-opening-')),file=join(directory,'book.sqlite');let book=new Book(file);
  try{
    const cash=opening(book,1,100000);assert.equal(cash.opening_balance,100000);assert.equal(cash.opening_date,DATE);assert.deepEqual(book.state().opening_balances,summary(100000,0));assert.deepEqual(book.state().totals,emptyPostings);assert.equal(book.state().vouchers.length,0);assert.equal(rows(book).postings.length,0);assert.equal(rows(book).bills.length,0);
    let trial=book.trialBalance(),report=book.financialReports();assert.deepEqual(trial.opening_balances,summary(100000,0));assert.deepEqual(trial.totals,{debit:100000,credit:0,balanced:false});assert.equal(trial.rows.find(row=>row.id===1).opening,100000);assert.equal(trial.rows.find(row=>row.id===1).debit,0);assert.equal(trial.rows.find(row=>row.id===1).credit,0);
    assert.deepEqual(report.balanceSheet.openingDifference,{amount:100000,side:'liabilities',signed:100000});assert.deepEqual(report.balanceSheet.totals,{assets:100000,liabilities:100000,balanced:false});assert.equal(report.profitAndLoss.netProfit,0);assert.equal(report.trialBalanced,false);
    const capital=book.saveLedger({kind:'capital',name:'Fictional Opening Capital',opening_balance:-100000,opening_date:DATE});assert.equal(capital.opening_balance,-100000);assert.deepEqual(book.state().opening_balances,summary(100000,100000));assert.deepEqual(book.state().totals,emptyPostings);assert.equal(book.state().vouchers.length,0);
    report=book.financialReports();assert.equal(report.balanceSheet.openingDifference.amount,0);assert.equal(capitalGroup(report).amount,100000);assert.equal(report.profitAndLoss.netProfit,0);assert.deepEqual(report.balanceSheet.totals,{assets:100000,liabilities:100000,balanced:true});assert.deepEqual(book.trialBalance().totals,{debit:100000,credit:100000,balanced:true});
    assert.equal(book.statement(1).opening,100000);assert.equal(book.statement(1).balance,100000);assert.deepEqual(book.statement(1).rows,[]);assert.equal(book.monthlySummary(1).opening,100000);assert.deepEqual(book.monthlySummary(1).totals,{debit:0,credit:0,closing:100000});assert.equal(book.statement(capital.id).opening,-100000);assert.equal(book.statement(capital.id).balance,-100000);
    const saved=book.state(),savedReport=book.financialReports();book.close();book=new Book(file);assert.deepEqual(book.state(),saved);assert.deepEqual(book.financialReports(),savedReport);assert.equal(book.masterLedger(1).opening_date,DATE);assert.equal(book.db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{book.close();assert.ok(directory.startsWith(join(tmpdir(),'bookr-opening-')));rmSync(directory,{recursive:true,force:true});}
});

test('signed Cash credit and Capital debit openings remain explicit and unsupported roles do not receive implicit offsets',()=>{
  const book=new Book();try{
    opening(book,1,-2500);assert.deepEqual(book.state().opening_balances,summary(0,2500));assert.deepEqual(book.financialReports().balanceSheet.openingDifference,{amount:2500,side:'assets',signed:-2500});assert.deepEqual(book.financialReports().balanceSheet.totals,{assets:2500,liabilities:2500,balanced:false});assert.ok(book.financialReports().balanceSheet.presentation.liabilities.some(group=>group.key==='current-assets' && group.amount===2500));assert.equal(book.statement(1).opening,-2500);assert.equal(book.statement(1).balance,-2500);
    const capital=book.saveAccount({kind:'capital',name:'Fictional Debit Capital',opening_balance:2500});assert.equal(book.statement(capital.id).balance,2500);assert.deepEqual(book.state().opening_balances,summary(2500,2500));assert.deepEqual(book.trialBalance().totals,{debit:2500,credit:2500,balanced:true});assert.equal(capitalGroup(book.financialReports()).amount,-2500);assert.equal(book.financialReports().profitAndLoss.netProfit,0);assert.deepEqual(book.state().totals,emptyPostings);assert.equal(book.state().vouchers.length,0);
    const zero=book.ledgers().filter(ledger=>![1,capital.id].includes(ledger.id));assert.ok(zero.every(ledger=>ledger.opening_balance===0 && ledger.opening_date===DATE));
    let report=book.financialReports();assert.deepEqual(report.balanceSheet.totals,{assets:2500,liabilities:2500,balanced:true});assert.ok(report.balanceSheet.presentation.assets.some(group=>group.key==='capital' && group.amount===2500));assert.ok(report.balanceSheet.presentation.liabilities.some(group=>group.key==='current-assets' && group.amount===2500));assert.ok([...report.balanceSheet.presentation.assets,...report.balanceSheet.presentation.liabilities].every(group=>group.amount>=0));
    opening(book,1,0);report=book.financialReports();assert.deepEqual(report.balanceSheet.openingDifference,{amount:2500,side:'liabilities',signed:2500});assert.deepEqual(report.balanceSheet.totals,{assets:2500,liabilities:2500,balanced:false});assert.equal(capitalGroup(report).amount,-2500);assert.ok(report.balanceSheet.presentation.assets.some(group=>group.key==='capital' && group.amount===2500));assert.equal(report.profitAndLoss.netProfit,0);
  }finally{book.close();}
});

test('opening balances stay separate from period voucher activity in statements, Monthly, Trial Balance, profit and Balance Sheet',()=>{
  const book=new Book();try{
    opening(book,1,500000);const capital=book.saveLedger({kind:'capital',name:'Fictional Brought Forward Capital',opening_balance:-500000}),customer=book.createCustomer({name:'Fictional Opening Test Buyer'}),expense=book.saveLedger({kind:'expense',name:'Fictional Opening Test Expense'});
    const sale=book.saveVoucher({type:'sale',date:DATE,customer_id:customer.id,account_id:2,amount:100000});book.saveVoucher({type:'payment',date:DATE,ledger_id:expense.id,account_id:1,amount:20000});book.saveVoucher({type:'receipt',date:'2026-04-02',customer_id:customer.id,account_id:1,amount:40000,allocations:[{bill_id:sale.bill.id,amount:40000}]});book.saveVoucher({type:'payment',date:'2026-04-02',ledger_id:capital.id,account_id:1,amount:10000});
    const state=book.state(),cash=book.statement(1),capitalStatement=book.statement(capital.id),trial=book.trialBalance(),report=book.financialReports();assert.equal(state.vouchers.length,4);assert.equal(rows(book).postings.length,8);assert.deepEqual(state.totals,{debit:170000,credit:170000,balanced:true});assert.deepEqual(state.opening_balances,summary(500000,500000));
    assert.equal(cash.opening,500000);assert.equal(cash.rows.length,3);assert.equal(cash.balance,510000);assert.equal(cash.rows[0].balance,480000);assert.equal(capitalStatement.opening,-500000);assert.equal(capitalStatement.balance,-490000);assert.deepEqual(capitalStatement.rows.map(row=>[row.type,row.side,row.amount]),[['payment','debit',10000]]);
    const cashTrial=trial.rows.find(row=>row.id===1),capitalTrial=trial.rows.find(row=>row.id===capital.id);assert.equal(cashTrial.opening,500000);assert.equal(cashTrial.debit,40000);assert.equal(cashTrial.credit,30000);assert.equal(cashTrial.balance,510000);assert.equal(capitalTrial.opening,-500000);assert.equal(capitalTrial.debit,10000);assert.equal(capitalTrial.credit,0);assert.equal(capitalTrial.balance,-490000);
    assert.equal(report.profitAndLoss.income,100000);assert.equal(report.profitAndLoss.grossProfit,100000);assert.equal(report.profitAndLoss.indirectExpenses,20000);assert.equal(report.profitAndLoss.netProfit,80000);assert.equal(capitalGroup(report).amount,490000);assert.deepEqual(report.balanceSheet.totals,{assets:570000,liabilities:570000,balanced:true});assert.equal(book.outstanding()[0].pending,60000);
    const monthly=book.monthlySummary(1);assert.equal(monthly.opening,500000);assert.equal(monthly.rows[0].opening,500000);assert.equal(monthly.rows[0].debit,40000);assert.equal(monthly.rows[0].credit,30000);assert.equal(monthly.rows[0].closing,510000);assert.deepEqual(monthly.totals,{debit:40000,credit:30000,closing:510000});
    const day2=book.statement(1,{from:'2026-04-02',to:'2026-04-02'});assert.equal(day2.opening,480000);assert.equal(day2.rows.length,2);assert.equal(day2.balance,510000);const plDay2=book.financialReports({from:'2026-04-02',to:'2026-04-02'});assert.equal(plDay2.profitAndLoss.netProfit,0);assert.deepEqual(plDay2.balanceSheet.profit,{opening:80000,current:0,closing:80000});assert.deepEqual(plDay2.balanceSheet.totals,report.balanceSheet.totals);
    const empty=book.statement(1,{from:'2026-04-03',to:'2026-04-03'});assert.equal(empty.opening,510000);assert.equal(empty.balance,510000);assert.equal(empty.rows.length,0);assert.deepEqual(book.state(),state);
  }finally{book.close();}
});

test('changing or clearing openings revises only the master, retains existing vouchers, and rolls back stale or failed saves',()=>{
  const book=new Book();try{
    const f=openingFixture(book),before=rows(book);let cash=opening(book,1,100000);opening(book,f.capital.id,-100000);const vouchers=book.state().vouchers,bank=book.masterLedger(f.bank.id).bank,profit=book.financialReports().profitAndLoss;
    assert.deepEqual(rows(book).vouchers,before.vouchers);assert.deepEqual(rows(book).postings,before.postings);assert.deepEqual(rows(book).bills,before.bills);assert.deepEqual(rows(book).receipt_allocations,before.receipt_allocations);assert.equal(book.statement(1).balance,639025);assert.equal(book.financialReports().balanceSheet.totals.assets,859575);
    cash=book.saveLedger({name:'Fictional Renamed Cash',alias:'RC',revision:cash.revision},cash.id);assert.equal(cash.opening_balance,100000);assert.equal(cash.opening_date,DATE);const old=cash;cash=opening(book,cash.id,100025);assert.equal(cash.revision,old.revision+1);assert.equal(book.statement(1).balance,639050);assert.deepEqual(book.financialReports().profitAndLoss,profit);assert.deepEqual(rows(book).vouchers,before.vouchers);assert.deepEqual(book.masterLedger(f.bank.id).bank,bank);
    const stable=allRows(book);assert.throws(()=>book.saveLedger({...old,name:'Stale Cash',opening_balance:5},old.id),error=>error.status===409);assert.deepEqual(allRows(book),stable);
    book.db.exec("CREATE TRIGGER fail_opening_write BEFORE INSERT ON ledger_openings WHEN NEW.amount=7500 BEGIN SELECT RAISE(ABORT,'simulated opening insert failure'); END;");assert.throws(()=>book.saveLedger({kind:'cash',name:'Must Roll Back Opening Master',opening_balance:7500}),/simulated opening/);assert.deepEqual(allRows(book),stable);book.db.exec('DROP TRIGGER fail_opening_write');
    book.db.exec("CREATE TRIGGER fail_opening_update BEFORE UPDATE ON ledger_openings WHEN NEW.amount=200025 BEGIN SELECT RAISE(ABORT,'simulated opening update failure'); END;");assert.throws(()=>book.saveLedger({...cash,name:'Must Roll Back Opening Edit',opening_balance:200025},cash.id),/simulated opening/);assert.deepEqual(allRows(book),stable);book.db.exec('DROP TRIGGER fail_opening_update');
    cash=opening(book,cash.id,0);opening(book,f.capital.id,0);assert.equal(cash.opening_balance,0);assert.equal(book.db.prepare('SELECT COUNT(*) AS count FROM ledger_openings').get().count,0);assert.deepEqual(book.state().opening_balances,summary(0,0));assert.equal(book.statement(1).balance,539025);assert.deepEqual(rows(book).vouchers,before.vouchers);assert.deepEqual(book.financialReports().profitAndLoss,profit);assert.deepEqual(book.financialReports().balanceSheet.totals,{assets:759575,liabilities:759575,balanced:true});
  }finally{book.close();}
});

test('fixed books-beginning date excludes openings before April and rejects only unsupported crossing ranges',()=>{
  const book=new Book();try{
    opening(book,1,100000);const capital=book.saveLedger({kind:'capital',name:'Fictional Boundary Capital',opening_balance:-100000}),expense=book.saveLedger({kind:'expense',name:'Fictional Boundary Expense'});
    const beforePeriod={from:'2026-03-01',to:'2026-03-31'};assert.equal(book.statement(1,beforePeriod).opening,0);assert.equal(book.statement(1,beforePeriod).balance,0);assert.deepEqual(book.trialBalance(beforePeriod).opening_balances,summary(0,0));assert.deepEqual(book.trialBalance(beforePeriod).totals,emptyPostings);assert.deepEqual(book.financialReports(beforePeriod).balanceSheet.totals,{assets:0,liabilities:0,balanced:true});assert.equal(book.statement(1,{to:'2026-03-31'}).balance,0);
    for(const period of [{from:DATE,to:DATE},{to:DATE},{from:'2026-04-02',to:'2026-04-02'},{}]){assert.equal(book.statement(1,period).opening,100000);assert.equal(book.statement(1,period).balance,100000);assert.equal(book.statement(capital.id,period).balance,-100000);assert.deepEqual(book.trialBalance(period).opening_balances,summary(100000,100000));}
    for(const period of [{from:'2026-03-31',to:DATE},{from:'2026-03-01',to:'2026-04-02'},{from:'2026-03-31'}]){assert.throws(()=>book.statement(1,period),bad400);assert.throws(()=>book.trialBalance(period),bad400);assert.throws(()=>book.financialReports(period),bad400);assert.equal(book.statement(expense.id,period).balance,0);}
    const capitalLedger=book.masterLedger(capital.id);assert.throws(()=>book.saveLedger({...capitalLedger,opening_date:'2026-04-02'},capital.id),bad400);assert.throws(()=>book.saveLedger({...capitalLedger,opening_date:null},capital.id),bad400);assert.equal(book.masterLedger(capital.id).opening_balance,-100000);assert.equal(book.saveLedger({...capitalLedger,opening_date:DATE},capital.id).opening_date,DATE);
  }finally{book.close();}
});

test('opening validation covers exact signed paise, supported roles, direct legacy entry points and immutable saved kinds',()=>{
  const book=new Book();try{
    const f=openingFixture(book),cash=book.masterLedger(1),capital=book.masterLedger(f.capital.id),before=allRows(book);
    for(const value of [null,'0','100',0.5,NaN,Infinity,-Infinity,100000000001,-100000000001,Number.MAX_SAFE_INTEGER,{},[]]){assert.throws(()=>book.saveLedger({...cash,opening_balance:value},cash.id),bad400);assert.deepEqual(allRows(book),before);assert.throws(()=>book.saveLedger({...capital,opening_balance:value},capital.id),bad400);assert.deepEqual(allRows(book),before);}
    for(const kind of ['customer','supplier','sales','purchase','expense','income']){assert.throws(()=>book.saveLedger({kind,name:'Unsupported Opening '+kind,opening_balance:1}),bad400);assert.deepEqual(allRows(book),before);}
    for(const create of [()=>book.createCustomer({name:'Legacy Buyer Opening',opening_balance:1}),()=>book.saveCustomer({name:'Legacy Customer Opening',opening_balance:1}),()=>book.saveSupplier({name:'Legacy Supplier Opening',opening_balance:1}),()=>book.saveAccount({kind:'expense',name:'Direct Expense Opening',opening_balance:1})]){assert.throws(create,bad400);assert.deepEqual(allRows(book),before);}
    for(const kind of ['customer','supplier','sales','purchase','expense','income']){const ledger=book.ledgers().find(ledger=>ledger.kind===kind);assert.throws(()=>book.saveLedger({...ledger,opening_balance:-1},ledger.id),bad400);assert.deepEqual(allRows(book),before);}
    assert.throws(()=>book.saveLedger({...cash,kind:'capital',opening_balance:1000},cash.id),bad400);assert.deepEqual(allRows(book),before);
    const high=book.saveAccount({kind:'cash',name:'Fictional Exact Opening Limit',opening_balance:100000000000});assert.equal(high.opening_balance,100000000000);const low=book.saveAccount({kind:'capital',name:'Fictional Exact Credit Limit',opening_balance:-100000000000});assert.equal(low.opening_balance,-100000000000);assert.equal(book.state().opening_balances.balanced,true);assert.deepEqual(rows(book).vouchers,before.vouchers);assert.deepEqual(rows(book).postings,before.postings);
  }finally{book.close();}
});

test('legacy pre-books movements stay intact while openings and newly backdated vouchers cannot bypass the fixed-date boundary',()=>{
  const book=new Book();try{
    const customer=book.createCustomer({name:'Fictional Prior Books Buyer'}),capital=book.saveLedger({kind:'capital',name:'Fictional Prior Books Capital'}),sale=book.saveVoucher({type:'sale',date:'2026-03-31',customer_id:customer.id,account_id:2,amount:100001});book.saveVoucher({type:'receipt',date:'2026-03-31',customer_id:customer.id,account_id:1,amount:100001,allocations:[{bill_id:sale.bill.id,amount:100001}]});
    const before=allRows(book);assert.equal(book.statement(1,{from:DATE,to:DATE}).opening,100001);assert.throws(()=>opening(book,1,1),bad400);assert.deepEqual(allRows(book),before);assert.equal(book.monthlySummary(1).opening,100001);
    opening(book,capital.id,-100000);const stable=allRows(book);assert.throws(()=>book.saveVoucher({type:'payment',date:'2026-03-31',ledger_id:capital.id,account_id:1,amount:25}),bad400);assert.deepEqual(allRows(book),stable);
    const payment=book.saveVoucher({type:'payment',date:DATE,ledger_id:capital.id,account_id:1,amount:25}),current=allRows(book);assert.throws(()=>book.saveVoucher({type:'payment',date:'2026-03-31',ledger_id:capital.id,account_id:1,amount:25,revision:payment.revision},payment.id),bad400);assert.deepEqual(allRows(book),current);assert.equal(book.statement(1,{from:DATE,to:DATE}).opening,100001);
  }finally{book.close();}
  const other=new Book();try{
    const capital=other.saveLedger({kind:'capital',name:'Fictional Prior Capital Posting'});other.saveVoucher({type:'payment',date:'2026-03-31',ledger_id:capital.id,account_id:1,amount:25});const before=allRows(other);assert.throws(()=>opening(other,capital.id,-100000),bad400);assert.deepEqual(allRows(other),before);assert.equal(other.masterLedger(capital.id).opening_balance,0);
  }finally{other.close();}
  const cashBook=new Book();try{
    const customer=cashBook.createCustomer({name:'Fictional Backdated Cash Buyer'}),sale=cashBook.saveVoucher({type:'sale',date:'2026-03-31',customer_id:customer.id,account_id:2,amount:1000});opening(cashBook,1,100000);const before=allRows(cashBook),receipt={type:'receipt',date:'2026-03-31',customer_id:customer.id,account_id:1,amount:25,allocations:[{bill_id:sale.bill.id,amount:25}]};assert.throws(()=>cashBook.saveVoucher(receipt),bad400);assert.deepEqual(allRows(cashBook),before);assert.equal(cashBook.outstanding()[0].pending,1000);
    const saved=cashBook.saveVoucher({...receipt,date:DATE});assert.equal(cashBook.statement(1).balance,100025);assert.equal(cashBook.outstanding()[0].pending,975);const current=allRows(cashBook);assert.throws(()=>cashBook.saveVoucher({...receipt,revision:saved.revision},saved.id),bad400);assert.deepEqual(allRows(cashBook),current);
  }finally{cashBook.close();}
});

test('populated pre-opening migration keeps identities, revisions, bills, allocations, Journal, Drawings and bank details unchanged',()=>{
  const directory=mkdtempSync(join(tmpdir(),'bookr-opening-migration-')),file=join(directory,'old.sqlite'),source=new Book();let book;
  try{
    const f=openingFixture(source);source.saveBank({...f.bank,bank:{account_holder:'Fictional Opening Holder',account_number:'000123456789',ifs_code:'FAKE0000001',swift_code:'FICTIONAL',branch:'Fictional Branch'}},f.bank.id);source.saveLedger({...f.customer,alias:'Existing Buyer Revision'},f.customer.id);
    const expected=rows(source),state=source.state(),reports=source.financialReports(),old=new DatabaseSync(file);try{old.exec('PRAGMA foreign_keys=ON');for(const table of tables)old.exec(source.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table).sql);for(const table of tables){const records=expected[table];if(!records.length)continue;const columns=Object.keys(records[0]),insert=old.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`);for(const record of records)insert.run(...columns.map(column=>record[column]));}assert.equal(old.prepare("SELECT name FROM sqlite_master WHERE name='ledger_openings'").get(),undefined);}finally{old.close();}
    book=new Book(file);assert.deepEqual(rows(book),expected);assert.deepEqual(book.state(),state);assert.deepEqual(book.financialReports(),reports);assert.equal(book.db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);assert.equal(book.db.prepare('PRAGMA foreign_key_check').all().length,0);assert.equal(book.db.prepare('SELECT COUNT(*) AS count FROM ledger_openings').get().count,0);assert.ok(book.ledgers().every(ledger=>ledger.opening_balance===0 && ledger.opening_date===DATE));
    opening(book,1,50000);opening(book,f.capital.id,-50000);assert.equal(book.statement(1).balance,589025);assert.equal(book.statement(f.capital.id).balance,-550000);assert.deepEqual(book.state().vouchers,state.vouchers);assert.deepEqual(book.outstanding(),state.outstanding);assert.deepEqual(book.payables(),state.payables);assert.deepEqual(book.masterLedger(f.bank.id).bank,source.masterLedger(f.bank.id).bank);assert.deepEqual(book.financialReports().profitAndLoss,reports.profitAndLoss);assert.deepEqual(book.financialReports().balanceSheet.totals,{assets:809575,liabilities:809575,balanced:true});assert.deepEqual(rows(book).postings,expected.postings);assert.deepEqual(rows(book).bills,expected.bills);assert.deepEqual(rows(book).receipt_allocations,expected.receipt_allocations);
    const saved=book.state(),savedReports=book.financialReports();book.close();book=new Book(file);assert.deepEqual(book.state(),saved);assert.deepEqual(book.financialReports(),savedReports);assert.equal(book.db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{source.close();book?.close();assert.ok(directory.startsWith(join(tmpdir(),'bookr-opening-migration-')));rmSync(directory,{recursive:true,force:true});}
});

test('WAL commits between report queries cannot mix openings, summaries, statement rows or Monthly dates from different snapshots',()=>{
  const directory=mkdtempSync(join(tmpdir(),'bookr-opening-snapshot-')),file=join(directory,'book.sqlite'),reader=new Book(file),writer=new Book(file);
  const prepare=reader.db.prepare;
  try{
    opening(writer,1,500);let interleaved=false;
    reader.db.prepare=function(sql){
      const statement=prepare.call(this,sql);
      if(sql==='SELECT ledger_id,amount FROM ledger_openings'){
        const all=statement.all;
        statement.all=function(...values){const result=all.apply(this,values);if(!interleaved){interleaved=true;opening(writer,1,1000);}return result;};
      }
      return statement;
    };
    const report=reader.trialBalance();assert.equal(interleaved,true);assert.equal(writer.masterLedger(1).opening_balance,1000);assert.equal(report.rows.find(row=>row.id===1).opening,500);assert.equal(report.rows.find(row=>row.id===1).balance,500);assert.deepEqual(report.opening_balances,summary(500,0));assert.deepEqual(report.totals,{debit:500,credit:0,balanced:false});assert.equal(reader.db.isTransaction,false);
    reader.db.prepare=prepare;const next=reader.trialBalance();assert.equal(next.rows.find(row=>row.id===1).opening,1000);assert.deepEqual(next.opening_balances,summary(1000,0));assert.equal(reader.db.isTransaction,false);
    function afterRead(query,method,action){
      let fired=false;
      reader.db.prepare=function(sql){const statement=prepare.call(this,sql);if(typeof query==='function'?query(sql):sql===query){const read=statement[method];statement[method]=function(...values){const result=read.apply(this,values);if(!fired){fired=true;action();}return result;};}return statement;};
      return ()=>assert.equal(fired,true,'The second connection committed during the intended read.');
    }
    let assertInterleaved=afterRead('SELECT amount FROM ledger_openings WHERE ledger_id=?','get',()=>opening(writer,1,1500));
    const state=reader.state();assertInterleaved();assert.equal(writer.masterLedger(1).opening_balance,1500);assert.equal(state.ledgers.find(ledger=>ledger.id===1).opening_balance,1000);assert.deepEqual(state.opening_balances,summary(1000,0));assert.deepEqual(state.totals,emptyPostings);assert.equal(reader.db.isTransaction,false);reader.db.prepare=prepare;assert.deepEqual(reader.state().opening_balances,summary(1500,0));
    const expense=writer.saveLedger({kind:'expense',name:'Fictional Snapshot Expense'});
    assertInterleaved=afterRead('SELECT amount FROM ledger_openings WHERE ledger_id=?','get',()=>{opening(writer,1,2000);writer.saveVoucher({type:'payment',date:DATE,ledger_id:expense.id,account_id:1,amount:25});});
    const statement=reader.statement(1);assertInterleaved();assert.equal(writer.statement(1).balance,1975);assert.equal(statement.opening,1500);assert.equal(statement.balance,1500);assert.equal(statement.rows.length,0);assert.equal(reader.db.isTransaction,false);reader.db.prepare=prepare;assert.equal(reader.statement(1).balance,1975);
    const movementQuery=sql=>sql.includes('FROM postings p JOIN vouchers v ON v.id=p.voucher_id') && sql.includes('WHERE p.ledger_id=? ORDER BY v.date,v.id');
    assertInterleaved=afterRead(movementQuery,'all',()=>writer.saveVoucher({type:'payment',date:'2026-05-01',ledger_id:expense.id,account_id:1,amount:50}));
    const monthly=reader.monthlySummary(1);assertInterleaved();assert.equal(monthly.last_voucher_date,DATE);assert.equal(monthly.opening,2000);assert.equal(monthly.rows[0].credit,25);assert.equal(monthly.rows[1].credit,0);assert.equal(monthly.rows[1].display_active,false);assert.equal(monthly.totals.closing,1975);assert.equal(reader.db.isTransaction,false);reader.db.prepare=prepare;
    const nextMonthly=reader.monthlySummary(1);assert.equal(nextMonthly.last_voucher_date,'2026-05-01');assert.equal(nextMonthly.rows[1].credit,50);assert.equal(nextMonthly.rows[1].display_active,true);assert.equal(nextMonthly.totals.closing,1925);
    assert.throws(()=>reader.trialBalance({from:'2026-03-31',to:DATE}),bad400);assert.equal(reader.db.isTransaction,false);assert.throws(()=>reader.statement(1,{from:'2026-03-31',to:DATE}),bad400);assert.equal(reader.db.isTransaction,false);
    reader.transaction(()=>{assert.equal(reader.db.isTransaction,true);assert.equal(reader.state().ledgers.find(ledger=>ledger.id===1).opening_balance,2000);assert.equal(reader.monthlySummary(1).totals.closing,1925);assert.equal(reader.db.isTransaction,true);});assert.equal(reader.db.isTransaction,false);
  }finally{reader.db.prepare=prepare;reader.close();writer.close();assert.ok(directory.startsWith(join(tmpdir(),'bookr-opening-snapshot-')));rmSync(directory,{recursive:true,force:true});}
});
