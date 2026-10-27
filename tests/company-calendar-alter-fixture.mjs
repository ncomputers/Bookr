import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {realpathSync,readdirSync} from 'node:fs';
import {basename,dirname,isAbsolute,join,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {CompanyStore} from '../lib/companies.mjs';

export const initialCalendar=Object.freeze({financial_year_from:'2026-04-01',books_from:'2026-04-01',financial_year_to:'2027-03-31'});
export const changedCalendar=Object.freeze({financial_year_from:'2025-04-01',books_from:'2025-07-01',financial_year_to:'2026-03-31'});
export const calendarOf=profile=>Object.fromEntries(Object.keys(initialCalendar).map(key=>[key,profile[key]]));
export function ownedCalendarDirectory(directory){
 const temporary=realpathSync.native(tmpdir()),actual=realpathSync.native(directory),part=relative(temporary,actual);
 assert.ok(part&&!part.startsWith('..')&&!isAbsolute(part)&&basename(actual).startsWith('bookr-calendar-alter-'),'Use only a new owned calendar-alter fixture.');return actual;
}
export function tableRows(file){const db=new DatabaseSync(file,{readOnly:true});try{return rowsFrom(db);}finally{db.close();}}
export const rowsFrom=db=>Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'" ORDER BY rowid').all().map(row=>({...row}))]));
export function seedCalendarAlter(database){
 const directory=ownedCalendarDirectory(dirname(database)),store=new CompanyStore({defaultFile:database});
 try{
  const comparison=store.create({name:'Fictional Calendar Alter Comparison'}),comparisonBook=store.book(comparison.id),buyer=comparisonBook.createCustomer({name:'Fictional Calendar Alter Buyer'}),sale=comparisonBook.saveVoucher({type:'sale',date:'2026-04-01',customer_id:buyer.id,account_id:2,amount:100000});
  comparisonBook.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:buyer.id,account_id:1,amount:40000,allocations:[{bill_id:sale.bill.id,amount:40000}]});
  const target=store.create({name:'Fictional Calendar Alter Target',mailing_name:'Fictional saved calendar mailing',address:'Fictional saved calendar address'}),other=store.create({name:'Fictional Calendar Alter Other'});
  store.book(target.id).saveLedger({kind:'bank',name:'Fictional Calendar Empty Bank',bank:{account_holder:'Fictional Calendar Holder',account_number:'000001',ifs_code:'FICTIONAL',bank_name:'Fictional Bank',branch:'Fictional Branch'}});
  return {directory,database,catalog:store.catalogFile,target,other,comparison,bookFiles:['default',target.id,other.id,comparison.id].map(id=>({id,file:store.fileFor(id)}))};
 }finally{store.close();}
}
export function snapshotCalendarAlter(f){ownedCalendarDirectory(f.directory);return {catalog:tableRows(f.catalog),books:Object.fromEntries(f.bookFiles.map(({id,file})=>[id,tableRows(file)])),files:readdirSync(f.directory,{recursive:true}).filter(path=>!/-wal$|-shm$/.test(path)).sort()};}
export function injectOpeningForCalendarPolicy(f){
 ownedCalendarDirectory(f.directory);const file=f.bookFiles.find(row=>row.id===f.target.id).file,db=new DatabaseSync(file);
 try{assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ledger_openings').get().n,0);db.prepare('INSERT INTO ledger_openings(ledger_id,amount) VALUES(1,1)').run();}finally{db.close();}
}
