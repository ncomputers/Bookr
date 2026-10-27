import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {Book} from '../lib/accounting.mjs';
import {request as httpRequest} from 'node:http';

const accountingState=state=>{const {capabilities,...accounting}=state;assert.deepEqual(capabilities,{general_journal:true,company_alter:true,cash_purchases:true,current_period:true,company_backup:true,company_calendar_alteration:true,company_currency_labels:true,company_backup_v2:true,company_mobile_calling_code:true,company_backup_v3:true,company_geography_masters:true});return accounting;};
const root=resolve('.'),base='http://127.0.0.1:4384';
async function withServer(action){
 const tempRoot=await realpath(tmpdir()),directory=await mkdtemp(join(tempRoot,'bookr-companies-http-')),file=join(directory,'book.sqlite');let server,output='';
 const stop=async()=>{if(server && server.exitCode===null && server.signalCode===null){const ended=new Promise(done=>server.once('exit',done));server.kill();await ended;}};
 const start=async()=>{
  server=spawn(process.execPath,[join(root,'server.mjs')],{cwd:root,windowsHide:true,env:{...process.env,PORT:'4384',BOOKR_DB:file,BOOKR_TAILSCALE_IP:''},stdio:['ignore','pipe','pipe']});server.stdout.on('data',data=>output+=data);server.stderr.on('data',data=>output+=data);
  let started=false;for(let i=0;i<80;i++){if(server.exitCode!==null)throw new Error(output);try{if((await fetch(base+'/api/state')).ok){started=true;break;}}catch{}await new Promise(done=>setTimeout(done,100));}assert.equal(started,true,output);
 };
 try{
  try{await fetch(base+'/api/state');throw new Error('Company HTTP test port is occupied.');}catch(error){if(!error.message.includes('fetch failed'))throw error;}
  const book=new Book(file);let before;try{const customer=book.createCustomer({name:'Legacy HTTP Company Customer'}),sale=book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:100000});book.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1,amount:40000,allocations:[{bill_id:sale.bill.id,amount:40000}]});before=JSON.parse(JSON.stringify(book.state()));}finally{book.close();}
  await start();await action({before,request:async(path,options={})=>fetch(base+path,options),restart:async()=>{await stop();await start();}});
 }finally{
  await stop();
  const target=await realpath(directory),part=relative(tempRoot,target);assert.ok(part && !part.startsWith('..') && !isAbsolute(part));await rm(target,{recursive:true,force:true});
 }
}
test('global Company HTTP list preserves the existing default accounting book',async()=>{
 await withServer(async({before,request})=>{const response=await request('/api/companies');assert.equal(response.status,200,'Company registry API must exist before selecting isolated accounting books.');const body=await response.json();assert.equal(body.default_company_id,'default');assert.equal(body.companies.length,1);assert.equal(body.companies[0].id,'default');assert.deepEqual(accountingState(await(await request('/api/state')).json()),before);});
});

const metadata=name=>({name,mailing_name:name+' Mailing',address:'1 Fictional Company Road',state:'Fictional State',country:'India',pincode:'000101',financial_year_from:'2026-04-01',books_from:'2026-04-01',financial_year_to:'2027-03-31'});
async function json(request,path,{company,data,method='GET',status=200}={}){
 const headers={...(data===undefined?{}:{'Content-Type':'application/json'}),...(company===undefined?{}:{'X-Bookr-Company':company})};const response=await request(path,{method,headers,...(data===undefined?{}:{body:JSON.stringify(data)})}),body=await response.json();assert.equal(response.status,status,path+': '+JSON.stringify(body));return path==='/api/state'?accountingState(body):body;
}

