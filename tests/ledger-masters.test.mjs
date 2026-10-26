import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Book,BookError} from '../lib/accounting.mjs';

test('generic ledger masters create and alter all six current kinds without creating vouchers or changing groups',()=>{
  const book=new Book();try{
    const kinds=['customer','supplier','bank','cash','sales','purchase'];
    for(const kind of kinds){
      const input={kind,name:'Fictional '+kind,alias:'Alias '+kind,mailing_name:'Fictional Mailing '+kind,address:'1 Example Road',state:'Not Applicable',country:'India',pincode:'000000',...(kind==='bank'?{bank:{account_number:'000100200',branch:'Fictional Branch'}}:{})};
      const ledger=book.saveLedger(input);assert.equal(ledger.kind,kind);assert.equal(ledger.revision,1);assert.deepEqual(book.masterLedger(ledger.id),ledger);
      const saved=book.saveLedger({...ledger,name:'Renamed '+kind,alias:'New Alias '+kind,address:'2 Example Road'},ledger.id);
      assert.equal(saved.id,ledger.id);assert.equal(saved.revision,2);assert.equal(saved.kind,kind);assert.equal(saved.alias,'New Alias '+kind);assert.equal(saved.address,'2 Example Road');
      const withoutKind={...saved,name:'Again '+kind};delete withoutKind.kind;
      const final=book.saveLedger(withoutKind,ledger.id);assert.equal(final.kind,kind);assert.equal(final.revision,3);
      assert.equal(Object.hasOwn(final,'bank'),kind==='bank');if(kind==='bank')assert.equal(final.bank.account_number,'000100200');
      const before=book.state();assert.throws(()=>book.saveLedger({...final,kind:kind==='cash'?'sales':'cash'},ledger.id),BookError);assert.deepEqual(book.state(),before);
    }
    assert.equal(book.state().vouchers.length,0);assert.deepEqual(book.state().totals,{debit:0,credit:0,balanced:true});
    assert.throws(()=>book.masterLedger(999999),e=>e.status===404);
  }finally{book.close();}
});

test('generic masters reject malformed names, unsupported groups, malformed opening balances and stale edits without partial writes',()=>{
  const book=new Book();try{
    const ledger=book.saveLedger({kind:'cash',name:'Fictional Till',alias:'Till',address:'Original address'}),before=book.state();
    for(const value of [null,[],{}, {kind:'cash',name:''},{kind:'cash',name:' '},{kind:'cash',name:'x'.repeat(121)},
      {kind:'cash',name:'Cash'},{kind:'cash',name:'fictional till'},{kind:'unverified-group',name:'Unsupported Group'},{kind:'cash',name:'Bad Alias',alias:5},
      {kind:'cash',name:'Opening Balance',opening_balance:1.5},{kind:'cash',name:'Opening Balance',opening_balance:'0'}]){
      assert.throws(()=>book.saveLedger(value),BookError);assert.deepEqual(book.state(),before);
    }
    const changed=book.saveLedger({...ledger,name:'Renamed Fictional Till'},ledger.id);assert.equal(changed.revision,2);
    const stable=book.state();assert.throws(()=>book.saveLedger({...ledger,name:'Stale Till'},ledger.id),e=>e.status===409);assert.deepEqual(book.state(),stable);
    assert.throws(()=>book.saveLedger({...changed,opening_balance:1.5},changed.id),BookError);assert.deepEqual(book.state(),stable);
    book.db.exec("CREATE TRIGGER fail_generic_master BEFORE UPDATE ON ledgers WHEN NEW.name='Must Roll Back' BEGIN SELECT RAISE(ABORT,'simulated master failure'); END;");
    assert.throws(()=>book.saveLedger({...changed,name:'Must Roll Back',alias:'No partial alias',address:'No partial address'},changed.id),/simulated/);assert.deepEqual(book.state(),stable);
    assert.throws(()=>book.saveAccount({kind:'customer',name:'No party through account API'}),BookError);
  }finally{book.close();}
});

