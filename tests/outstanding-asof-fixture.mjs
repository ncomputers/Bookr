// Saved fictional dates deliberately separate invoices from later settlements.
export function outstandingAsOfFixture(book){
  const customer=book.saveLedger({kind:'customer',name:'Fictional Date Cutoff Customer',opening_balance:200000,opening_bills:[{reference:'OLD-CUTOFF-C',date:'2026-03-31',amount:200000}]}),supplier=book.saveLedger({kind:'supplier',name:'Fictional Date Cutoff Supplier',opening_balance:-120000,opening_bills:[{reference:'OLD-CUTOFF-S',date:'2026-03-31',amount:120000}]});
  book.saveLedger({kind:'capital',name:'Fictional Date Cutoff Capital',opening_balance:-80000});
  const expense=book.saveLedger({kind:'expense',name:'Fictional Date Cutoff Expense'}),purchaseAccount=book.ledgers().find(row=>row.kind==='purchase');
  const sale=book.saveVoucher({type:'sale',date:'2026-04-10',customer_id:customer.id,account_id:2,amount:100000,bill:{reference:'CUTOFF-SALE'}});
  const receipt=book.saveVoucher({type:'receipt',date:'2026-04-20',customer_id:customer.id,account_id:1,amount:40000,allocations:[{bill_id:sale.bill.id,amount:40000}]});
  const finalReceipt=book.saveVoucher({type:'receipt',date:'2026-05-10',customer_id:customer.id,account_id:1,amount:60000,allocations:[{bill_id:sale.bill.id,amount:60000}]});
  book.saveVoucher({type:'receipt',date:'2026-05-01',customer_id:customer.id,account_id:1,amount:50000,allocations:[{opening_bill_id:customer.opening_bills[0].id,amount:50000}]});
  const purchase=book.saveVoucher({type:'purchase',date:'2026-04-05',supplier_id:supplier.id,account_id:purchaseAccount.id,amount:50000,bill:{reference:'CUTOFF-PURCHASE'}});
  const journal=book.saveVoucher({type:'journal',date:'2026-04-08',debit_ledger_id:expense.id,credit_ledger_id:supplier.id,debit_amount:12500,credit_amount:12500,bill:{reference:'CUTOFF-JOURNAL'}});
  const payment=book.saveVoucher({type:'payment',date:'2026-04-22',supplier_id:supplier.id,account_id:1,amount:40000,allocations:[{opening_bill_id:supplier.opening_bills[0].id,amount:30000},{bill_id:purchase.bill.id,amount:10000}]});
  book.saveVoucher({type:'payment',date:'2026-04-25',supplier_id:supplier.id,account_id:1,amount:5000,allocations:[{bill_id:journal.bill.id,amount:5000}]});
  book.saveVoucher({type:'payment',date:'2026-05-15',supplier_id:supplier.id,account_id:1,amount:30000,allocations:[{bill_id:purchase.bill.id,amount:30000}]});
  book.saveVoucher({type:'payment',date:'2026-05-20',supplier_id:supplier.id,account_id:1,amount:7500,allocations:[{bill_id:journal.bill.id,amount:7500}]});
  return {customer,supplier,expense,sale,receipt,finalReceipt,purchase,journal,payment};
}
