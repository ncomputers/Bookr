import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,isAbsolute,join,relative} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {CompanyStore} from '../lib/companies.mjs';
import {checksumCompanyBundle} from '../lib/company-backup.mjs';

export const GBP=Object.freeze({currency_symbol:'£',currency_name:'GBP'}),INR=Object.freeze({currency_symbol:'₹',currency_name:'INR'});
export function assertCurrencyFixture(directory){const temporary=realpathSync.native(tmpdir()),actual=realpathSync.native(directory),part=relative(temporary,actual);assert.ok(part&&!part.startsWith('..')&&!isAbsolute(part)&&basename(actual).startsWith('bookr-currency-'));return actual;}
export function seedCurrencyFixture(book){
 const database=book.db.prepare('PRAGMA database_list').all().find(row=>row.name==='main').file,directory=assertCurrencyFixture(dirname(database)),customer=book.createCustomer({name:'Fictional Currency Buyer'}),sale=book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:100000});book.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1,amount:40000,allocations:[{bill_id:sale.bill.id,amount:40000}]});
 const store=new CompanyStore({defaultFile:database});try{const target=store.create({name:'Fictional Currency Empty',country:'United Kingdom',state:'England',financial_year_from:'2025-04-01',books_from:'2025-05-01'}),other=store.create({name:'Fictional Currency Other'});return {directory,database,catalog:join(directory,'book.companies.sqlite'),target,other,bookFiles:[database,join(directory,'book.companies',target.id+'.sqlite'),join(directory,'book.companies',other.id+'.sqlite')]};}finally{store.close();}
}
export function withCurrencyStore(action){const directory=mkdtempSync(join(realpathSync.native(tmpdir()),'bookr-currency-store-')),store=new CompanyStore({defaultFile:join(directory,'book.sqlite')});try{const fixture=seedCurrencyFixture(store.book());for(const id of [fixture.target.id,fixture.other.id])store.book(id);return action({store,...fixture});}finally{store.close();rmSync(assertCurrencyFixture(directory),{recursive:true,force:true});}}
function rows(file){const db=new DatabaseSync(file,{readOnly:true});try{return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'" ORDER BY rowid').all().map(row=>({...row}))]));}finally{db.close();}}
export function currencySnapshot(fixture){assertCurrencyFixture(fixture.directory);return {catalog:rows(fixture.catalog),books:fixture.bookFiles.map(file=>({file,tables:rows(file)})),files:readdirSync(fixture.directory,{recursive:true}).filter(name=>!/-wal$|-shm$/.test(name)).sort()};}
export function changeStoredCurrency(fixture,change){assertCurrencyFixture(fixture.directory);const db=new DatabaseSync(fixture.catalog);try{const row=db.prepare('SELECT details FROM companies WHERE id=?').get(fixture.target.id),details=JSON.parse(row.details);change(details);db.prepare('UPDATE companies SET details=? WHERE id=?').run(JSON.stringify(details,null,3),fixture.target.id);}finally{db.close();}}
export function legacyV1(bundle){const copy=structuredClone(bundle);copy.version=1;delete copy.company.currency_symbol;delete copy.company.currency_name;copy.checksum={algorithm:'sha256',value:checksumCompanyBundle(copy)};return copy;}
export function corruptBundle(bundle,change){const copy=structuredClone(bundle);change(copy);copy.checksum={algorithm:'sha256',value:checksumCompanyBundle(copy)};return copy;}
