import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Worker} from 'node:worker_threads';
import {Book,BookError} from '../lib/accounting.mjs';

test('receipt bill context separates saved pending from the amount available to replace',()=>{
  const book=new Book();
  try{
    const customer=book.createCustomer({name:'Correction Fictional Customer'});
    const input={date:'2026-04-01',customer_id:customer.id};
    const first=book.saveVoucher({...input,type:'sale',account_id:2,amount:100000});
    const second=book.saveVoucher({...input,type:'sale',account_id:2,amount:250075,bill:{reference:'STUDY-BILL-02'}});
    book.saveVoucher({...input,type:'receipt',account_id:1,amount:40000,sale_id:first.id});
    const receipt=book.saveVoucher({...input,type:'receipt',account_id:1,amount:82525,allocations:[{bill_id:second.bill.id,amount:62525},{bill_id:first.bill.id,amount:20000}]});
    const before=book.state();
    assert.deepEqual(book.receiptBills(customer.id).bills.map(b=>[b.pending,b.own_allocation,b.available]),[[40000,0,40000],[187550,0,187550]]);
    assert.deepEqual(book.receiptBills(customer.id,receipt.id).bills.map(b=>[b.pending,b.own_allocation,b.available]),[[40000,20000,60000],[187550,62525,250075]]);
    assert.deepEqual(book.state(),before); // Context reads never post accounting entries.
    const corrected=book.saveVoucher({...receipt,allocations:[{bill_id:second.bill.id,amount:22525},{bill_id:first.bill.id,amount:60000}]},receipt.id);
    assert.equal(corrected.number,2);assert.equal(corrected.amount,82525);assert.deepEqual(corrected.postings,receipt.postings);
    assert.equal(book.statement(customer.id).balance,227550);assert.equal(book.statement(1).balance,122525);
    assert.deepEqual(book.outstanding().map(b=>b.pending),[0,227550]);
    assert.deepEqual(book.receiptBills(customer.id).bills.map(b=>b.available),[0,227550]);
    assert.deepEqual(book.receiptBills(customer.id,receipt.id).bills.map(b=>[b.pending,b.own_allocation,b.available]),[[0,60000,60000],[227550,22525,250075]]);
    const restored=book.saveVoucher({...corrected,allocations:receipt.allocations},receipt.id);
    assert.deepEqual(restored.postings,receipt.postings);assert.deepEqual(book.outstanding().map(b=>b.pending),[40000,187550]);
    for(const excluded of [-1,1.5,NaN])assert.throws(()=>book.receiptBills(customer.id,excluded),BookError);
    assert.throws(()=>book.receiptBills(customer.id,first.id),/Only a saved receipt/);
    assert.throws(()=>book.receiptBills(customer.id,999),e=>e.status===404);
    assert.throws(()=>book.receiptBills(1),/customer/);
  }finally{book.close();}
});

test('malformed receipt updates cannot silently fall back to a legacy allocation or change voucher type',()=>{
  const book=new Book();
  try{
    const customer=book.createCustomer({name:'Strict Fictional Buyer'});
    const input={date:'2026-04-01',customer_id:customer.id};
    const sale=book.saveVoucher({...input,type:'sale',account_id:2,amount:100000});
    const receipt=book.saveVoucher({...input,type:'receipt',account_id:1,amount:40000,sale_id:sale.id});
    const before=book.state();
    assert.throws(()=>book.saveVoucher({...receipt,amount:50000,allocations:null},receipt.id),/Allocate this receipt/);
    assert.throws(()=>book.saveVoucher({...receipt,type:'sale'},receipt.id),/keep its voucher type/);
    for(const revision of [true,'1',null,1.5])assert.throws(()=>book.saveVoucher({...receipt,revision},receipt.id),e=>e.status===409);
    assert.deepEqual(book.state(),before);
    const {allocations,...legacy}=receipt;
    const saved=book.saveVoucher({...legacy,narration:'Legacy input still supported'},receipt.id);
    assert.equal(saved.amount,40000);assert.deepEqual(saved.allocations,allocations);assert.equal(book.outstanding()[0].pending,60000);
  }finally{book.close();}
});

