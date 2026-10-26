import {journalFixture} from './journal-fixture.mjs';
export function incomeFixture(book){
  const f=journalFixture(book);
  const journal=book.saveVoucher({type:'journal',date:'2026-04-01',debit_ledger_id:f.expense.id,credit_ledger_id:f.supplier.id,debit_amount:12500,credit_amount:12500,bill:{reference:'JRN-001'}});
  const payment=book.saveVoucher({type:'payment',date:'2026-04-01',supplier_id:f.supplier.id,account_id:1,amount:5000,allocations:[{bill_id:journal.bill.id,amount:5000}]});
  return {...f,journal,payment};
}
