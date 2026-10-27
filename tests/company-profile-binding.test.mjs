import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCompanyProfile} from '../public/company-profile-binding.js';

const metadata=Object.freeze({name:'Fictional Saved <Company>',mailing_name:'Fictional mailing',address:'First line\nSecond line',state:'Fictional Region',country:'India',pincode:'000001',telephone:'000-0000000',mobile:'0000000000',fax:'000',email:'fictional@example.invalid',website:'https://example.invalid'});
const saved=Object.freeze({...metadata,id:'a'.repeat(32),revision:4,financial_year_from:'2025-04-01',books_from:'2025-07-01',financial_year_to:'2026-03-31'});
function fixture(){
 const events=[],fields=new Map(Object.keys(metadata).map((key,index)=>['#company-'+key.replaceAll('_','-'),{value:'  Draft '+key+'  ',disabled:index%2===0,readOnly:false,dispatchEvent(event){events.push({key,event:event.type,country:fields.get('#company-country').value,id:form.dataset.companyId});}}]));
 for(const[id,value]of [['#company-financial-year','1-Apr-2025'],['#company-books-from','1-Jul-2025']])fields.set(id,{get value(){return value;},set value(_){throw new Error('Published metadata must not rewrite formatted dates.');},readOnly:true,disabled:true});
 const submit=()=>{},form={dataset:{companyId:'old',companyRevision:'1'},onsubmit:submit,querySelector(selector){assert.ok(fields.has(selector),'Unexpected form selector '+selector);return fields.get(selector);}},heading={textContent:'Previously active company',set innerHTML(_){throw new Error('Heading must be assigned as text.');}};
 return {form,heading,fields,events,submit};
}
test('published fields show canonical response values rather than padded draft values',()=>{
 const f=fixture();applyCompanyProfile({...f,profile:saved});
 for(const[key,value]of Object.entries(metadata))assert.equal(f.fields.get('#company-'+key.replaceAll('_','-')).value,value);
 assert.equal(f.heading.textContent,'Fictional Saved <Company>');
});
test('target identity and revision are bound to the saved result independently of prior heading',()=>{
 const f=fixture();applyCompanyProfile({...f,profile:saved});
 assert.deepEqual(f.form.dataset,{companyId:saved.id,companyRevision:'4'});
 applyCompanyProfile({...f,profile:{...saved,id:'b'.repeat(32),revision:5,name:'Fictional second result'}});
 assert.deepEqual(f.form.dataset,{companyId:'b'.repeat(32),companyRevision:'5'});assert.equal(f.heading.textContent,'Fictional second result');
});
test('metadata refresh preserves every existing disabled/read-only control and submit controller',()=>{
 const f=fixture(),nodes=new Map(f.fields),flags=[...f.fields].map(([id,node])=>[id,node.disabled,node.readOnly]);
 applyCompanyProfile({...f,profile:saved});
 assert.deepEqual([...f.fields].map(([id,node])=>[id,node.disabled,node.readOnly]),flags);
 for(const[id,node]of nodes)assert.equal(f.fields.get(id),node);
 assert.equal(f.form.onsubmit,f.submit);
});
test('formatted calendar values are untouched when response contains ISO date properties',()=>{
 const f=fixture();applyCompanyProfile({...f,profile:saved});
 assert.equal(f.fields.get('#company-financial-year').value,'1-Apr-2025');assert.equal(f.fields.get('#company-books-from').value,'1-Jul-2025');
});
test('calling-code refresh is notified once after saved country and target identity are installed',()=>{
 const f=fixture();applyCompanyProfile({...f,profile:{...saved,country:'Fictional Country'}});
 assert.deepEqual(f.events,[{key:'country',event:'input',country:'Fictional Country',id:saved.id}]);
});
test('binding does not mutate frozen saved profile or process future settings as form fields',()=>{
 const f=fixture(),profile=Object.freeze({...saved,future_setting:Object.freeze({enabled:true})}),before=JSON.stringify(profile);
 applyCompanyProfile({...f,profile});assert.equal(JSON.stringify(profile),before);
});
