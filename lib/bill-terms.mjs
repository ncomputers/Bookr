// Original bounded term model: integer calendar days or one fixed due date.
// Unspecified terms remain absent rather than inferring a native blank default.
export const validTermDate=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export function dueDate(terms,origin){
  if(!terms)return null;
  return terms.mode==='date'?terms.date:new Date(Date.parse(origin+'T00:00:00Z')+terms.days*86400000).toISOString().slice(0,10);
}
export function normalizeBillTerms(input,previous,origin,check){
  const value=input===undefined?(previous ?? null):input;
  if(value===null)return null;
  check(value && typeof value==='object' && !Array.isArray(value),'Enter valid bill terms or null to clear them.');
  check(value.mode==='days' || value.mode==='date','Choose credit days or a fixed due date.');
  let terms;
  if(value.mode==='days'){
    check(Object.keys(value).every(key=>['mode','days'].includes(key)) && Number.isSafeInteger(value.days) && value.days>=0 && value.days<=3650,'Credit days must be a whole number from 0 to 3650.');
    terms={mode:'days',days:value.days};
  }else{
    check(Object.keys(value).every(key=>['mode','date'].includes(key)) && validTermDate(value.date),'Enter a valid fixed due date.');
    terms={mode:'date',date:value.date};
  }
  const date=dueDate(terms,origin);
  check(validTermDate(date),'The bill due date exceeds the supported four-digit year range.');
  check(date>=origin,'The due date cannot be before the bill date.');
  return terms;
}
const tableFor=source=>source==='opening'?['opening_bill_terms','opening_bill_id']:['bill_terms','bill_id'];
export function initializeBillTermsSchema(db){
  for(const [table,key,parent] of [['bill_terms','bill_id','bills'],['opening_bill_terms','opening_bill_id','opening_bills']])db.exec(`CREATE TABLE IF NOT EXISTS ${table}(
    ${key} INTEGER PRIMARY KEY REFERENCES ${parent}(id) ON DELETE CASCADE,
    mode TEXT NOT NULL CHECK(mode IN ('days','date')),
    days INTEGER,
    date TEXT,
    CHECK((mode='days' AND typeof(days)='integer' AND days BETWEEN 0 AND 3650 AND date IS NULL)
      OR (mode='date' AND days IS NULL AND typeof(date)='text' AND length(date)=10))
  );`);
}
export function readBillTerms(db,source,id){
  const [table,key]=tableFor(source),row=db.prepare(`SELECT mode,days,date FROM ${table} WHERE ${key}=?`).get(id);
  return row?(row.mode==='days'?{mode:'days',days:row.days}:{mode:'date',date:row.date}):null;
}
export function writeBillTerms(db,source,id,terms){
  const [table,key]=tableFor(source);
  if(!terms){db.prepare(`DELETE FROM ${table} WHERE ${key}=?`).run(id);return;}
  db.prepare(`INSERT INTO ${table}(${key},mode,days,date) VALUES(?,?,?,?) ON CONFLICT(${key}) DO UPDATE SET mode=excluded.mode,days=excluded.days,date=excluded.date`).run(id,terms.mode,terms.mode==='days'?terms.days:null,terms.mode==='date'?terms.date:null);
}
export function withBillTerms(db,row,source,id,origin){
  const terms=readBillTerms(db,source,id);
  return terms?{...row,terms,due_date:dueDate(terms,origin)}:row;
}
