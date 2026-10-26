import test from 'node:test';
import assert from 'node:assert/strict';
import {validCalendarDate,initialFinancialYearTo,previousCalendarDate,monthPeriods} from '../public/calendar-values.js';

test('Pure calendar values retain exact ISO dates across leap days and year boundaries',()=>{
 for(const value of ['2024-02-29','2025-07-01','0075-12-31','9999-12-31'])assert.equal(validCalendarDate(value),true,value);
 for(const value of [null,undefined,2025,{},'', '2025-02-29','2024-02-30','2025-4-01','1-Apr-2025',' 2025-04-01 '])assert.equal(validCalendarDate(value),false,String(value));
 assert.equal(previousCalendarDate('2024-03-01'),'2024-02-29');assert.equal(previousCalendarDate('2025-03-01'),'2025-02-28');assert.equal(previousCalendarDate('2026-01-01'),'2025-12-31');
 assert.equal(initialFinancialYearTo('2025-04-01'),'2026-03-31');assert.equal(initialFinancialYearTo('2024-01-01'),'2024-12-31');assert.equal(initialFinancialYearTo('2023-03-01'),'2024-02-29');assert.equal(initialFinancialYearTo('0075-04-01'),'0076-03-31');
});

test('Month periods cover exact clipped ranges including thirteen partial-month rows and four-digit early years',()=>{
 const fiscal=monthPeriods({from:'2025-04-01',to:'2026-03-31'});assert.equal(fiscal.length,12);assert.deepEqual(fiscal[0],{month:'2025-04',from:'2025-04-01',to:'2025-04-30'});assert.deepEqual(fiscal.at(-1),{month:'2026-03',from:'2026-03-01',to:'2026-03-31'});
 const partial=monthPeriods({from:'2025-07-15',to:'2026-07-14'});assert.equal(partial.length,13);assert.deepEqual(partial[0],{month:'2025-07',from:'2025-07-15',to:'2025-07-31'});assert.deepEqual(partial[1],{month:'2025-08',from:'2025-08-01',to:'2025-08-31'});assert.deepEqual(partial.at(-1),{month:'2026-07',from:'2026-07-01',to:'2026-07-14'});
 assert.deepEqual(monthPeriods({from:'2024-02-28',to:'2024-03-01'}),[{month:'2024-02',from:'2024-02-28',to:'2024-02-29'},{month:'2024-03',from:'2024-03-01',to:'2024-03-01'}]);
 assert.deepEqual(monthPeriods({from:'0075-12-31',to:'0076-01-01'}),[{month:'0075-12',from:'0075-12-31',to:'0075-12-31'},{month:'0076-01',from:'0076-01-01',to:'0076-01-01'}]);
 assert.deepEqual(monthPeriods({from:'9999-12-01',to:'9999-12-31'}),[{month:'9999-12',from:'9999-12-01',to:'9999-12-31'}]);
});

test('Invalid date calculations and unsupported end overflow reject rather than normalizing bad input',()=>{
 for(const value of ['2025-02-29','2026-04-31','',null]){assert.throws(()=>initialFinancialYearTo(value),RangeError);assert.throws(()=>previousCalendarDate(value),RangeError);}
 assert.throws(()=>initialFinancialYearTo('9999-04-01'),RangeError);assert.equal(initialFinancialYearTo('9999-01-01'),'9999-12-31');assert.throws(()=>previousCalendarDate('0000-01-01'),RangeError);
 for(const period of [null,[],{}, {from:'2025-04-02',to:'2025-04-01'},{from:'2025-02-29',to:'2025-03-01'},{from:'2025-04-01',to:'2025-04-31'}])assert.throws(()=>monthPeriods(period),RangeError);
});
