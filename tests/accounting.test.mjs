import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Book, BookError } from '../lib/accounting.mjs';
import { parseRupees,parseEntryDate } from '../public/entry-values.js';

test('customer ledger survives closing, reopening and altering without creating vouchers', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bookr-ledger-'));
  let book = new Book(join(directory,'test.sqlite'));
  try {
    const created = book.createCustomer({ name:'  Fictional Customer  ', alias:' Demo ' });
    assert.equal(created.name,'Fictional Customer');
    assert.equal(created.alias,'Demo');
    book.close(); book = new Book(join(directory,'test.sqlite'));
    assert.deepEqual(book.customer(created.id),created);
    const altered = book.saveCustomer({ name:'Fictional Customer Updated', alias:'Updated', revision:created.revision },created.id);
    assert.equal(altered.id,created.id);
    assert.equal(altered.revision,2);
    book.close(); book = new Book(join(directory,'test.sqlite'));
    assert.equal(book.customer(created.id).name,'Fictional Customer Updated');
    assert.equal(book.customer(created.id).alias,'Updated');
    assert.equal(book.state().vouchers.length,0);
    assert.deepEqual({ ...book.state().totals },{ debit:0, credit:0, balanced:true });
  } finally { book.close(); rmSync(directory,{recursive:true,force:true}); }
});

test('validation and stale edits cannot overwrite saved ledgers', () => {
  const book = new Book();
  try {
    const a = book.createCustomer({name:'Customer A',alias:'A'});
    book.createCustomer({name:'Customer B'});
    for (const invalid of [null, [], {}, {name:'  '}, {name:'x'.repeat(121)}, {name:'Bad Alias',alias:5}, {name:'customer a'}, {name:'Cash'}]) {
      assert.throws(() => book.createCustomer(invalid),BookError);
    }
    assert.throws(() => book.saveCustomer({name:'CUSTOMER B', revision:a.revision},a.id),/already exists/);
    assert.equal(book.customer(a.id).name,'Customer A');
    const saved = book.saveCustomer({name:'Customer A',alias:'New alias',revision:a.revision},a.id);
    assert.throws(() => book.saveCustomer({name:'Overwritten',revision:a.revision},a.id),error => error.status === 409);
    assert.throws(() => book.saveCustomer({name:'Renamed Cash',revision:1},1),error => error.status === 404);
    assert.equal(book.customer(a.id).alias,'New alias');
    assert.equal(book.customer(a.id).revision,saved.revision);
    assert.equal(book.ledgers().filter(row => row.kind === 'customer').length,2);
  } finally { book.close(); }
});

test('existing application database gains ledger revision while keeping saved names', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bookr-migration-'));
  const file = join(directory,'test.sqlite');
  const old = new DatabaseSync(file);
  old.exec("CREATE TABLE ledgers(id INTEGER PRIMARY KEY,name TEXT COLLATE NOCASE UNIQUE,kind TEXT,alias TEXT DEFAULT ''); INSERT INTO ledgers VALUES(3,'Existing Fictional Customer','customer','Fictional');");
  old.close();
  const book = new Book(file);
  try {
    assert.equal(book.customer(3).name,'Existing Fictional Customer');
    assert.equal(book.customer(3).revision,1);
    assert.equal(book.saveCustomer({name:'Existing Fictional Customer',alias:'Updated',revision:1},3).revision,2);
  } finally { book.close(); rmSync(directory,{recursive:true,force:true}); }
});

test('sale persists balanced postings and edits replace them without changing its number', () => {
  const directory = mkdtempSync(join(tmpdir(),'bookr-sale-'));
  let book = new Book(join(directory,'sale.sqlite'));
  try {
    const customer = book.createCustomer({name:'Fictional Credit Customer'});
    const sale = book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:125075,narration:'Fictional no-tax sale'});
    assert.equal(sale.number,1);
    assert.deepEqual(sale.postings.map(row => [row.ledger_id,row.side,row.amount]),[[customer.id,'debit',125075],[2,'credit',125075]]);
    assert.equal(book.statement(customer.id).balance,125075);
    book.close(); book = new Book(join(directory,'sale.sqlite'));
    const reopened = book.voucher(sale.id);
    assert.equal(reopened.narration,'Fictional no-tax sale');
    const changed = book.saveVoucher({...reopened,amount:234550,date:'2026-04-02',narration:'Corrected fictional sale'},sale.id);
    assert.equal(changed.number,1);
    assert.equal(changed.revision,2);
    assert.equal(changed.postings.length,2);
    assert.equal(book.statement(customer.id).balance,234550);
    assert.deepEqual({...book.state().totals},{debit:234550,credit:234550,balanced:true});
    assert.throws(() => book.saveVoucher({...reopened,amount:1},sale.id),error => error.status === 409);
    assert.equal(book.voucher(sale.id).amount,234550);
    const next = book.saveVoucher({...reopened,amount:12345});
    assert.equal(next.number,2);
    assert.equal(book.state().vouchers.length,2);
  } finally { book.close(); rmSync(directory,{recursive:true,force:true}); }
});

