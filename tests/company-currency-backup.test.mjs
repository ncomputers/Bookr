import test from 'node:test';
import assert from 'node:assert/strict';
import {exportCompanyBundle,restoreCompanyBundle} from '../lib/company-backup.mjs';
import {GBP,INR,withCurrencyStore,currencySnapshot,legacyV1,corruptBundle} from './company-currency-fixture.mjs';
const labels=value=>({currency_symbol:value.currency_symbol,currency_name:value.currency_name});
function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}

test('Version3 exporter includes canonical labels and exact existing accounting tables',()=>withCurrencyStore(f=>{
 const before=currencySnapshot(f),bundle=exportCompanyBundle(f.store,'default');assert.equal(bundle.version,3);assert.deepEqual(labels(bundle.company),INR);assert.deepEqual(currencySnapshot(f),before);
}));
test('Strict validV1 imports default labels after original checksum validation without mutating input',()=>withCurrencyStore(f=>{
 const legacy=freeze(legacyV1(exportCompanyBundle(f.store,'default'))),encoded=JSON.stringify(legacy),before=currencySnapshot(f),created=restoreCompanyBundle(f.store,legacy,{name:'Fictional V1 Legacy Currency Copy'});assert.notEqual(created.id,'default');assert.deepEqual(labels(created),INR);assert.equal(JSON.stringify(legacy),encoded);assert.deepEqual(exportCompanyBundle(f.store,created.id).tables,legacy.tables);assert.equal(f.store.book(created.id).outstandingReport().totals.pending,60000);assert.deepEqual(currencySnapshot(f).books,before.books);
}));
test('V1 with added label fields or a bad original checksum rejects before any publication',()=>withCurrencyStore(f=>{
 const legacy=legacyV1(exportCompanyBundle(f.store,'default')),before=currencySnapshot(f),withFields=corruptBundle(legacy,value=>Object.assign(value.company,GBP)),bad=structuredClone(legacy);bad.checksum.value='0'.repeat(64);for(const bundle of [withFields,bad]){assert.throws(()=>restoreCompanyBundle(f.store,bundle,{name:'Must Not Publish Bad V1'}));assert.deepEqual(currencySnapshot(f),before);}assert.equal(f.store.catalog.isTransaction,false);
}));
test('Configured empty£/GBP V3 roundtrips into a new UUID without source or amount conversion',()=>withCurrencyStore(f=>{
 f.store.update(f.target.id,{revision:1,...GBP});const bundle=exportCompanyBundle(f.store,f.target.id),before=currencySnapshot(f),created=restoreCompanyBundle(f.store,bundle,{name:'Fictional V2 GBP Empty Copy'});assert.equal(bundle.version,3);assert.deepEqual(labels(created),GBP);assert.notEqual(created.id,f.target.id);assert.equal(created.books_from,f.target.books_from);assert.deepEqual(exportCompanyBundle(f.store,created.id).tables,bundle.tables);assert.deepEqual(currencySnapshot(f).books,before.books);assert.equal(f.store.book().outstandingReport().totals.pending,60000);
}));
test('Posted defaultINR V3 roundtrip preserves every record, sequence and60000pending',()=>withCurrencyStore(f=>{
 const bundle=exportCompanyBundle(f.store,'default'),before=currencySnapshot(f),created=restoreCompanyBundle(f.store,bundle,{name:'Fictional V2 Posted INR Copy'}),copy=exportCompanyBundle(f.store,created.id);assert.equal(bundle.version,3);assert.deepEqual(labels(copy.company),INR);assert.deepEqual(copy.tables,bundle.tables);assert.deepEqual(copy.sequences,bundle.sequences);assert.equal(f.store.book(created.id).outstandingReport().totals.pending,60000);assert.deepEqual(currencySnapshot(f).books,before.books);
}));
test('UnknownV3 fields, partial labels, unsupported versions and currency checksum tampering reject atomically',()=>withCurrencyStore(f=>{
 const bundle=exportCompanyBundle(f.store,'default'),before=currencySnapshot(f),tampered=structuredClone(bundle);tampered.company.currency_symbol='£';const invalid=[corruptBundle(bundle,value=>{value.company.decimal_places=3;}),corruptBundle(bundle,value=>{delete value.company.currency_name;}),corruptBundle(bundle,value=>{value.version=4;}),tampered];for(const value of invalid){assert.throws(()=>restoreCompanyBundle(f.store,value,{name:'Must Not Publish Bad V2'}));assert.deepEqual(currencySnapshot(f),before);}assert.equal(f.store.catalog.isTransaction,false);
}));
