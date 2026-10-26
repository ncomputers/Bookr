import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {Book,BookError} from '../lib/accounting.mjs';
import {expandAccountingSchema} from '../lib/schema.mjs';

const bankDetails={account_holder:'Bookr Demo Fictional',account_number:'000123456789',ifs_code:'DEMO0000001',swift_code:'DEMOZZZZ',bank_name:'Not Applicable',branch:'Fictional Study Branch'};
const allocation=(bank,type,amount,number)=>({account_id:bank.id,transaction_type:type==='payment'?'Cheque':'Cheque/DD',amount,instrument_number:number,instrument_date:'2026-04-01',bank_name:'Not Applicable',cheque_range:type==='payment'?'Not Applicable':''});
function fixture(book){
  const customer=book.createCustomer({name:'Demo Customer'}),supplier=book.saveSupplier({name:'Study Supplier Fictional'});
  const purchaseAccount=book.ledgers().find(l=>l.kind==='purchase').id;
  const first=book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:100000});
  const second=book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:250075,bill:{reference:'STUDY-BILL-02'}});
  book.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1,amount:40000,allocations:[{bill_id:first.bill.id,amount:40000}]});
  book.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1,amount:82525,allocations:[{bill_id:second.bill.id,amount:62525},{bill_id:first.bill.id,amount:20000}]});
  const purchase=book.saveVoucher({type:'purchase',date:'2026-04-01',supplier_id:supplier.id,account_id:purchaseAccount,amount:150000,bill:{reference:'sup-001'}});
  book.saveVoucher({type:'payment',date:'2026-04-01',supplier_id:supplier.id,account_id:1,amount:60000,allocations:[{bill_id:purchase.bill.id,amount:60000}]});
  const bank=book.saveBank({name:'Study Bank Fictional',alias:'SBF',bank:bankDetails});
  const receiptInput={type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:bank.id,amount:30000,allocations:[{bill_id:first.bill.id,amount:30000}],details:{bank:allocation(bank,'receipt',30000,'000101')}};
  const paymentInput={type:'payment',date:'2026-04-01',supplier_id:supplier.id,account_id:bank.id,amount:10000,allocations:[{bill_id:purchase.bill.id,amount:10000}],details:{bank:allocation(bank,'payment',10000,'000201')}};
  return {customer,supplier,first,second,purchase,bank,receiptInput,paymentInput};
}

