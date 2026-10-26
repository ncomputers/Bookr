import {capitalFixture} from './capital-fixture.mjs';
export function drawingsFixture(book){
  const fixture=capitalFixture(book);
  const capital=book.saveLedger({kind:'capital',name:'Study Owner Capital',alias:'SOC'});
  const funding=book.saveVoucher({type:'receipt',date:'2026-04-01',ledger_id:capital.id,account_id:1,amount:500000,narration:'Fictional owner funding'});
  return {...fixture,capital,funding};
}
