import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {Book,BookError} from '../lib/accounting.mjs';

function fixture(book){
  const customer=book.createCustomer({name:'Demo Customer'}),supplier=book.saveSupplier({name:'Study Supplier Fictional',alias:'SSF'});
  const purchases=book.ledgers().find(l=>l.kind==='purchase');
  const sale=amount=>book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount});
  const first=sale(100000),second=sale(250075);
  book.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1,amount:40000,allocations:[{bill_id:first.bill.id,amount:40000}]});
  book.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1,amount:82525,allocations:[{bill_id:second.bill.id,amount:62525},{bill_id:first.bill.id,amount:20000}]});
  const purchase=book.saveVoucher({type:'purchase',date:'2026-04-01',supplier_id:supplier.id,account_id:purchases.id,amount:150000,details:{supplier_invoice:{number:'SUP-001',date:'2026-04-01'}}});
  const paymentInput={type:'payment',date:'2026-04-01',supplier_id:supplier.id,account_id:1,amount:60000,allocations:[{bill_id:purchase.bill.id,amount:60000}]};
  const payment=book.saveVoucher(paymentInput);
  return {customer,supplier,purchases,purchase,payment,paymentInput,first};
}

test('observed supplier cycle and all five Trial Balance ledger balances survive restart',()=>{
  const directory=mkdtempSync(join(tmpdir(),'bookr-payables-')),file=join(directory,'book.sqlite');let book=new Book(file);
  try{
    const {customer,supplier,purchases,purchase,payment}=fixture(book);
    assert.equal(book.supplier(supplier.id).alias,'SSF');assert.equal(purchase.number,1);assert.equal(payment.number,1);
    assert.equal(purchase.bill.reference,'SUP-001');assert.equal(purchase.details.supplier_invoice.date,'2026-04-01');
    assert.deepEqual(purchase.postings.map(p=>[p.ledger_id,p.side,p.amount]),[[purchases.id,'debit',150000],[supplier.id,'credit',150000]]);
    assert.deepEqual(payment.postings.map(p=>[p.ledger_id,p.side,p.amount]),[[supplier.id,'debit',60000],[1,'credit',60000]]);
    assert.equal(book.statement(supplier.id).balance,-90000);assert.equal(book.statement(customer.id).balance,227550);assert.equal(book.statement(1).balance,62525);
    assert.deepEqual(book.payables().map(b=>[b.reference,b.pending]),[['SUP-001',90000]]);
    assert.deepEqual(book.outstanding().map(b=>b.pending),[40000,187550]);
    const trial=book.trialBalance();
    assert.deepEqual(trial.totals,{debit:440075,credit:440075,balanced:true});
    assert.deepEqual(new Map(trial.rows.map(r=>[r.id,r.balance])),new Map([[1,62525],[2,-350075],[customer.id,227550],[supplier.id,-90000],[purchases.id,150000]]));
    assert.deepEqual(book.state().totals,{debit:682600,credit:682600,balanced:true});
    const before=book.state();book.close();book=new Book(file);assert.deepEqual(book.state(),before);
    assert.deepEqual(book.voucher(payment.id),payment);assert.deepEqual(book.voucher(purchase.id),purchase);
    assert.equal(book.db.prepare('PRAGMA foreign_key_check').all().length,0);
    const emptyPeriod=book.trialBalance({from:'2026-04-02',to:'2026-04-02'});
    assert.deepEqual(emptyPeriod.totals,trial.totals);assert.equal(emptyPeriod.rows.find(r=>r.id===supplier.id).opening,-90000);
    assert.equal(emptyPeriod.rows.every(r=>r.debit===0 && r.credit===0),true);
    assert.equal(book.trialBalance({to:'2026-03-31'}).rows.every(r=>r.balance===0),true);
    for(const period of [[],{from:'2026-04-31'},{from:'2026-04-02',to:'2026-04-01'}])assert.throws(()=>book.trialBalance(period),BookError);
  }finally{book.close();rmSync(directory,{recursive:true,force:true});}
});

