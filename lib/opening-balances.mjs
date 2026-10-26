// Master opening amounts are separate from vouchers and their postings.
// Direct legacy Books retain the default date; managed companies pass theirs.
export const OPENING_DATE='2026-04-01';
export const OPENING_LIMIT=100000000000;
export const openingApplies=(to,date=OPENING_DATE)=>!to || to>=date;
export const crossesOpeningDate=({from,to},date=OPENING_DATE)=>Boolean(from && from<date && openingApplies(to,date));

export function withOpening(db,row,date=OPENING_DATE){
  const saved=db.prepare('SELECT amount FROM ledger_openings WHERE ledger_id=?').get(row.id);
  return {...row,opening_balance:saved?.amount ?? 0,opening_date:date};
}

export function openingSummary(db,active=true,date=OPENING_DATE){
  let debit=0n,credit=0n;
  if(active)for(const {amount} of db.prepare('SELECT amount FROM ledger_openings').all()){
    if(amount>0)debit+=BigInt(amount);else credit-=BigInt(amount);
  }
  if(debit>BigInt(Number.MAX_SAFE_INTEGER) || credit>BigInt(Number.MAX_SAFE_INTEGER))throw new RangeError('Combined opening balances exceed the supported exact amount.');
  return {date,debit:Number(debit),credit:Number(credit),difference:Number(debit-credit),balanced:debit===credit};
}
