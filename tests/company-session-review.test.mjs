import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompanySession,commitStorageWrites} from '../public/company-session.js';

const A='a'.repeat(32),B='b'.repeat(32),C='c'.repeat(32),SESSION='bookr.company-session',LEGACY='bookr.company',key=id=>'bookr.working-date.'+id;
const encoded=(loadedIds,activeId)=>JSON.stringify({version:1,loadedIds,activeId});
const fresh={date:'2025-07-01',revision:2,period:{from:'2025-04-01',to:'2026-03-31'}};
function memory(seed={}){
 const values=new Map(Object.entries(seed)),writes=[];let writeCount=0,readCount=0,writeFailure=null,readFailure=null,mutateFirst=false;
 const mutate=(kind,name,value)=>{writeCount++;writes.push({kind,name,value});if(writeCount===writeFailure&&!mutateFirst)throw Error('Fictional write denied');if(kind==='set')values.set(name,value);else values.delete(name);if(writeCount===writeFailure)throw Error('Fictional write failed after mutation');};
 return {getItem(name){readCount++;if(readCount===readFailure)throw Error('Fictional snapshot read denied');return values.get(name)??null;},setItem:(name,value)=>mutate('set',name,value),removeItem:name=>mutate('remove',name),writes,armWrite(at,{afterMutation=false}={}){writeCount=0;writeFailure=at;mutateFirst=afterMutation;},armRead(at){readCount=0;readFailure=at;},snapshot:()=>[...values].sort(([a],[b])=>a.localeCompare(b))};
}
const make=(storage,catalogIds=['default',A,B])=>createCompanySession({storage,catalogIds});

test('Canonical explicit-none defeats a stale selected-ID bridge and only explicit disk selection loads the requested company',()=>{
 const storage=memory({[SESSION]:encoded([],null),[LEGACY]:A,[key(B)]:'retained B context'}),value=make(storage),before=storage.snapshot();
 assert.deepEqual(value.read(),{loadedIds:[],activeId:null});assert.deepEqual(value.choose(),[]);assert.deepEqual(value.choose({includeUnloaded:true}),['default',A,B]);assert.deepEqual(storage.snapshot(),before);
 assert.deepEqual(value.select(B,{freshContext:fresh}),{loadedIds:[B],activeId:B,freshLoad:true});assert.equal(storage.getItem(LEGACY),B);assert.equal(storage.getItem(key(B)),JSON.stringify(fresh));assert.equal(storage.getItem(key(A)),null);assert.deepEqual(value.read(),{loadedIds:[B],activeId:B});
});

test('Corrupt canonical state can recover through explicit fresh selection without trusting a conflicting legacy selection',()=>{
 const storage=memory({[SESSION]:'{bad-json',[LEGACY]:A,[key(A)]:'unchanged A'}),value=make(storage),before=storage.snapshot();
 assert.deepEqual(value.read(),{loadedIds:[],activeId:null});assert.deepEqual(storage.snapshot(),before);
 value.select(B,{freshContext:Object.freeze({...fresh,period:Object.freeze({...fresh.period})})});assert.deepEqual(value.read(),{loadedIds:[B],activeId:B});assert.equal(storage.getItem(key(A)),'unchanged A');assert.equal(storage.getItem(key(B)),JSON.stringify(fresh));
});

test('Catalog refresh cannot retain removed companies or silently select default, and newly discovered companies remain unloaded',()=>{
 const storage=memory({[SESSION]:encoded([A,B],A),[LEGACY]:A}),before=storage.snapshot(),removed=make(storage,['default',B,C]);
 assert.deepEqual(removed.read(),{loadedIds:[],activeId:null});assert.deepEqual(removed.choose(),[]);assert.deepEqual(removed.choose({includeUnloaded:true}),['default',B,C]);assert.deepEqual(storage.snapshot(),before);assert.throws(()=>removed.select(A));
 removed.select(B,{freshContext:fresh});const catalog=['default',B,C],refreshed=make(storage,catalog);catalog.reverse();catalog.push(A);assert.deepEqual(refreshed.read(),{loadedIds:[B],activeId:B});assert.deepEqual(refreshed.choose({includeUnloaded:true}),['default',B,C]);assert.throws(()=>refreshed.select(A));
});

