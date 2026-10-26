// Report arithmetic is original Bookr code. All amounts are integer paise.
// The current chart has no stock, tax or year-end transfers. Cash/Bank/Capital
// opening masters affect closing position, separately from period movements.
export function financialReports(trial) {
  const group = (key,name,kinds,value) => {
    const ledgers=trial.rows.filter(row=>kinds.includes(row.kind)).map(row=>({id:row.id,name:row.name,amount:value(row)}));
    return {key,name,amount:ledgers.reduce((sum,row)=>sum+row.amount,0),ledgers};
  };
  const sales=group('sales','Sales Accounts',['sales'],row=>row.credit-row.debit);
  const purchases=group('purchases','Purchase Accounts',['purchase'],row=>row.debit-row.credit);
  const indirect=group('indirect-expenses','Indirect Expenses',['expense'],row=>row.debit-row.credit);
  const otherIncome=group('indirect-incomes','Indirect Incomes',['income'],row=>row.credit-row.debit);
  const grossProfit=sales.amount-purchases.amount,profit=grossProfit-indirect.amount+otherIncome.amount;
  const cash=group('cash','Cash-in-Hand',['cash'],row=>row.balance);
  const banks=group('banks','Bank Accounts',['bank'],row=>row.balance);
  const debtors=group('debtors','Sundry Debtors',['customer'],row=>row.balance);
  const creditors=group('creditors','Sundry Creditors',['supplier'],row=>-row.balance);
  const capital=group('capital','Capital Account',['capital'],row=>-row.balance);
  const accumulated=trial.rows.reduce((sum,row)=>sum+(['sales','purchase','expense','income'].includes(row.kind)?-row.balance:0),0);
  const currentAssets={key:'current-assets',name:'Current Assets',amount:cash.amount+banks.amount+debtors.amount,groups:[cash,banks,debtors]};
  const currentLiabilities={key:'current-liabilities',name:'Current Liabilities',amount:creditors.amount,groups:[creditors]};
  const difference=trial.opening_balances?.difference ?? 0;
  const openingDifference={amount:Math.abs(difference),side:difference>0?'liabilities':'assets',signed:difference};
  // Presentation moves a negative top-level group to the opposite side. Its
  // signed source amount and ledger grouping stay intact for drill-down.
  const presentation={assets:[],liabilities:[]};
  for(const [entry,naturalSide,showZero] of [[currentAssets,'assets',true],[capital,'liabilities',false],[currentLiabilities,'liabilities',true]]){
    if(entry.amount===0 && !showZero)continue;
    const side=entry.amount<0?(naturalSide==='assets'?'liabilities':'assets'):naturalSide;
    presentation[side].push({key:entry.key,amount:Math.abs(entry.amount)});
  }
  const assets=presentation.assets.reduce((sum,entry)=>sum+entry.amount,0)+Math.max(-accumulated,0)+Math.max(-difference,0);
  const liabilities=presentation.liabilities.reduce((sum,entry)=>sum+entry.amount,0)+Math.max(accumulated,0)+Math.max(difference,0);
  return {
    period:trial.period,
    profitAndLoss:{income:sales.amount,expenses:purchases.amount,indirectExpenses:indirect.amount,indirectIncome:otherIncome.amount,profit,netProfit:profit,grossProfit,groups:[purchases,sales,indirect,otherIncome],
      tradingTotals:{debit:purchases.amount+Math.max(grossProfit,0),credit:sales.amount+Math.max(-grossProfit,0)},
      totals:{debit:indirect.amount+Math.max(-grossProfit,0)+Math.max(profit,0),credit:otherIncome.amount+Math.max(grossProfit,0)+Math.max(-profit,0)}},
    balanceSheet:{groups:[currentAssets,currentLiabilities,capital],presentation,openingDifference,profit:{
      opening:accumulated-profit,current:profit,closing:accumulated},
      totals:{assets,liabilities,balanced:assets===liabilities && trial.totals.balanced}},
    trialBalanced:trial.totals.balanced
  };
}
