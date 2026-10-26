import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,realpathSync} from 'node:fs';
import {join,relative,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {CompanyStore} from '../lib/companies.mjs';
const pending=await import('../public/working-date.js').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const calendar=Object.freeze({financial_year_from:'2025-04-01',books_from:'2025-07-01',financial_year_to:'2026-03-31'}),period=Object.freeze({from:calendar.financial_year_from,to:calendar.financial_year_to}),companyA='a'.repeat(32),companyB='b'.repeat(32);
function implementation(){assert.equal(typeof pending.createWorkingDateContext,'function','Implement the shared createWorkingDateContext contract before enabling Gateway F2.');assert.equal(typeof pending.createEntryDateState,'function','Implement the shared new-entry date state contract.');return pending;}
function storage(){const values=new Map(),writes=[];return {values,writes,getItem(key){return values.get(key)??null;},setItem(key,value){values.set(key,String(value));writes.push({key,value:String(value)});}};}
const options=(backing,id=companyA)=>({companyId:id,booksFrom:calendar.books_from,storage:backing});
const rows=db=>Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'" ORDER BY rowid').all().map(row=>({...row}))]));

test('Working date defaults from Books independently of immutable master calendar and does not write on read',()=>{
 const {createWorkingDateContext}=implementation(),backing=storage(),before=JSON.stringify(calendar),context=createWorkingDateContext(options(backing));assert.deepEqual(context.current(),{date:'2025-07-01',revision:0});assert.deepEqual(context.current(),{date:'2025-07-01',revision:0});assert.equal(backing.writes.length,0);assert.equal(JSON.stringify(calendar),before);
});

test('Accepting Gateway date is scoped to the tab/company, survives context reopening and advances revision even for the same date',()=>{
 const {createWorkingDateContext}=implementation(),backing=storage(),context=createWorkingDateContext(options(backing));assert.deepEqual(context.accept('2025-08-15'),{date:'2025-08-15',revision:1});assert.deepEqual(context.accept('2025-08-15'),{date:'2025-08-15',revision:2});assert.deepEqual(createWorkingDateContext(options(backing)).current(),{date:'2025-08-15',revision:2});assert.equal(backing.values.size,1);assert.equal(backing.writes.length,2);const key=[...backing.values.keys()][0];assert.ok(key.includes(companyA),'A stored working context must include the selected company ID.');
});

test('Invalid dates reject atomically and a working date before Books remains independently selectable',()=>{
 const {createWorkingDateContext}=implementation(),backing=storage(),context=createWorkingDateContext(options(backing));context.accept('2025-08-15');const saved=[...backing.values],writeCount=backing.writes.length;
 for(const value of [null,undefined,20250815,'','15-Aug-2025','2025-02-29','2025-08-32']){assert.throws(()=>context.accept(value));assert.deepEqual(context.current(),{date:'2025-08-15',revision:1});assert.deepEqual([...backing.values],saved);assert.equal(backing.writes.length,writeCount);}
 assert.equal(context.accept('2025-06-30').date,'2025-06-30','Native Gateway date can precede Books beginning. Upper/lower financial-year bounds remain unasserted pending observation.');
});

test('Two company contexts and two tab storage areas cannot change one another',()=>{
 const {createWorkingDateContext}=implementation(),firstTab=storage(),secondTab=storage(),a=createWorkingDateContext(options(firstTab,companyA)),b=createWorkingDateContext(options(firstTab,companyB)),otherTab=createWorkingDateContext(options(secondTab,companyA));a.accept('2025-08-15');b.accept('2025-09-20');assert.deepEqual(a.current(),{date:'2025-08-15',revision:1});assert.deepEqual(b.current(),{date:'2025-09-20',revision:1});assert.deepEqual(otherTab.current(),{date:'2025-07-01',revision:0});otherTab.accept('2025-10-01');assert.deepEqual(a.current(),{date:'2025-08-15',revision:1});assert.equal(firstTab.values.size,2);assert.equal(secondTab.values.size,1);
});

