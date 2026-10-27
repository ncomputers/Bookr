import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseDraftValue} from '../public/text-choice-model.js';
import {applyCompanyProfile} from '../public/company-profile-binding.js';

test('Whole-form calling-code save retains the entered digit string rather than a partial suggestion',()=>{
 for(const [entered,value]of [['4','44'],['9','91'],['044','44'],['','91']])assert.equal(chooseDraftValue({entered,open:true,row:{value},wholeForm:true,preserveEnteredOnSave:true}),entered);
});
test('Explicit Enter or Tab chooses a real code; whole-form State preserves its raw text',()=>{
 assert.equal(chooseDraftValue({entered:'4',open:true,row:{value:'44'},preserveEnteredOnSave:true}),'44');
 assert.equal(chooseDraftValue({entered:'Raj',open:true,row:{value:'Rajasthan'},wholeForm:true}),'Raj');
 assert.equal(chooseDraftValue({entered:'',open:true,row:{value:'Not Applicable'},wholeForm:true}),'');
});
const metadata=Object.freeze({name:'Fictional Calling Code Target',mailing_name:'Fictional saved mailing',address:'Fictional address',state:'England',country:'UK',pincode:'',telephone:'Fictional telephone',mobile:'  0044 raw +91 (keep exactly)  ',fax:'',email:'fictional@example.invalid',website:''});
function fixture(code){
 const nodes=new Map(Object.keys(metadata).map(key=>['#company-'+key.replaceAll('_','-'),{value:metadata[key],disabled:true,readOnly:false,dispatchEvent(){}}]));
 const year=Object.freeze({value:'1-Apr-2025',readOnly:true}),books=Object.freeze({value:'1-May-2025',readOnly:true}),heading={textContent:'Fictional previously active company'},control={value:code,disabled:true,readOnly:true};
 nodes.set('#company-financial-year',year);nodes.set('#company-books-from',books);
 const form={dataset:{companyId:'old',companyRevision:'1'},querySelector(id){assert.ok(nodes.has(id),'Unexpected binder selector '+id);return nodes.get(id);}};
 return {form,heading,control,nodes,year,books};
}
test('Published calling code binds with saved identity without changing raw mobile, date controls or disabled state',()=>{
 const f=fixture(' 91 '),profile=Object.freeze({...metadata,id:'a'.repeat(32),revision:8,mobile_calling_code:'44',financial_year_from:'2025-04-01',books_from:'2025-05-01'});
 applyCompanyProfile({...f,profile,extraControls:[{key:'mobile_calling_code',control:f.control}]});
 assert.equal(f.control.value,'44');assert.equal(f.control.disabled,true);assert.equal(f.control.readOnly,true);assert.equal(f.nodes.get('#company-mobile').value,metadata.mobile);assert.equal(f.nodes.get('#company-financial-year'),f.year);assert.equal(f.nodes.get('#company-books-from'),f.books);assert.equal(f.heading.textContent,metadata.name);assert.deepEqual(f.form.dataset,{companyId:profile.id,companyRevision:'8'});
});
test('An explicitly unrecorded saved code clears the old display without deriving a code from Country',()=>{
 const f=fixture('91'),profile=Object.freeze({...metadata,id:'b'.repeat(32),revision:3,country:'India',mobile_calling_code:''});
 applyCompanyProfile({...f,profile,extraControls:[{key:'mobile_calling_code',control:f.control}]});assert.equal(f.control.value,'');assert.equal(f.nodes.get('#company-country').value,'India');assert.equal(f.nodes.get('#company-mobile').value,metadata.mobile);
});
test('A required extra saved field must be present before any displayed profile is rebound',()=>{
 const f=fixture('91'),profile=Object.freeze({...metadata,id:'c'.repeat(32),revision:9}),before={...f.form.dataset},heading=f.heading.textContent;
 assert.throws(()=>applyCompanyProfile({...f,profile,extraControls:[{key:'mobile_calling_code',control:f.control}]}),/saved|company|refresh|incomplete/i);
 assert.deepEqual(f.form.dataset,before);assert.equal(f.heading.textContent,heading);assert.equal(f.control.value,'91');assert.equal(f.nodes.get('#company-mobile').value,metadata.mobile);
});
