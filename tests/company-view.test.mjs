import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultCompanyView,readCompanyView,writeCompanyView,describeCompanyCurrency,companyFeatureStatus} from '../public/company-view-model.js';

function storage(){const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),values};}
test('display defaults show contacts and hide fixed currency description',()=>{
 assert.deepEqual(defaultCompanyView,{show_contacts:true,show_currency_details:false});assert.ok(Object.isFrozen(defaultCompanyView));
 assert.deepEqual(readCompanyView(storage(),'default'),defaultCompanyView);
});
test('browser preferences belong to the edited target, independently of active/default/create views',()=>{
 const local=storage();writeCompanyView(local,'target-c',{show_contacts:false,show_currency_details:true});
 assert.deepEqual(readCompanyView(local,'target-c'),{show_contacts:false,show_currency_details:true});
 for(const id of ['default','target-b','creation'])assert.deepEqual(readCompanyView(local,id),defaultCompanyView);
 assert.deepEqual(readCompanyView(local,'target-c'),{show_contacts:false,show_currency_details:true});
});
test('view storage serializes only two booleans, without company or accounting metadata',()=>{
 const local=storage(),input=Object.freeze({show_contacts:false,show_currency_details:true,name:'Never stored',mobile_calling_code:'44',revision:7});writeCompanyView(local,'target-c',input);
 const saved=JSON.parse([...local.values.values()][0]);assert.deepEqual(saved,{version:1,show_contacts:false,show_currency_details:true});assert.equal(input.name,'Never stored');
});
test('invalid saved presentation values fall back to honest defaults',()=>{
 const local=storage();writeCompanyView(local,'default',{show_contacts:true,show_currency_details:false});const key=[...local.values.keys()][0];
 for(const bad of ['invalid-json',JSON.stringify({version:2,show_contacts:false,show_currency_details:true}),JSON.stringify({version:1,show_contacts:'No',show_currency_details:0})]){local.values.set(key,bad);assert.deepEqual(readCompanyView(local,'default'),defaultCompanyView);}
});
test('fixed currency description reflects Bookr formatter and current draft labels, without configurable native rules',()=>{
 const result=describeCompanyCurrency({currency_symbol:'£',currency_name:'GBP'});
 assert.deepEqual(result,{symbol:'£',name:'GBP',decimals:2,grouping:'en-IN',position:'Before amount',spacing:'No space',example:'£12,34,567.89'});
 assert.equal(describeCompanyCurrency({currency_symbol:'US$',currency_name:'Fictional Dollars'}).example,'US$12,34,567.89');assert.equal(Object.hasOwn(result,'amount_in_words'),false);assert.equal(Object.hasOwn(result,'millions'),false);
});
test('features distinguish existing accounting from unavailable engines without writable flags',()=>{
 const rows=companyFeatureStatus();assert.ok(rows.some(row=>row.key==='accounts'&&row.status==='available'));assert.ok(rows.some(row=>row.key==='bill_tracking'&&row.status==='available'));
 for(const key of ['inventory','tax','payroll','cost_centres','interest','remote','security'])assert.ok(rows.some(row=>row.key===key&&row.status==='unavailable'),key);
 assert.ok(rows.every(row=>!Object.hasOwn(row,'enabled')&&!Object.hasOwn(row,'checked')));assert.notEqual(rows,companyFeatureStatus());
});
