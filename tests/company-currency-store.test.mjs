import test from 'node:test';
import assert from 'node:assert/strict';
import {CompanyStore} from '../lib/companies.mjs';
import {GBP,INR,withCurrencyStore,currencySnapshot,changeStoredCurrency} from './company-currency-fixture.mjs';
const labels=profile=>({currency_symbol:profile.currency_symbol,currency_name:profile.currency_name});

test('Company profiles/list/summary/state supply legacy default labels without rewriting the catalog',()=>withCurrencyStore(f=>{
 changeStoredCurrency(f,details=>{delete details.currency_symbol;delete details.currency_name;});const before=currencySnapshot(f);assert.deepEqual(labels(f.store.profile(f.target.id)),INR);assert.deepEqual(labels(f.store.list().find(row=>row.id===f.target.id)),INR);assert.deepEqual(labels(f.store.summary(f.target.id).profile),INR);assert.deepEqual(labels(f.store.book(f.target.id).state()),INR);assert.deepEqual(currencySnapshot(f),before);
}));
test('Explicit empty-company labels save canonically and preserve all accounting rows/dates/country',()=>withCurrencyStore(f=>{
 const before=currencySnapshot(f),saved=f.store.update(f.target.id,{revision:1,currency_symbol:' £ ',currency_name:' GBP '});assert.deepEqual(labels(saved),GBP);assert.equal(saved.revision,2);assert.equal(saved.country,'United Kingdom');assert.equal(saved.books_from,'2025-05-01');assert.deepEqual(currencySnapshot(f).books,before.books);assert.equal(f.store.book().outstandingReport().totals.pending,60000);
}));
test('Warm/cold cached books, second store and reopen use the target labels without global state',()=>withCurrencyStore(f=>{
 const second=new CompanyStore({defaultFile:f.database});try{second.book(f.target.id);f.store.book(f.target.id);f.store.update(f.target.id,{revision:1,...GBP});assert.deepEqual(labels(second.book(f.target.id).state()),GBP);assert.deepEqual(labels(f.store.book(f.other.id).state()),INR);assert.deepEqual(labels(f.store.book().state()),INR);}finally{second.close();}
 const reopened=new CompanyStore({defaultFile:f.database});try{assert.deepEqual(labels(reopened.profile(f.target.id)),GBP);assert.deepEqual(labels(reopened.book(f.target.id).state()),GBP);}finally{reopened.close();}
}));
test('A posted company rejects changed labels atomically but accepts ordinary edits with unchanged normalized labels',()=>withCurrencyStore(f=>{
 const before=currencySnapshot(f),profile=f.store.profile();assert.throws(()=>f.store.update('default',{revision:profile.revision,...GBP}),error=>error.status===400&&/empty|financial/i.test(error.message));assert.deepEqual(currencySnapshot(f),before);
 const saved=f.store.update('default',{revision:profile.revision,name:'Fictional Currency Posted Renamed',currency_symbol:' ₹ ',currency_name:' INR '});assert.deepEqual(labels(saved),INR);assert.deepEqual(currencySnapshot(f).books,before.books);assert.equal(f.store.book().outstandingReport().totals.pending,60000);
}));
test('Nonzero openings with zero vouchers do not qualify as empty financial books',()=>withCurrencyStore(f=>{
 const book=f.store.book(f.target.id);book.saveLedger({...book.masterLedger(1),opening_balance:10000},1);book.saveLedger({kind:'capital',name:'Fictional Currency Opening Capital',opening_balance:-10000});const before=currencySnapshot(f);assert.equal(book.state().vouchers.length,0);assert.throws(()=>f.store.update(f.target.id,{revision:1,...GBP}),error=>error.status===400&&/empty|financial/i.test(error.message));assert.deepEqual(currencySnapshot(f),before);
}));
test('Stale or invalid currency writes preserve catalog revision, settings and every accounting row',()=>withCurrencyStore(f=>{
 const saved=f.store.update(f.target.id,{revision:1,...GBP}),before=currencySnapshot(f);for(const patch of [{revision:1,currency_symbol:'$'},{revision:saved.revision,currency_name:''},{revision:saved.revision,currency_symbol:3},{revision:saved.revision,decimal_places:3}]){assert.throws(()=>f.store.update(f.target.id,patch));assert.deepEqual(currencySnapshot(f),before);}assert.equal(f.store.catalog.isTransaction,false);
}));
test('Unrelated edits preserve configured labels and country never resets symbol/name/dates',()=>withCurrencyStore(f=>{
 const saved=f.store.update(f.target.id,{revision:1,...GBP}),next=f.store.update(f.target.id,{revision:saved.revision,country:'India',state:'Not Applicable',email:'fictional@example.invalid'});assert.deepEqual(labels(next),GBP);assert.equal(next.financial_year_from,f.target.financial_year_from);assert.equal(next.books_from,f.target.books_from);
}));
test('Partial stored label settings fail closed and nondefault denominations reject before posting',()=>withCurrencyStore(f=>{
 f.store.update(f.target.id,{revision:1,...GBP});const book=f.store.book(f.target.id),bank=book.saveBank({name:'Fictional Currency Bank'}),before=currencySnapshot(f);assert.throws(()=>book.saveVoucher({type:'contra',date:'2025-05-01',source_id:1,destination_id:bank.id,amount:100,details:{bank:{account_id:bank.id,transaction_type:'Cash',amount:100,instrument_number:'',instrument_date:'2025-05-01',bank_name:'Not Applicable',cheque_range:'',denominations:{counts:{'1':1},others:0}}}}),error=>error.status===400&&/denomination|default.*currency/i.test(error.message));assert.deepEqual(currencySnapshot(f),before);
 changeStoredCurrency(f,details=>{delete details.currency_name;});const corrupt=currencySnapshot(f);assert.throws(()=>f.store.profile(f.target.id));assert.throws(()=>f.store.update(f.target.id,{revision:2,address:'Must not repair'}));assert.deepEqual(currencySnapshot(f),corrupt);
}));
