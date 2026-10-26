export function journalFixture(book){
  const customer=book.createCustomer({name:'Demo Customer'}),supplier=book.saveSupplier({name:'Study Supplier Fictional'}),expense=book.saveLedger({kind:'expense',name:'Study Office Expense'}),bank=book.saveBank({name:'Study Bank Fictional'});
  const first=book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:100000}),second=book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:250075,bill:{reference:'STUDY-BILL-02'}});
  book.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1,amount:40000,allocations:[{bill_id:first.bill.id,amount:40000}]});
  book.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1,amount:82525,allocations:[{bill_id:second.bill.id,amount:62525},{bill_id:first.bill.id,amount:20000}]});
  const purchase=book.saveVoucher({type:'purchase',date:'2026-04-01',supplier_id:supplier.id,account_id:book.ledgers().find(l=>l.kind==='purchase').id,amount:150000,bill:{reference:'sup-001'}});
  book.saveVoucher({type:'payment',date:'2026-04-01',supplier_id:supplier.id,account_id:1,amount:60000,allocations:[{bill_id:purchase.bill.id,amount:60000}]});
  const metadata=(type,amount,number)=>({account_id:bank.id,transaction_type:type==='receipt'?'Cheque/DD':'Cheque',amount,instrument_number:number,instrument_date:'2026-04-01',bank_name:'Not Applicable',cheque_range:type==='receipt'?'':'Not Applicable'});
  book.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:bank.id,amount:30000,allocations:[{bill_id:first.bill.id,amount:30000}],details:{bank:metadata('receipt',30000,'000101')}});
  book.saveVoucher({type:'payment',date:'2026-04-01',supplier_id:supplier.id,account_id:bank.id,amount:10000,allocations:[{bill_id:purchase.bill.id,amount:10000}],details:{bank:metadata('payment',10000,'000201')}});
  book.saveVoucher({type:'contra',date:'2026-04-01',source_id:1,destination_id:bank.id,amount:5000,details:{bank:{...metadata('receipt',5000,''),transaction_type:'Cash',denominations:{counts:{'50':1},others:0}}}});
  book.saveVoucher({type:'contra',date:'2026-04-01',source_id:bank.id,destination_id:1,amount:2000,details:{bank:metadata('payment',2000,'000301')}});
  book.saveVoucher({type:'payment',date:'2026-04-01',ledger_id:expense.id,account_id:1,amount:7500});
  return {customer,supplier,expense,bank,purchase};
}
