export const generalJournalKinds=Object.freeze(['cash','capital','expense','income','sales','purchase']);
export const isGeneralJournal=details=>(typeof details==='string'?JSON.parse(details):details)?.journal_mode==='general';

export function initializeGeneralJournalSchema(db){
  // Money and sides remain solely in postings; this table stores input order.
  db.exec(`CREATE TABLE IF NOT EXISTS journal_entry_order(
    voucher_id INTEGER NOT NULL,ledger_id INTEGER NOT NULL,
    position INTEGER NOT NULL CHECK(typeof(position)='integer' AND position>=0),
    PRIMARY KEY(voucher_id,ledger_id),UNIQUE(voucher_id,position),
    FOREIGN KEY(voucher_id,ledger_id) REFERENCES postings(voucher_id,ledger_id) ON DELETE CASCADE
  );`);
}
export function generalJournalEntries(db,id){
  return db.prepare(`SELECT p.ledger_id,p.side,p.amount,l.name FROM postings p
    JOIN ledgers l ON l.id=p.ledger_id LEFT JOIN journal_entry_order o ON o.voucher_id=p.voucher_id AND o.ledger_id=p.ledger_id
    WHERE p.voucher_id=? ORDER BY COALESCE(o.position,2147483647),p.ledger_id`).all(id);
}
// Called within Book.saveVoucher's existing BEGIN IMMEDIATE transaction.
export function saveGeneralJournal({db,input,previous,check,ledger,isDate,checkOpening,readVoucher}){
  check(!previous || (Number.isSafeInteger(input.revision) && input.revision===previous.revision),'This voucher changed after you opened it. Reopen it before saving.',409);
  check(input.type===undefined || input.type==='journal','A saved voucher must keep its voucher type.');
  check(!previous || isGeneralJournal(previous.details),'A saved Journal must keep its entry mode.');
  for(const field of ['amount','debit_ledger_id','credit_ledger_id','debit_amount','credit_amount','account_id','customer_id','supplier_id','ledger_id','source_id','destination_id','sale_id'])check(!Object.hasOwn(input,field),'Use the general Journal entries; conflicting voucher header fields are not accepted.');
  check(input.bill==null,'General Journals cannot contain bill references.');
  check(input.allocations===undefined || (Array.isArray(input.allocations) && input.allocations.length===0),'General Journals cannot contain settlement allocations.');
  check(input.details===undefined || (input.details && typeof input.details==='object' && !Array.isArray(input.details) && Object.keys(input.details).every(key=>key==='journal_mode') && (input.details.journal_mode===undefined || input.details.journal_mode==='general')),'Bank, bill and other details are outside this general Journal mode.');
  check(isDate(input.date),'Enter a valid date.');
  check(Array.isArray(input.entries) && input.entries.length>=2 && input.entries.length<=100,'Enter between 2 and 100 balanced Journal lines.');
  const seen=new Set(),ledgers=[];
  const entries=input.entries.map(row=>{
    check(row && typeof row==='object' && !Array.isArray(row),'Enter a valid Journal line.');
    check(Object.keys(row).every(key=>['ledger_id','side','amount','name'].includes(key)),'Use ledger, side and amount for each Journal line.');
    check(Number.isSafeInteger(row.ledger_id) && row.ledger_id>0 && !seen.has(row.ledger_id),'Choose each Journal ledger once.');seen.add(row.ledger_id);
    check(['debit','credit'].includes(row.side),'Choose Debit or Credit for each Journal line.');
    check(Number.isSafeInteger(row.amount) && row.amount>0 && row.amount<=100000000000,'Enter a positive Journal amount in paise.');
    const account=ledger(row.ledger_id);check(generalJournalKinds.includes(account.kind),'Choose Cash, Capital, Expenses, Incomes, Sales or Purchases in this general Journal mode.');ledgers.push(account);
    return {ledger_id:account.id,side:row.side,amount:row.amount};
  });
  const debit=entries.filter(row=>row.side==='debit').reduce((sum,row)=>sum+row.amount,0),credit=entries.filter(row=>row.side==='credit').reduce((sum,row)=>sum+row.amount,0);
  check(debit>0 && debit===credit,'Journal debit and credit totals must be equal.');
  check(debit<=100000000000,'The total Journal amount exceeds the supported limit.');checkOpening(...ledgers);
  const narration=input.narration===undefined?'':input.narration;check(typeof narration==='string' && narration.length<=1000,'Enter a valid narration.');
  const account=entries.find(row=>row.side==='debit').ledger_id,party=entries.find(row=>row.side==='credit').ledger_id;
  const number=previous?.number ?? db.prepare("SELECT COALESCE(MAX(number),0)+1 AS value FROM vouchers WHERE type='journal'").get().value;
  const details=JSON.stringify({journal_mode:'general'});let id=previous?.id;
  if(previous){
    db.prepare('UPDATE vouchers SET date=?,customer_id=?,account_id=?,amount=?,narration=?,details=?,revision=revision+1 WHERE id=?').run(input.date,party,account,debit,narration.trim(),details,id);
    db.prepare('DELETE FROM journal_entry_order WHERE voucher_id=?').run(id);db.prepare('DELETE FROM postings WHERE voucher_id=?').run(id);
  }else id=Number(db.prepare("INSERT INTO vouchers(type,number,date,customer_id,account_id,amount,narration,details) VALUES('journal',?,?,?,?,?,?,?)").run(number,input.date,party,account,debit,narration.trim(),details).lastInsertRowid);
  const posting=db.prepare('INSERT INTO postings(voucher_id,ledger_id,side,amount) VALUES(?,?,?,?)'),order=db.prepare('INSERT INTO journal_entry_order(voucher_id,ledger_id,position) VALUES(?,?,?)');
  entries.forEach((row,position)=>{posting.run(id,row.ledger_id,row.side,row.amount);order.run(id,row.ledger_id,position);});
  const totals=db.prepare("SELECT COUNT(*) AS count,SUM(CASE WHEN side='debit' THEN amount ELSE -amount END) AS difference FROM postings WHERE voucher_id=?").get(id);
  check(totals.count===entries.length && totals.difference===0,'Journal must contain balanced accounting entries.');return readVoucher(id);
}
