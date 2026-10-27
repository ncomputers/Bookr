import {BookError} from './errors.mjs';
import {companyCurrency,supportsCompanyDenominations} from '../public/company-currency.js';
// Compatibility and stale-draft checks, not authentication or conversion.
export function requireCurrencyAwareness(headers,profile){
 if(headers['x-bookr-currency-labels']!==undefined&&headers['x-bookr-currency-labels']!=='1')throw new BookError('Unsupported currency-label protocol version. Use a current Bookr client.');
 if(!supportsCompanyDenominations(profile)&&headers['x-bookr-currency-labels']!=='1')throw new BookError('This company uses currency labels that require a current Bookr client.');
}
export function requireCurrencyContext(headers,profile){
 requireCurrencyAwareness(headers,profile);const raw=headers['x-bookr-currency-context'];
 if(raw===undefined&&headers['x-bookr-currency-labels']===undefined&&supportsCompanyDenominations(profile))return;
 let value;try{if(typeof raw!=='string'||raw.length>4096||/[^\x20-\x7e]/.test(raw))throw new Error();value=JSON.parse(decodeURIComponent(raw));}catch{}
 const saved=companyCurrency(profile);
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==2||!Object.keys(saved).every(key=>Object.hasOwn(value,key)&&value[key]===saved[key]))throw new BookError('Company currency labels changed or are missing from this draft. Reopen the entry before saving.',409);
}
