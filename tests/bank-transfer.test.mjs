import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Book,BookError} from '../lib/accounting.mjs';

function fixture(book){
 const source=book.saveBank({name:'Transfer Source Bank Fictional',opening_balance:1000000,bank:{account_number:'000111000111',branch:'Source Branch'}});
 const destination=book.saveBank({name:'Transfer Destination Bank Fictional',bank:{account_number:'000222000222',branch:'Destination Branch'}});
 const capital=book.saveLedger({kind:'capital',name:'Transfer Opening Capital Fictional',opening_balance:-1000000});
 return {source,destination,capital};
}
const allocation=(account,type,amount,number)=>({account_id:account.id,transaction_type:type,amount,instrument_number:number,instrument_date:'2026-04-01',bank_name:'Not Applicable',cheque_range:type==='Cheque'?'Not Applicable':''});
const input=(f,amount=250000)=>({type:'contra',date:'2026-04-01',source_id:f.source.id,destination_id:f.destination.id,amount,narration:'Fictional own-bank cheque transfer',details:{source_bank:allocation(f.source,'Cheque',amount,'000045'),bank:allocation(f.destination,'Cheque/DD',amount,'000045')}});
const update=(voucher,patch={})=>({type:'contra',date:voucher.date,source_id:voucher.source_id,destination_id:voucher.destination_id,amount:voucher.amount,narration:voucher.narration,revision:voucher.revision,...patch});
const rows=book=>Object.fromEntries(['vouchers','postings','bills','receipt_allocations','ledger_openings'].map(table=>[table,book.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(row=>({...row}))]));

