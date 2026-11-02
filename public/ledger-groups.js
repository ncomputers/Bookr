// The installed fictional reference showed34 distinct Under labels. Only the
// nine roles below currently have verified posting workflows in Bookr. Other
// labels remain selectable as non-posting ledger masters; no alias equivalence
// is assumed for the six additional visible labels.
export const DISPLAY_LABELS = Object.freeze([
  'Bank Accounts','Bank OCC A/c','Bank OD A/c','Branch / Divisions','Capital Account','Cash-in-Hand',
  'Current Assets','Current Liabilities','Deposits (Asset)','Direct Expenses','Direct Incomes','Duties & Taxes',
  'Expenses (Direct)','Expenses (Indirect)','Fixed Assets','Income (Direct)','Income (Indirect)',
  'Indirect Expenses','Indirect Incomes','Investments','Loans & Advances (Asset)','Loans (Liability)',
  'Misc. Expenses (ASSET)','Provisions','Purchase Accounts','Reserves & Surplus','Retained Earnings',
  'Sales Accounts','Secured Loans','Stock-in-Hand','Sundry Creditors','Sundry Debtors','Suspense A/c','Unsecured Loans'
]);

const roles = Object.freeze({
  'Bank Accounts':'bank','Cash-in-Hand':'cash','Sundry Debtors':'customer','Capital Account':'capital',
  'Sundry Creditors':'supplier','Indirect Expenses':'expense','Purchase Accounts':'purchase',
  'Indirect Incomes':'income','Sales Accounts':'sales'
});
const groupIds = Object.freeze({
  'Bank Accounts':16,'Bank OD A/c':17,'Cash-in-Hand':18,'Deposits (Asset)':19,'Duties & Taxes':20,
  'Loans & Advances (Asset)':21,'Provisions':22,'Reserves & Surplus':23,'Secured Loans':24,
  'Stock-in-Hand':25,'Sundry Creditors':26,'Sundry Debtors':27,'Unsecured Loans':28,
  'Branch / Divisions':1,'Capital Account':2,'Current Assets':3,'Current Liabilities':4,
  'Direct Expenses':5,'Direct Incomes':6,'Fixed Assets':7,'Indirect Expenses':8,'Indirect Incomes':9,
  'Investments':10,'Loans (Liability)':11,'Misc. Expenses (ASSET)':12,'Purchase Accounts':13,
  'Sales Accounts':14,'Suspense A/c':15
});
const groupParents = Object.freeze({
  'Bank Accounts':'Current Assets','Bank OCC A/c':'Loans (Liability)','Bank OD A/c':'Loans (Liability)',
  'Branch / Divisions':'','Capital Account':'','Cash-in-Hand':'Current Assets','Current Assets':'',
  'Current Liabilities':'','Deposits (Asset)':'Current Assets','Direct Expenses':'','Direct Incomes':'',
  'Duties & Taxes':'Current Liabilities','Expenses (Direct)':'','Expenses (Indirect)':'','Fixed Assets':'',
  'Income (Direct)':'','Income (Indirect)':'','Indirect Expenses':'','Indirect Incomes':'','Investments':'',
  'Loans & Advances (Asset)':'Current Assets','Loans (Liability)':'','Misc. Expenses (ASSET)':'','Provisions':'Current Liabilities',
  'Purchase Accounts':'','Reserves & Surplus':'Capital Account','Retained Earnings':'Capital Account',
  'Sales Accounts':'','Secured Loans':'Loans (Liability)','Stock-in-Hand':'Current Assets',
  'Sundry Creditors':'Current Liabilities','Sundry Debtors':'Current Assets','Suspense A/c':'','Unsecured Loans':'Loans (Liability)'
});
const groupNatures = Object.freeze({
  'Bank Accounts':'Assets','Bank OCC A/c':'Liabilities','Bank OD A/c':'Liabilities','Branch / Divisions':'Liabilities',
  'Capital Account':'Liabilities','Cash-in-Hand':'Assets','Current Assets':'Assets','Current Liabilities':'Liabilities',
  'Deposits (Asset)':'Assets','Direct Expenses':'Expenses','Direct Incomes':'Income','Duties & Taxes':'Liabilities',
  'Expenses (Direct)':'Expenses','Expenses (Indirect)':'Expenses','Fixed Assets':'Assets','Income (Direct)':'Income',
  'Income (Indirect)':'Income','Indirect Expenses':'Expenses','Indirect Incomes':'Income','Investments':'Assets',
  'Loans & Advances (Asset)':'Assets','Loans (Liability)':'Liabilities','Misc. Expenses (ASSET)':'Assets',
  'Provisions':'Liabilities','Purchase Accounts':'Expenses','Reserves & Surplus':'Liabilities','Retained Earnings':'Liabilities',
  'Sales Accounts':'Income','Secured Loans':'Liabilities','Stock-in-Hand':'Assets','Sundry Creditors':'Liabilities',
  'Sundry Debtors':'Assets','Suspense A/c':'Liabilities','Unsecured Loans':'Liabilities'
});
const unmappedLabels = new Set(['Bank OCC A/c','Expenses (Direct)','Expenses (Indirect)','Income (Direct)','Income (Indirect)','Retained Earnings']);

export const ledgerGroups = Object.freeze(DISPLAY_LABELS.map(name=>Object.freeze({
  value:roles[name]??'label:'+name,
  // Null means this observed label has no verified local canonical group ID.
  group_id:unmappedLabels.has(name)?null:groupIds[name],
  kind:roles[name]??'general',name,
  parent:groupParents[name]??'',
  nature:groupNatures[name]??null
})));

export const supportedLedgerGroups=Object.freeze(ledgerGroups.filter(group=>group.kind!=='general'));
export const LABEL_CANONICAL_MAP = Object.freeze({});
// Retained as the canonical built-in names for existing consumers. Parent and
// nature fields are only actionable for the supported posting roles above.
export const STANDARD_CANONICAL_GROUPS = Object.freeze(ledgerGroups.filter(group=>group.group_id!==null).map(group=>Object.freeze({
  id:group.group_id,name:group.name,parent:group.parent||null,nature:group.nature,kind:group.kind
})));
