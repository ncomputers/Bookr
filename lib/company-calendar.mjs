import {BookError} from './errors.mjs';
import {validCalendarDate,initialFinancialYearTo} from '../public/calendar-values.js';

export const LEGACY_COMPANY_DATES=Object.freeze({financial_year_from:'2026-04-01',books_from:'2026-04-01',financial_year_to:'2027-03-31'});
const check=(condition,message)=>{if(!condition)throw new BookError(message);};

export function normalizeCompanyCalendar(input={}){
  check(input&&typeof input==='object'&&!Array.isArray(input),'Enter company calendar dates.');
  check(Object.keys(input).every(key=>Object.hasOwn(LEGACY_COMPANY_DATES,key)),'Choose only company financial-year and books dates.');
  const financial_year_from=input.financial_year_from===undefined?LEGACY_COMPANY_DATES.financial_year_from:input.financial_year_from;
  check(validCalendarDate(financial_year_from),'Enter a valid financial-year beginning date.');
  let financial_year_to;try{financial_year_to=initialFinancialYearTo(financial_year_from);}catch(error){throw new BookError(error.message);}
  const books_from=input.books_from===undefined?financial_year_from:input.books_from;
  check(validCalendarDate(books_from),'Enter a valid books-beginning date.');
  check(books_from>=financial_year_from&&books_from<=financial_year_to,'Choose a books-beginning date within the initial financial year.');
  check(input.financial_year_to===undefined||input.financial_year_to===financial_year_to,'The financial-year end must match the derived twelve-month period.');
  // This is the initial creation window, not a permanent posting-year limit.
  return {financial_year_from,books_from,financial_year_to};
}
