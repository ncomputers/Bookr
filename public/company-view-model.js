import {companyCurrency,formatCompanyAmount} from './company-currency.js';

export const defaultCompanyView=Object.freeze({show_contacts:true,show_currency_details:false});
const key=target=>'bookr.company-view.v1.'+encodeURIComponent(target);
const fields=value=>({show_contacts:typeof value?.show_contacts==='boolean'?value.show_contacts:defaultCompanyView.show_contacts,show_currency_details:typeof value?.show_currency_details==='boolean'?value.show_currency_details:defaultCompanyView.show_currency_details});
export function readCompanyView(storage,target){
 try{const saved=JSON.parse(storage.getItem(key(target)));if(saved?.version===1&&typeof saved.show_contacts==='boolean'&&typeof saved.show_currency_details==='boolean')return fields(saved);}catch{}
 return {...defaultCompanyView};
}
export function writeCompanyView(storage,target,value){const result=fields(value);storage.setItem(key(target),JSON.stringify({version:1,...result}));return result;}
export function describeCompanyCurrency(value){const labels=companyCurrency(value);return {symbol:labels.currency_symbol,name:labels.currency_name,decimals:2,grouping:'en-IN',position:'Before amount',spacing:'No space',example:formatCompanyAmount(123456789,labels)};}

const features=Object.freeze([
 {key:'accounts',label:'Accounts',status:'available',level:0,detail:'Double-entry ledger balances and statements.'},
 {key:'bill_tracking',label:'Bill tracking',status:'available',level:0,detail:'Saved references, receipt allocations and outstanding balances.'},
 {key:'vouchers',label:'Supported vouchers',status:'available',level:1,detail:'Sales, purchases, receipts, payments, contra and supported journals.'},
 {key:'reports',label:'Accounting reports',status:'available',level:1,detail:'Trial balance, financial statements and supported ledger and bill reports.'},
 {key:'inventory',label:'Inventory',status:'unavailable',level:0,detail:'Stock items, quantities, godowns and inventory valuation are not implemented.'},
 {key:'tax',label:'Tax',status:'unavailable',level:0,detail:'Tax calculation and statutory returns are not implemented.'},
 {key:'cost_centres',label:'Cost centres',status:'unavailable',level:1,detail:'Cost allocation and cost-centre reports are not implemented.'},
 {key:'remote',label:'Remote access',status:'unavailable',level:1,detail:'Managed remote access and synchronisation are not implemented.'},
 {key:'security',label:'Security and access',status:'unavailable',level:1,detail:'User access control, encryption and edit log are unavailable; no password protection is applied.'},
 {key:'payroll',label:'Payroll',status:'unavailable',level:2,detail:'Employee payroll processing is not implemented.'},
 {key:'interest',label:'Interest calculation',status:'unavailable',level:2,detail:'Automatic interest calculations are not implemented.'}
]);
export const companyFeatureStatus=()=>features.map(row=>({...row}));
