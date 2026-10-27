import test from 'node:test';
import assert from 'node:assert/strict';
import {createActivityTracker} from '../public/workspace-activity.js';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
test('activity spans the entire asynchronous task and preserves its result',async()=>{
 const events=[],tracker=createActivityTracker(count=>events.push(count)),gate=deferred();
 assert.equal(tracker.pending(),0);assert.deepEqual(events,[0]);
 const result=tracker.run(async()=>{await gate.promise;assert.equal(tracker.pending(),1);return 42;});
 assert.equal(tracker.pending(),1);gate.resolve();assert.equal(await result,42);assert.equal(tracker.pending(),0);assert.deepEqual(events,[0,1,0]);
});
test('overlapping tasks stay active through out-of-order completion',async()=>{
 const events=[],tracker=createActivityTracker(count=>events.push(count)),first=deferred(),second=deferred();
 const a=tracker.run(()=>first.promise),b=tracker.run(()=>second.promise);
 assert.equal(tracker.pending(),2);second.resolve('second');assert.equal(await b,'second');assert.equal(tracker.pending(),1);
 first.resolve('first');assert.equal(await a,'first');assert.equal(tracker.pending(),0);assert.deepEqual(events,[0,1,2,1,0]);
});
test('rejections restore availability without ending another task',async()=>{
 const tracker=createActivityTracker(),gate=deferred(),failure=new Error('Fictional failed request');
 const held=tracker.run(()=>gate.promise),failed=tracker.run(()=>Promise.reject(failure));
 await assert.rejects(failed,error=>error===failure);assert.equal(tracker.pending(),1);gate.resolve();await held;assert.equal(tracker.pending(),0);
});
test('synchronous throws also release activity and preserve the original error',async()=>{
 const events=[],tracker=createActivityTracker(count=>events.push(count)),failure=new Error('Fictional setup failure');
 await assert.rejects(tracker.run(()=>{throw failure;}),error=>error===failure);assert.equal(tracker.pending(),0);assert.deepEqual(events,[0,1,0]);
});
