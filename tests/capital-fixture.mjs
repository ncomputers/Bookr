import {incomeFixture} from './income-fixture.mjs';
export function capitalFixture(book){
  const fixture=incomeFixture(book);
  const income=book.saveLedger({kind:'income',name:'Study Other Income',alias:'SOI'});
  const incomeReceipt=book.saveVoucher({type:'receipt',date:'2026-04-01',ledger_id:income.id,account_id:1,amount:12000,narration:'Fictional other income'});
  return {...fixture,income,incomeReceipt};
}
