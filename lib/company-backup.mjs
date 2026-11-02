import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {BookError} from './errors.mjs';
import {normalizeCompanyCalendar} from './company-calendar.mjs';
import {normalizeBillTerms} from './bill-terms.mjs';
import {validCalendarDate} from '../public/calendar-values.js';
import {companyCurrency,supportsCompanyDenominations} from '../public/company-currency.js';
import {companyMobileCallingCode} from '../public/company-mobile-code.js';
import {ledgerGroups} from '../public/ledger-groups.js';
import {STANDARD_GROUPS} from './groups.mjs';
import {PRIMARY_COST_CATEGORY} from './cost-centres.mjs';

// Original portable JSON format, independent of any database/vendor file format.
const FORMAT='bookr.company',VERSION=3,MAX=100000000000,MAX_BYTES=25*1024*1024,MAX_ROWS=200000;
export const companyRecordColumns=Object.freeze({
 ledgers:['id','name','kind','alias','revision','mailing_name','address','state','country','pincode','group_id','group_name','gstin','gst_registration_type','tax_type','tax_rate'],
 vouchers:['id','type','number','date','customer_id','account_id','amount','narration','sale_id','revision','details'],
 postings:['voucher_id','ledger_id','side','amount'],bills:['id','sale_id','reference','amount'],
 receipt_allocations:['receipt_id','bill_id','amount','position'],bank_accounts:['ledger_id','details'],
 ledger_openings:['ledger_id','amount'],opening_bills:['id','ledger_id','reference','date','amount'],
 opening_bill_allocations:['receipt_id','opening_bill_id','amount','position'],
 bill_terms:['bill_id','mode','days','date'],opening_bill_terms:['opening_bill_id','mode','days','date'],
 journal_entry_order:['voucher_id','ledger_id','position']
});
const columns=companyRecordColumns,tableNames=Object.keys(columns),legacyProfileFields=['name','mailing_name','address','state','country','pincode','telephone','mobile','fax','email','website','financial_year_from','books_from','financial_year_to'],currencyProfileFields=[...legacyProfileFields,'currency_symbol','currency_name'],mobileProfileFields=[...currencyProfileFields,'mobile_calling_code'],gstProfileFields=[...mobileProfileFields,'gstin','gst_registration_type'],profileFields=gstProfileFields;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const check=(condition,message)=>{if(!condition)throw new BookError(message);};
const keys=(value,names,label,exact=true)=>{check(object(value)&&Object.keys(value).every(key=>names.includes(key))&&(!exact||names.every(key=>Object.hasOwn(value,key))),'Unsupported '+label+' fields.');};
const integer=(value,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const positive=value=>integer(value,1),money=value=>integer(value,1,MAX);
const inputText=(value,max,nonempty=false)=>typeof value==='string'&&value.length<=max&&(!nonempty||value.trim().length>0);
// Restored stored text must already match the engine's trim-on-save form.
// Reject incompatible data rather than changing names/references on import.
const text=(value,max,nonempty=false)=>inputText(value,max,nonempty)&&value.trim()===value;
const asciiFold=value=>value.replace(/[A-Z]/g,char=>char.toLowerCase());
function canonical(value,depth=0){
 check(depth<40,'Portable backup nesting is too deep.');
 if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'){check(Number.isFinite(value)&&Number.isSafeInteger(value),'Portable backup numbers must be exact integers.');return String(value);}
 if(Array.isArray(value))return '['+value.map(item=>canonical(item,depth+1)).join(',')+']';
 check(object(value),'Portable backup values must contain only plain JSON data.');
 return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key],depth+1)).join(',')+'}';
}
export function checksumCompanyBundle(bundle){check(object(bundle),'Enter a portable Bookr bundle.');const {checksum,...payload}=bundle;return createHash('sha256').update(canonical(payload)).digest('hex');}
const mapBy=(rows,key,label)=>{const result=new Map();for(const row of rows){check(!result.has(row[key]),'Duplicate '+label+' identity.');result.set(row[key],row);}return result;};
function jsonDetails(value,label){check(text(value,24000),'Invalid '+label+' JSON.');let result;try{result=JSON.parse(value);}catch{throw new BookError('Invalid '+label+' JSON.');}check(object(result),'Invalid '+label+' details.');return result;}
function validate(bundle){
 keys(bundle,['format','version','created_at','company','tables','sequences','checksum','groups','cost_centres'],'portable bundle',false);
 for(const key of ['format','version','created_at','company','tables','sequences','checksum'])check(Object.hasOwn(bundle,key),'Unsupported portable bundle fields.');
 check(bundle.format===FORMAT&&[1,2,VERSION].includes(bundle.version),'Unsupported Bookr portable backup format or version.');
 check(text(bundle.created_at,40)&&Number.isFinite(Date.parse(bundle.created_at))&&new Date(bundle.created_at).toISOString()===bundle.created_at,'Invalid backup timestamp.');
 check(Buffer.byteLength(canonical(bundle))<=MAX_BYTES,'Portable backup exceeds the supported size.');
 keys(bundle.checksum,['algorithm','value'],'checksum');check(bundle.checksum.algorithm==='sha256'&&/^[a-f0-9]{64}$/.test(bundle.checksum.value)&&checksumCompanyBundle(bundle)===bundle.checksum.value,'Portable backup checksum does not match.');
 const acceptedFields=bundle.version===1?legacyProfileFields:bundle.version===2?currencyProfileFields:Object.hasOwn(bundle.company,'gstin')?gstProfileFields:mobileProfileFields;
 keys(bundle.company,acceptedFields,'company');for(const key of acceptedFields.filter(key=>!key.includes('from')&&key!=='financial_year_to'))check(text(bundle.company[key],key==='address'?1000:key==='pincode'?20:key==='gstin'?15:key==='gst_registration_type'?30:120,key==='name'),'Invalid portable company '+key+'.');if(bundle.company.gstin)check(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(bundle.company.gstin),'Invalid portable company gstin.');companyCurrency(bundle.company);companyMobileCallingCode(bundle.company);normalizeCompanyCalendar(Object.fromEntries(['financial_year_from','books_from','financial_year_to'].map(key=>[key,bundle.company[key]])));
 keys(bundle.tables,tableNames,'accounting table');keys(bundle.sequences,['opening_bills'],'identity sequence');check(integer(bundle.sequences.opening_bills),'Invalid opening bill identity sequence.');
 let count=0;for(const table of tableNames){const rows=bundle.tables[table];check(Array.isArray(rows),'Invalid portable '+table+' rows.');count+=rows.length;check(count<=MAX_ROWS,'Portable backup exceeds the supported row count.');for(const row of rows){const fields=table==='ledgers'&&!Object.hasOwn(row,'group_id')?(Object.hasOwn(row,'gstin')?columns.ledgers.filter(c=>c!=='group_id'&&c!=='group_name'):columns.ledgers.slice(0,10)):table==='ledgers'&&!Object.hasOwn(row,'gstin')?columns.ledgers.slice(0,12):columns[table];keys(row,fields,table+' row');for(const value of Object.values(row))check(value===null||typeof value==='string'||Number.isSafeInteger(value)||typeof value==='number','Invalid portable row value.');}}
 const t=bundle.tables,ledgers=mapBy(t.ledgers,'id','ledger'),vouchers=mapBy(t.vouchers,'id','voucher'),bills=mapBy(t.bills,'id','bill'),openingBills=mapBy(t.opening_bills,'id','opening bill'),openings=mapBy(t.ledger_openings,'ledger_id','ledger opening'),bankAccounts=mapBy(t.bank_accounts,'ledger_id','bank account');
 if(bundle.groups!==undefined){
  check(Array.isArray(bundle.groups)&&bundle.groups.length<=1000,'Invalid portable groups.');
  const groupIds=new Set(),groupNames=new Set();
  for(const sg of STANDARD_GROUPS){groupIds.add(sg.id);groupNames.add(asciiFold(sg.name));}
  for(const g of bundle.groups){
   keys(g,['id','name','alias','parent_id','parent_name','nature','affects_gross_profit','is_subledger','net_reporting','is_builtin','revision'],'portable group',false);
   check(positive(g.id)&&g.id>=100&&positive(g.revision)&&g.is_builtin===0,'Invalid group identity, revision or builtin flag.');
   check(text(g.name,120,true),'Invalid group name.');
   if(g.alias!==undefined)check(text(g.alias,120),'Invalid group alias.');
   check(['Assets','Liabilities','Expenses','Income'].includes(g.nature),'Invalid group nature.');
   check([0,1].includes(g.affects_gross_profit),'Invalid group affects_gross_profit.');
   if(g.is_subledger!==undefined)check([0,1].includes(g.is_subledger),'Invalid group is_subledger.');
   if(g.net_reporting!==undefined)check([0,1].includes(g.net_reporting),'Invalid group net_reporting.');
   check(g.parent_id===null||positive(g.parent_id),'Invalid group parent identity.');
   if(g.parent_name!==null&&g.parent_name!==undefined)check(text(g.parent_name,120,true),'Invalid group parent name.');
   check(!groupIds.has(g.id),'Duplicate group identity.');
   groupIds.add(g.id);
   const foldName=asciiFold(g.name);
   check(!groupNames.has(foldName),'Duplicate group name.');
   groupNames.add(foldName);
  }
  const allGroups=new Map();
  for(const sg of STANDARD_GROUPS)allGroups.set(sg.id,{id:sg.id,parent_id:sg.parent_id});
  for(const g of bundle.groups)allGroups.set(g.id,{id:g.id,parent_id:g.parent_id});
  for(const g of bundle.groups){
   if(g.parent_id!==null){
    check(allGroups.has(g.parent_id),'Group parent not found.');
    let current=g.parent_id;
    const seen=new Set([g.id]);
    while(current){
     check(!seen.has(current),'Cyclic group hierarchy detected.');
     seen.add(current);
     current=allGroups.get(current)?.parent_id??null;
    }
   }
  }
 }
 if(bundle.cost_centres!==undefined){
  keys(bundle.cost_centres,['version','categories','centres','ledger_applicability'],'cost centres');
  check(bundle.cost_centres.version===1,'Invalid portable cost centres version.');
  check(Array.isArray(bundle.cost_centres.categories)&&bundle.cost_centres.categories.length>0&&bundle.cost_centres.categories.length<=1000,'Invalid portable cost categories.');
  check(Array.isArray(bundle.cost_centres.centres)&&bundle.cost_centres.centres.length<=10000,'Invalid portable cost centres.');
  check(object(bundle.cost_centres.ledger_applicability),'Invalid portable cost centre applicability.');
  check(bundle.cost_centres.categories.some(c=>c.id===1&&c.is_builtin===1),'Primary Cost Category is required.');
  const categoryIds=new Set(),categoryNames=new Set();
  for(const cat of bundle.cost_centres.categories){
   keys(cat,['id','name','alias','allocate_revenue','allocate_non_revenue','is_builtin','revision'],'cost category');
   check(positive(cat.id)&&positive(cat.revision),'Invalid cost category identity or revision.');
   check(text(cat.name,120,true),'Invalid cost category name.');
   check(text(cat.alias,120),'Invalid cost category alias.');
   check([0,1].includes(cat.allocate_revenue)&&[0,1].includes(cat.allocate_non_revenue)&&[0,1].includes(cat.is_builtin),'Invalid cost category allocation or builtin flag.');
   check(!categoryIds.has(cat.id),'Duplicate cost category identity.');
   categoryIds.add(cat.id);
   const fold=asciiFold(cat.name);
   check(!categoryNames.has(fold),'Duplicate cost category name.');
   categoryNames.add(fold);
  }
  const centreIds=new Set(),centreKeys=new Set();
  for(const c of bundle.cost_centres.centres){
   keys(c,['id','category_id','parent_id','name','alias','revision','category_name','parent_name'],'cost centre',false);
   check(positive(c.id)&&positive(c.revision),'Invalid cost centre identity or revision.');
   check(positive(c.category_id)&&categoryIds.has(c.category_id),'Invalid cost centre category identity.');
   check(c.parent_id===null||positive(c.parent_id),'Invalid cost centre parent identity.');
   check(text(c.name,120,true),'Invalid cost centre name.');
   check(text(c.alias,120),'Invalid cost centre alias.');
   if(c.category_name!==undefined)check(text(c.category_name,120,true),'Invalid cost centre category name.');
   if(c.parent_name!==null&&c.parent_name!==undefined)check(text(c.parent_name,120,true),'Invalid cost centre parent name.');
   check(!centreIds.has(c.id),'Duplicate cost centre identity.');
   centreIds.add(c.id);
   const key=c.category_id+':'+asciiFold(c.name);
   check(!centreKeys.has(key),'Duplicate cost centre name in category.');
   centreKeys.add(key);
  }
  const centreMap=new Map(bundle.cost_centres.centres.map(c=>[c.id,c]));
  for(const c of bundle.cost_centres.centres){
   if(c.parent_id!==null){
    const parent=centreMap.get(c.parent_id);
    check(parent&&parent.category_id===c.category_id,'Cost centre parent must belong to the same category.');
    let current=c.parent_id;
    const seen=new Set([c.id]);
    while(current!==null){
     check(!seen.has(current),'Cyclic cost centre hierarchy detected.');
     seen.add(current);
     current=centreMap.get(current)?.parent_id??null;
    }
   }
  }
  for(const[key,value]of Object.entries(bundle.cost_centres.ledger_applicability)){
   check(/^\d+$/.test(key)&&positive(Number(key)),'Invalid ledger applicability identity.');
   check(ledgers.has(Number(key)),'Cost centre applicability ledger not found.');
   check(typeof value==='boolean','Invalid cost centre applicability value.');
  }
 }
 const ledgerKinds=['customer','supplier','cash','bank','sales','purchase','expense','income','capital','general'],names=new Set();
 for(const row of t.ledgers){check(positive(row.id)&&positive(row.revision)&&ledgerKinds.includes(row.kind),'Invalid ledger identity, revision or kind.');for(const[key,limit]of Object.entries({name:120,alias:120,mailing_name:120,address:1000,state:120,country:120,pincode:20}))check(text(row[key],limit,key==='name'),'Invalid ledger '+key+'.');const key=asciiFold(row.name);check(!names.has(key),'Duplicate ledger name.');names.add(key);if(Object.hasOwn(row,'group_id')){check((row.group_id===null||positive(row.group_id))&&text(row.group_name,120,true),'Invalid ledger group.');const group=ledgerGroups.find(item=>item.name===row.group_name&&(item.group_id??null)===row.group_id);if(group){check(group.kind===row.kind,'Ledger group does not match its posting role.');}else{const custom=bundle.groups?.find(item=>item.name===row.group_name&&item.id===row.group_id);check(custom,'Ledger group does not match its posting role.');}}}
 check(ledgers.get(1)?.kind==='cash'&&ledgers.get(2)?.kind==='sales'&&t.ledgers.some(row=>row.kind==='purchase'),'Required application seed ledgers are missing; restoring would reseed the book.');
 for(const row of t.bank_accounts){check(ledgers.get(row.ledger_id)?.kind==='bank','Bank metadata must belong to a bank ledger.');const details=jsonDetails(row.details,'bank ledger');keys(details,['account_holder','account_number','ifs_code','swift_code','bank_name','branch'],'bank ledger');for(const[key,limit]of Object.entries({account_holder:120,account_number:80,ifs_code:40,swift_code:40,bank_name:120,branch:120}))check(text(details[key],limit),'Invalid bank ledger '+key+'.');}
 let debitOpening=0n,creditOpening=0n;
 for(const row of t.ledger_openings){const ledger=ledgers.get(row.ledger_id);check(ledger&&['cash','bank','capital','customer','supplier'].includes(ledger.kind)&&Number.isSafeInteger(row.amount)&&row.amount!==0&&Math.abs(row.amount)<=MAX,'Invalid ledger opening.');if(row.amount>0)debitOpening+=BigInt(row.amount);else creditOpening-=BigInt(row.amount);}
 check(debitOpening<=BigInt(Number.MAX_SAFE_INTEGER)&&creditOpening<=BigInt(Number.MAX_SAFE_INTEGER),'Opening totals exceed exact supported amounts.');
 const openingReferences=new Set(),openingTotals=new Map(),openingCounts=new Map();for(const row of t.opening_bills){const party=ledgers.get(row.ledger_id),opening=openings.get(row.ledger_id)?.amount??0;check(positive(row.id)&&money(row.amount)&&party&&['customer','supplier'].includes(party.kind)&&validCalendarDate(row.date)&&row.date<bundle.company.books_from&&text(row.reference,120,true),'Invalid opening bill.');check(party.kind==='customer'?opening>0:opening<0,'Opening bill side does not match the party.');const count=(openingCounts.get(row.ledger_id)??0)+1;check(count<=100,'A party can contain at most100 opening references.');openingCounts.set(row.ledger_id,count);const key=row.ledger_id+':'+row.reference.toLowerCase();check(!openingReferences.has(key),'Duplicate opening reference.');openingReferences.add(key);openingTotals.set(row.ledger_id,(openingTotals.get(row.ledger_id)??0n)+BigInt(row.amount));}
 for(const party of t.ledgers.filter(row=>['customer','supplier'].includes(row.kind))){const amount=openings.get(party.id)?.amount??0,total=openingTotals.get(party.id)??0n;check(total===BigInt(Math.abs(amount)),'Opening bills must equal their party opening.');if(amount)check(party.kind==='customer'?amount>0:amount<0,'Unsupported party opening side.');}
 check(bundle.sequences.opening_bills>=t.opening_bills.reduce((maximum,row)=>Math.max(maximum,row.id),0),'Opening identity sequence would reuse a saved identity.');
 const postingKeys=new Set(),postingsByVoucher=new Map(),positions=new Map(),numberKeys=new Set(),detailsById=new Map(),billByVoucher=new Map();
 for(const row of t.postings){check(vouchers.has(row.voucher_id)&&ledgers.has(row.ledger_id)&&['debit','credit'].includes(row.side)&&money(row.amount),'Invalid posting or foreign key.');const key=row.voucher_id+':'+row.ledger_id;check(!postingKeys.has(key),'Duplicate posting.');postingKeys.add(key);const list=postingsByVoucher.get(row.voucher_id)??[];check(list.length<100,'A voucher exceeds the supported posting count.');list.push(row);postingsByVoucher.set(row.voucher_id,list);}
 for(const row of t.journal_entry_order){check(vouchers.has(row.voucher_id)&&ledgers.has(row.ledger_id)&&postingKeys.has(row.voucher_id+':'+row.ledger_id)&&integer(row.position),'Invalid Journal order.');const rows=positions.get(row.voucher_id)??[];check(rows.length<100&&!rows.some(item=>item.position===row.position||item.ledger_id===row.ledger_id),'Duplicate or excessive Journal order.');rows.push(row);positions.set(row.voucher_id,rows);}
 for(const row of t.bills){const voucher=vouchers.get(row.sale_id);check(positive(row.id)&&voucher&&money(row.amount)&&row.amount===voucher.amount&&text(row.reference,120,true),'Invalid bill amount, identity or reference.');check(!billByVoucher.has(row.sale_id),'Duplicate voucher bill.');billByVoucher.set(row.sale_id,row);}
 for(const voucher of t.vouchers){
  const party=ledgers.get(voucher.customer_id),account=ledgers.get(voucher.account_id);check(positive(voucher.id)&&positive(voucher.revision)&&positive(voucher.number)&&['sale','purchase','receipt','payment','contra','journal','credit_note','debit_note'].includes(voucher.type)&&validCalendarDate(voucher.date)&&money(voucher.amount)&&text(voucher.narration,1000)&&party&&account&&(voucher.sale_id===null||vouchers.has(voucher.sale_id)),'Invalid voucher identity, date, amount or foreign key.');
  const numberKey=voucher.type+':'+voucher.number;check(!numberKeys.has(numberKey),'Duplicate voucher number.');numberKeys.add(numberKey);const details=jsonDetails(voucher.details,'voucher');detailsById.set(voucher.id,details);const general=voucher.type==='journal'&&details.journal_mode==='general',postings=postingsByVoucher.get(voucher.id)??[],debit=postings.filter(row=>row.side==='debit').reduce((sum,row)=>sum+BigInt(row.amount),0n),credit=postings.filter(row=>row.side==='credit').reduce((sum,row)=>sum+BigInt(row.amount),0n);check(debit===BigInt(voucher.amount)&&credit===debit,'Voucher postings must balance and match the saved amount.');
  check(postings.every(row=>!openings.has(row.ledger_id)||voucher.date>=bundle.company.books_from),'A nonzero opening cannot be combined with an earlier voucher in this version.');
  let needsBill=false;
  if(general){keys(details,['journal_mode','cost_allocations'],'general Journal',false);check(postings.length>=2&&postings.length<=100&&postings.every(row=>['customer','supplier','bank','cash','capital','expense','income','sales','purchase','general'].includes(ledgers.get(row.ledger_id).kind)),'Invalid general Journal ledgers.');const order=(positions.get(voucher.id)??[]).sort((a,b)=>a.position-b.position);check(order.length===postings.length&&order.every((row,index)=>row.position===index),'General Journal order must contain every posting.');const ordered=order.map(row=>postings.find(posting=>posting.ledger_id===row.ledger_id));check(ordered.find(row=>row.side==='debit')?.ledger_id===account.id&&ordered.find(row=>row.side==='credit')?.ledger_id===party.id,'General Journal header does not match ordered entries.');}
  else{
   check(!positions.has(voucher.id),'Only general Journals have entry order.');
   if(voucher.type==='sale'){check(['customer','cash'].includes(party.kind)&&account.kind==='sales','Invalid Sales ledger kinds.');needsBill=party.kind==='customer';}
   if(voucher.type==='purchase'){check(['supplier','cash'].includes(party.kind)&&account.kind==='purchase','Invalid Purchase ledger kinds.');needsBill=party.kind==='supplier';}
   if(voucher.type==='credit_note'){check(['customer','cash'].includes(party.kind)&&account.kind==='sales','Invalid Credit Note ledger kinds.');needsBill=party.kind==='customer';}
   if(voucher.type==='debit_note'){check(['supplier','cash'].includes(party.kind)&&account.kind==='purchase','Invalid Debit Note ledger kinds.');needsBill=party.kind==='supplier';}
   if(voucher.type==='receipt')check(['customer','income','capital'].includes(party.kind)&&['cash','bank'].includes(account.kind),'Invalid Receipt ledger kinds.');
   if(voucher.type==='payment')check(['supplier','expense','capital'].includes(party.kind)&&['cash','bank'].includes(account.kind),'Invalid Payment ledger kinds.');
   if(voucher.type==='contra')check(['cash','bank'].includes(party.kind)&&['cash','bank'].includes(account.kind)&&party.id!==account.id&&(party.kind==='bank'||account.kind==='bank'),'Invalid Contra ledger kinds.');
   if(voucher.type==='journal'){check(party.kind==='supplier'&&account.kind==='expense'&&Object.keys(details).length===0,'Invalid credit-expense Journal.');needsBill=true;}
   const partyDebit=['sale','payment','debit_note'].includes(voucher.type);
   const partyPosting=postings.find(row=>row.ledger_id===party.id&&row.side===(partyDebit?'debit':'credit'));
   check(partyPosting&&partyPosting.amount===voucher.amount,'Party posting side or amount does not match voucher header.');
   const otherPostings=postings.filter(row=>row!==partyPosting);
   check(otherPostings.length>=1&&otherPostings.length<=100,'Posting sides or ledgers do not match the voucher header.');
   check(otherPostings.every(row=>row.side===(partyDebit?'credit':'debit')),'Posting side does not match voucher direction.');
   const otherTotal=otherPostings.reduce((sum,row)=>sum+BigInt(row.amount),0n);
   check(otherTotal===BigInt(voucher.amount),'Non-party postings total does not equal voucher amount.');
   if(otherPostings.length===1){
     check(otherPostings[0].ledger_id===account.id,'Posting ledger does not match voucher header.');
   }else{
     check(['sale','purchase','credit_note','debit_note'].includes(voucher.type),'Only invoices support multi-line postings.');
     check(otherPostings.some(row=>row.ledger_id===account.id),'Voucher account must be among the invoice postings.');
   }
   if(voucher.type!=='journal')validateVoucherDetails(details,voucher,party,account);
   check(supportsCompanyDenominations(bundle.company)||details.bank?.denominations==null,'Cash denominations currently support only the default currency labels.');
  }
  check(Boolean(billByVoucher.get(voucher.id))===needsBill,'Voucher bill presence does not match its type.');
 }
 const allocations=new Map(),allocatedRegular=new Map(),allocatedOpening=new Map();
 for(const [table,key,billMap,totals,opening]of [['receipt_allocations','bill_id',bills,allocatedRegular,false],['opening_bill_allocations','opening_bill_id',openingBills,allocatedOpening,true]])for(const row of t[table]){
  const voucher=vouchers.get(row.receipt_id),bill=billMap.get(row[key]),invoice=opening?null:vouchers.get(bill?.sale_id);check(voucher&&bill&&['receipt','payment'].includes(voucher.type)&&money(row.amount)&&integer(row.position),'Invalid settlement allocation or foreign key.');const payable=voucher.type==='payment';check(ledgers.get(voucher.customer_id).kind===(payable?'supplier':'customer'),'Only party settlements allocate bills.');check(opening?bill.ledger_id===voucher.customer_id:invoice.customer_id===voucher.customer_id&&(payable?['purchase','journal'].includes(invoice.type)&&detailsById.get(invoice.id).journal_mode!=='general':invoice.type==='sale'),'Allocation party or direction does not match its bill.');const list=allocations.get(voucher.id)??[];check(list.length<100&&!list.some(item=>item.position===row.position||item.opening===opening&&item.identity===row[key]),'Duplicate or excessive settlement allocation or position.');list.push({identity:row[key],position:row.position,amount:row.amount,opening,invoiceId:invoice?.id??null});allocations.set(voucher.id,list);totals.set(row[key],(totals.get(row[key])??0n)+BigInt(row.amount));
 }
 for(const [id,total]of allocatedRegular)check(total<=BigInt(bills.get(id).amount),'Bill settlements exceed the original amount.');for(const[id,total]of allocatedOpening)check(total<=BigInt(openingBills.get(id).amount),'Opening settlements exceed the original amount.');
 for(const voucher of t.vouchers){const party=ledgers.get(voucher.customer_id),settlement=['receipt','payment'].includes(voucher.type)&&['customer','supplier'].includes(party.kind),list=(allocations.get(voucher.id)??[]).sort((a,b)=>a.position-b.position);if(settlement)check(list.length>0&&list.length<=100&&list.every((row,index)=>row.position===index)&&list.reduce((sum,row)=>sum+BigInt(row.amount),0n)===BigInt(voucher.amount),'Settlement allocation totals/order do not match the voucher.');else check(list.length===0,'This voucher cannot contain settlement allocations.');const expected=settlement&&list.length===1&&!list[0].opening?list[0].invoiceId:null;check(voucher.sale_id===expected,'Legacy sale link does not match the saved allocation.');}
 for(const[table,key,billMap,opening]of [['bill_terms','bill_id',bills,false],['opening_bill_terms','opening_bill_id',openingBills,true]]){const seen=new Set();for(const row of t[table]){const bill=billMap.get(row[key]);check(bill&&!seen.has(row[key]),'Invalid or duplicate bill terms.');seen.add(row[key]);check(row.mode==='days'?integer(row.days,0,3650)&&row.date===null:row.mode==='date'&&row.days===null&&validCalendarDate(row.date),'Invalid bill terms.');const terms=row.mode==='days'?{mode:'days',days:row.days}:{mode:'date',date:row.date};normalizeBillTerms(terms,null,opening?bill.date:vouchers.get(bill.sale_id).date,check);}}
 return bundle;
}
function validateVoucherDetails(details,voucher,party,account){
 keys(details,['dispatch','party','supplier_invoice','original_invoice','bank','source_bank','lines','cost_allocations','gst'],'voucher details',false);
 for(const[section,fields]of Object.entries({dispatch:{delivery_note:200,document_no:120,through:120,destination:120,carrier:120,bill_of_lading:120,bill_date:10,vehicle:80},party:{mailing_name:120,address:1000,state:120,country:120}}))if(details[section]!==undefined){keys(details[section],Object.keys(fields),section);for(const[key,limit]of Object.entries(fields))check(text(details[section][key],limit),'Invalid '+section+' '+key+'.');}
 if(details.dispatch?.bill_date)check(validCalendarDate(details.dispatch.bill_date),'Invalid bill-of-lading date.');
 if(details.supplier_invoice!==undefined){keys(details.supplier_invoice,['number','date'],'supplier invoice');check(text(details.supplier_invoice.number,120)&&text(details.supplier_invoice.date,10)&&(!details.supplier_invoice.date||validCalendarDate(details.supplier_invoice.date)),'Invalid supplier invoice.');}
 if(details.original_invoice!==undefined){keys(details.original_invoice,['number','date'],'original invoice');check(text(details.original_invoice.number,120)&&text(details.original_invoice.date,10)&&(!details.original_invoice.date||validCalendarDate(details.original_invoice.date)),'Invalid original invoice.');}
 if(details.gst!==undefined){
  keys(details.gst,['supply_type','company_state','party_state','taxable_amount','cgst_amount','sgst_amount','igst_amount','total_tax','total_amount'],'voucher gst',false);
  check(['intra_state','inter_state'].includes(details.gst.supply_type),'Invalid GST supply type.');
  check(Number.isSafeInteger(details.gst.total_tax)&&details.gst.total_tax>=0,'Invalid GST total tax.');
 }
 const transfer=voucher.type==='contra'&&party.kind==='bank'&&account.kind==='bank',deposit=voucher.type==='contra'&&account.kind==='bank'&&party.kind==='cash',withdrawal=voucher.type==='contra'&&party.kind==='bank'&&account.kind==='cash';
 const bankCheck=(value,ledgerId,type,allowDenominations=false)=>{keys(value,['account_id','transaction_type','amount','instrument_number','instrument_date','bank_name','cheque_range','denominations'],'bank voucher',false);check(value.account_id===ledgerId&&value.amount===voucher.amount&&value.transaction_type===type&&validCalendarDate(value.instrument_date)&&text(value.instrument_number,120)&&text(value.bank_name,120)&&['','Not Applicable'].includes(value.cheque_range),'Invalid bank allocation.');check(allowDenominations||value.denominations==null,'Unexpected cash denominations.');if(value.denominations!=null){keys(value.denominations,['counts','others','total','difference'],'cash denominations');const counts=value.denominations.counts,allowed=['2000','1000','500','200','100','50','20','10','5','2','1'];keys(counts,allowed,'cash denomination count');check(Object.values(counts).every(count=>integer(count))&&integer(value.denominations.others),'Invalid cash denomination counts.');const total=allowed.reduce((sum,key)=>sum+BigInt(key)*100n*BigInt(counts[key]),BigInt(value.denominations.others));check(total<=BigInt(Number.MAX_SAFE_INTEGER)&&value.denominations.total===Number(total)&&value.denominations.difference===voucher.amount-Number(total),'Invalid cash denomination totals.');}};
 if(transfer){bankCheck(details.bank,account.id,'Cheque/DD');bankCheck(details.source_bank,party.id,'Cheque');check(details.source_bank.cheque_range==='Not Applicable','Invalid source cheque range.');}
 else if(deposit)bankCheck(details.bank,account.id,'Cash',true);
 else if(withdrawal){bankCheck(details.bank,party.id,'Cheque');check(details.bank.cheque_range==='Not Applicable','Invalid withdrawal cheque range.');}
 else if(account.kind==='bank')bankCheck(details.bank,account.id,voucher.type==='payment'?'Cheque':'Cheque/DD');
 else check(details.bank==null,'Bank allocation requires a bank account.');
 check(transfer||details.source_bank===undefined,'Second bank allocation requires a bank-to-bank transfer.');
 if(details.lines!==undefined){
  check(Array.isArray(details.lines)&&details.lines.length>0&&details.lines.length<=100,'Invalid voucher lines.');
  let linesTotal=0n;
  for(const line of details.lines){
   keys(line,['ledger_id','amount','description','hsn_sac','gst_rate','cgst_amount','sgst_amount','igst_amount','total_amount'],'voucher line',false);
   check(positive(line.ledger_id)&&money(line.amount),'Invalid voucher line.');
   if(line.description!==undefined)check(text(line.description,200),'Invalid line description.');
   if(line.hsn_sac!==undefined)check(text(line.hsn_sac,20),'Invalid line HSN/SAC.');
   if(line.gst_rate!==undefined)check(typeof line.gst_rate==='number'&&line.gst_rate>=0&&line.gst_rate<=100,'Invalid line GST rate.');
   linesTotal+=BigInt(line.amount);
  }
  const gstTax=BigInt(details.gst?.total_tax??0);
  check(linesTotal+gstTax===BigInt(voucher.amount),'Voucher lines total must equal voucher amount.');
 }
 if(details.cost_allocations!==undefined){
  check(Array.isArray(details.cost_allocations)&&details.cost_allocations.length>0&&details.cost_allocations.length<=100,'Invalid cost allocations.');
  for(const ca of details.cost_allocations){
   keys(ca,['ledger_id','category_id','category_name','allocations'],'cost allocation',false);
   check(positive(ca.ledger_id)&&positive(ca.category_id),'Invalid cost allocation ledger or category.');
   if(ca.category_name!==undefined)check(text(ca.category_name,120),'Invalid category name.');
   check(Array.isArray(ca.allocations)&&ca.allocations.length>0&&ca.allocations.length<=100,'Invalid centre allocations.');
   let allocTotal=0n;
   for(const a of ca.allocations){
    keys(a,['centre_id','centre_name','amount'],'centre allocation',false);
    check(positive(a.centre_id)&&money(a.amount),'Invalid centre allocation.');
    if(a.centre_name!==undefined)check(text(a.centre_name,120),'Invalid centre name.');
    allocTotal+=BigInt(a.amount);
   }
   let expectedAmount;
   if(details.lines!==undefined){
    expectedAmount=details.lines.filter(l=>l.ledger_id===ca.ledger_id).reduce((sum,l)=>sum+BigInt(l.amount),0n);
   }else{
    expectedAmount=BigInt(voucher.amount);
   }
   check(allocTotal===expectedAmount,'Cost allocations must equal ledger amount.');
  }
 }
}
function readRows(db){
 const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row=>row.name);check(names.length===tableNames.length+1&&names.every(name=>tableNames.includes(name)||name==='sqlite_sequence'),'Unsupported source accounting schema.');
 const result={};for(const table of tableNames){const actual=db.prepare('PRAGMA table_info("'+table+'")').all().map(row=>row.name);check(actual.length===columns[table].length&&actual.every(name=>columns[table].includes(name)),'Unsupported source '+table+' columns.');result[table]=db.prepare('SELECT * FROM "'+table+'" ORDER BY rowid').all().map(row=>({...row}));}
 const sequences=db.prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name').all();check(sequences.length<=1&&sequences.every(row=>row.name==='opening_bills'),'Unsupported identity sequence.');return {tables:result,sequences:{opening_bills:sequences[0]?.seq??0}};
}
export function exportCompanyBundle(store,id){
 check(!store.catalog.isTransaction,'Finish the current company operation before exporting.');store.catalog.exec('BEGIN DEFERRED');let db;
 try{const profile=store.profile(id);check(Object.keys(profile).every(key=>key==='id'||key==='revision'||profileFields.includes(key)),'Unsupported source company settings; no portable backup was emitted.');const exportCompanyFields=(profile.gstin||(profile.gst_registration_type&&profile.gst_registration_type!=='Unregistered'))?gstProfileFields:mobileProfileFields;const company=Object.fromEntries(exportCompanyFields.map(key=>[key,profile[key]??(key==='gst_registration_type'?'Unregistered':'')]));db=new DatabaseSync(store.fileFor(id),{readOnly:true});db.exec('BEGIN DEFERRED');const saved=readRows(db);const groups=store.groups?store.groups(id).read().groups:[];const costCentres=store.costCentres?store.costCentres(id).read():{version:1,categories:[{...PRIMARY_COST_CATEGORY}],centres:[],ledger_applicability:{}};const bundle={format:FORMAT,version:VERSION,created_at:new Date().toISOString(),company,...saved,groups,cost_centres:costCentres};bundle.checksum={algorithm:'sha256',value:checksumCompanyBundle(bundle)};validate(bundle);check(db.prepare('PRAGMA foreign_key_check').all().length===0,'Source foreign-key check failed.');db.exec('COMMIT');store.catalog.exec('COMMIT');return bundle;
 }catch(error){if(db?.isTransaction)db.exec('ROLLBACK');if(store.catalog.isTransaction)store.catalog.exec('ROLLBACK');throw error;}finally{db?.close();}
}
export function restoreCompanyBundle(store,bundle,options){
 keys(options,['name'],'restore options');check(inputText(options.name,120,true),'Enter a new company name.');validate(bundle);const trusted=structuredClone(bundle);Object.assign(trusted.company,companyCurrency(trusted.company),{mobile_calling_code:companyMobileCallingCode(trusted.company)});
 // Versions 1–3 predate explicit group membership. Preserve their existing
 // supported role semantics while translating them into the current schema.
 for(const row of trusted.tables.ledgers){
  if(!Object.hasOwn(row,'group_id')){const group=ledgerGroups.find(item=>item.kind===row.kind&&item.kind!=='general');check(group,'This older backup cannot identify the group for a general ledger. No company was created.');row.group_id=group.group_id;row.group_name=group.name;}
  if(!Object.hasOwn(row,'gstin')){row.gstin='';row.gst_registration_type='Unregistered';row.tax_type='';row.tax_rate=0;}
 }
 // Explicit current-period requests make later-year vouchers editable without
 // changing master dates. Named books still reject dates before Books, so
 // importing that distinct legacy policy remains unsupported and fail closed.
 check(trusted.tables.vouchers.every(row=>row.date>=trusted.company.books_from),'Restore cannot preserve before-Books legacy voucher-date edit policy. No company was created.');
 const created=store.create({...trusted.company,name:options.name},{initializeBook:book=>{
  book.transaction(()=>{book.db.exec('PRAGMA defer_foreign_keys=ON');for(const table of [...tableNames].reverse())book.db.exec('DELETE FROM "'+table+'"');for(const table of tableNames){const fields=columns[table],insert=book.db.prepare('INSERT INTO "'+table+'"('+fields.map(field=>'"'+field+'"').join(',')+') VALUES('+fields.map(()=>'?').join(',')+')');for(const row of trusted.tables[table])insert.run(...fields.map(field=>row[field]));}book.db.exec("DELETE FROM sqlite_sequence WHERE name='opening_bills'");if(trusted.sequences.opening_bills)book.db.prepare('INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)').run('opening_bills',trusted.sequences.opening_bills);check(book.db.prepare('PRAGMA foreign_key_check').all().length===0,'Restored foreign-key check failed.');check(book.db.prepare('PRAGMA integrity_check').all().every(row=>row.integrity_check==='ok'),'Restored database integrity check failed.');const copied=readRows(book.db);check(canonical(copied.tables)===canonical(trusted.tables)&&canonical(copied.sequences)===canonical(trusted.sequences),'Restored records or identity sequences changed.');});
 }});
 try{
  if(store.groups&&trusted.groups!==undefined){
   store.groups(created.id).save({version:1,groups:trusted.groups});
  }
  if(store.costCentres&&trusted.cost_centres!==undefined){
   store.costCentres(created.id).save(trusted.cost_centres);
  }
  return created;
 }catch(error){
  try{store.delete(created.id);}catch{}
  throw error;
 }
}
