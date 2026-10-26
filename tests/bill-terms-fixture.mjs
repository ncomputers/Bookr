export function billTermsFixture(book){
  const customer=book.saveCustomer({name:'Fictional Credit Term Buyer',alias:'CTB',opening_balance:200000,opening_bills:[{reference:'OLD-TERM-C1',date:'2026-03-01',amount:200000,terms:{mode:'days',days:30}}]});
  const supplier=book.saveSupplier({name:'Fictional Credit Term Supplier',alias:'CTS',opening_balance:-120000,opening_bills:[{reference:'OLD-TERM-S1',date:'2026-03-15',amount:120000,terms:{mode:'date',date:'2026-04-15'}}]});
  const capital=book.saveLedger({kind:'capital',name:'Fictional Credit Term Capital',opening_balance:-80000});
  const expense=book.saveLedger({kind:'expense',name:'Fictional Credit Term Expense',alias:'CTE'});
  return {customer,supplier,capital,expense};
}
