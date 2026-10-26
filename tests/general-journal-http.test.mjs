import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,relative,isAbsolute} from 'node:path';

const root=resolve('.'),port='4392',base='http://127.0.0.1:'+port;
const clean=entries=>entries.map(({ledger_id,side,amount})=>({ledger_id,side,amount}));

test('HTTP accepts100 canonical General Journal lines and isolates colliding voucher/ledger IDs across company saves and restart',async()=>{
 const tempRoot=await realpath(tmpdir()),directory=await mkdtemp(join(tempRoot,'bookr-general-http-')),file=join(directory,'book.sqlite');let server,output='';
 const stop=async()=>{if(server && server.exitCode===null && server.signalCode===null){const ended=new Promise(done=>server.once('exit',done));server.kill();await ended;}};
 const start=async()=>{server=spawn(process.execPath,[join(root,'server.mjs')],{cwd:root,windowsHide:true,env:{...process.env,PORT:port,BOOKR_DB:file,BOOKR_TAILSCALE_IP:''},stdio:['ignore','pipe','pipe']});server.stdout.on('data',data=>output+=data);server.stderr.on('data',data=>output+=data);let ready=false;for(let i=0;i<80;i++){if(server.exitCode!==null)throw new Error(output);try{if((await fetch(base+'/api/state')).ok){ready=true;break;}}catch{}await new Promise(done=>setTimeout(done,100));}assert.equal(ready,true,output);};
 const json=async(path,{company,method='GET',data,status=200}={})=>{const response=await fetch(base+path,{method,headers:{...(company===undefined?{}:{'X-Bookr-Company':company}),...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})}),body=await response.json();assert.equal(response.status,status,path+': '+JSON.stringify(body));return body;};
 try{
  try{await fetch(base+'/api/state');throw new Error('General HTTP test port is occupied.');}catch(error){if(!error.message.includes('fetch failed'))throw error;}
  await start();const defaultBefore=await json('/api/state'),alpha=await json('/api/companies',{method:'POST',data:{name:'General HTTP Fictional Alpha'},status:201}),beta=await json('/api/companies',{method:'POST',data:{name:'General HTTP Fictional Beta'},status:201}),a=[],b=[];
  for(let i=0;i<100;i++)for(const [company,list,label] of [[alpha.id,a,'Alpha'],[beta.id,b,'Beta']])list.push(await json('/api/ledgers',{company,method:'POST',data:{kind:i<50?'expense':'capital',name:label+' General '+String(i).padStart(3,'0')},status:201}));
  assert.deepEqual(a.map(row=>row.id),b.map(row=>row.id));const entries=a.map((ledger,i)=>({ledger_id:ledger.id,side:i<50?'debit':'credit',amount:1000000000})),payload={type:'journal',date:'2026-04-01',entries,narration:'Canonical100-line HTTP payload '+'.'.repeat(900)};
  assert.equal(payload.entries.length,100);assert.ok(Buffer.byteLength(JSON.stringify(payload))<16384);const saved=await json('/api/vouchers',{company:alpha.id,method:'POST',data:payload,status:201});assert.equal(saved.amount,50000000000);assert.deepEqual(clean(saved.entries),entries);assert.equal(saved.bill,null);
  const other=await json('/api/vouchers',{company:beta.id,method:'POST',data:{type:'journal',date:'2026-04-01',entries:[{ledger_id:b[99].id,side:'credit',amount:2500},{ledger_id:b[0].id,side:'debit',amount:2500}],narration:'Beta isolated small Journal'},status:201});assert.equal(other.id,saved.id);assert.equal(other.number,saved.number);
  const betaBefore=await json('/api/state',{company:beta.id});assert.equal((await json('/api/vouchers/'+saved.id,{company:alpha.id})).amount,50000000000);assert.equal((await json('/api/vouchers/'+saved.id,{company:beta.id})).amount,2500);
  const replacement=[...entries].reverse();const edited=await json('/api/vouchers/'+saved.id,{company:alpha.id,method:'PUT',data:{...payload,entries:replacement,revision:saved.revision,narration:'Alpha100 rows reordered'}});assert.equal(edited.revision,2);assert.deepEqual(clean(edited.entries),replacement);assert.deepEqual(await json('/api/state',{company:beta.id}),betaBefore);assert.deepEqual(await json('/api/state'),defaultBefore);
  const alphaState=await json('/api/state',{company:alpha.id});assert.equal(alphaState.vouchers[0].entries.length,100);assert.equal((await json('/api/statement?ledger='+a[0].id,{company:alpha.id})).balance,1000000000);assert.equal((await json('/api/statement?ledger='+b[0].id,{company:beta.id})).balance,2500);assert.equal((await json('/api/day-book',{company:alpha.id})).rows[0].particulars,'Multiple Accounts');assert.equal((await json('/api/trial-balance',{company:alpha.id})).totals.balanced,true);assert.equal((await json('/api/outstanding',{company:alpha.id})).totals.pending,0);
  await stop();await start();assert.deepEqual(await json('/api/state',{company:alpha.id}),alphaState);assert.deepEqual(await json('/api/state',{company:beta.id}),betaBefore);assert.deepEqual(await json('/api/state'),defaultBefore);assert.deepEqual(clean((await json('/api/vouchers/'+saved.id,{company:alpha.id})).entries),replacement);
 }finally{await stop();const target=await realpath(directory),part=relative(tempRoot,target);assert.ok(part && !part.startsWith('..') && !isAbsolute(part));await rm(target,{recursive:true,force:true});}
});