const timeout=(promise,ms)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Concurrent receipt worker timed out.')),ms);
  promise.then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});
});

for(const payable of [false,true])test(`two simultaneous ${payable?'payment':'receipt'} writers cannot spend the same remaining bill balance`,{timeout:20000},async()=>{
  const directory=mkdtempSync(join(tmpdir(),'bookr-concurrent-receipts-')),file=join(directory,'book.sqlite');
  const book=new Book(file),workers=[];
  try{
    const customer=payable?book.saveSupplier({name:'Concurrent Fictional Supplier'}):book.createCustomer({name:'Concurrent Fictional Customer'});
    const party=payable?{supplier_id:customer.id}:{customer_id:customer.id};
    const sale=book.saveVoucher({type:payable?'purchase':'sale',date:'2026-04-01',...party,account_id:payable?book.ledgers().find(l=>l.kind==='purchase').id:2,amount:100000});
    const input={type:payable?'payment':'receipt',date:'2026-04-01',...party,account_id:1,amount:40000,allocations:[{bill_id:sale.bill.id,amount:40000}]};
    book.saveVoucher(input);
    const gate=new SharedArrayBuffer(4);
    const code=String.raw`
      const {parentPort,workerData}=require('node:worker_threads');
      (async()=>{
        const {Book}=await import(workerData.moduleUrl);
        const book=new Book(workerData.file);
        try{
          parentPort.postMessage({phase:'ready'});
          Atomics.wait(new Int32Array(workerData.gate),0,0);
          try{const saved=book.saveVoucher(workerData.input);parentPort.postMessage({phase:'result',ok:true,id:saved.id,postings:saved.postings.length});}
          catch(error){parentPort.postMessage({phase:'result',ok:false,status:error.status,message:error.message});}
        }finally{book.close();}
      })().catch(error=>{parentPort.postMessage({phase:'fatal',message:error.message});process.exitCode=1;});`;
    const jobs=Array.from({length:2},()=>{
      const worker=new Worker(code,{eval:true,workerData:{file,gate,moduleUrl:new URL('../lib/accounting.mjs',import.meta.url).href,input}});workers.push(worker);
      let readyResolve,readyReject,resultResolve,resultReject;
      const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
      const result=new Promise((resolve,reject)=>{resultResolve=resolve;resultReject=reject;});
      worker.on('message',m=>{if(m.phase==='ready')readyResolve();else if(m.phase==='result')resultResolve(m);else if(m.phase==='fatal'){readyReject(new Error(m.message));resultReject(new Error(m.message));}});
      worker.on('error',e=>{readyReject(e);resultReject(e);});
      return {ready,result};
    });
    // Observe both result promises immediately, including startup failures.
    const outcomes=timeout(Promise.all(jobs.map(j=>j.result)),15000);
    outcomes.catch(()=>{}); // Keep startup rejection handled if readiness fails first.
    await timeout(Promise.all(jobs.map(j=>j.ready)),10000);
    Atomics.store(new Int32Array(gate),0,1);Atomics.notify(new Int32Array(gate),0,2);
    const results=await outcomes;
    assert.equal(results.filter(r=>r.ok).length,1);const rejected=results.find(r=>!r.ok);assert.equal(rejected.status,400);assert.match(rejected.message,/exceeds/);
    assert.equal(results.find(r=>r.ok).postings,2);
    assert.equal(book.state().vouchers.length,3);assert.equal(book.statement(customer.id).balance,payable?-20000:20000);assert.equal((payable?book.payables():book.outstanding())[0].pending,20000);
    assert.deepEqual({...book.state().totals},{debit:180000,credit:180000,balanced:true});
  }finally{await Promise.allSettled(workers.map(w=>w.terminate()));book.close();rmSync(directory,{recursive:true,force:true});}
});