test('invalid dates, amounts and ledger kinds leave the book unchanged', () => {
  const book = new Book();
  try {
    const customer = book.createCustomer({name:'Validation Customer'});
    const input = {type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:10000};
    for (const date of ['2026-13-01','2026-02-30','2025-02-29','not-a-date',null]) {
      assert.throws(() => book.saveVoucher({...input,date}),error => error instanceof BookError && error.status === 400);
    }
    for (const amount of [0,-1,100.25,NaN,Infinity,100000000001,'100']) {
      assert.throws(() => book.saveVoucher({...input,amount}),BookError);
    }
    // Cash is now a supported Sales party. Direct Bank sales remain outside
    // this workflow and must still be rejected without partial postings.
    const bank = book.saveBank({name:'Validation Unsupported Sales Bank'});
    assert.throws(() => book.saveVoucher({...input,customer_id:bank.id}),BookError);
    assert.throws(() => book.saveVoucher({...input,account_id:1}),BookError);
    assert.throws(() => book.saveVoucher(null),BookError);
    assert.equal(book.state().vouchers.length,0);
    assert.equal(book.db.prepare('SELECT COUNT(*) AS count FROM postings').get().count,0);
  } finally { book.close(); }
});

test('a failed second posting rolls back the sale and its first posting', () => {
  const book = new Book();
  try {
    const customer = book.createCustomer({name:'Atomic Customer'});
    book.db.exec("CREATE TRIGGER fail_credit BEFORE INSERT ON postings WHEN NEW.side='credit' BEGIN SELECT RAISE(ABORT,'test credit write failure'); END");
    assert.throws(() => book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:100000}),/test credit write failure/);
    assert.equal(book.state().vouchers.length,0);
    assert.equal(book.db.prepare('SELECT COUNT(*) AS count FROM postings').get().count,0);
    assert.equal(book.db.prepare('SELECT COUNT(*) AS count FROM bills').get().count,0);
    book.db.exec('DROP TRIGGER fail_credit');
    assert.equal(book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:100000}).number,1);
  } finally { book.close(); }
});

test('named New Ref persists independently of voucher number and keeps its identity when altered', () => {
  const directory = mkdtempSync(join(tmpdir(),'bookr-bill-reference-'));
  let book = new Book(join(directory,'bill.sqlite'));
  try {
    const customer = book.createCustomer({name:'Fictional Named Bill Customer'});
    const input = {type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:250075,bill:{reference:'  STUDY-BILL-02  '}};
    const sale = book.saveVoucher(input);
    assert.equal(sale.number,1);
    assert.equal(sale.bill.reference,'STUDY-BILL-02');
    assert.equal(sale.bill.sale_id,sale.id);
    assert.equal(sale.bill.amount,250075);
    const billId = sale.bill.id;
    book.close(); book = new Book(join(directory,'bill.sqlite'));
    const reopened = book.voucher(sale.id);
    assert.equal(reopened.bill.reference,'STUDY-BILL-02');
    const changed = book.saveVoucher({...reopened,amount:270025,bill:{reference:'CORRECTED-REF'}},sale.id);
    assert.equal(changed.number,1);
    assert.equal(changed.bill.id,billId);
    assert.equal(changed.bill.amount,270025);
    assert.equal(changed.postings.length,2);
    assert.deepEqual({...book.state().totals},{debit:270025,credit:270025,balanced:true});
    assert.equal(book.outstanding()[0].reference,'CORRECTED-REF');
    assert.equal(book.outstanding()[0].bill_id,billId);
    assert.throws(() => book.saveVoucher({...reopened,bill:{reference:'STALE'}},sale.id),error => error.status === 409);
    for (const bill of [null,[],{}, {reference:''},{reference:'   '},{reference:5},{reference:'x'.repeat(121)}]) {
      assert.throws(() => book.saveVoucher({...changed,bill},sale.id),BookError);
    }
    assert.equal(book.voucher(sale.id).bill.reference,'CORRECTED-REF');
    assert.equal(book.voucher(sale.id).revision,2);
    book.close(); book = new Book(join(directory,'bill.sqlite'));
    assert.equal(book.voucher(sale.id).bill.id,billId);
    assert.equal(book.voucher(sale.id).bill.reference,'CORRECTED-REF');
    const posted = book.voucher(sale.id);
    book.db.exec("CREATE TRIGGER fail_rename_credit BEFORE INSERT ON postings WHEN NEW.side='credit' BEGIN SELECT RAISE(ABORT,'test rename rollback'); END");
    assert.throws(() => book.saveVoucher({...posted,bill:{reference:'NOT-COMMITTED'}},sale.id),/test rename rollback/);
    assert.equal(book.voucher(sale.id).bill.reference,'CORRECTED-REF');
    assert.equal(book.voucher(sale.id).postings.length,2);
    assert.equal(book.voucher(sale.id).revision,2);
  } finally { book.close(); rmSync(directory,{recursive:true,force:true}); }
});

