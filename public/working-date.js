import {validCalendarDate} from './calendar-values.js';

const check=(condition,message)=>{if(!condition)throw new Error(message);};
const validRevision=value=>Number.isSafeInteger(value)&&value>=0;

// Browser-tab context is separate from company metadata and accounting rows.
export function createWorkingDateContext({companyId,booksFrom,period=null,storage}){
  check(companyId==='default'||typeof companyId==='string'&&/^[a-f0-9]{32}$/.test(companyId),'Choose a valid company.');
  check(validCalendarDate(booksFrom),'Enter a valid initial working date.');
  check(storage&&typeof storage.getItem==='function'&&typeof storage.setItem==='function','Working-date storage is unavailable.');
  if(period)check(validCalendarDate(period.from)&&validCalendarDate(period.to)&&period.from<=period.to,'Choose a valid current period.');
  const supported=date=>validCalendarDate(date)&&(!period||date>=period.from&&date<=period.to);
  check(supported(booksFrom),'The initial working date must be within the current period.');
  const key='bookr.working-date.'+companyId;
  let value={date:booksFrom,revision:0};
  try{
    const saved=JSON.parse(storage.getItem(key));
    if(saved&&typeof saved==='object'&&!Array.isArray(saved)&&supported(saved.date)&&validRevision(saved.revision))value={date:saved.date,revision:saved.revision};
  }catch{}
  const current=()=>({...value});
  return {current,accept(date){
    check(validCalendarDate(date),'Enter a valid working date.');
    check(supported(date),'Choose a date within the current period.');
    check(value.revision<Number.MAX_SAFE_INTEGER,'Reopen the working-date context before changing it again.');
    const next={date,revision:value.revision+1};
    storage.setItem(key,JSON.stringify(next));
    value=next;return current();
  }};
}

// Saved vouchers never consume a pending working-date change or replace the
// next-new-voucher date. Child drafts remain owned by their entry controller.
export function createEntryDateState(getContext){
  let revision=null,workingDate=null,newDate=null;
  function synchronize(){
    const context=getContext();
    check(context&&validCalendarDate(context.date)&&validRevision(context.revision),'Reopen the company working-date context.');
    if(context.revision!==revision||context.date!==workingDate){revision=context.revision;workingDate=context.date;newDate=context.date;}
  }
  return {forRender({savedDate}={}){
    if(savedDate!==undefined){check(validCalendarDate(savedDate),'Enter a valid saved voucher date.');return savedDate;}
    synchronize();return newDate;
  },rememberNew(date){check(validCalendarDate(date),'Enter a valid new voucher date.');synchronize();newDate=date;}};
}

export function followingWorkingDate(date){
  check(validCalendarDate(date),'Enter a valid working date.');
  const next=new Date(date+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+1);
  const result=next.toISOString().slice(0,10);
  check(validCalendarDate(result),'The next date exceeds the supported calendar.');return result;
}
