// Master opening amounts are separate from vouchers and their postings. This
// version has one fixed books-beginning date and supports Cash/Bank/Capital.
export const OPENING_DATE='2026-04-01';
export const OPENING_LIMIT=100000000000;
export const openingApplies=to=>!to || to>=OPENING_DATE;
export const crossesOpeningDate=({from,to})=>Boolean(from && from<OPENING_DATE && openingApplies(to));

export function withOpening(db,row){
  const saved=db.prepare('SELECT amount FROM ledger_openings WHERE ledger_id=?').get(row.id);
  return {...row,opening_balance:saved?.amount ?? 0,opening_date:OPENING_DATE};
}

export function openingSummary(db,active=true){
  let debit=0n,credit=0n;
  if(active)for(const {amount} of db.prepare('SELECT amount FROM ledger_openings').all()){
    if(amount>0)debit+=BigInt(amount);else credit-=BigInt(amount);
  }
  if(debit>BigInt(Number.MAX_SAFE_INTEGER) || credit>BigInt(Number.MAX_SAFE_INTEGER))throw new RangeError('Combined opening balances exceed the supported exact amount.');
  return {date:OPENING_DATE,debit:Number(debit),credit:Number(credit),difference:Number(debit-credit),balanced:debit===credit};
}
