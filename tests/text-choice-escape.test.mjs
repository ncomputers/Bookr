import test from 'node:test';
import assert from 'node:assert/strict';
import {escapeTextChoice} from '../public/text-choice-model.js';

test('Escape in an open nonempty suggestion input clears only the search',()=>{
 for(const entered of ['Maha','Guj','Maharashtra','  '])assert.equal(escapeTextChoice({open:true,entered}),'clear');
});

test('Escape in an open empty suggestion input closes and delegates exit without restoration',()=>{
 assert.equal(escapeTextChoice({open:true,entered:''}),'close-and-back');
});

test('Escape with a closed list belongs to the existing company controller',()=>{
 for(const entered of ['','Rajasthan'])assert.equal(escapeTextChoice({open:false,entered}),'delegate');
});
