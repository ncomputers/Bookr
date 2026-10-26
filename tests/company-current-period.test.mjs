import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,relative,isAbsolute} from 'node:path';
import {createWorkingDateContext,createEntryDateState} from '../public/working-date.js';
import {CompanyStore} from '../lib/companies.mjs';
const calendar=Object.freeze({financial_year_from:'2025-04-01',books_from:'2025-07-01',financial_year_to:'2026-03-31'}),initial=Object.freeze({from:calendar.financial_year_from,to:calendar.financial_year_to}),later=Object.freeze({from:'2026-04-01',to:'2027-03-31'});
function storage(){const values=new Map(),writes=[];return {values,writes,getItem:key=>values.get(key)??null,setItem(key,value){values.set(key,value);writes.push({key,value});}};}
function context(backing=storage()){const state=createWorkingDateContext({companyId:'a'.repeat(32),booksFrom:calendar.books_from,period:initial,storage:backing});assert.equal(typeof state.period,'function','Expose the selected current period separately from master dates.');assert.equal(typeof state.acceptPeriod,'function','Implement atomic current-period acceptance.');return state;}

test('Current period defaults from the supplied initial window without changing master dates or storage',()=>{
 const backing=storage(),state=context(backing);assert.deepEqual(state.period(),initial);const copy=state.period();copy.from='2000-01-01';assert.deepEqual(state.period(),initial);assert.deepEqual(state.current(),{date:calendar.books_from,revision:0});assert.equal(backing.writes.length,0);
});
test('Moving to a later period clamps a too-early working date to From; restoring the earlier period clamps to To',()=>{
 const state=context();state.accept('2025-08-15');state.acceptPeriod(later);assert.deepEqual(state.period(),later);assert.deepEqual(state.current(),{date:'2026-04-01',revision:2});state.acceptPeriod(initial);assert.deepEqual(state.current(),{date:'2026-03-31',revision:3});assert.equal(calendar.books_from,'2025-07-01');
});
test('An overlapping period preserves an in-range working date and resets the next-new-voucher context revision',()=>{
 const state=context(),entry=createEntryDateState(()=>state.current());state.accept('2025-08-15');assert.equal(entry.forRender(),'2025-08-15');entry.rememberNew('2025-08-20');state.acceptPeriod({from:'2025-07-01',to:'2025-09-30'});assert.equal(state.current().date,'2025-08-15');assert.equal(entry.forRender(),'2025-08-15');
});
test('A tab retains selected period and working date together across reopening, independently of another tab',()=>{
 const backing=storage(),state=context(backing);state.acceptPeriod(later);state.accept('2026-08-15');const reopened=context(backing);assert.deepEqual(reopened.period(),later);assert.deepEqual(reopened.current(),state.current());assert.deepEqual(context(storage()).period(),initial);assert.equal(backing.values.size,1);
});
test('Invalid period changes reject atomically, including missing, reversed and impossible dates',()=>{
 const backing=storage(),state=context(backing);state.accept('2025-08-15');const before=[...backing.values],count=backing.writes.length;
 for(const period of [null,{},[],{from:'2025-08-15'},{from:'2025-08-15',to:'2025-08-14'},{from:'2025-02-30',to:'2025-08-15'},{from:'2025-04-01',to:'2026-03-31',extra:true}]){assert.throws(()=>state.acceptPeriod(period));assert.deepEqual(state.period(),initial);assert.deepEqual(state.current(),{date:'2025-08-15',revision:1});assert.deepEqual([...backing.values],before);assert.equal(backing.writes.length,count);}
});
test('A failed storage write preserves both old period and working date',()=>{
 const backing=storage(),state=context(backing);state.accept('2025-08-15');const before=[...backing.values];backing.setItem=()=>{throw new Error('Fictional quota failure');};assert.throws(()=>state.acceptPeriod(later),/Fictional quota/);assert.deepEqual(state.period(),initial);assert.deepEqual(state.current(),{date:'2025-08-15',revision:1});assert.deepEqual([...backing.values],before);
});
test('Working-date bounds follow the selected current period while allowing before-Books dates in the initial period',()=>{
 const state=context();state.accept('2025-06-30');state.acceptPeriod(later);assert.throws(()=>state.accept('2025-08-15'));assert.equal(state.accept('2026-04-01').date,'2026-04-01');assert.equal(state.accept('2027-03-31').date,'2027-03-31');
});
function fixture(action){const temporary=realpathSync(tmpdir()),directory=mkdtempSync(join(temporary,'bookr-period-proposal-'));let store;try{store=new CompanyStore({defaultFile:join(directory,'book.sqlite')});const profile=store.create({name:'Fictional Later Period Posting',...calendar});action({book:store.book(profile.id),store,profile});}finally{store?.close();const target=realpathSync(directory),part=relative(temporary,target);assert.ok(part&&!part.startsWith('..')&&!isAbsolute(part));rmSync(target,{recursive:true,force:true});}}
const rows=db=>Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'" ORDER BY rowid').all().map(row=>({...row}))]));
test('Observed later-year Cash Receipt against Capital saves with request-local period, unchanged master dates and balanced postings',()=>fixture(({book,store,profile})=>{
 const capital=book.saveLedger({kind:'capital',name:'Later Year Capital Fictional'}),metadata=store.profile(profile.id),catalog=rows(store.catalog),defaultBefore=store.book().state(),cachedPeriod={...book.companyPeriod};
 const saved=book.saveVoucher({type:'receipt',date:later.from,ledger_id:capital.id,account_id:1,amount:100},null,{currentPeriod:later});assert.equal(saved.type,'receipt');assert.equal(saved.date,later.from);assert.equal(saved.postings.length,2);assert.deepEqual(book.trialBalance(later).totals,{debit:100,credit:100,balanced:true});assert.deepEqual(store.profile(profile.id),metadata);assert.deepEqual(rows(store.catalog),catalog);assert.deepEqual(store.book().state(),defaultBefore);assert.deepEqual(book.companyPeriod,cachedPeriod);assert.deepEqual(book.calendar,calendar);assert.equal(book.state().vouchers.length,1);
}));
test('One cached book can use two independent request periods without leaking context or dropping the Books lower bound',()=>fixture(({book})=>{
 const capital=book.saveLedger({kind:'capital',name:'Period Isolation Capital'}),input=date=>({type:'receipt',date,ledger_id:capital.id,account_id:1,amount:100});book.saveVoucher(input(later.from),null,{currentPeriod:later});const before=rows(book.db);
 assert.throws(()=>book.saveVoucher(input(later.from),null,{currentPeriod:initial}));assert.throws(()=>book.saveVoucher(input('2025-06-30'),null,{currentPeriod:initial}));assert.deepEqual(rows(book.db),before);book.saveVoucher(input('2025-07-01'),null,{currentPeriod:initial});assert.deepEqual(book.trialBalance().totals,{debit:200,credit:200,balanced:true});assert.equal(book.state().vouchers.length,2);
}));