test('legacy sales gain numeric references without changing vouchers, receipts or accounting balances', () => {
  const directory = mkdtempSync(join(tmpdir(),'bookr-legacy-bills-'));
  let book = new Book(join(directory,'legacy.sqlite'));
  try {
    const customer = book.createCustomer({name:'Legacy Fictional Buyer'});
    const sale = book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:100000});
    book.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1,sale_id:sale.id,amount:40000});
    book.db.exec('DROP TABLE receipt_allocations; DROP TABLE bills');
    const originalPostings = book.statement(customer.id);
    book.close(); book = new Book(join(directory,'legacy.sqlite'));
    assert.equal(book.voucher(sale.id).bill.reference,'1');
    assert.equal(book.voucher(sale.id).revision,1);
    assert.equal(book.state().vouchers.length,2);
    assert.equal(book.outstanding()[0].pending,60000);
    assert.deepEqual(book.statement(customer.id),originalPostings);
    const updated = book.saveVoucher({...book.voucher(sale.id),bill:{reference:'LEGACY-NAMED'}},sale.id);
    assert.equal(updated.bill.reference,'LEGACY-NAMED');
    book.close(); book = new Book(join(directory,'legacy.sqlite'));
    assert.equal(book.db.prepare('SELECT COUNT(*) AS count FROM bills').get().count,1);
    assert.equal(book.voucher(sale.id).bill.reference,'LEGACY-NAMED');
    assert.equal(book.outstanding()[0].pending,60000);
  } finally { book.close(); rmSync(directory,{recursive:true,force:true}); }
});

test('observed sale and partial receipt produce 600 outstanding without hardcoded values', () => {
  const book = new Book();
  try {
    const customer = book.createCustomer({name:'Fictional Outstanding Customer'});
    const sale = book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:100000});
    book.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1,sale_id:sale.id,amount:40000});
    assert.equal(book.statement(customer.id).balance,60000);
    assert.equal(book.outstanding()[0].pending,60000);
    assert.equal(book.state().totals.balanced,true);
    assert.throws(() => book.saveVoucher({...sale,amount:39999},sale.id),/less than receipts/);
    assert.equal(book.voucher(sale.id).amount,100000);
  } finally { book.close(); }
});

test('amount entry preserves exact paise and date entry rejects impossible days', () => {
  assert.equal(parseRupees('0.29'),29);
  assert.equal(parseRupees('1250.75'),125075);
  assert.equal(parseRupees('001.1'),110);
  for (const value of ['1.001','1e3','-50','0','1,000','words','1000000000.01']) assert.throws(() => parseRupees(value));
  assert.equal(parseEntryDate('2-Apr-2026'),'2026-04-02');
  assert.equal(parseEntryDate('2-4-2026'),'2026-04-02');
  assert.equal(parseEntryDate('2024-02-29'),'2024-02-29');
  for (const value of ['2026-02-29','31-Apr-2026','2026-99-99']) assert.throws(() => parseEntryDate(value));
});

test('Day Book combines voucher type and inclusive date filters without changing the book',()=>{
  const book=new Book();
  try{
    const customer=book.createCustomer({name:'Day Book Fictional Customer'});
    const sale=(date,amount)=>book.saveVoucher({type:'sale',date,customer_id:customer.id,account_id:2,amount});
    const first=sale('2026-04-01',100000),second=sale('2026-04-03',250075);
    const receipt=(date,amount,sale_id)=>book.saveVoucher({type:'receipt',date,customer_id:customer.id,account_id:1,amount,sale_id});
    const paid=receipt('2026-04-01',40000,first.id);receipt('2026-04-04',62525,second.id);
    const before=book.state();
    assert.deepEqual(book.dayBook().rows.map(v=>v.id),[paid.id,first.id,second.id,4]);
    assert.deepEqual(book.dayBook().totals,{debit:350075,credit:102525});
    const filtered=book.dayBook({from:'2026-04-01',to:'2026-04-03',type:'sale'});
    assert.equal(filtered.rows.length,2);assert.deepEqual(filtered.totals,{debit:350075,credit:0});
    assert.equal(book.dayBook({from:'2026-04-02',to:'2026-04-02'}).rows.length,0);
    assert.deepEqual(book.dayBook({to:'2026-04-03',type:'receipt'}).rows.map(v=>v.id),[paid.id]);
    for(const filter of [null,[],{type:'credit-note'},{type:1},{from:'2026-02-30'},{from:'2026-04-04',to:'2026-04-01'}])assert.throws(()=>book.dayBook(filter),BookError);
    assert.deepEqual(book.state(),before);
  }finally{book.close();}
});

