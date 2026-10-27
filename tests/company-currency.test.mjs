import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_COMPANY_CURRENCY,companyCurrency,normalizeCurrencyPatch,formatCompanyAmount,supportsCompanyDenominations,encodeCompanyCurrencyContext} from '../public/company-currency.js';
import {parseRupees,inputRupees,formatRupees,formatBalance} from '../public/entry-values.js';
import * as currencyModel from '../public/company-currency.js';

test('Legacy profiles resolve to explicit immutable default labels without rewriting input',()=>{
 const profile=Object.freeze({id:'default',name:'Fictional legacy'}),resolved=companyCurrency(profile);assert.deepEqual(resolved,{currency_symbol:'₹',currency_name:'INR'});assert.ok(Object.isFrozen(resolved));assert.deepEqual(DEFAULT_COMPANY_CURRENCY,{currency_symbol:'₹',currency_name:'INR'});assert.ok(Object.isFrozen(DEFAULT_COMPANY_CURRENCY));assert.equal(Object.hasOwn(profile,'currency_symbol'),false);
});
test('Label patches trim Unicode text and preserve omitted target values independently of country',()=>{
 const previous=Object.freeze({currency_symbol:'₹',currency_name:'INR',country:'United Kingdom'}),result=normalizeCurrencyPatch({currency_symbol:' £ ',currency_name:' GBP '},previous);assert.deepEqual(result,{currency_symbol:'£',currency_name:'GBP'});assert.deepEqual(normalizeCurrencyPatch({currency_name:'Fictional unit'},result),{currency_symbol:'£',currency_name:'Fictional unit'});assert.equal(previous.currency_symbol,'₹');
});
test('Software text limits reject blanks, controls, incorrect types and unsupported precision/rate keys',()=>{
 for(const patch of [{currency_symbol:''},{currency_name:'  '},{currency_symbol:'x'.repeat(13)},{currency_name:'x'.repeat(121)},{currency_symbol:'£\n'},{currency_name:'G\u0000BP'},{currency_symbol:1},{currency_name:null},{decimal_places:3},{exchange_rate:2}])assert.throws(()=>normalizeCurrencyPatch(patch));
});
test('Stored partial, noncanonical or malformed labels never silently mix with INR defaults',()=>{
 for(const profile of [null,{currency_symbol:'£'},{currency_name:'GBP'},{currency_symbol:' £ ',currency_name:'GBP'},{currency_symbol:'£',currency_name:4}])assert.throws(()=>companyCurrency(profile));
});
test('Explicit company formatting preserves existing two decimals and en-IN numeric grouping',()=>{
 const gbp={currency_symbol:'£',currency_name:'GBP'};assert.equal(formatCompanyAmount(100000,gbp),'£1,000.00');assert.equal(formatCompanyAmount(123456789,gbp),'£12,34,567.89');assert.equal(formatRupees(123456789),'12,34,567.89');assert.equal(inputRupees(105),'1.05');
});
test('Alternating company descriptors never changes another label or a global formatter',()=>{
 const a=Object.freeze({currency_symbol:'£',currency_name:'GBP'}),b=Object.freeze({currency_symbol:'₹',currency_name:'INR'});assert.equal(formatCompanyAmount(100,a),'£1.00');assert.equal(formatCompanyAmount(100,b),'₹1.00');assert.equal(formatCompanyAmount(100,a),'£1.00');assert.equal(formatBalance(-105),'1.05 Cr');
});
test('The fixed Indian denomination set is available only for the exact default label pair',()=>{
 assert.equal(supportsCompanyDenominations({}),true);assert.equal(supportsCompanyDenominations(DEFAULT_COMPANY_CURRENCY),true);for(const labels of [{currency_symbol:'£',currency_name:'GBP'},{currency_symbol:'Rs.',currency_name:'INR'},{currency_symbol:'₹',currency_name:'Fictional unit'}])assert.equal(supportsCompanyDenominations(labels),false);
});
test('Parsing stays fixed100-scale with neutral limit errors and no currency-prefixed input',()=>{
 assert.equal(parseRupees('0.01'),1);assert.equal(parseRupees('1.05'),105);for(const value of ['£1.00','1.001','1,000.00'])assert.throws(()=>parseRupees(value));assert.throws(()=>parseRupees('1000000001.00'),error=>!/₹|INR/.test(error.message));
});
test('Numeric draft context encodes exactly the immutable saved labels as ASCII HTTP text',()=>{
 const original=Object.freeze({id:'fictional',currency_symbol:'₹',currency_name:'INR'}),encoded=encodeCompanyCurrencyContext(original);assert.match(encoded,/^[\x20-\x7e]+$/);assert.equal(encoded,encodeURIComponent(JSON.stringify({currency_symbol:'₹',currency_name:'INR'})));assert.deepEqual(JSON.parse(decodeURIComponent(encoded)),{currency_symbol:'₹',currency_name:'INR'});assert.notEqual(encoded,encodeCompanyCurrencyContext({currency_symbol:'£',currency_name:'GBP'}));assert.equal(original.currency_symbol,'₹');assert.throws(()=>encodeCompanyCurrencyContext({currency_symbol:'£'}));
});
test('A supported server binds only matching explicit profile and accounting-state labels',()=>{
 const profile=Object.freeze({currency_symbol:'£',currency_name:'GBP'}),state=Object.freeze({...profile});assert.equal(typeof currencyModel.confirmCompanyCurrency,'function');const result=currencyModel.confirmCompanyCurrency(profile,state,{company_currency_labels:true});assert.deepEqual(result,profile);assert.ok(Object.isFrozen(result));assert.deepEqual(currencyModel.confirmCompanyCurrency(DEFAULT_COMPANY_CURRENCY,DEFAULT_COMPANY_CURRENCY,{company_currency_labels:true}),DEFAULT_COMPANY_CURRENCY);
});
test('A supported server cannot omit either state label even when the known company is defaultINR',()=>{
 assert.equal(typeof currencyModel.confirmCompanyCurrency,'function');
 for(const state of [{},{currency_symbol:'₹'},{currency_name:'INR'}])assert.throws(()=>currencyModel.confirmCompanyCurrency(DEFAULT_COMPANY_CURRENCY,state,{company_currency_labels:true}),/currenc|labels|server|refresh/i);
});
test('Disagreeing or partial declared labels reject instead of silently publishing another currency',()=>{
 assert.equal(typeof currencyModel.confirmCompanyCurrency,'function');
 for(const [profile,state]of [[{currency_symbol:'£',currency_name:'GBP'},DEFAULT_COMPANY_CURRENCY],[{currency_symbol:'£'},{currency_symbol:'£',currency_name:'GBP'}]])assert.throws(()=>currencyModel.confirmCompanyCurrency(profile,state,{company_currency_labels:true}),/currenc|labels|server|refresh/i);
});
test('A known nondefault company requires a supported server even when its state labels match',()=>{
 assert.equal(typeof currencyModel.confirmCompanyCurrency,'function');
 for(const state of [{},{currency_symbol:'£',currency_name:'GBP'}])assert.throws(()=>currencyModel.confirmCompanyCurrency({currency_symbol:'£',currency_name:'GBP'},state,{}),/currenc|labels|server|refresh/i);
});
test('Genuine legacyINR remains compatible and inactive configured companies do not change its descriptor',()=>{
 const profile=Object.freeze({name:'Fictional active legacy'}),state=Object.freeze({loadedCompanies:[{currency_symbol:'£',currency_name:'GBP'}]});assert.deepEqual(currencyModel.confirmCompanyCurrency(profile,state,{}),DEFAULT_COMPANY_CURRENCY);assert.deepEqual(currencyModel.confirmCompanyCurrency(DEFAULT_COMPANY_CURRENCY,{},{}),DEFAULT_COMPANY_CURRENCY);assert.equal(Object.hasOwn(profile,'currency_symbol'),false);
});
