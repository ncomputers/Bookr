import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('screen evidence rejects an invalid capture contract before any image or record is emitted',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'bookr-screen-evidence-unit-'));
 try{
  const {captureVerifiedScreen,ScreenEvidenceError}=await import('./screen-evidence.mjs');
  await assert.rejects(captureVerifiedScreen({page:{},outputDir:directory,id:'invalid-contract',expected:null,readState:async()=>({})}),error=>error instanceof ScreenEvidenceError&&error.code==='INVALID_CONTRACT');
  assert.deepEqual(await readdir(directory),[]);
 }finally{assert.ok(directory.startsWith(join(tmpdir(),'bookr-screen-evidence-unit-')));await rm(directory,{recursive:true,force:true});}
});

for(const [name,patch] of [
 ['path traversal in the immutable evidence id',{id:'../escape'}],
 ['unsupported field read mode',{expected:{fields:[{selector:'#receipt-amount',read:'html',equals:'400.00'}]}}],
 ['attribute read without an attribute name',{expected:{fields:[{selector:'#receipt-form',read:'attribute',equals:'receipt'}]}}],
 ['prototype traversal through an API assertion path',{expected:{api:[{path:'vouchers.__proto__',equals:[]} ]}}],
 ['caller supplied native verification status',{reference:{status:'verified-context',id:'receipt-1-400'}}]
])test('screen evidence rejects '+name+' before touching the browser',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'bookr-screen-evidence-contract-'));
 try{
  const {captureVerifiedScreen,ScreenEvidenceError}=await import('./screen-evidence.mjs');
  const expected={view:'receipt',root:'#receipt-form',context:{amount:40000},fields:[{selector:'#receipt-amount',read:'value',equals:'400.00'}],api:[{path:'vouchers',where:{id:1},equals:{type:'receipt',amount:40000}}],...patch.expected};
  const code=patch.reference?'REFERENCE_MISMATCH':'INVALID_CONTRACT';
  await assert.rejects(captureVerifiedScreen({page:{},outputDir:directory,id:'invalid-contract',readState:async()=>({}),reference:null,...patch,expected}),error=>error instanceof ScreenEvidenceError&&error.code===code);assert.deepEqual(await readdir(directory),[]);
 }finally{assert.ok(directory.startsWith(join(tmpdir(),'bookr-screen-evidence-contract-')));await rm(directory,{recursive:true,force:true});}
});