test('bank-to-bank cheque Contra saves two exact postings and both allocations, reports10000 without profit, and reopens',()=>{
 const directory=mkdtempSync(join(tmpdir(),'bookr-bank-transfer-')),file=join(directory,'book.sqlite');let book=new Book(file);
 try{
  const f=fixture(book),before=book.state(),beforeFinancial=book.financialReports(),voucher=book.saveVoucher(input(f));
  assert.equal(voucher.number,1);assert.deepEqual(voucher.postings.map(p=>[p.ledger_id,p.side,p.amount]),[[f.destination.id,'debit',250000],[f.source.id,'credit',250000]]);
  assert.equal(voucher.source_id,f.source.id);assert.equal(voucher.destination_id,f.destination.id);assert.equal(voucher.details.source_bank.account_id,f.source.id);assert.equal(voucher.details.source_bank.transaction_type,'Cheque');assert.equal(voucher.details.bank.account_id,f.destination.id);assert.equal(voucher.details.bank.transaction_type,'Cheque/DD');assert.equal(voucher.details.source_bank.instrument_number,'000045');assert.equal(voucher.details.bank.instrument_number,'000045');assert.equal(voucher.details.source_bank.cheque_range,'Not Applicable');assert.equal(voucher.details.source_bank.denominations ?? null,null);assert.equal(voucher.details.bank.denominations ?? null,null);
  assert.equal(voucher.bill,null);assert.deepEqual(voucher.allocations,[]);assert.equal(book.statement(f.source.id).balance,750000);assert.equal(book.statement(f.destination.id).balance,250000);assert.equal(book.statement(1).balance,0);assert.deepEqual(book.outstanding(),before.outstanding);assert.deepEqual(book.payables(),before.payables);
  const financial=book.financialReports();assert.deepEqual(financial.profitAndLoss,beforeFinancial.profitAndLoss);assert.deepEqual(financial.balanceSheet.totals,{assets:1000000,liabilities:1000000,balanced:true});assert.equal(book.trialBalance().totals.balanced,true);assert.equal(book.dayBook({type:'contra'}).rows[0].id,voucher.id);assert.equal(book.monthlySummary(f.source.id).rows[0].credit,250000);assert.equal(book.monthlySummary(f.destination.id).rows[0].debit,250000);
  const state=book.state(),saved=book.voucher(voucher.id);book.close();book=new Book(file);assert.deepEqual(book.state(),state);assert.deepEqual(book.voucher(voucher.id),saved);assert.equal(book.db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{book.close();assert.ok(directory.startsWith(join(tmpdir(),'bookr-bank-transfer-')));rmSync(directory,{recursive:true,force:true});}
});

test('bank transfer narration-only edits preserve both allocations; amount/accounts need explicitly reviewed matching pairs',()=>{
 const book=new Book();try{
  const f=fixture(book);let voucher=book.saveVoucher(input(f)),original=voucher;
  voucher=book.saveVoucher(update(voucher,{narration:'Narration only, no details field'}),voucher.id);assert.equal(voucher.revision,2);assert.deepEqual(voucher.details,original.details);assert.equal(voucher.id,original.id);assert.equal(voucher.number,original.number);
  for(const patch of [{amount:250001},{amount:250001,details:{bank:allocation(f.destination,'Cheque/DD',250001,'000046')}},{amount:250001,details:{source_bank:allocation(f.source,'Cheque',250001,'000046')}},{source_id:f.destination.id,destination_id:f.source.id}]){const before=book.state();assert.throws(()=>book.saveVoucher(update(voucher,patch),voucher.id),BookError);assert.deepEqual(book.state(),before);}
  const replacement=input(f,300001);voucher=book.saveVoucher(update(voucher,{amount:300001,details:replacement.details}),voucher.id);assert.equal(voucher.revision,3);assert.equal(book.statement(f.source.id).balance,699999);assert.equal(book.statement(f.destination.id).balance,300001);assert.equal(book.voucher(voucher.id).postings.length,2);
  const stable=book.state();assert.throws(()=>book.saveVoucher(update(original,{details:original.details}),original.id),error=>error.status===409);assert.deepEqual(book.state(),stable);
  const reversed={source:f.destination,destination:f.source};voucher=book.saveVoucher(update(voucher,{source_id:f.destination.id,destination_id:f.source.id,amount:50001,details:input(reversed,50001).details}),voucher.id);assert.equal(voucher.revision,4);assert.equal(voucher.details.source_bank.account_id,f.destination.id);assert.equal(voucher.details.bank.account_id,f.source.id);assert.equal(book.statement(f.source.id).balance,1050001);assert.equal(book.statement(f.destination.id).balance,-50001);assert.equal(book.financialReports().profitAndLoss.netProfit,0);
 }finally{book.close();}
});

test('bank transfer rejects missing/wrong allocations, electronic or cash types, denominations and same/ineligible accounts atomically',()=>{
 const book=new Book();try{
  const f=fixture(book),base=input(f),otherCash=book.saveLedger({kind:'cash',name:'Other Cash Fictional'}),customer=book.createCustomer({name:'Transfer Ineligible Customer'});
  const invalid=[{details:{}},{details:{bank:base.details.bank}},{details:{source_bank:base.details.source_bank}},{details:{source_bank:null,bank:base.details.bank}},{source_id:f.source.id,destination_id:f.source.id},{source_id:1,destination_id:otherCash.id},{source_id:customer.id},
   {details:{...base.details,source_bank:{...base.details.source_bank,account_id:f.destination.id}}},{details:{...base.details,bank:{...base.details.bank,account_id:f.source.id}}},
   {details:{...base.details,source_bank:{...base.details.source_bank,amount:249999}}},{details:{...base.details,bank:{...base.details.bank,amount:250001}}},
   {details:{...base.details,source_bank:{...base.details.source_bank,transaction_type:'e-Fund Transfer'}}},{details:{...base.details,bank:{...base.details.bank,transaction_type:'Cash'}}},
   {details:{...base.details,source_bank:{...base.details.source_bank,denominations:{counts:{'50':1}}}}},{details:{...base.details,bank:{...base.details.bank,denominations:{counts:{'50':1}}}}},
   {details:{...base.details,source_bank:{...base.details.source_bank,cheque_range:''}}},{allocations:[]},{bill:{reference:'Not a settlement'}}];
  for(const patch of invalid){const stable=book.state(),raw=rows(book);assert.throws(()=>book.saveVoucher({...base,...patch}),BookError,JSON.stringify(patch));assert.deepEqual(book.state(),stable);assert.deepEqual(rows(book),raw);}
  const accepted=book.saveVoucher({...base,details:{source_bank:{...base.details.source_bank,denominations:null},bank:{...base.details.bank,denominations:null}}});assert.equal(accepted.postings.length,2);
 }finally{book.close();}
});

test('source_bank metadata is rejected on non-transfer Contra and other voucher types instead of silently ignored',()=>{
 const book=new Book();try{
  const f=fixture(book),customer=book.createCustomer({name:'Transfer Scope Customer'}),sale=book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:100000});
  const deposit={type:'contra',date:'2026-04-01',source_id:1,destination_id:f.destination.id,amount:10000,details:{bank:allocation(f.destination,'Cash',10000,'')}};
  const withdrawal={type:'contra',date:'2026-04-01',source_id:f.source.id,destination_id:1,amount:10000,details:{bank:allocation(f.source,'Cheque',10000,'000047')}};
  const saleInput={type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:100000},receipt={type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1,amount:10000,allocations:[{bill_id:sale.bill.id,amount:10000}]};
  for(const ordinary of [deposit,withdrawal,saleInput,receipt])for(const sourceBank of [allocation(f.source,'Cheque',ordinary.amount,'000048'),null]){const before=book.state();assert.throws(()=>book.saveVoucher({...ordinary,details:{...ordinary.details,source_bank:sourceBank}}),BookError);assert.deepEqual(book.state(),before);}
 }finally{book.close();}
});

