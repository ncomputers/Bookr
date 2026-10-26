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
  const depositInput={type:'contra',date:'2026-04-01',source_id:1,destination_id:bank.id,amount:5000,narration:'Fictional cash deposit',details:{bank:{...bankAllocation(bank,'Cash',5000),denominations:{counts:{'50':1},others:0}}}};
  const withdrawalInput={type:'contra',date:'2026-04-01',source_id:bank.id,destination_id:1,amount:2000,narration:'Fictional cash withdrawal',details:{bank:bankAllocation(bank,'Cheque',2000,'000301')}};
  return {customer,supplier,bank,first,purchase,depositInput,withdrawalInput};
}
const contraInput=voucher=>({type:'contra',date:voucher.date,source_id:voucher.source_id,destination_id:voucher.destination_id,amount:voucher.amount,narration:voucher.narration,details:structuredClone(voucher.details),revision:voucher.revision});
const tableNames=['ledgers','vouchers','postings','bills','receipt_allocations','bank_accounts'];
const tableRows=db=>Object.fromEntries(tableNames.map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));

test('observed 50 deposit and 20 withdrawal inputs produce two balanced postings each and survive reopening',()=>{
  const directory=mkdtempSync(join(tmpdir(),'bookr-contra-')),file=join(directory,'book.sqlite');let book=new Book(file);
  try{
    const {customer,supplier,bank,depositInput,withdrawalInput}=fixture(book),before=book.state(),financial=book.financialReports();
    const deposit=book.saveVoucher(depositInput);assert.equal(deposit.number,1);
    assert.deepEqual(deposit.postings.map(p=>[p.ledger_id,p.side,p.amount]),[[bank.id,'debit',5000],[1,'credit',5000]]);
    assert.equal(deposit.source_id,1);assert.equal(deposit.source_name,'Cash');assert.equal(deposit.destination_id,bank.id);assert.equal(deposit.destination_name,bank.name);
    assert.equal(deposit.customer_id,1);assert.equal(deposit.account_id,bank.id);assert.equal(deposit.bill,null);assert.deepEqual(deposit.allocations,[]);
    assert.equal(deposit.details.bank.denominations.counts['50'],1);assert.equal(Object.keys(deposit.details.bank.denominations.counts).length,11);
    assert.equal(deposit.details.bank.denominations.total,5000);assert.equal(deposit.details.bank.denominations.difference,0);
    assert.equal(book.statement(1).balance,57525);assert.equal(book.statement(bank.id).balance,25000);
    const withdrawal=book.saveVoucher(withdrawalInput);assert.equal(withdrawal.number,2);
    assert.deepEqual(withdrawal.postings.map(p=>[p.ledger_id,p.side,p.amount]),[[1,'debit',2000],[bank.id,'credit',2000]]);
    assert.equal(withdrawal.details.bank.instrument_number,'000301');assert.equal(withdrawal.details.bank.cheque_range,'Not Applicable');
    assert.equal(book.statement(1).balance,59525);assert.equal(book.statement(bank.id).balance,23000);
    assert.equal(book.statement(customer.id).balance,197550);assert.equal(book.statement(supplier.id).balance,-80000);
    assert.deepEqual(book.outstanding(),before.outstanding);assert.deepEqual(book.payables(),before.payables);
    const after=book.financialReports();assert.deepEqual(after.profitAndLoss,financial.profitAndLoss);assert.deepEqual(after.balanceSheet.totals,financial.balanceSheet.totals);assert.deepEqual(after.balanceSheet.profit,financial.balanceSheet.profit);
    assert.deepEqual(book.trialBalance().totals,{debit:430075,credit:430075,balanced:true});
    const daybook=book.dayBook({type:'contra'});assert.deepEqual(daybook.rows.map(r=>r.id),[deposit.id,withdrawal.id]);assert.deepEqual(daybook.totals,{debit:0,credit:7000});
    assert.equal(daybook.rows[0].source_name,'Cash');assert.equal(daybook.rows[0].destination_name,bank.name);
    assert.deepEqual(book.dayBook().rows.slice(0,2).map(r=>r.type),['contra','contra']);
    const state=book.state();book.close();book=new Book(file);assert.deepEqual(book.state(),state);assert.deepEqual(book.voucher(deposit.id),deposit);assert.deepEqual(book.voucher(withdrawal.id),withdrawal);
    assert.equal(book.db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{book.close();assert.ok(directory.startsWith(join(tmpdir(),'bookr-contra-')));rmSync(directory,{recursive:true,force:true});}
});

test('Contra edits preserve number and revision, require new metadata on transfer changes, and replace postings atomically',()=>{
  const book=new Book();try{
    const {bank,depositInput}=fixture(book),deposit=book.saveVoucher(depositInput),other=book.saveBank({name:'Second Fictional Bank'}),original=book.state();
    const noDetails=contraInput(deposit);delete noDetails.details;
    assert.throws(()=>book.saveVoucher({...noDetails,amount:5001},deposit.id),BookError);
    assert.throws(()=>book.saveVoucher({...noDetails,destination_id:other.id},deposit.id),BookError);
    assert.throws(()=>book.saveVoucher({...noDetails,source_id:bank.id,destination_id:1},deposit.id),BookError);assert.deepEqual(book.state(),original);
    let changed=book.saveVoucher({...contraInput(deposit),destination_id:other.id,amount:5001,details:{bank:{...bankAllocation(other,'Cash',5001),denominations:{counts:{'50':1},others:1}}}},deposit.id);
    assert.equal(changed.number,deposit.number);assert.equal(changed.revision,deposit.revision+1);assert.equal(changed.postings.length,2);assert.equal(changed.details.bank.denominations.total,5001);
    assert.equal(book.statement(other.id).balance,5001);assert.equal(book.statement(bank.id).balance,20000);
    const same=contraInput(changed);delete same.details;changed=book.saveVoucher({...same,narration:'Narration-only edit'},changed.id);assert.equal(changed.details.bank.denominations.total,5001);
    const before=book.state();book.db.exec(`CREATE TRIGGER fail_contra_post BEFORE INSERT ON postings WHEN NEW.ledger_id=${bank.id} BEGIN SELECT RAISE(ABORT,'simulated Contra posting failure'); END;`);
    assert.throws(()=>book.saveVoucher({...contraInput(changed),destination_id:bank.id,details:{bank:{...bankAllocation(bank,'Cash',5001),denominations:null}}},changed.id),/simulated/);
    assert.deepEqual(book.state(),before);assert.deepEqual(book.voucher(changed.id),changed);book.db.exec('DROP TRIGGER fail_contra_post');
    const withdrawal=book.saveVoucher({...contraInput(changed),source_id:other.id,destination_id:1,details:{bank:bankAllocation(other,'Cheque',5001,'000302')}},changed.id);
    assert.equal(withdrawal.number,deposit.number);assert.equal(withdrawal.source_id,other.id);assert.equal(withdrawal.destination_id,1);assert.equal(book.statement(other.id).balance,-5001);
    assert.throws(()=>book.saveVoucher(contraInput(changed),changed.id),e=>e.status===409);
    assert.throws(()=>book.saveVoucher({...contraInput(withdrawal),type:'receipt'},withdrawal.id),BookError);
  }finally{book.close();}
});

test('Contra pair, bank and allocation validation rejects unsupported inputs without changing saved data',()=>{
  const book=new Book();try{
    const {customer,supplier,bank,first,depositInput,withdrawalInput}=fixture(book),other=book.saveBank({name:'Another Fictional Bank'});
    const old=book.state(),invalid=[
      {...depositInput,source_id:1,destination_id:1},{...depositInput,source_id:bank.id,destination_id:other.id},
      {...depositInput,source_id:customer.id},{...depositInput,destination_id:supplier.id},{...depositInput,source_id:2},
      {...depositInput,source_id:999999},{...depositInput,amount:0},{...depositInput,amount:1.5},{...depositInput,date:'2026-02-30'},
      {...depositInput,bill:null},{...depositInput,bill:{reference:'Not permitted'}},{...depositInput,allocations:[]},{...depositInput,allocations:[{bill_id:first.bill.id,amount:5000}]},{...depositInput,sale_id:first.id},
      {...depositInput,details:{bank:null}},{...depositInput,details:{bank:{...depositInput.details.bank,account_id:1}}},
      {...depositInput,details:{bank:{...depositInput.details.bank,amount:4999}}},{...depositInput,details:{bank:{...depositInput.details.bank,transaction_type:'Cheque'}}},
      {...withdrawalInput,details:{bank:{...withdrawalInput.details.bank,transaction_type:'Cash'}}},{...withdrawalInput,details:{bank:{...withdrawalInput.details.bank,cheque_range:''}}},{...withdrawalInput,details:{bank:{...withdrawalInput.details.bank,denominations:{counts:{'20':1},others:0}}}}
    ];
    for(const input of invalid){assert.throws(()=>book.saveVoucher(input),BookError);assert.deepEqual(book.state(),old);}
    const cash=book.db.prepare("INSERT INTO ledgers(name,kind) VALUES('Second Fictional Cash','cash')").run();
    assert.throws(()=>book.saveVoucher({...depositInput,destination_id:Number(cash.lastInsertRowid)}),BookError);
  }finally{book.close();}
});

test('cash denominations compute exact paise and signed differences without asserting unobserved mismatch rejection',()=>{
  const book=new Book();try{
    const {depositInput}=fixture(book);
    const save=denominations=>book.saveVoucher({...depositInput,details:{bank:{...depositInput.details.bank,denominations}}});
    const mismatch=save({counts:{'20':1},others:25});assert.equal(mismatch.details.bank.denominations.total,2025);assert.equal(mismatch.details.bank.denominations.difference,2975);
    const excess=save({counts:{'100':1},others:1});assert.equal(excess.details.bank.denominations.total,10001);assert.equal(excess.details.bank.denominations.difference,-5001);
    assert.equal(save(null).details.bank.denominations,null);
    const omitted=book.saveVoucher({...depositInput,details:{bank:bankAllocation(book.bank(depositInput.destination_id),'Cash',5000)}});assert.equal(omitted.details.bank.denominations,null);
    for(const denominations of [[],{counts:null},{counts:[]},{counts:{'50':null}},{counts:{'50':-1}},{counts:{'50':0.5}},{counts:{'50':'1'}},{counts:{'3':1}},{counts:{'50':1},others:null},{counts:{},others:-1},{counts:{},others:0.5},{counts:{'2000':Number.MAX_SAFE_INTEGER},others:0},{counts:{'1':1},others:Number.MAX_SAFE_INTEGER}]){
      const before=book.state();assert.throws(()=>save(denominations),BookError);assert.deepEqual(book.state(),before);
    }
  }finally{book.close();}
});

test('Contra report periods carry balances, exclude future transfers, and never enter bill-settlement queries',()=>{
  const book=new Book();try{
    const {customer,bank,first,depositInput,withdrawalInput}=fixture(book),before=book.state();
    const deposit=book.saveVoucher(depositInput);book.saveVoucher({...withdrawalInput,date:'2026-04-03',amount:2001,details:{bank:bankAllocation(bank,'Cheque',2001,'000303')}});
    const period={from:'2026-04-02',to:'2026-04-02'};
    assert.equal(book.dayBook({...period,type:'contra'}).rows.length,0);assert.deepEqual(book.dayBook({from:'2026-04-01',to:'2026-04-01',type:'contra'}).totals,{debit:0,credit:5000});
    const cash=book.statement(1,period),bankStatement=book.statement(bank.id,period);assert.equal(cash.rows.length,0);assert.equal(cash.opening,57525);assert.equal(cash.balance,57525);assert.equal(bankStatement.opening,25000);
    assert.equal(book.financialReports(period).profitAndLoss.profit,0);assert.equal(book.financialReports(period).balanceSheet.profit.closing,200075);
    assert.equal(book.statement(1).balance,59526);assert.equal(book.statement(bank.id).balance,22999);
    assert.throws(()=>book.receiptBills(customer.id,deposit.id),BookError);assert.throws(()=>book.paymentBills(customer.id,deposit.id),BookError);
    // Deliberately inject a foreign-key-valid but semantically invalid link in
    // this in-memory test: report queries must still ignore Contra settlements.
    book.db.prepare('INSERT INTO receipt_allocations(receipt_id,bill_id,amount,position) VALUES(?,?,?,0)').run(deposit.id,first.bill.id,5000);
    assert.deepEqual(book.outstanding(),before.outstanding);assert.equal(book.allocated(first.id),90000);assert.deepEqual(book.allocations(deposit.id),[]);assert.deepEqual(book.voucher(deposit.id).allocations,[]);
    assert.deepEqual(book.receiptBills(customer.id).bills.map(b=>b.pending),[10000,187550]);
  }finally{book.close();}
});

test('populated pre-Contra bank schema migrates without losing bank metadata, vouchers, bills or identities',()=>{
  const directory=mkdtempSync(join(tmpdir(),'bookr-contra-migration-')),file=join(directory,'old.sqlite');let book;
  const source=new Book();
  try{
    const {bank}=fixture(source),expectedState=source.state(),expectedRows=tableRows(source.db);
    const old=new DatabaseSync(file);old.exec('PRAGMA foreign_keys=ON');
    try{
      for(const table of tableNames){let sql=source.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table).sql;if(table==='vouchers')sql=sql.replace(",'contra'",'');old.exec(sql);}
      for(const table of tableNames){const values=expectedRows[table];if(!values.length)continue;const columns=Object.keys(values[0]),insert=old.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`);for(const row of values)insert.run(...columns.map(column=>row[column]));}
      assert.equal(old.prepare("SELECT sql FROM sqlite_master WHERE name='vouchers'").get().sql.includes("'contra'"),false);
    }finally{old.close();}
    book=new Book(file);assert.deepEqual(tableRows(book.db),expectedRows);assert.deepEqual(book.state(),expectedState);assert.equal(book.bank(bank.id).bank.account_number,'000123456789');
    assert.equal(book.db.prepare('PRAGMA foreign_key_check').all().length,0);assert.equal(book.db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
    const deposit=book.saveVoucher({type:'contra',date:'2026-04-01',source_id:1,destination_id:bank.id,amount:501,details:{bank:{...bankAllocation(bank,'Cash',501),denominations:{counts:{'5':1},others:1}}}});
    assert.equal(deposit.number,1);assert.equal(deposit.details.bank.denominations.total,501);
    const final=book.state();book.close();book=new Book(file);assert.deepEqual(book.state(),final);assert.equal(book.bank(bank.id).bank.account_number,'000123456789');
  }finally{source.close();book?.close();assert.ok(directory.startsWith(join(tmpdir(),'bookr-contra-migration-')));rmSync(directory,{recursive:true,force:true});}
});
