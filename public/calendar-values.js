// Pure date-only helpers shared by company setup and accounting/report context.
export function validCalendarDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const timestamp=Date.parse(value+'T12:00:00Z');
  return Number.isFinite(timestamp)&&new Date(timestamp).toISOString().slice(0,10)===value;
}
function dateValue(value){if(!validCalendarDate(value))throw new RangeError('Enter a valid ISO calendar date.');return new Date(value+'T12:00:00Z');}
function isoDate(date){const value=date.toISOString().slice(0,10);if(!validCalendarDate(value))throw new RangeError('The calendar exceeds the supported four-digit year range.');return value;}

export function initialFinancialYearTo(from){
  const date=dateValue(from);date.setUTCFullYear(date.getUTCFullYear()+1);date.setUTCDate(date.getUTCDate()-1);return isoDate(date);
}
export function previousCalendarDate(value){const date=dateValue(value);date.setUTCDate(date.getUTCDate()-1);return isoDate(date);}

export function monthPeriods(period){
  if(!period||typeof period!=='object'||Array.isArray(period)||!validCalendarDate(period.from)||!validCalendarDate(period.to)||period.from>period.to)throw new RangeError('Enter valid ordered calendar From and To dates.');
  const rows=[];let year=Number(period.from.slice(0,4)),month=Number(period.from.slice(5,7));
  while(true){
    const key=String(year).padStart(4,'0')+'-'+String(month).padStart(2,'0'),first=key+'-01',next=dateValue(first);next.setUTCMonth(next.getUTCMonth()+1);next.setUTCDate(next.getUTCDate()-1);const last=isoDate(next);
    rows.push({month:key,from:first<period.from?period.from:first,to:last>period.to?period.to:last});
    if(last>=period.to)break;
    if(month===12){year++;month=1;}else month++;
  }
  return rows;
}