test('Malformed stored contexts fall back without rewriting storage or company metadata',()=>{
 const {createWorkingDateContext}=implementation(),backing=storage(),context=createWorkingDateContext(options(backing));context.accept('2025-08-15');const key=[...backing.values.keys()][0],valid=JSON.parse(backing.values.get(key));
 for(const raw of ['not-json',JSON.stringify({...valid,date:'2025-02-29'}),JSON.stringify({...valid,date:'2026-04-31'}),JSON.stringify({...valid,revision:-1}),JSON.stringify({...valid,revision:0.5}),JSON.stringify({...valid,revision:'1'})]){backing.values.set(key,raw);const count=backing.writes.length;assert.deepEqual(createWorkingDateContext(options(backing)).current(),{date:'2025-07-01',revision:0});assert.equal(backing.writes.length,count);assert.equal(backing.values.get(key),raw);}
});

test('A failed session-storage write leaves the previous accepted working context intact',()=>{
 const {createWorkingDateContext}=implementation(),backing=storage(),context=createWorkingDateContext(options(backing));context.accept('2025-08-15');const saved=[...backing.values];backing.setItem=()=>{throw new Error('Fictional storage quota failure');};assert.throws(()=>context.accept('2025-09-20'),/Fictional storage quota failure/);assert.deepEqual(context.current(),{date:'2025-08-15',revision:1});assert.deepEqual([...backing.values],saved);
});

test('A new-entry cache preserves its remembered next date until explicit context acceptance, including a repeated accepted date',()=>{
 const {createWorkingDateContext,createEntryDateState}=implementation(),context=createWorkingDateContext(options(storage())),entry=createEntryDateState(()=>context.current());assert.equal(entry.forRender(),'2025-07-01');entry.rememberNew('2025-07-12');assert.equal(entry.forRender(),'2025-07-12');context.accept('2025-08-15');assert.equal(entry.forRender(),'2025-08-15');entry.rememberNew('2025-08-20');assert.equal(entry.forRender(),'2025-08-20');context.accept('2025-08-15');assert.equal(entry.forRender(),'2025-08-15');
});

test('Saved voucher rendering never consumes a pending context revision or overwrites the separate new-entry date',()=>{
 const {createWorkingDateContext,createEntryDateState}=implementation(),context=createWorkingDateContext(options(storage())),entry=createEntryDateState(()=>context.current());assert.equal(entry.forRender(),'2025-07-01');entry.rememberNew('2025-07-12');context.accept('2025-08-15');assert.equal(entry.forRender({savedDate:'2025-07-01'}),'2025-07-01');assert.equal(entry.forRender(),'2025-08-15');assert.equal(entry.forRender({savedDate:'2025-07-02'}),'2025-07-02');assert.equal(entry.forRender(),'2025-08-15');
});

test('Working context reads, acceptance and saved/new render selection cannot mutate API snapshots or balanced accounting rows',()=>{
 const {createWorkingDateContext,createEntryDateState}=implementation(),temporaryRoot=realpathSync(tmpdir()),directory=mkdtempSync(join(temporaryRoot,'bookr-working-date-contract-'));let store;
 try{store=new CompanyStore({defaultFile:join(directory,'book.sqlite')});const profile=store.create({name:'Fictional Working Date Guard',...calendar}),book=store.book(profile.id),customer=book.createCustomer({name:'Fictional Working Date Buyer'}),sale=book.saveVoucher({type:'sale',date:calendar.books_from,customer_id:customer.id,account_id:2,amount:100000});book.saveVoucher({type:'receipt',date:calendar.books_from,customer_id:customer.id,account_id:1,amount:40000,allocations:[{bill_id:sale.bill.id,amount:40000}]});const beforeState=book.state(),beforeProfile=store.profile(profile.id),beforeMoney=rows(book.db),beforeCatalog=rows(store.catalog),backing=storage(),context=createWorkingDateContext({...options(backing,profile.id),booksFrom:beforeState.calendar.books_from}),entry=createEntryDateState(()=>context.current());entry.forRender();context.accept('2025-08-15');assert.equal(entry.forRender({savedDate:sale.date}),sale.date);assert.equal(entry.forRender(),'2025-08-15');assert.deepEqual(book.state(),beforeState);assert.deepEqual(store.profile(profile.id),beforeProfile);assert.deepEqual(rows(book.db),beforeMoney);assert.deepEqual(rows(store.catalog),beforeCatalog);assert.equal(book.outstandingReport().totals.pending,60000);assert.equal(book.state().totals.balanced,true);assert.equal(book.state().opening_balances.date,calendar.books_from);
 }finally{store?.close();const target=realpathSync(directory),part=relative(temporaryRoot,target);assert.ok(part&&!part.startsWith('..')&&!isAbsolute(part));rmSync(target,{recursive:true,force:true});}
});