test('cash-bank to bank-bank and back requires explicit replacement allocations and removes stale source_bank',()=>{
 const book=new Book();try{
  const f=fixture(book);let voucher=book.saveVoucher({type:'contra',date:'2026-04-01',source_id:f.source.id,destination_id:1,amount:10000,details:{bank:allocation(f.source,'Cheque',10000,'000049')}});
  const stable=book.state();assert.throws(()=>book.saveVoucher(update(voucher,{destination_id:f.destination.id}),voucher.id),BookError);assert.deepEqual(book.state(),stable);
  voucher=book.saveVoucher(update(voucher,{destination_id:f.destination.id,details:input(f,10000).details}),voucher.id);assert.equal(book.statement(1).balance,0);assert.equal(book.statement(f.source.id).balance,990000);assert.equal(book.statement(f.destination.id).balance,10000);
  const transferState=book.state();assert.throws(()=>book.saveVoucher(update(voucher,{destination_id:1}),voucher.id),BookError);assert.deepEqual(book.state(),transferState);
  const single={bank:allocation(f.source,'Cheque',10000,'000050')};assert.throws(()=>book.saveVoucher(update(voucher,{destination_id:1,details:{...single,source_bank:voucher.details.source_bank}}),voucher.id),BookError);
  voucher=book.saveVoucher(update(voucher,{destination_id:1,details:single}),voucher.id);assert.equal(Object.hasOwn(voucher.details,'source_bank'),false);assert.equal(voucher.details.bank.account_id,f.source.id);assert.equal(book.statement(1).balance,10000);assert.equal(book.statement(f.destination.id).balance,0);assert.equal(book.voucher(voucher.id).postings.length,2);
 }finally{book.close();}
});

test('bank transfer posting failures roll back both allocations, voucher revision and prior posting replacement',()=>{
 const book=new Book();try{
  const f=fixture(book),base=input(f),stable=book.state(),raw=rows(book);const trigger="CREATE TRIGGER fail_bank_transfer_credit BEFORE INSERT ON postings WHEN NEW.side='credit' BEGIN SELECT RAISE(ABORT,'simulated bank-transfer credit failure'); END;";
  book.db.exec(trigger);assert.throws(()=>book.saveVoucher(base),/simulated bank-transfer/);assert.deepEqual(book.state(),stable);assert.deepEqual(rows(book),raw);book.db.exec('DROP TRIGGER fail_bank_transfer_credit');
  const voucher=book.saveVoucher(base),saved=book.state(),savedRows=rows(book);book.db.exec(trigger);assert.throws(()=>book.saveVoucher(update(voucher,{amount:300001,narration:'Must roll back',details:input(f,300001).details}),voucher.id),/simulated bank-transfer/);assert.deepEqual(book.state(),saved);assert.deepEqual(rows(book),savedRows);
 }finally{book.close();}
});

test('bank transfers respect existing opening-date guards and report period movements separately from opening positions',()=>{
 const book=new Book();try{
  const f=fixture(book),base=input(f),before=book.state();assert.throws(()=>book.saveVoucher({...base,date:'2026-03-31'}),BookError);assert.deepEqual(book.state(),before);
  book.saveVoucher({...base,date:'2026-04-02'});const empty=book.statement(f.source.id,{from:'2026-04-01',to:'2026-04-01'}),active=book.statement(f.source.id,{from:'2026-04-02',to:'2026-04-02'});assert.equal(empty.balance,1000000);assert.equal(empty.rows.length,0);assert.equal(active.opening,1000000);assert.equal(active.balance,750000);assert.equal(active.rows.length,1);assert.equal(book.financialReports({from:'2026-04-02',to:'2026-04-02'}).profitAndLoss.netProfit,0);
  const zeroSource=book.saveBank({name:'Zero Opening Transfer Source'}),zeroDestination=book.saveBank({name:'Zero Opening Transfer Destination'});assert.equal(book.saveVoucher({...input({source:zeroSource,destination:zeroDestination},100),date:'2026-03-31'}).amount,100);
 }finally{book.close();}
});