test('ledger period carries earlier postings into opening and excludes later transactions', () => {
  const book=new Book();
  try{
    const customer=book.createCustomer({name:'Period Fictional Customer'});
    const sale=book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:100000});
    book.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1,amount:40000,sale_id:sale.id});
    const later=book.saveVoucher({type:'sale',date:'2026-04-03',customer_id:customer.id,account_id:2,amount:25075});
    book.saveVoucher({type:'receipt',date:'2026-04-04',customer_id:customer.id,account_id:1,amount:10000,sale_id:later.id});
    const empty=book.statement(customer.id,{from:'2026-04-02',to:'2026-04-02'});
    assert.equal(empty.opening,60000);assert.equal(empty.balance,60000);assert.equal(empty.rows.length,0);
    const selected=book.statement(customer.id,{from:'2026-04-03',to:'2026-04-03'});
    assert.equal(selected.opening,60000);assert.equal(selected.balance,85075);assert.equal(selected.rows.length,1);assert.equal(selected.rows[0].balance,85075);
    assert.equal(book.statement(customer.id,{from:'2026-04-01',to:'2026-04-01'}).rows.length,2);
    assert.equal(book.statement(customer.id,{to:'2026-04-03'}).balance,85075);
    assert.equal(book.statement(customer.id).balance,75075);
    const before=book.state();
    for(const period of [{from:'2026-02-30'},{to:''},{from:'2026-04-04',to:'2026-04-01'},null,[]])assert.throws(()=>book.statement(customer.id,period),BookError);
    assert.deepEqual(book.state(),before);
  }finally{book.close();}
});

test('observed split receipt survives restart with two allocations and only two postings', () => {
  const directory=mkdtempSync(join(tmpdir(),'bookr-split-')),file=join(directory,'split.sqlite');
  let book=new Book(file);
  try {
    const customer=book.createCustomer({name:'Split Fictional Customer'});
    const sale=amount=>book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount});
    const first=sale(100000),second=book.saveVoucher({...sale(250075),bill:{reference:'STUDY-BILL-02'}},2);
    const receipt={type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1};
    book.saveVoucher({...receipt,amount:40000,allocations:[{bill_id:first.bill.id,amount:40000}]});
    assert.equal(book.statement(customer.id).balance,310075);
    const allocations=[{bill_id:second.bill.id,amount:62525},{bill_id:first.bill.id,amount:20000}];
    const saved=book.saveVoucher({...receipt,amount:82525,allocations});
    assert.deepEqual(saved.postings.map(p=>[p.ledger_id,p.side,p.amount]),[[1,'debit',82525],[customer.id,'credit',82525]]);
    assert.equal(book.statement(customer.id).balance,227550);
    assert.deepEqual(book.outstanding().map(b=>[b.reference,b.pending]),[['1',40000],['STUDY-BILL-02',187550]]);
    book.close();book=new Book(file);
    assert.deepEqual(book.voucher(saved.id).allocations,saved.allocations);
    assert.deepEqual({...book.state().totals},{debit:472600,credit:472600,balanced:true});
    // Replacing allocations excludes this receipt's own saved amounts.
    const changed=book.saveVoucher({...book.voucher(saved.id),allocations:[{bill_id:first.bill.id,amount:60000},{bill_id:second.bill.id,amount:22525}]},saved.id);
    assert.equal(changed.number,2);assert.equal(changed.revision,2);assert.equal(changed.postings.length,2);
    assert.deepEqual(book.outstanding().map(b=>b.pending),[0,227550]);
    assert.equal(book.statement(customer.id).balance,227550);
    assert.throws(()=>book.saveVoucher({...saved,narration:'stale'},saved.id),e=>e.status===409);
    assert.throws(()=>book.saveVoucher({...first,amount:99999},first.id),/less than receipts/);
    book.close();book=new Book(file);
    assert.equal(book.voucher(saved.id).allocations.length,2);
    assert.deepEqual(book.outstanding().map(b=>b.pending),[0,227550]);
  }finally{book.close();rmSync(directory,{recursive:true,force:true});}
});

