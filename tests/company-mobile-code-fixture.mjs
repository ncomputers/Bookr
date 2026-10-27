import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,isAbsolute,join,relative} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {CompanyStore} from '../lib/companies.mjs';
import {checksumCompanyBundle} from '../lib/company-backup.mjs';

export function ownedMobileDirectory(directory){const temporary=realpathSync.native(tmpdir()),actual=realpathSync.native(directory),part=relative(temporary,actual);assert.ok(part&&!part.startsWith('..')&&!isAbsolute(part)&&basename(actual).startsWith('bookr-mobile-code-'));return actual;}
function post600(book,date,name){const customer=book.createCustomer({name}),sale=book.saveVoucher({type:'sale',date,customer_id:customer.id,account_id:2,amount:100000});book.saveVoucher({type:'receipt',date,customer_id:customer.id,account_id:1,amount:40000,allocations:[{bill_id:sale.bill.id,amount:40000}]});}
export function seedMobileCodeFixture(book){
 const database=book.db.prepare('PRAGMA database_list').all().find(row=>row.name==='main').file,directory=ownedMobileDirectory(dirname(database));post600(book,'2026-04-01','Fictional Mobile Default Buyer');const store=new CompanyStore({defaultFile:database});
 try{const target=store.create({name:'Fictional Mobile Target',mailing_name:'Fictional mobile mailing',country:'United Kingdom',state:'England',mobile:'+91 Fictional raw 000 0044',currency_symbol:'£',currency_name:'GBP',financial_year_from:'2025-04-01',books_from:'2025-05-01'}),empty=store.create({name:'Fictional Mobile Empty'});post600(store.book(target.id),'2025-05-01','Fictional Mobile Target Buyer');store.book(empty.id);return {directory,database,catalog:join(directory,'book.companies.sqlite'),target,empty,files:[database,join(directory,'book.companies',target.id+'.sqlite'),join(directory,'book.companies',empty.id+'.sqlite')]};}finally{store.close();}
}
export function withMobileStore(action){const directory=mkdtempSync(join(realpathSync.native(tmpdir()),'bookr-mobile-code-store-')),store=new CompanyStore({defaultFile:join(directory,'book.sqlite')});try{const f=seedMobileCodeFixture(store.book());for(const id of [f.target.id,f.empty.id])store.book(id);return action({store,...f});}finally{store.close();rmSync(ownedMobileDirectory(directory),{recursive:true,force:true});}}
function rows(file){const db=new DatabaseSync(file,{readOnly:true});try{return {schema:db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all().map(row=>({...row})),tables:Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'" ORDER BY rowid').all().map(row=>({...row}))]))};}finally{db.close();}}
export function mobileSnapshot(f){ownedMobileDirectory(f.directory);return {catalog:rows(f.catalog),books:f.files.map(file=>({file,...rows(file)})),files:readdirSync(f.directory,{recursive:true}).filter(name=>!/-wal$|-shm$/.test(name)).sort()};}
export function changeStoredMobile(f,change,id=f.target.id){ownedMobileDirectory(f.directory);const db=new DatabaseSync(f.catalog);try{const row=db.prepare('SELECT details FROM companies WHERE id=?').get(id),details=JSON.parse(row.details);change(details);db.prepare('UPDATE companies SET details=? WHERE id=?').run(JSON.stringify(details),id);}finally{db.close();}}
export function legacyMobileBundle(bundle,version){assert.ok([1,2].includes(version));const copy=structuredClone(bundle);copy.version=version;delete copy.company.mobile_calling_code;if(version===1){delete copy.company.currency_symbol;delete copy.company.currency_name;}copy.checksum={algorithm:'sha256',value:checksumCompanyBundle(copy)};return copy;}
export function resealMobileBundle(bundle,change){const copy=structuredClone(bundle);change(copy);copy.checksum={algorithm:'sha256',value:checksumCompanyBundle(copy)};return copy;}