test('Selected current-period bounds reject the observed outside dates atomically while June30 before Books is accepted',()=>{
 const {createWorkingDateContext}=implementation(),backing=storage(),context=createWorkingDateContext({...options(backing),period});context.accept('2025-08-15');const saved=[...backing.values],count=backing.writes.length;
 for(const date of ['2025-03-31','2026-04-01']){assert.throws(()=>context.accept(date),/current period/i);assert.deepEqual(context.current(),{date:'2025-08-15',revision:1});assert.deepEqual([...backing.values],saved);assert.equal(backing.writes.length,count);}
 assert.deepEqual(context.accept('2025-06-30'),{date:'2025-06-30',revision:2});assert.equal(calendar.books_from,'2025-07-01');
});

test('An out-of-current-period stored context falls back without rewriting it and an invalid selected period cannot initialize',()=>{
 const {createWorkingDateContext}=implementation(),backing=storage(),unbounded=createWorkingDateContext(options(backing));unbounded.accept('2026-04-01');const stored=[...backing.values],count=backing.writes.length,bounded=createWorkingDateContext({...options(backing),period});assert.deepEqual(bounded.current(),{date:'2025-07-01',revision:0});assert.deepEqual([...backing.values],stored);assert.equal(backing.writes.length,count);
 for(const invalid of [{from:'2025-04-31',to:'2026-03-31'},{from:'2026-04-01',to:'2025-04-01'}])assert.throws(()=>createWorkingDateContext({...options(backing),period:invalid}));assert.throws(()=>createWorkingDateContext({...options(backing),booksFrom:'2026-04-01',period}));assert.deepEqual([...backing.values],stored);assert.equal(backing.writes.length,count);
});

test('Returned context snapshots cannot mutate saved state and a saturated revision rejects without loss',()=>{
 const {createWorkingDateContext}=implementation(),backing=storage(),context=createWorkingDateContext(options(backing));context.accept('2025-08-15');const returned=context.current();returned.date='2025-09-20';returned.revision=77;assert.deepEqual(context.current(),{date:'2025-08-15',revision:1});const key=[...backing.values.keys()][0],stored=JSON.parse(backing.values.get(key));backing.values.set(key,JSON.stringify({...stored,revision:Number.MAX_SAFE_INTEGER}));const saturated=createWorkingDateContext(options(backing)),before=[...backing.values],count=backing.writes.length;assert.throws(()=>saturated.accept('2025-09-20'));assert.deepEqual(saturated.current(),{date:'2025-08-15',revision:Number.MAX_SAFE_INTEGER});assert.deepEqual([...backing.values],before);assert.equal(backing.writes.length,count);
});

test('The next-date proposal advances one real UTC calendar day across leap/month/year boundaries',()=>{
 implementation();assert.equal(typeof pending.followingWorkingDate,'function');for(const [date,next]of [['2025-07-01','2025-07-02'],['2024-02-28','2024-02-29'],['2024-02-29','2024-03-01'],['2025-02-28','2025-03-01'],['2025-12-31','2026-01-01'],['0075-12-31','0076-01-01']])assert.equal(pending.followingWorkingDate(date),next);
});

test('An invalid or overflowing next-date proposal rejects instead of normalizing bad input',()=>{
 implementation();assert.equal(typeof pending.followingWorkingDate,'function');for(const date of [null,'','2025-02-29','2025-04-31','1-Jul-2025','9999-12-31'])assert.throws(()=>pending.followingWorkingDate(date));
});