test('supplier allocations stay separate and edits replace postings and allocations atomically',()=>{
  const book=new Book();
  try{
    const {supplier,purchase,payment,paymentInput,first,purchases}=fixture(book);
    const before=book.state();
    const other=book.saveSupplier({name:'Other Fictional Supplier'});const withOther=book.state();
    const invalid=[{...paymentInput,allocations:[{bill_id:first.bill.id,amount:60000}]},{...paymentInput,supplier_id:other.id},
      {...paymentInput,amount:90001,allocations:[{bill_id:purchase.bill.id,amount:90001}]},{...paymentInput,account_id:2},
      {...paymentInput,supplier_id:first.customer_id},{...paymentInput,allocations:null}];
    for(const value of invalid){assert.throws(()=>book.saveVoucher(value),BookError);assert.deepEqual(book.state(),withOther);}
    assert.throws(()=>book.receiptBills(first.customer_id,payment.id),BookError);
    assert.throws(()=>book.paymentBills(supplier.id,first.id),BookError);
    assert.equal(book.paymentBills(supplier.id).bills[0].available,90000);
    assert.deepEqual(book.paymentBills(supplier.id,payment.id).bills.map(b=>[b.pending,b.available,b.own_allocation]),[[90000,150000,60000]]);
    const full=book.saveVoucher({...paymentInput,revision:payment.revision,amount:150000,allocations:[{bill_id:purchase.bill.id,amount:150000}]},payment.id);
    assert.equal(full.number,payment.number);assert.equal(full.revision,payment.revision+1);assert.equal(book.state().vouchers.length,before.vouchers.length);
    assert.equal(book.payables()[0].pending,0);assert.equal(book.statement(supplier.id).balance,0);assert.equal(book.statement(1).balance,-27475);
    assert.throws(()=>book.saveVoucher({...paymentInput,revision:payment.revision},payment.id),e=>e.status===409);
    assert.throws(()=>book.saveVoucher({...purchase,amount:149999},purchase.id),BookError);
    assert.throws(()=>book.saveVoucher({...purchase,supplier_id:other.id},purchase.id),BookError);
    const renamed=book.saveVoucher({...purchase,bill:{reference:'SUP-REVISED'},details:{supplier_invoice:{number:'SUP-REVISED',date:'2026-04-01'}}},purchase.id);
    assert.equal(renamed.bill.id,purchase.bill.id);assert.equal(book.voucher(payment.id).allocations[0].reference,'SUP-REVISED');
    const stable=book.state();
    book.db.exec(`CREATE TRIGGER fail_payment_post BEFORE INSERT ON postings WHEN NEW.ledger_id=1 AND NEW.side='credit' BEGIN SELECT RAISE(ABORT,'simulated cash posting failure'); END;`);
    assert.throws(()=>book.saveVoucher({...full,amount:60000,allocations:paymentInput.allocations},payment.id),/simulated/);
    assert.deepEqual(book.state(),stable);book.db.exec('DROP TRIGGER fail_payment_post');
    const restored=book.saveVoucher({...full,amount:60000,allocations:paymentInput.allocations},payment.id);
    assert.equal(restored.postings.length,2);assert.equal(book.statement(1).balance,62525);
    assert.deepEqual(book.dayBook({type:'purchase'}).totals,{debit:0,credit:150000});
    assert.deepEqual(book.dayBook({type:'payment'}).totals,{debit:60000,credit:0});
    assert.equal(book.ledger(purchases.id).kind,'purchase');
  }finally{book.close();}
});

