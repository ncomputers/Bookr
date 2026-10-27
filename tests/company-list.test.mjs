import test from 'node:test';
import assert from 'node:assert/strict';
import {companyList,companyName} from '../public/company-list.js';

const catalog=()=>[
  {id:'z',name:'Zulu fictional company'},
  {id:'b',name:'Bravo fictional company'},
  {id:'a',name:'Alpha fictional company'}
];
const ids=result=>result.rows.map(row=>row.id);

test('change, shut and edit project only loaded companies; select exposes the catalog',()=>{
  for(const mode of ['change','shut','edit'])assert.deepEqual(ids(companyList({companies:catalog(),loadedIds:['z','a','missing'],mode})),['a','z']);
  assert.deepEqual(ids(companyList({companies:catalog(),loadedIds:['z'],mode:'select'})),['a','b','z']);
});
test('search is trimmed and case insensitive with empty results unselected',()=>{
  assert.deepEqual(ids(companyList({companies:catalog(),loadedIds:['z','a'],mode:'edit',query:'  ALPHA  '})),['a']);
  assert.deepEqual(companyList({companies:catalog(),loadedIds:['z'],mode:'edit',query:'missing'}),{rows:[],index:-1,selectedId:null});
});
test('preferred company ID retains focus after a new name changes sorting',()=>{
  const before=companyList({companies:catalog(),loadedIds:['z','a'],mode:'edit',preferredId:'z'});
  assert.equal(before.index,1);assert.equal(before.selectedId,'z');
  const after=companyList({companies:catalog().map(row=>row.id==='z'?{...row,name:'Aardvark renamed fictional company'}:row),loadedIds:['z','a'],mode:'edit',preferredId:'z'});
  assert.equal(after.index,0);assert.equal(after.selectedId,'z');
});
test('a hidden or missing preferred target falls back to first visible result',()=>{
  for(const preferredId of ['b','missing',null])assert.equal(companyList({companies:catalog(),loadedIds:['z','a'],mode:'edit',preferredId}).selectedId,'a');
  assert.equal(companyList({companies:catalog(),loadedIds:['z','a'],mode:'edit',preferredId:'z',query:'alpha'}).selectedId,'a');
});
test('updated target name is looked up by ID for return-search prefill',()=>{
  const companies=catalog();assert.equal(companyName(companies,'z'),'Zulu fictional company');
  companies[0]={...companies[0],name:'Renamed fictional company'};
  assert.equal(companyName(companies,'z'),'Renamed fictional company');assert.equal(companyName(companies,'missing'),'');
});
test('empty loaded set never inherits a catalog target in a loaded mode',()=>{
  assert.deepEqual(companyList({companies:catalog(),loadedIds:[],mode:'edit',preferredId:'a'}),{rows:[],index:-1,selectedId:null});
});
test('projection does not sort or mutate catalog rows, loaded IDs or frozen arguments',()=>{
  const companies=Object.freeze(catalog().map(Object.freeze)),loadedIds=Object.freeze(['z','a']);
  const input=Object.freeze({companies,loadedIds,mode:'edit',query:'fictional',preferredId:'z'}),before=JSON.stringify(input);
  assert.deepEqual(ids(companyList(input)),['a','z']);assert.equal(JSON.stringify(input),before);
  assert.notEqual(companyList(input).rows,companies);
});