test('A stale legacy bridge cannot override canonical active state; failed bridge repair leaves canonical selection intact',()=>{
 const storage=memory({[SESSION]:encoded([A,B],A),[LEGACY]:B,[key(A)]:'A context'}),value=make(storage),before=storage.snapshot();assert.equal(value.read().activeId,A);storage.armWrite(1);assert.throws(()=>value.select(A));assert.deepEqual(storage.snapshot(),before);assert.equal(value.read().activeId,A);
 assert.deepEqual(value.select(A),{loadedIds:[A,B],activeId:A,freshLoad:false});assert.equal(storage.getItem(LEGACY),A);assert.equal(storage.getItem(key(A)),'A context');
});

test('All storage snapshots are read before mutation, including mixed removals, and a read failure leaves exact original bytes',()=>{
 for(const failure of [1,2,3]){const storage=memory({one:'',two:'null',three:'original'}),before=storage.snapshot();storage.armRead(failure);assert.throws(()=>commitStorageWrites(storage,[{key:'one',value:'new-one'},{key:'two',value:null},{key:'three',value:'new-three'}]),/snapshot read denied/);assert.deepEqual(storage.snapshot(),before);assert.equal(storage.writes.length,0);}
});

test('Mixed remove, create, empty-string and literal-null writes restore exact bytes even if a setter mutates before throwing',()=>{
 for(const afterMutation of [false,true])for(const failure of [1,2,3,4]){const storage=memory({empty:'',literal:'null',remove:'old'}),before=storage.snapshot();storage.armWrite(failure,{afterMutation});assert.throws(()=>commitStorageWrites(storage,[{key:'remove',value:null},{key:'new',value:'created'},{key:'empty',value:'now-filled'},{key:'literal',value:''}]),/rolled back/);assert.deepEqual(storage.snapshot(),before);}
});

for(const failure of [1,2,3])test('Fresh select failure '+failure+' from explicit-none cannot resurrect default or leave a new context',()=>{
 const storage=memory({[SESSION]:encoded([],null),[LEGACY]:'null',[key(A)]:'retained closed A'}),value=make(storage),before=storage.snapshot();storage.armWrite(failure);assert.throws(()=>value.select(B,{freshContext:fresh}));assert.deepEqual(storage.snapshot(),before);assert.deepEqual(value.read(),{loadedIds:[],activeId:null});assert.equal(storage.getItem(key(B)),null);assert.equal(storage.getItem(key(A)),'retained closed A');
});

test('Failed nonactive Shut preserves active and all contexts; successful Shut never writes the unchanged legacy bridge',()=>{
 const storage=memory({[SESSION]:encoded([A,B],A),[LEGACY]:A,[key(A)]:'A period',[key(B)]:'B period'}),value=make(storage),before=storage.snapshot();storage.armWrite(1);assert.throws(()=>value.shut(B));assert.deepEqual(storage.snapshot(),before);const mark=storage.writes.length;assert.deepEqual(value.shut(B),{loadedIds:[A],activeId:A});assert.deepEqual(storage.writes.slice(mark).map(row=>row.name),[SESSION]);assert.equal(storage.getItem(key(A)),'A period');assert.equal(storage.getItem(key(B)),'B period');
});

test('Prototypal fresh contexts cannot inject storage keys and a null-prototype typed value is copied as plain JSON',()=>{
 const storage=memory(),value=make(storage),before=storage.snapshot(),inherited=Object.create(fresh);inherited.key=SESSION;assert.throws(()=>value.select(A,{freshContext:inherited}));assert.deepEqual(storage.snapshot(),before);assert.equal(storage.writes.length,0);
 const typed=Object.assign(Object.create(null),fresh,{period:Object.assign(Object.create(null),fresh.period)});value.select(A,{freshContext:typed});assert.deepEqual(JSON.parse(storage.getItem(key(A))),fresh);assert.deepEqual(Object.keys(typed),['date','revision','period']);
});