test('multiple Cash, Sales and Purchase masters feed posting reports and renamed seeded masters survive database reopen',()=>{
  const directory=mkdtempSync(join(tmpdir(),'bookr-ledger-masters-')),file=join(directory,'book.sqlite');let book=new Book(file);
  try{
    const cash=book.saveLedger({kind:'cash',name:'Fictional Second Cash',alias:'Till2'}),sales=book.saveLedger({kind:'sales',name:'Fictional Second Sales'}),purchases=book.saveLedger({kind:'purchase',name:'Fictional Second Purchases'});
    const customer=book.saveLedger({kind:'customer',name:'Fictional Buyer'}),supplier=book.saveLedger({kind:'supplier',name:'Fictional Supplier'});
    const sale=book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:sales.id,amount:100025});
    const purchase=book.saveVoucher({type:'purchase',date:'2026-04-01',supplier_id:supplier.id,account_id:purchases.id,amount:40010});
    const receipt=book.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:cash.id,amount:50025,allocations:[{bill_id:sale.bill.id,amount:50025}]});
    book.saveVoucher({type:'payment',date:'2026-04-01',supplier_id:supplier.id,account_id:cash.id,amount:20010,allocations:[{bill_id:purchase.bill.id,amount:20010}]});
    assert.equal(book.statement(cash.id).balance,30015);assert.equal(book.statement(1).balance,0);assert.equal(book.statement(sales.id).balance,-100025);assert.equal(book.statement(purchases.id).balance,40010);
    const report=book.financialReports();assert.equal(report.profitAndLoss.profit,60015);assert.equal(report.balanceSheet.groups[0].groups.find(g=>g.key==='cash').amount,30015);assert.equal(report.balanceSheet.totals.balanced,true);
    assert.equal(report.profitAndLoss.groups.find(g=>g.key==='sales').ledgers.find(l=>l.id===sales.id).amount,100025);
    const savedReceiptDetails=book.voucher(receipt.id).details;
    const renamed=book.saveLedger({...cash,name:'Renamed Fictional Second Cash'},cash.id);assert.equal(book.voucher(receipt.id).account_name,renamed.name);assert.deepEqual(book.voucher(receipt.id).details,savedReceiptDetails);
    const seededCash=book.masterLedger(1),seededSales=book.masterLedger(2);
    book.saveLedger({...seededCash,name:'Renamed Seeded Cash'},1);book.saveLedger({...seededSales,name:'Renamed Seeded Sales'},2);
    // Renaming preserves identities and frees the old name without creating a
    // replacement seeded ledger during a later constructor call.
    const newCash=book.saveLedger({kind:'cash',name:'Cash'});assert.notEqual(newCash.id,1);
    const state=book.state();book.close();book=new Book(file);assert.deepEqual(book.state(),state);assert.equal(book.masterLedger(1).name,'Renamed Seeded Cash');assert.equal(book.masterLedger(2).name,'Renamed Seeded Sales');
    assert.equal(book.ledgers().filter(l=>l.name==='Cash').length,1);assert.equal(book.db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{book.close();assert.ok(directory.startsWith(join(tmpdir(),'bookr-ledger-masters-')));rmSync(directory,{recursive:true,force:true});}
});

test('generic HTTP routes dispatch all nine ledger kinds while retaining legacy endpoints and immutable saved kinds',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'bookr-master-api-')),file=join(directory,'book.sqlite'),base='http://127.0.0.1:4335';
  const serverPath=fileURLToPath(new URL('../server.mjs',import.meta.url));let server,output='';
  async function stop(){if(!server || server.exitCode!==null)return;const stopped=new Promise(resolve=>server.once('exit',resolve));server.kill();await stopped;}
  async function start(){
    server=spawn(process.execPath,[serverPath],{windowsHide:true,env:{...process.env,PORT:'4335',BOOKR_DB:file,BOOKR_TAILSCALE_IP:''},stdio:['ignore','pipe','pipe']});
    server.stdout.on('data',data=>output+=data);server.stderr.on('data',data=>output+=data);
    for(let attempt=0;attempt<80;attempt++){if(server.exitCode!==null)throw new Error(output);try{if((await fetch(base+'/api/state')).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('Master API server did not start: '+output);
  }
  async function request(path,method='GET',data,status=200){
    const response=await fetch(base+path,{method,...(data===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})});
    const body=await response.json();assert.equal(response.status,status,JSON.stringify(body));return body;
  }
  try{
    await start();
    for(const kind of ['customer','supplier','bank','cash','sales','purchase','expense','income','capital']){
      const ledger=await request('/api/ledgers','POST',{kind,name:'HTTP Fictional '+kind,alias:'HTTP '+kind,...(kind==='bank'?{bank:{account_number:'000900'}}:{})},201);
      assert.equal(ledger.kind,kind);assert.deepEqual(await request('/api/ledgers/'+ledger.id),ledger);
      const renamed=await request('/api/ledgers/'+ledger.id,'PUT',{...ledger,name:'HTTP Renamed '+kind});assert.equal(renamed.revision,ledger.revision+1);
      await request('/api/ledgers/'+ledger.id,'PUT',{...renamed,kind:kind==='cash'?'sales':'cash'},400);
      await request('/api/ledgers/'+ledger.id,'PUT',{...ledger,name:'HTTP Stale '+kind},409);
      assert.deepEqual(await request('/api/ledgers/'+ledger.id),renamed);
      if(['customer','supplier','bank'].includes(kind)){const route=kind==='bank'?'banks':kind==='customer'?'customers':'suppliers';assert.deepEqual(await request('/api/'+route+'/'+ledger.id),renamed);}
    }
    await request('/api/ledgers/999999','GET',undefined,404);await request('/api/ledgers','POST',{kind:'unverified-group',name:'No invented group'},400);
    const cash=await request('/api/ledgers/1');await request('/api/ledgers/1','PUT',{...cash,name:'HTTP Renamed Seeded Cash'});
    const state=await request('/api/state');assert.equal(state.vouchers.length,0);await stop();await start();assert.deepEqual(await request('/api/state'),state);
  }finally{await stop();assert.ok(directory.startsWith(join(tmpdir(),'bookr-master-api-')));rmSync(directory,{recursive:true,force:true});}
});
