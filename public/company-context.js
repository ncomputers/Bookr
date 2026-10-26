import {entryDate} from './entry-values.js';
import {initialFinancialYearTo} from './calendar-values.js';

export function companyCalendar(book){
  if(book?.calendar)return book.calendar;
  const beginning=book?.opening_balances?.date;
  if(!beginning)throw new Error('Company calendar is unavailable. Reopen the company.');
  return {financial_year_from:beginning,books_from:beginning,financial_year_to:initialFinancialYearTo(beginning)};
}
export const workingDateContext=book=>book?.working_context??{date:companyCalendar(book).books_from,revision:0};
export const initialEntryDate=book=>workingDateContext(book).date;
export const shortCompanyDate=value=>entryDate(value).slice(0,-4)+value.slice(2,4);
export function companyDateCaption(book){
  const date=initialEntryDate(book),weekday=new Intl.DateTimeFormat('en-GB',{weekday:'long',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
  return weekday+', '+entryDate(date);
}
