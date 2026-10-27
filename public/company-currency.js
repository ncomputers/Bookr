import {formatRupees} from './entry-values.js';
export class CurrencyError extends Error {constructor(message){super(message);this.name='CurrencyError';this.status=400;}}
export const DEFAULT_COMPANY_CURRENCY=Object.freeze({currency_symbol:'₹',currency_name:'INR'});
const limits=Object.freeze({currency_symbol:12,currency_name:120});
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function label(key,value,canonical=false){
 if(typeof value!=='string'||/[\u0000-\u001f\u007f]/.test(value))throw new CurrencyError('Enter valid single-line currency labels.');
 const trimmed=value.trim();if(!trimmed||trimmed.length>limits[key]||(canonical&&trimmed!==value))throw new CurrencyError('Enter valid currency labels within the supported text limits.');return trimmed;
}
export function companyCurrency(profile){
 if(!object(profile))throw new CurrencyError('Unsupported stored company currency labels.');
 const present=Object.keys(limits).filter(key=>Object.hasOwn(profile,key));if(!present.length)return DEFAULT_COMPANY_CURRENCY;
 if(present.length!==2)throw new CurrencyError('Unsupported stored company currency labels.');
 return Object.freeze(Object.fromEntries(Object.keys(limits).map(key=>[key,label(key,profile[key],true)])));
}
export function normalizeCurrencyPatch(patch,previous=DEFAULT_COMPANY_CURRENCY){
 if(!object(patch)||Object.keys(patch).some(key=>!Object.hasOwn(limits,key)))throw new CurrencyError('Choose only the supported currency symbol and formal name.');
 const result={...companyCurrency(previous)};for(const key of Object.keys(patch))result[key]=label(key,patch[key]);return Object.freeze(result);
}
export const formatCompanyAmount=(amount,profile)=>companyCurrency(profile).currency_symbol+formatRupees(amount);
export function supportsCompanyDenominations(profile){const current=companyCurrency(profile);return Object.keys(limits).every(key=>current[key]===DEFAULT_COMPANY_CURRENCY[key]);}
export const encodeCompanyCurrencyContext=profile=>encodeURIComponent(JSON.stringify(companyCurrency(profile)));
export function confirmCompanyCurrency(profile,state,capabilities={}){
 try{
  const expected=companyCurrency(profile),actual=companyCurrency(state),fields=Object.keys(DEFAULT_COMPANY_CURRENCY);
  if(capabilities.company_currency_labels===true){if(!fields.every(key=>Object.hasOwn(profile,key)&&Object.hasOwn(state,key)))throw new Error();}
  else if(!supportsCompanyDenominations(expected)||!supportsCompanyDenominations(actual))throw new Error();
  if(!fields.every(key=>expected[key]===actual[key]))throw new Error();return actual;
 }catch{throw new CurrencyError('Unable to confirm company currency labels. Refresh using the current Bookr server before opening these books.');}
}
