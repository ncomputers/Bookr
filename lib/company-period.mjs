import {BookError} from './errors.mjs';
import {validCalendarDate} from '../public/calendar-values.js';

export function normalizeCurrentPeriod(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==2||!Object.hasOwn(value,'from')||!Object.hasOwn(value,'to'))throw new BookError('Enter current-period From and To dates.');
  if(!validCalendarDate(value.from)||!validCalendarDate(value.to)||value.from>value.to)throw new BookError('Enter valid ordered current-period dates.');
  return Object.freeze({from:value.from,to:value.to});
}

export function currentPeriodHeader(value){
  if(value===undefined)return null;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}$/.test(value))throw new BookError('Send one current period as ISO From/To dates.');
  return normalizeCurrentPeriod({from:value.slice(0,10),to:value.slice(11)});
}
