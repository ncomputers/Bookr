import {OPENING_DATE,OPENING_LIMIT} from './opening-balances.mjs';
import {normalizeBillTerms,withBillTerms,writeBillTerms} from './bill-terms.mjs';

// Separate master references from invoice vouchers. Existing bill/allocation
// identities are preserved, and deleted opening identities are never reused.
export function initializePartyOpeningSchema(db){
  db.exec(`CREATE TABLE IF NOT EXISTS opening_bills(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ledger_id INTEGER NOT NULL REFERENCES ledgers(id),
    reference TEXT NOT NULL CHECK(length(trim(reference))>0),
    date TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK(amount>0 AND amount<=100000000000)
  );
  CREATE INDEX IF NOT EXISTS opening_bills_ledger ON opening_bills(ledger_id);
  CREATE TABLE IF NOT EXISTS opening_bill_allocations(
    receipt_id INTEGER NOT NULL REFERENCES vouchers(id),
    opening_bill_id INTEGER NOT NULL REFERENCES opening_bills(id),
    amount INTEGER NOT NULL CHECK(amount>0 AND amount<=100000000000),
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(receipt_id,opening_bill_id)
  );`);
}
export const openingBills=(db,ledgerId)=>db.prepare('SELECT id,reference,date,amount FROM opening_bills WHERE ledger_id=? ORDER BY date,id').all(ledgerId).map(row=>withBillTerms(db,row,'opening',row.id,row.date));
const validDate=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T12:00:00Z')) && new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;

// Caller holds the master BEGIN IMMEDIATE transaction. These are deliberately
// narrow web integrity rules: positive complete breakups, no advances/On Account.
export function writeOpeningBills(db,ledgerId,rows,opening,kind,check,openingDate=OPENING_DATE){
  check(Array.isArray(rows) && rows.length<=100,'Enter up to 100 opening bills.');
  check((kind==='customer' && opening>=0) || (kind==='supplier' && opening<=0),'This version supports customer debit and supplier credit opening balances only.');
  const existing=openingBills(db,ledgerId),byId=new Map(existing.map(row=>[row.id,row])),seen=new Set(),references=new Set();
  let total=0n;
  const normalized=rows.map(row=>{
    check(row && typeof row==='object' && !Array.isArray(row),'Enter valid opening bill details.');
    check(Object.keys(row).every(key=>['id','reference','date','amount','terms','due_date'].includes(key)),'Opening bills support only id, reference, date, amount and terms; other methods or sides are outside this version.');
    const id=row.id;
    check(id===undefined || (Number.isSafeInteger(id) && byId.has(id) && !seen.has(id)),'Choose each saved opening bill once for this ledger.');
    if(id!==undefined)seen.add(id);
    check(typeof row.reference==='string' && row.reference.trim().length>0 && row.reference.length<=120,'Opening bill reference must contain 1 to 120 characters.');
    const reference=row.reference.trim(),key=reference.toLowerCase();
    check(!references.has(key),'Opening bill references must be unique within this ledger.');references.add(key);
    check(validDate(row.date) && row.date<openingDate,`Opening bill dates must be valid and before ${openingDate} in this version.`);
    check(Number.isSafeInteger(row.amount) && row.amount>0 && row.amount<=OPENING_LIMIT,'Enter a positive opening bill amount in whole paise within the supported limit.');
    // due_date is a read-only projection, accepted for GET/PUT roundtrips. Terms
    // and the current reference date always determine its authoritative value.
    const terms=normalizeBillTerms(row.terms,byId.get(id)?.terms,row.date,check);
    total+=BigInt(row.amount);return {id,reference,date:row.date,amount:row.amount,terms};
  });
  check(total===BigInt(Math.abs(opening)),'Opening bill amounts must equal the absolute opening balance.');
  for(const old of existing){
    const replacement=normalized.find(row=>row.id===old.id);
    const paid=db.prepare('SELECT COALESCE(SUM(amount),0) AS value FROM opening_bill_allocations WHERE opening_bill_id=?').get(old.id).value;
    check(!paid || replacement,'An opening bill with allocated settlements cannot be removed.');
    check(!replacement || replacement.amount>=paid,'An opening bill cannot be reduced below settlements already allocated to it.');
  }
  for(const old of existing)if(!seen.has(old.id))db.prepare('DELETE FROM opening_bills WHERE id=?').run(old.id);
  for(const row of normalized){
    if(row.id!==undefined)db.prepare('UPDATE opening_bills SET reference=?,date=?,amount=? WHERE id=? AND ledger_id=?').run(row.reference,row.date,row.amount,row.id,ledgerId);
    else row.id=Number(db.prepare('INSERT INTO opening_bills(ledger_id,reference,date,amount) VALUES(?,?,?,?)').run(ledgerId,row.reference,row.date,row.amount).lastInsertRowid);
    writeBillTerms(db,'opening',row.id,row.terms);
  }
}
