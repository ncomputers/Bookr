// Shared group names and presentation for the supported ledger kinds.
export const ledgerGroups=Object.freeze([
  {kind:'bank',name:'Bank Accounts',nature:'Assets',parent:'Current Assets'},
  {kind:'cash',name:'Cash-in-Hand',nature:'Assets',parent:'Current Assets'},
  {kind:'customer',name:'Sundry Debtors',nature:'Assets',parent:'Current Assets'},
  {kind:'capital',name:'Capital Account',nature:'Liabilities',parent:''},
  {kind:'supplier',name:'Sundry Creditors',nature:'Liabilities',parent:'Current Liabilities'},
  {kind:'expense',name:'Indirect Expenses',nature:'Expenses',parent:''},
  {kind:'purchase',name:'Purchase Accounts',nature:'Expenses',parent:''},
  {kind:'income',name:'Indirect Incomes',nature:'Income',parent:''},
  {kind:'sales',name:'Sales Accounts',nature:'Income',parent:''}
].map(Object.freeze));
