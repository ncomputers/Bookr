import test from 'node:test';
import assert from 'node:assert/strict';
import {filterCatalogRows} from '../public/text-choice-model.js';
import {companyLocationPolicy,compactCountrySuggestions,beginCountrySelection,searchCountrySelection,escapeCountrySelection,acceptCountrySelection,locationMetadata} from '../public/company-location-model.js';

const start=()=>beginCountrySelection({state:'England',country:'UK'});
test('country policy labels India State and both unchanged UK aliases Region',()=>{
 assert.equal(companyLocationPolicy('India').label,'State');
 for(const country of ['UK','United Kingdom','  uK  '])assert.deepEqual(companyLocationPolicy(country),{label:'Region',suggestions:['Not Applicable','England','Northern Ireland','Scotland','Wales']});
 assert.ok(companyLocationPolicy('India').suggestions.includes('Rajasthan'));
 assert.deepEqual(companyLocationPolicy('Fictional Country'),{label:'State',suggestions:['Not Applicable']});
});
test('compact country catalog is precisely the observed bounded suggestion list',()=>{
 assert.deepEqual(compactCountrySuggestions,['Not Applicable','Bangladesh','Bhutan','Botswana','Egypt','Ghana','Hong Kong','India','Indonesia','Kenya','Kingdom of Bahrain','Kuwait','Liberia','Malawi','Malaysia','Myanmar (Burma)','Nepal','Nigeria','Philippines','Qatar','Saudi Arabia','Singapore','South Africa','Sri Lanka','Sultanate of Oman','Tanzania','Thailand','UAE','Uganda','UK','United States of America','Zambia']);
 assert.equal(new Set(compactCountrySuggestions).size,32);assert.ok(Object.isFrozen(compactCountrySuggestions));
});
test('nested opening blanks region while retaining accepted country and separate blank search',()=>{
 const profile=Object.freeze({state:'England',country:'UK'}),draft=beginCountrySelection(profile);
 assert.deepEqual(draft,{mode:'country',state:'',country:'UK',query:''});assert.deepEqual(profile,{state:'England',country:'UK'});
});
test('nonempty country Escape clears only query and leaves nested choice open',()=>{
 const query=searchCountrySelection(start(),'UK'),next=escapeCountrySelection(query);
 assert.deepEqual(query,{mode:'country',state:'',country:'UK',query:'UK'});assert.deepEqual(next,start());
});
test('empty country Escape returns blank Region without company-exit or old value restoration',()=>{
 assert.deepEqual(escapeCountrySelection(start()),{mode:'region',state:'',country:'UK',query:''});
});
test('explicit UK country choice returns blank Region and query never becomes metadata',()=>{
 const draft=searchCountrySelection(start(),'U'),accepted=acceptCountrySelection(draft,'UK');
 assert.deepEqual(locationMetadata(accepted),{state:'',country:'UK'});assert.equal(accepted.mode,'region');assert.equal(accepted.query,'');assert.equal(draft.query,'U');
});
test('whole-form save refuses pending Country query instead of serializing either geographic field',()=>{
 for(const query of ['','UK','Fictional Search'])assert.throws(()=>locationMetadata(searchCountrySelection(start(),query)),/choose.*country|back/i);
});
test('unknown and alias strings remain exact direct metadata without synthetic Country options',()=>{
 for(const country of ['United Kingdom','Fictional Republic','  Fictional Republic  ']){
  const draft={mode:'region',state:'Fictional district',country,query:''};
  assert.deepEqual(locationMetadata(draft),{state:'Fictional district',country});
  assert.deepEqual(filterCatalogRows(compactCountrySuggestions,'Fictional'),[]);
  assert.throws(()=>acceptCountrySelection(searchCountrySelection(start(),country),country),/catalog|matching country/i);
 }
});
