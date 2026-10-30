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
const knownParents = Object.freeze({'Bank Accounts':'Current Assets','Cash-in-Hand':'Current Assets','Sundry Debtors':'Current Assets','Sundry Creditors':'Current Liabilities'});
const unmappedLabels = new Set(['Bank OCC A/c','Expenses (Direct)','Expenses (Indirect)','Income (Direct)','Income (Indirect)','Retained Earnings']);

export const ledgerGroups = Object.freeze(DISPLAY_LABELS.map(name=>Object.freeze({
  value:roles[name]??'label:'+name,
  // Null means this observed label has no verified local canonical group ID.
  group_id:unmappedLabels.has(name)?null:groupIds[name],
  kind:roles[name]??'general',name,
  parent:knownParents[name]??'',
  // Group nature and alias relationships outside the observed posting roles
  // are not yet established for this reference version.
  nature:null
})));

export const supportedLedgerGroups=Object.freeze(ledgerGroups.filter(group=>group.kind!=='general'));
export const LABEL_CANONICAL_MAP = Object.freeze({});
// Retained as the canonical built-in names for existing consumers. Parent and
// nature fields are only actionable for the supported posting roles above.
export const STANDARD_CANONICAL_GROUPS = Object.freeze(ledgerGroups.filter(group=>group.group_id!==null).map(group=>Object.freeze({
  id:group.group_id,name:group.name,parent:group.parent||null,nature:group.nature,kind:group.kind
})));
