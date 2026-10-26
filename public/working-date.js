import {validCalendarDate} from './calendar-values.js';

const check=(condition,message)=>{if(!condition)throw new Error(message);};
const validRevision=value=>Number.isSafeInteger(value)&&value>=0;
function normalizePeriod(value){
  check(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===2&&Object.hasOwn(value,'from')&&Object.hasOwn(value,'to'),'Enter From and To dates for the current period.');
  check(validCalendarDate(value.from)&&validCalendarDate(value.to)&&value.from<=value.to,'Choose a valid ordered current period.');
  return Object.freeze({from:value.from,to:value.to});
}

// Browser-tab context is separate from company metadata and accounting rows.
export function createWorkingDateContext({companyId,booksFrom,period=null,storage}){
  check(companyId==='default'||typeof companyId==='string'&&/^[a-f0-9]{32}$/.test(companyId),'Choose a valid company.');
  check(validCalendarDate(booksFrom),'Enter a valid initial working date.');
  check(storage&&typeof storage.getItem==='function'&&typeof storage.setItem==='function','Working-date storage is unavailable.');
  let selectedPeriod=period===null?null:normalizePeriod(period);
  const supported=(date,range=selectedPeriod)=>validCalendarDate(date)&&(!range||date>=range.from&&date<=range.to);
  check(supported(booksFrom),'The initial working date must be within the current period.');
  const key='bookr.working-date.'+companyId;
  let value={date:booksFrom,revision:0};
  try{
    const saved=JSON.parse(storage.getItem(key));
    if(saved&&typeof saved==='object'&&!Array.isArray(saved)){
      const storedPeriod=Object.hasOwn(saved,'period')&&saved.period!==null?normalizePeriod(saved.period):selectedPeriod;
      if(supported(saved.date,storedPeriod)&&validRevision(saved.revision)){value={date:saved.date,revision:saved.revision};selectedPeriod=storedPeriod;}
    }
  }catch{}
  const current=()=>({...value});
  function persist(date,nextPeriod=selectedPeriod){
    check(value.revision<Number.MAX_SAFE_INTEGER,'Reopen the working-date context before changing it again.');
    const next={date,revision:value.revision+1};
    storage.setItem(key,JSON.stringify({...next,period:nextPeriod}));
    value=next;selectedPeriod=nextPeriod;return current();
  }
  return {current,period:()=>selectedPeriod?{...selectedPeriod}:null,accept(date){
    check(validCalendarDate(date),'Enter a valid working date.');
    check(supported(date),'Choose a date within the current period.');
    return persist(date);
  },acceptPeriod(input){
    const next=normalizePeriod(input),date=value.date<next.from?next.from:value.date>next.to?next.to:value.date;
    return persist(date,next);
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