test('old constrained schema expands without changing saved sales, receipts, references or ledger revisions',()=>{
  const directory=mkdtempSync(join(tmpdir(),'bookr-payable-migration-')),file=join(directory,'old.sqlite');
  const old=new DatabaseSync(file);
  old.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE ledgers(id INTEGER PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE,kind TEXT NOT NULL CHECK(kind IN ('customer','cash','sales')),alias TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE vouchers(id INTEGER PRIMARY KEY,type TEXT NOT NULL CHECK(type IN ('sale','receipt')),number INTEGER NOT NULL,date TEXT NOT NULL,customer_id INTEGER NOT NULL REFERENCES ledgers(id),account_id INTEGER NOT NULL REFERENCES ledgers(id),amount INTEGER NOT NULL CHECK(amount>0),narration TEXT NOT NULL DEFAULT '',sale_id INTEGER REFERENCES vouchers(id),revision INTEGER NOT NULL DEFAULT 1,UNIQUE(type,number));
    CREATE TABLE postings(voucher_id INTEGER NOT NULL REFERENCES vouchers(id),ledger_id INTEGER NOT NULL REFERENCES ledgers(id),side TEXT NOT NULL CHECK(side IN ('debit','credit')),amount INTEGER NOT NULL CHECK(amount>0),PRIMARY KEY(voucher_id,ledger_id));
    CREATE TABLE bills(id INTEGER PRIMARY KEY,sale_id INTEGER NOT NULL UNIQUE REFERENCES vouchers(id),reference TEXT NOT NULL,amount INTEGER NOT NULL);
    CREATE TABLE receipt_allocations(receipt_id INTEGER NOT NULL REFERENCES vouchers(id),bill_id INTEGER NOT NULL REFERENCES bills(id),amount INTEGER NOT NULL,position INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(receipt_id,bill_id));
    INSERT INTO ledgers VALUES(1,'Cash','cash','',1),(2,'Demo Sales','sales','',1),(7,'Existing Fictional Customer','customer','Old alias',4);
    INSERT INTO vouchers VALUES(10,'sale',12,'2026-04-01',7,2,100000,'Original sale',NULL,3),(15,'receipt',9,'2026-04-01',7,1,40000,'Original receipt',10,2);
    INSERT INTO bills VALUES(20,10,'ORIGINAL-CUSTOM-REF',100000);
    INSERT INTO receipt_allocations VALUES(15,20,40000,2);
    INSERT INTO postings VALUES(10,7,'debit',100000),(10,2,'credit',100000),(15,1,'debit',40000),(15,7,'credit',40000);`);
  const oldRows={ledgers:old.prepare('SELECT * FROM ledgers ORDER BY id').all(),vouchers:old.prepare('SELECT * FROM vouchers ORDER BY id').all(),postings:old.prepare('SELECT * FROM postings ORDER BY voucher_id,ledger_id').all(),bills:old.prepare('SELECT * FROM bills').all(),allocations:old.prepare('SELECT * FROM receipt_allocations').all()};old.close();
  let book=new Book(file);
  try{
    for(const row of oldRows.ledgers)assert.deepEqual(Object.fromEntries(Object.keys(row).map(key=>[key,book.ledger(row.id)[key]])),{...row});
    for(const row of oldRows.vouchers)assert.deepEqual(Object.fromEntries(Object.keys(row).map(key=>[key,book.voucher(row.id)[key]])),{...row});
    assert.deepEqual(book.db.prepare('SELECT * FROM postings ORDER BY voucher_id,ledger_id').all(),oldRows.postings);
    assert.deepEqual(book.db.prepare('SELECT * FROM bills').all(),oldRows.bills);
    assert.deepEqual(book.db.prepare('SELECT * FROM receipt_allocations').all(),oldRows.allocations);
    assert.equal(book.outstanding()[0].pending,60000);assert.equal(book.db.prepare('PRAGMA foreign_key_check').all().length,0);
    const supplier=book.saveSupplier({name:'New Fictional Supplier'});
    book.saveVoucher({type:'purchase',date:'2026-04-01',supplier_id:supplier.id,account_id:book.ledgers().find(l=>l.kind==='purchase').id,amount:50000});
    const before=book.state();book.close();book=new Book(file);assert.deepEqual(book.state(),before);assert.equal(book.customer(7).revision,4);
  }finally{book.close();rmSync(directory,{recursive:true,force:true});}
});

test('one supplier payment can allocate exact paise across bills without creating extra accounting postings',()=>{
  const directory=mkdtempSync(join(tmpdir(),'bookr-split-payment-')),file=join(directory,'book.sqlite');let book=new Book(file);
  try{
    const {supplier,purchase,purchases}=fixture(book);
    const second=book.saveVoucher({type:'purchase',date:'2026-04-02',supplier_id:supplier.id,account_id:purchases.id,amount:70025,bill:{reference:'SUP-002'}});
    const payment=book.saveVoucher({type:'payment',date:'2026-04-02',supplier_id:supplier.id,account_id:1,amount:105025,allocations:[{bill_id:second.bill.id,amount:20025},{bill_id:purchase.bill.id,amount:85000}]});
    assert.equal(payment.postings.length,2);assert.deepEqual(payment.postings.map(p=>p.amount),[105025,105025]);
    assert.deepEqual(payment.allocations.map(a=>[a.bill_id,a.amount]),[[second.bill.id,20025],[purchase.bill.id,85000]]);
    assert.deepEqual(book.payables().map(b=>b.pending),[5000,50000]);assert.equal(book.statement(supplier.id).balance,-55000);
    const before=book.state();book.close();book=new Book(file);assert.deepEqual(book.state(),before);assert.deepEqual(book.voucher(payment.id).allocations,payment.allocations);
    assert.equal(book.trialBalance().totals.balanced,true);
    const duplicate={...payment,allocations:[{bill_id:second.bill.id,amount:20025},{bill_id:second.bill.id,amount:85000}]};
    assert.throws(()=>book.saveVoucher(duplicate,payment.id),BookError);assert.deepEqual(book.state(),before);
  }finally{book.close();rmSync(directory,{recursive:true,force:true});}
});
