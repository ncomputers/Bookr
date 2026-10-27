import {BookError} from './errors.mjs';
import {companyRecordColumns} from './company-backup.mjs';

// Share the supported portable-record schema; an eligibility read never opens
// the accounting engine or initializes a missing table.
export function emptyCalendarBook(db){
 const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name),expected=[...Object.keys(companyRecordColumns),'sqlite_sequence'];
 const supported=names.length===expected.length&&names.every(name=>expected.includes(name))&&Object.entries(companyRecordColumns).every(([table,columns])=>{
  const stored=db.prepare('PRAGMA table_info("'+table+'")').all().map(row=>row.name);return stored.length===columns.length&&stored.every(name=>columns.includes(name));
 });
 if(!supported)throw new BookError('The stored book schema does not support company date changes.');
 return Object.keys(companyRecordColumns).filter(name=>!['ledgers','bank_accounts'].includes(name)).every(name=>!db.prepare('SELECT 1 FROM "'+name+'" LIMIT 1').get());
}
