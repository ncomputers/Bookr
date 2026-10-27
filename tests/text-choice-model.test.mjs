import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTextChoices,moveHighlight,chooseDraftValue,nextCompanyAddressField} from '../public/text-choice-model.js';

const values=Object.freeze(['Not Applicable','Rajasthan','Tripura','Uttarakhand','Uttar Pradesh','West Bengal']);
const choices=input=>buildTextChoices({values,alwaysVisible:['Not Applicable'],...input});
const labels=result=>result.rows.map(row=>row.value);

test('initial suggestions retain observed order and select saved value',()=>{
 const result=choices({opening:'Uttar Pradesh'});
 assert.deepEqual(labels(result),values);assert.equal(result.index,4);
});
test('query keeps pinned fallback and highlights a substantive match',()=>{
 const result=choices({opening:'Not Applicable',query:'  rAj  ',entered:'  rAj  '});
 assert.deepEqual(labels(result),['Not Applicable','Rajasthan']);assert.equal(result.index,1);
});
test('cleared search restores all choices and fallback highlight',()=>{
 const result=choices({opening:'Rajasthan',query:'',entered:''});
 assert.deepEqual(labels(result),values);assert.equal(result.index,0);
});
test('unknown saved text remains selectable without becoming a catalog entry',()=>{
 const result=choices({opening:'Fictional Region'});
 assert.deepEqual(labels(result),['Not Applicable','Fictional Region',...values.slice(1)]);
 assert.equal(result.rows[result.index].value,'Fictional Region');
 assert.equal(result.rows[result.index].typed,false);
 assert.deepEqual(labels(choices({opening:'Rajasthan'})),values);
});
test('unmatched input offers entered text with original whitespace intact',()=>{
 const result=choices({opening:'Rajasthan',query:'  Fictional New Region  ',entered:'  Fictional New Region  '});
 assert.deepEqual(labels(result),['Not Applicable','  Fictional New Region  ']);
 assert.equal(result.index,1);assert.equal(result.rows[1].typed,true);
});
test('matching saved unknown text can be explicitly selected',()=>{
 const result=choices({opening:'Fictional Region',query:'fictional',entered:'fictional'});
 assert.deepEqual(labels(result),['Not Applicable','Fictional Region']);assert.equal(result.index,1);
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
