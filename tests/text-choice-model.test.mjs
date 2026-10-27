import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../public/text-choice-model.js';
const {buildTextChoices,moveHighlight,chooseDraftValue,nextCompanyAddressField}=model;

const values=Object.freeze(['Not Applicable','Rajasthan','Tripura','Uttarakhand','Uttar Pradesh','West Bengal']);
const choices=input=>buildTextChoices({values,alwaysVisible:['Not Applicable'],...input});
const labels=result=>result.rows.map(row=>row.value);

test('initial suggestions retain observed order and select saved value',()=>{
 const result=choices({opening:'Uttar Pradesh'});
 assert.deepEqual(labels(result),values);assert.equal(result.index,4);
});
test('query shows only matching catalog entries, excluding unmatched fallback',()=>{
 const result=choices({opening:'Not Applicable',query:'  rAj  ',entered:'  rAj  '});
 assert.deepEqual(labels(result),['Rajasthan']);assert.equal(result.index,0);
});
test('cleared search restores all choices and fallback highlight',()=>{
 const result=choices({opening:'Rajasthan',query:'',entered:''});
 assert.deepEqual(labels(result),values);assert.equal(result.index,0);
});
test('unknown saved text does not become a selectable catalog entry',()=>{
 const result=choices({opening:'Fictional Region'});
 assert.deepEqual(labels(result),values);
 assert.equal(result.rows[result.index].value,'Not Applicable');
 assert.equal(result.rows[result.index].typed,false);
 assert.deepEqual(labels(choices({opening:'Rajasthan'})),values);
});
test('unmatched input has no options or highlight',()=>{
 const result=choices({opening:'Rajasthan',query:'  Fictional New Region  ',entered:'  Fictional New Region  '});
 assert.deepEqual(result,{rows:[],index:-1});
});
test('query matching only unknown saved text still has no options',()=>{
 const result=choices({opening:'Fictional Region',query:'fictional',entered:'fictional'});
 assert.deepEqual(result,{rows:[],index:-1});
});
test('catalog choices do not duplicate a saved known value',()=>{
 assert.equal(choices({opening:'Rajasthan'}).rows.filter(row=>row.value==='Rajasthan').length,1);
});
test('an empty catalog and absent opening value has no highlighted option',()=>{
 assert.deepEqual(buildTextChoices({values:[],opening:''}),{rows:[],index:-1});
});
test('projection does not mutate frozen caller data or previous results',()=>{
 const input=Object.freeze({values,alwaysVisible:Object.freeze(['Not Applicable']),opening:'Fictional Region',query:null});
 const before=JSON.stringify(input),first=buildTextChoices(input),second=buildTextChoices(input);
 assert.equal(JSON.stringify(input),before);assert.notEqual(first.rows,second.rows);assert.notEqual(first.rows[0],second.rows[0]);
});
test('highlight movement clamps at either list boundary',()=>{
 assert.equal(moveHighlight({index:0,delta:-1,count:37}),0);
 assert.equal(moveHighlight({index:36,delta:1,count:37}),36);
 assert.equal(moveHighlight({index:5,delta:1,count:37}),6);
 assert.equal(moveHighlight({index:5,delta:-1,count:37}),4);
});
test('empty lists have no highlight even when arrow movement is requested',()=>{
 assert.equal(moveHighlight({index:-1,delta:1,count:0}),-1);
});
test('explicit acceptance chooses selected text rather than the search',()=>{
 assert.equal(chooseDraftValue({entered:'Raj',open:true,row:{value:'Rajasthan'}}),'Rajasthan');
});
test('whole-form acceptance preserves optional blank text; explicit acceptance can choose fallback',()=>{
 assert.equal(chooseDraftValue({entered:'  ',open:true,row:{value:'Not Applicable'},wholeForm:true}),'  ');
 assert.equal(chooseDraftValue({entered:'',open:true,row:{value:'Not Applicable'}}),'Not Applicable');
});
test('whole-form save preserves raw unknown prefixes without accepting another catalog row',()=>{
 for(const entered of ['Raj legacy','  Fictional Region  ','4'])assert.equal(chooseDraftValue({entered,open:true,row:{value:'Rajasthan'},wholeForm:true}),entered);
});
test('only genuine matching fallback values can appear in filtered results',()=>{
 assert.deepEqual(labels(choices({query:'applicable'})),['Not Applicable']);
 assert.deepEqual(labels(choices({query:'zzzz',alwaysVisible:['Invented']})),[]);
});
test('shared catalog filtering preserves original objects and catalog order',()=>{
 assert.equal(typeof model.filterCatalogRows,'function');
 const rows=Object.freeze([Object.freeze({name:'Current Assets'}),Object.freeze({name:'Sundry Debtors'}),Object.freeze({name:'Current Liabilities'})]);
 const result=model.filterCatalogRows(rows,'  CURRENT  ',row=>row.name);
 assert.deepEqual(result,[rows[0],rows[2]]);assert.equal(result[0],rows[0]);
 assert.deepEqual(model.filterCatalogRows(rows,'unmatched',row=>row.name),[]);
 assert.deepEqual(model.filterCatalogRows(rows,'',row=>row.name),rows);
});
test('closed or unselected suggestions retain existing free text',()=>{
 assert.equal(chooseDraftValue({entered:'Raj',open:false,row:{value:'Rajasthan'}}),'Raj');
 assert.equal(chooseDraftValue({entered:'Fictional Region',open:true,row:null}),'Fictional Region');
});
test('accepted substantive state and country advance to Pincode',()=>{
 assert.equal(nextCompanyAddressField({state:' Rajasthan ',country:' India '}),'pincode');
});
test('Not Applicable and empty state advance to Country',()=>{
 for(const state of ['','  ','Not Applicable',' not applicable '])assert.equal(nextCompanyAddressField({state,country:'India'}),'country');
});
test('an unset country advances to Country even with a substantive state',()=>{
 for(const country of ['','  ','Not Applicable',' not applicable '])assert.equal(nextCompanyAddressField({state:'Fictional Region',country}),'country');
});