test('Company HTTP header isolates every book route, colliding IDs, bank defaults and saved mutations across restart',async()=>{
 await withServer(async({before,request,restart})=>{
  const alpha=await json(request,'/api/companies',{method:'POST',data:metadata('HTTP Alpha Company Fictional'),status:201}),beta=await json(request,'/api/companies',{method:'POST',data:metadata('HTTP Beta Company Fictional'),status:201});assert.notEqual(alpha.id,beta.id);assert.notEqual(alpha.id,'default');assert.equal((await json(request,'/api/companies')).companies.length,3);assert.deepEqual(await json(request,'/api/companies/'+alpha.id),alpha);assert.equal(alpha.financial_year_from,'2026-04-01');assert.equal(alpha.books_from,'2026-04-01');
  const alphaEmpty=await json(request,'/api/state',{company:alpha.id}),betaEmpty=await json(request,'/api/state',{company:beta.id});assert.equal(alphaEmpty.company,alpha.name);assert.equal(betaEmpty.company,beta.name);assert.equal(alphaEmpty.vouchers.length,0);assert.equal(betaEmpty.vouchers.length,0);assert.equal(alphaEmpty.ledgers.some(l=>l.name==='Legacy HTTP Company Customer'),false);assert.deepEqual(await json(request,'/api/state'),before);
  const customerA=await json(request,'/api/customers',{company:alpha.id,method:'POST',data:{name:'Alpha Scoped Customer'},status:201}),customerB=await json(request,'/api/customers',{company:beta.id,method:'POST',data:{name:'Beta Scoped Customer'},status:201});assert.equal(customerA.id,customerB.id);
  const bankA=await json(request,'/api/banks',{company:alpha.id,method:'POST',data:{name:'Alpha Scoped Bank'},status:201}),bankB=await json(request,'/api/banks',{company:beta.id,method:'POST',data:{name:'Beta Scoped Bank'},status:201});assert.equal(bankA.bank.account_holder,alpha.name);assert.equal(bankB.bank.account_holder,beta.name);assert.equal(bankA.id,bankB.id);
  const saleA=await json(request,'/api/vouchers',{company:alpha.id,method:'POST',data:{type:'sale',date:'2026-04-01',customer_id:customerA.id,account_id:2,amount:125050},status:201});await json(request,'/api/vouchers',{company:alpha.id,method:'POST',data:{type:'receipt',date:'2026-04-01',customer_id:customerA.id,account_id:1,amount:40000,allocations:[{bill_id:saleA.bill.id,amount:40000}]},status:201});
  const saleB=await json(request,'/api/vouchers',{company:beta.id,method:'POST',data:{type:'sale',date:'2026-04-01',customer_id:1,account_id:2,amount:7500},status:201});assert.equal(saleA.id,saleB.id);assert.equal((await json(request,'/api/vouchers/'+saleA.id,{company:alpha.id})).amount,125050);assert.equal((await json(request,'/api/vouchers/'+saleB.id,{company:beta.id})).amount,7500);assert.equal((await json(request,'/api/vouchers/1')).amount,100000);
  for(const [company,id,name] of [[alpha.id,customerA.id,'Alpha Scoped Customer'],[beta.id,customerB.id,'Beta Scoped Customer'],['default',before.ledgers.find(l=>l.kind==='customer').id,'Legacy HTTP Company Customer']]){assert.equal((await json(request,'/api/customers/'+id,{company})).name,name);assert.equal((await json(request,'/api/ledgers/'+id,{company})).name,name);}
  for(const [company,closing,profit,pending,count] of [[alpha.id,40000,125050,85050,2],[beta.id,7500,7500,0,1],['default',40000,100000,60000,2]]){
   assert.equal((await json(request,'/api/statement?ledger=1',{company})).balance,closing);assert.equal((await json(request,'/api/financial-reports',{company})).profitAndLoss.netProfit,profit);assert.equal((await json(request,'/api/outstanding?direction=receivable',{company})).totals.pending,pending);assert.equal((await json(request,'/api/day-book',{company})).rows.length,count);assert.equal((await json(request,'/api/trial-balance',{company})).totals.balanced,true);assert.equal((await json(request,'/api/monthly-summary?ledger=1',{company})).rows[0].debit,closing);
  }
  assert.equal((await json(request,'/api/receipt-bills?customer='+customerA.id,{company:alpha.id})).bills[0].pending,85050);assert.equal((await json(request,'/api/receipt-bills?customer='+customerB.id,{company:beta.id})).bills.length,0);assert.equal((await json(request,'/api/banks/'+bankA.id,{company:alpha.id})).name,bankA.name);assert.equal((await json(request,'/api/banks/'+bankB.id,{company:beta.id})).name,bankB.name);
  const supplierB=await json(request,'/api/suppliers',{company:beta.id,method:'POST',data:{name:'Beta Scoped Supplier'},status:201});assert.equal((await json(request,'/api/suppliers/'+supplierB.id,{company:beta.id})).name,supplierB.name);assert.equal((await json(request,'/api/payment-bills?supplier='+supplierB.id,{company:beta.id})).bills.length,0);
  await json(request,'/api/vouchers/'+saleB.id,{company:beta.id,method:'PUT',data:{...saleB,amount:10000}});await json(request,'/api/ledgers/'+customerB.id,{company:beta.id,method:'PUT',data:{...customerB,name:'Beta Changed Scoped Customer'}});assert.equal((await json(request,'/api/vouchers/'+saleA.id,{company:alpha.id})).amount,125050);assert.equal((await json(request,'/api/customers/'+customerA.id,{company:alpha.id})).name,customerA.name);assert.deepEqual(await json(request,'/api/state'),before);
  const states=await Promise.all([json(request,'/api/state',{company:alpha.id}),json(request,'/api/state',{company:beta.id}),json(request,'/api/state')]);await restart();assert.deepEqual(await json(request,'/api/state',{company:alpha.id}),states[0]);assert.deepEqual(await json(request,'/api/state',{company:beta.id}),states[1]);assert.deepEqual(await json(request,'/api/state'),states[2]);assert.equal((await json(request,'/api/companies')).companies.length,3);
 });
});

