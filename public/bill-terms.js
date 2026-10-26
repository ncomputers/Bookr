import {entryDate,parseEntryDate,validIsoDate} from './entry-values.js';

// Per-reference terms only. Blank is unspecified; zero days is explicit.
export function termText(terms){return !terms?'':terms.mode==='days'?`${terms.days} Days`:entryDate(terms.date);}
export function termDueDate(terms,origin){
  if(!terms)return null;
  if(!validIsoDate(origin))throw new Error('Enter a valid bill date before setting credit terms.');
  if(terms.mode==='date'){
    if(terms.date<origin)throw new Error('The due date must be on or after the bill date.');
    return terms.date;
  }
  const date=new Date(origin+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+terms.days);
  const result=date.toISOString().slice(0,10);
  if(!validIsoDate(result))throw new Error('The resulting due date is outside the supported calendar.');
  return result;
}
export function parseTerm(text,origin){
  const raw=text.trim();if(!raw)return null;
  const days=raw.match(/^(\d+)(?:\s*days?)?$/i);
  let terms;
  if(days){const value=Number(days[1]);if(!Number.isInteger(value)||value>3650)throw new Error('Enter credit days from 0 to 3650.');terms={mode:'days',days:value};}
  else {let date;try{date=parseEntryDate(raw);}catch{throw new Error('Enter 0 to 3650 credit days or a valid due date.');}terms={mode:'date',date};}
  termDueDate(terms,origin);return terms;
}
export const dueDateText=date=>date?entryDate(date):'\u2014';
export function termPreview(text,origin){try{return dueDateText(termDueDate(parseTerm(text,origin),origin));}catch{return 'Invalid terms';}}
