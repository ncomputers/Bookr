import {drawingsFixture} from './drawings-fixture.mjs';
export function openingFixture(book){
  const fixture=drawingsFixture(book);
  const drawings=book.saveLedger({kind:'capital',name:'Study Owner Drawings',alias:'SOD'});
  const withdrawal=book.saveVoucher({type:'payment',date:'2026-04-01',ledger_id:drawings.id,account_id:1,amount:20000,narration:'Fictional owner withdrawal'});
  return {...fixture,drawings,withdrawal};
}