test('invalid receipt splits and failed writes leave allocations, balances and revisions intact', () => {
  const book=new Book();
  try{
    const a=book.createCustomer({name:'Buyer A'}),b=book.createCustomer({name:'Buyer B'});
    const makeSale=customer_id=>book.saveVoucher({type:'sale',date:'2026-04-01',customer_id,account_id:2,amount:100000});
    const first=makeSale(a.id),second=makeSale(b.id);
    const receipt={type:'receipt',date:'2026-04-01',customer_id:a.id,account_id:1,amount:40000,allocations:[{bill_id:first.bill.id,amount:40000}]};
    const saved=book.saveVoucher(receipt),before=book.state();
    for(const allocations of [[],null,[{bill_id:first.bill.id,amount:39999}],[{bill_id:second.bill.id,amount:40000}],
      [{bill_id:first.bill.id,amount:20000},{bill_id:first.bill.id,amount:20000}],
      [{bill_id:999,amount:40000}],[{bill_id:first.bill.id,amount:1.5}],[{bill_id:first.bill.id,amount:-1}]]){
      assert.throws(()=>book.saveVoucher({...receipt,allocations}),BookError);
    }
    assert.throws(()=>book.saveVoucher({...receipt,amount:60001,allocations:[{bill_id:first.bill.id,amount:60001}]}),/exceeds/);
    assert.deepEqual(book.state(),before);
    book.db.exec("CREATE TRIGGER fail_receipt_posting BEFORE INSERT ON postings WHEN NEW.side='credit' BEGIN SELECT RAISE(ABORT,'receipt rollback'); END");
    assert.throws(()=>book.saveVoucher({...saved,amount:50000,allocations:[{bill_id:first.bill.id,amount:50000}]},saved.id),/receipt rollback/);
    assert.deepEqual(book.state(),before);assert.deepEqual(book.voucher(saved.id),saved);
    book.db.exec('DROP TRIGGER fail_receipt_posting');
    const altered=book.saveVoucher({...saved,amount:100000,allocations:[{bill_id:first.bill.id,amount:100000}]},saved.id);
    assert.equal(altered.revision,2);assert.equal(book.outstanding()[0].pending,0);
  }finally{book.close();}
});

test('mailing details persist and voucher party details remain a separate saved snapshot', () => {
  const directory = mkdtempSync(join(tmpdir(),'bookr-details-'));
  let book = new Book(join(directory,'details.sqlite'));
  try {
    const customer = book.createCustomer({name:'Fictional Buyer',mailing_name:'Buyer Trading',address:'12 Example Road',state:'Not Applicable',country:'India',pincode:'000000'});
    const sale = book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:12345,
      details:{dispatch:{delivery_note:'DEMO-1',document_no:'DOC-1',through:'Demo Transport',destination:'Example Town',carrier:'Fictional Carrier',bill_of_lading:'LR-1',bill_date:'2026-04-01',vehicle:'DEMO VEHICLE'},
        party:{mailing_name:customer.mailing_name,address:'Invoice-specific address',state:customer.state,country:customer.country}}});
    book.saveCustomer({...customer,name:'Renamed Buyer',address:'New customer address',revision:customer.revision},customer.id);
    book.close(); book = new Book(join(directory,'details.sqlite'));
    assert.equal(book.customer(customer.id).mailing_name,'Buyer Trading');
    assert.equal(book.customer(customer.id).address,'New customer address');
    assert.equal(book.customer(customer.id).pincode,'000000');
    const reopened = book.voucher(sale.id);
    assert.equal(reopened.customer_name,'Renamed Buyer');
    assert.equal(reopened.details.party.address,'Invoice-specific address');
    assert.equal(reopened.details.dispatch.document_no,'DOC-1');
    assert.equal(reopened.details.dispatch.bill_date,'2026-04-01');
    assert.equal(book.state().vouchers[0].details.party.mailing_name,'Buyer Trading');
    assert.throws(() => book.saveVoucher({...reopened,details:{dispatch:{bill_date:'2026-02-30'}}},sale.id),BookError);
    assert.equal(book.voucher(sale.id).revision,1);
    assert.equal(book.voucher(sale.id).details.dispatch.document_no,'DOC-1');
    assert.equal(book.state().totals.balanced,true);
  } finally { book.close(); rmSync(directory,{recursive:true,force:true}); }
});