test('invalid or unknown Company headers never fall back to the default book, while global recovery endpoints remain available',async()=>{
 await withServer(async({before,request})=>{
  const alpha=await json(request,'/api/companies',{method:'POST',data:metadata('Header Guard Alpha Company'),status:201}),alphaBefore=await json(request,'/api/state',{company:alpha.id});
  for(const id of ['', '../default','missing-company-id','__proto__','default, '+alpha.id]){
   for(const [path,options] of [['/api/state',{}],['/api/vouchers/1',{}],['/api/customers',{method:'POST',body:JSON.stringify({name:'Must Not Leak Into Default'})}]]){const response=await request(path,{...options,headers:{'X-Bookr-Company':id,'Content-Type':'application/json'}});assert.ok([400,404].includes(response.status),'Unknown/invalid company header must reject: '+JSON.stringify({id,path,status:response.status}));}
   const global=await json(request,'/api/companies',{company:id});assert.equal(global.companies.length,2);
  }
  assert.deepEqual(await json(request,'/api/state'),before);assert.deepEqual(await json(request,'/api/state',{company:'default'}),before);assert.deepEqual(await json(request,'/api/state',{company:alpha.id}),alphaBefore);
  const absent=await request('/api/companies/not-a-profile');assert.ok([400,404].includes(absent.status));
 });
});

test('Company creation validates calendar dates and name without adding a profile or mutating the original book',async()=>{
 await withServer(async({before,request})=>{
  const list=await json(request,'/api/companies');for(const patch of [{name:''},{financial_year_from:'2025-04-01'},{books_from:'2027-04-01'},{financial_year_to:'2028-03-31'}]){const response=await request('/api/companies',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...metadata('Invalid Company Must Not Persist'),...patch})});assert.equal(response.status,400);assert.deepEqual(await json(request,'/api/companies'),list);assert.deepEqual(await json(request,'/api/state'),before);}
 });
});

test('an interleaved slow Company A request body cannot be rebound to Company B by another request',async()=>{
 await withServer(async({before,request})=>{
  const alpha=await json(request,'/api/companies',{method:'POST',data:metadata('Slow Request Alpha Company'),status:201}),beta=await json(request,'/api/companies',{method:'POST',data:metadata('Fast Request Beta Company'),status:201});let slow;
  const pending=new Promise((resolve,reject)=>{slow=httpRequest(base+'/api/customers',{method:'POST',headers:{'Content-Type':'application/json','X-Bookr-Company':alpha.id}},response=>{let text='';response.on('data',bytes=>text+=bytes);response.on('end',()=>{try{resolve({status:response.statusCode,body:JSON.parse(text)});}catch(error){reject(error);}});});slow.on('error',reject);slow.write('{"name":');});
  try{
   await json(request,'/api/customers',{company:beta.id,method:'POST',data:{name:'Completed Beta During Alpha Body'},status:201});slow.end('"Delayed Alpha Customer"}');const result=await pending;assert.equal(result.status,201);assert.equal(result.body.name,'Delayed Alpha Customer');
   const a=await json(request,'/api/state',{company:alpha.id}),b=await json(request,'/api/state',{company:beta.id});assert.equal(a.ledgers.some(l=>l.name==='Delayed Alpha Customer'),true);assert.equal(a.ledgers.some(l=>l.name==='Completed Beta During Alpha Body'),false);assert.equal(b.ledgers.some(l=>l.name==='Completed Beta During Alpha Body'),true);assert.equal(b.ledgers.some(l=>l.name==='Delayed Alpha Customer'),false);assert.deepEqual(await json(request,'/api/state'),before);
  }finally{slow?.destroy();await pending.catch(()=>{});}
 });
});

test('new Company book dates reject out-of-period Sales and Journals while legacy default dates remain supported',async()=>{
 await withServer(async({request})=>{
  const company=await json(request,'/api/companies',{method:'POST',data:metadata('Bounded Date Company Fictional'),status:201}),companyId=company.id;
  const supplier=await json(request,'/api/suppliers',{company:companyId,method:'POST',data:{name:'Date Bound Supplier'},status:201}),expense=await json(request,'/api/ledgers',{company:companyId,method:'POST',data:{kind:'expense',name:'Date Bound Expense'},status:201}),stable=await json(request,'/api/state',{company:companyId});
  for(const date of ['2026-03-31','2027-04-01'])for(const voucher of [{type:'sale',date,customer_id:1,account_id:2,amount:1000},{type:'journal',date,debit_ledger_id:expense.id,credit_ledger_id:supplier.id,debit_amount:1000,credit_amount:1000}]){await json(request,'/api/vouchers',{company:companyId,method:'POST',data:voucher,status:400});assert.deepEqual(await json(request,'/api/state',{company:companyId}),stable);}
  for(const date of ['2026-04-01','2027-03-31'])await json(request,'/api/vouchers',{company:companyId,method:'POST',data:{type:'sale',date,customer_id:1,account_id:2,amount:1000},status:201});assert.equal((await json(request,'/api/state',{company:companyId})).vouchers.length,2);
  const legacy=await json(request,'/api/vouchers',{method:'POST',data:{type:'sale',date:'2026-03-31',customer_id:1,account_id:2,amount:1000},status:201});assert.equal(legacy.date,'2026-03-31');
 });
});