test('observed bank receipt and payment preserve cheque metadata, postings and financial balances after reopening',()=>{
  const directory=mkdtempSync(join(tmpdir(),'bookr-banking-')),file=join(directory,'book.sqlite');let book=new Book(file);
  try{
    const {customer,supplier,bank,receiptInput,paymentInput}=fixture(book),before=book.financialReports();
    const receipt=book.saveVoucher(receiptInput),payment=book.saveVoucher(paymentInput);
    assert.deepEqual(receipt.details.bank,receiptInput.details.bank);assert.deepEqual(payment.details.bank,paymentInput.details.bank);
    assert.deepEqual(receipt.postings.map(p=>[p.ledger_id,p.side,p.amount]),[[bank.id,'debit',30000],[customer.id,'credit',30000]]);
    assert.deepEqual(payment.postings.map(p=>[p.ledger_id,p.side,p.amount]),[[supplier.id,'debit',10000],[bank.id,'credit',10000]]);
    const statement=book.statement(bank.id);assert.equal(statement.opening,0);assert.equal(statement.balance,20000);
    assert.deepEqual(statement.rows.map(r=>[r.type,r.side,r.amount]),[['receipt','debit',30000],['payment','credit',10000]]);
    assert.equal(book.statement(1).balance,62525);assert.equal(book.statement(customer.id).balance,197550);assert.equal(book.statement(supplier.id).balance,-80000);
    assert.equal(book.outstanding().reduce((sum,b)=>sum+b.pending,0),197550);assert.equal(book.payables()[0].pending,80000);
    const report=book.financialReports();assert.deepEqual(report.profitAndLoss,before.profitAndLoss);
    assert.deepEqual(report.balanceSheet.totals,{assets:280075,liabilities:280075,balanced:true});
    const banks=report.balanceSheet.groups[0].groups.find(g=>g.key==='banks');assert.equal(banks.name,'Bank Accounts');assert.equal(banks.amount,20000);
    assert.deepEqual(banks.ledgers,[{id:bank.id,name:bank.name,amount:20000}]);
    assert.deepEqual(book.trialBalance().totals,{debit:430075,credit:430075,balanced:true});
    const empty=book.financialReports({from:'2026-04-02',to:'2026-04-02'});assert.equal(empty.profitAndLoss.profit,0);assert.deepEqual(empty.balanceSheet.totals,report.balanceSheet.totals);
    const bankPeriod=book.statement(bank.id,{from:'2026-04-02',to:'2026-04-02'});assert.equal(bankPeriod.rows.length,0);assert.equal(bankPeriod.opening,20000);assert.equal(bankPeriod.balance,20000);
    const renamed=book.saveBank({...bank,name:'Renamed Fictional Bank',bank:{...bank.bank,branch:'New Fictional Branch'}} ,bank.id);
    assert.equal(renamed.id,bank.id);assert.equal(renamed.revision,bank.revision+1);assert.equal(book.voucher(receipt.id).details.bank.instrument_number,'000101');
    const state=book.state();book.close();book=new Book(file);assert.deepEqual(book.state(),state);assert.deepEqual(book.bank(bank.id),renamed);
    assert.deepEqual(book.voucher(payment.id).details.bank,paymentInput.details.bank);assert.equal(book.db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{book.close();assert.ok(directory.startsWith(join(tmpdir(),'bookr-banking-')));rmSync(directory,{recursive:true,force:true});}
});

test('bank ledger validation, stale revisions and failed metadata writes cannot partially alter a ledger',()=>{
  const book=new Book();try{
    const oldLedgers=book.ledgers(),bank=book.saveBank({name:'Default Fictional Bank'});
    assert.equal(bank.bank.account_holder,'Bookr Demo Fictional');assert.equal(bank.bank.bank_name,'Not Applicable');
    for(const ledger of oldLedgers)assert.deepEqual(book.ledger(ledger.id),ledger);
    assert.equal(Object.hasOwn(book.ledger(1),'bank'),false);
    const stable=book.state();
    for(const invalid of [null,[],{name:''},{name:'Cash'},{name:'Bad bank',bank:null},{name:'Bad bank',bank:[]},{name:'Bad bank',bank:{account_number:123}},{name:'Bad bank',bank:{branch:'x'.repeat(121)}}]){
      assert.throws(()=>book.saveBank(invalid),BookError);assert.deepEqual(book.state(),stable);
    }
    assert.throws(()=>book.saveBank({...bank,revision:0},bank.id),e=>e.status===409);assert.throws(()=>book.bank(1),e=>e.status===404);
    book.db.exec("CREATE TRIGGER fail_bank_metadata BEFORE UPDATE ON bank_accounts BEGIN SELECT RAISE(ABORT,'simulated bank metadata failure'); END;");
    assert.throws(()=>book.saveBank({...bank,name:'Must Roll Back',bank:{branch:'Not committed'}},bank.id),/simulated/);assert.deepEqual(book.state(),stable);
    book.db.exec('DROP TRIGGER fail_bank_metadata');
    const edited=book.saveBank({...bank,bank:{account_number:'000123'}},bank.id);assert.equal(edited.bank.account_number,'000123');assert.equal(edited.bank.account_holder,bank.bank.account_holder);
    assert.throws(()=>book.saveBank({...bank,name:'Stale bank'},bank.id),e=>e.status===409);
    book.db.exec("CREATE TRIGGER fail_new_bank_metadata BEFORE INSERT ON bank_accounts BEGIN SELECT RAISE(ABORT,'simulated new bank metadata failure'); END;");
    const beforeNew=book.state();assert.throws(()=>book.saveBank({name:'No Partial New Bank'}),/simulated/);assert.deepEqual(book.state(),beforeNew);
  }finally{book.close();}
});

test('bank allocation validation rejects stale or mismatched details without consuming a bill balance',()=>{
  const book=new Book();try{
    const {bank,receiptInput,paymentInput,first}=fixture(book),before=book.state();
    const invalid=[undefined,null,[],{...receiptInput.details.bank,account_id:1},{...receiptInput.details.bank,amount:29999},{...receiptInput.details.bank,amount:'30000'},
      {...receiptInput.details.bank,transaction_type:'e-Fund Transfer'},{...receiptInput.details.bank,transaction_type:'Cheque'},
      {...receiptInput.details.bank,instrument_date:'2026-02-30'},{...receiptInput.details.bank,instrument_number:101},{...receiptInput.details.bank,cheque_range:'1-10'}];
    for(const value of invalid){assert.throws(()=>book.saveVoucher({...receiptInput,details:{bank:value}}),BookError);assert.deepEqual(book.state(),before);}
    assert.throws(()=>book.saveVoucher({...receiptInput,account_id:1}),BookError);assert.deepEqual(book.state(),before);
    assert.throws(()=>book.saveVoucher({...paymentInput,details:{bank:{...paymentInput.details.bank,transaction_type:'Cheque/DD'}}}),BookError);
    assert.throws(()=>book.saveVoucher({...receiptInput,amount:40001,allocations:[{bill_id:first.bill.id,amount:40001}],details:{bank:allocation(bank,'receipt',40001,'000111')}}),BookError);
    const cash=book.saveVoucher({...receiptInput,account_id:1,details:{bank:null}});assert.equal(Object.hasOwn(cash.details,'bank'),false);
    assert.throws(()=>book.saveVoucher({...cash,account_id:bank.id,details:undefined},cash.id),BookError);
  }finally{book.close();}
});

test('bank edits replace selected-account postings, clear cash metadata, and rollback all changes on a posting failure',()=>{
  const book=new Book();try{
    const {bank,receiptInput}=fixture(book),receipt=book.saveVoucher(receiptInput),other=book.saveBank({name:'Second Fictional Bank'});
    const stable=book.state();
    assert.throws(()=>book.saveVoucher({...receipt,account_id:other.id,details:undefined},receipt.id),BookError);
    assert.throws(()=>book.saveVoucher({...receipt,account_id:other.id},receipt.id),BookError);assert.deepEqual(book.state(),stable);
    let current=book.saveVoucher({...receipt,account_id:other.id,details:{bank:allocation(other,'receipt',30000,'000102')}},receipt.id);
    assert.equal(current.number,receipt.number);assert.equal(book.statement(bank.id).balance,0);assert.equal(book.statement(other.id).balance,30000);
    assert.equal(current.postings.length,2);assert.equal(current.details.bank.account_id,other.id);
    current=book.saveVoucher({...current,account_id:1,details:{...current.details,bank:null}},current.id);
    assert.equal(Object.hasOwn(current.details,'bank'),false);assert.equal(book.statement(other.id).balance,0);assert.equal(book.statement(1).balance,92525);
    current=book.saveVoucher({...current,account_id:bank.id,details:{bank:allocation(bank,'receipt',30000,'000103')}},current.id);
    const noDetails={...current,account_id:1};delete noDetails.details;
    current=book.saveVoucher(noDetails,current.id);assert.equal(Object.hasOwn(current.details,'bank'),false);
    current=book.saveVoucher({...current,account_id:bank.id,details:{bank:allocation(bank,'receipt',30000,'000104')}},current.id);
    const before=book.state();book.db.exec(`CREATE TRIGGER fail_bank_post BEFORE INSERT ON postings WHEN NEW.ledger_id=${other.id} BEGIN SELECT RAISE(ABORT,'simulated bank posting failure'); END;`);
    assert.throws(()=>book.saveVoucher({...current,account_id:other.id,details:{bank:allocation(other,'receipt',30000,'000105')}},current.id),/simulated/);
    assert.deepEqual(book.state(),before);assert.deepEqual(book.voucher(current.id),current);book.db.exec('DROP TRIGGER fail_bank_post');
    const paise=book.saveVoucher({...current,amount:30001,allocations:current.allocations.map(a=>({...a,amount:30001})),details:{bank:allocation(bank,'receipt',30001,'000106')}},current.id);
    assert.equal(paise.details.bank.amount,30001);assert.equal(book.statement(bank.id).balance,30001);assert.equal(book.state().totals.balanced,true);
    assert.throws(()=>book.saveVoucher({...current,narration:'Stale edit'},current.id),e=>e.status===409);
    const snapshot=book.state(),metadata=structuredClone(paise.details.bank);
    const unchanged=book.saveVoucher({...paise,details:undefined,narration:'Metadata retained'},paise.id);assert.deepEqual(unchanged.details.bank,metadata);
    assert.equal(book.state().vouchers.length,snapshot.vouchers.length);
  }finally{book.close();}
});

function createFiveKindDatabase(file){
  const db=new DatabaseSync(file);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE ledgers(id INTEGER PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE,kind TEXT NOT NULL CHECK(kind IN ('customer','supplier','cash','sales','purchase')),alias TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 1,mailing_name TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',state TEXT NOT NULL DEFAULT 'Not Applicable',country TEXT NOT NULL DEFAULT 'India',pincode TEXT NOT NULL DEFAULT '');
    CREATE TABLE vouchers(id INTEGER PRIMARY KEY,type TEXT NOT NULL CHECK(type IN ('sale','receipt','purchase','payment')),number INTEGER NOT NULL,date TEXT NOT NULL,customer_id INTEGER NOT NULL REFERENCES ledgers(id),account_id INTEGER NOT NULL REFERENCES ledgers(id),amount INTEGER NOT NULL CHECK(amount>0),narration TEXT NOT NULL DEFAULT '',sale_id INTEGER REFERENCES vouchers(id),revision INTEGER NOT NULL DEFAULT 1,details TEXT NOT NULL DEFAULT '{}',UNIQUE(type,number));
    CREATE TABLE postings(voucher_id INTEGER NOT NULL REFERENCES vouchers(id),ledger_id INTEGER NOT NULL REFERENCES ledgers(id),side TEXT NOT NULL CHECK(side IN ('debit','credit')),amount INTEGER NOT NULL CHECK(amount>0),PRIMARY KEY(voucher_id,ledger_id));
    CREATE TABLE bills(id INTEGER PRIMARY KEY,sale_id INTEGER NOT NULL UNIQUE REFERENCES vouchers(id),reference TEXT NOT NULL,amount INTEGER NOT NULL);
    CREATE TABLE receipt_allocations(receipt_id INTEGER NOT NULL REFERENCES vouchers(id),bill_id INTEGER NOT NULL REFERENCES bills(id),amount INTEGER NOT NULL,position INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(receipt_id,bill_id));
    INSERT INTO ledgers(id,name,kind,revision) VALUES(1,'Cash','cash',1),(2,'Demo Sales','sales',1),(3,'Demo Purchases','purchase',1),(7,'Old Fictional Customer','customer',4),(8,'Old Fictional Supplier','supplier',3);
    INSERT INTO vouchers VALUES(10,'sale',12,'2026-04-01',7,2,100000,'Original sale',NULL,3,'{"party":{"mailing_name":"Saved Original Buyer"}}'),(11,'receipt',9,'2026-04-01',7,1,40000,'Original receipt',10,2,'{}'),(12,'purchase',5,'2026-04-01',8,3,150000,'Original purchase',NULL,4,'{"supplier_invoice":{"number":"ORIGINAL-SUP"}}'),(13,'payment',3,'2026-04-01',8,1,60000,'Original payment',12,2,'{}');
    INSERT INTO postings VALUES(10,7,'debit',100000),(10,2,'credit',100000),(11,1,'debit',40000),(11,7,'credit',40000),(12,3,'debit',150000),(12,8,'credit',150000),(13,8,'debit',60000),(13,1,'credit',60000);
    INSERT INTO bills VALUES(20,10,'ORIGINAL-SALE',100000),(21,12,'ORIGINAL-SUP',150000);
    INSERT INTO receipt_allocations VALUES(11,20,40000,2),(13,21,60000,4);`);
  return db;
}
const rows=db=>Object.fromEntries(['ledgers','vouchers','postings','bills','receipt_allocations'].map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));

test('populated pre-bank five-kind schema migrates with every existing row unchanged and bank metadata survives the next reopen',()=>{
  const directory=mkdtempSync(join(tmpdir(),'bookr-bank-migration-')),file=join(directory,'old.sqlite');let book;
  try{
    const old=createFiveKindDatabase(file),original=rows(old);old.close();book=new Book(file);
    assert.deepEqual(rows(book.db),original);assert.equal(book.db.prepare('PRAGMA foreign_key_check').all().length,0);assert.equal(book.db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
    const bank=book.saveBank({name:'New Fictional Bank',bank:bankDetails});
    const receipt=book.saveVoucher({type:'receipt',date:'2026-04-02',customer_id:7,account_id:bank.id,amount:12345,allocations:[{bill_id:20,amount:12345}],details:{bank:allocation(bank,'receipt',12345,'000001')}});
    assert.equal(receipt.number,10);assert.equal(book.customer(7).revision,4);assert.equal(book.supplier(8).revision,3);
    const state=book.state();book.close();book=new Book(file);assert.deepEqual(book.state(),state);assert.deepEqual(book.bank(bank.id).bank,bankDetails);
    assert.equal(book.db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{book?.close();assert.ok(directory.startsWith(join(tmpdir(),'bookr-bank-migration-')));rmSync(directory,{recursive:true,force:true});}
});

test('a foreign-key failure rolls bank schema migration back and restores foreign-key enforcement',()=>{
  const directory=mkdtempSync(join(tmpdir(),'bookr-bank-migration-rollback-')),file=join(directory,'old.sqlite'),db=createFiveKindDatabase(file);
  try{
    db.exec("PRAGMA foreign_keys=OFF; INSERT INTO postings VALUES(999,1,'debit',1);");
    const original=rows(db),sql=db.prepare("SELECT sql FROM sqlite_master WHERE name='ledgers'").get().sql;
    assert.throws(()=>expandAccountingSchema(db),/foreign key check/);assert.deepEqual(rows(db),original);
    assert.equal(db.prepare("SELECT sql FROM sqlite_master WHERE name='ledgers'").get().sql,sql);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
    assert.equal(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name LIKE 'expanded_%'").get().count,0);
  }finally{db.close();assert.ok(directory.startsWith(join(tmpdir(),'bookr-bank-migration-rollback-')));rmSync(directory,{recursive:true,force:true});}
});
