// Report arithmetic is original Bookr code. All amounts are integer paise.
// The current chart has no stock, tax or year-end transfers. Cash/Bank/Capital
// opening masters affect closing position, separately from period movements.
export function financialReports(trial) {
  const group = (key,name,kinds,value,matcher=null) => {
    const ledgers=trial.rows.filter(row=>matcher?matcher(row):kinds.includes(row.kind)).map(row=>({id:row.id,name:row.name,amount:value(row)}));
    return {key,name,amount:ledgers.reduce((sum,row)=>sum+row.amount,0),ledgers};
  };
  const sales=group('sales','Sales Accounts',['sales'],row=>row.credit-row.debit,row=>row.kind==='sales'||row.group_name==='Sales Accounts');
  const directIncomes=group('direct-incomes','Direct Incomes',[],row=>row.credit-row.debit,row=>['Direct Incomes','Income (Direct)'].includes(row.group_name));
  const purchases=group('purchases','Purchase Accounts',['purchase'],row=>row.debit-row.credit,row=>row.kind==='purchase'||row.group_name==='Purchase Accounts');
  const directExpenses=group('direct-expenses','Direct Expenses',[],row=>row.debit-row.credit,row=>['Direct Expenses','Expenses (Direct)'].includes(row.group_name));
  const indirect=group('indirect-expenses','Indirect Expenses',['expense'],row=>row.debit-row.credit,row=>row.kind==='expense'||['Indirect Expenses','Expenses (Indirect)'].includes(row.group_name));
  const otherIncome=group('indirect-incomes','Indirect Incomes',['income'],row=>row.credit-row.debit,row=>row.kind==='income'||['Indirect Incomes','Income (Indirect)'].includes(row.group_name));

  const tradingIncome=sales.amount+directIncomes.amount;
  const tradingExpenses=purchases.amount+directExpenses.amount;
  const grossProfit=tradingIncome-tradingExpenses;
  const profit=grossProfit-indirect.amount+otherIncome.amount;

  const cash=group('cash','Cash-in-Hand',['cash'],row=>row.balance,row=>row.kind==='cash'||row.group_name==='Cash-in-Hand');
  const banks=group('banks','Bank Accounts',['bank'],row=>row.balance,row=>row.kind==='bank'||row.group_name==='Bank Accounts');
  const debtors=group('debtors','Sundry Debtors',['customer'],row=>row.balance,row=>row.kind==='customer'||row.group_name==='Sundry Debtors');
  const deposits=group('deposits-asset','Deposits (Asset)',[],row=>row.balance,row=>row.group_name==='Deposits (Asset)');
  const loansAdvances=group('loans-advances-asset','Loans & Advances (Asset)',[],row=>row.balance,row=>row.group_name==='Loans & Advances (Asset)');
  const stockInHand=group('stock-in-hand','Stock-in-Hand',[],row=>row.balance,row=>row.group_name==='Stock-in-Hand');

  const currentAssetGroups=[cash,banks,debtors];
  if(deposits.amount!==0)currentAssetGroups.push(deposits);
  if(loansAdvances.amount!==0)currentAssetGroups.push(loansAdvances);
  if(stockInHand.amount!==0)currentAssetGroups.push(stockInHand);

  const currentAssets={key:'current-assets',name:'Current Assets',amount:currentAssetGroups.reduce((s,g)=>s+g.amount,0),groups:currentAssetGroups};

  const fixedAssets=group('fixed-assets','Fixed Assets',[],row=>row.balance,row=>row.group_name==='Fixed Assets');
  const investments=group('investments','Investments',[],row=>row.balance,row=>row.group_name==='Investments');
  const miscExpenses=group('misc-expenses','Misc. Expenses (ASSET)',[],row=>row.balance,row=>row.group_name==='Misc. Expenses (ASSET)');

  const creditors=group('creditors','Sundry Creditors',['supplier'],row=>-row.balance,row=>row.kind==='supplier'||row.group_name==='Sundry Creditors');
  const dutiesTaxes=group('duties-taxes','Duties & Taxes',[],row=>-row.balance,row=>row.group_name==='Duties & Taxes');
  const provisions=group('provisions','Provisions',[],row=>-row.balance,row=>row.group_name==='Provisions');

  const currentLiabilityGroups=[creditors];
  if(dutiesTaxes.amount!==0)currentLiabilityGroups.push(dutiesTaxes);
  if(provisions.amount!==0)currentLiabilityGroups.push(provisions);

  const currentLiabilities={key:'current-liabilities',name:'Current Liabilities',amount:currentLiabilityGroups.reduce((s,g)=>s+g.amount,0),groups:currentLiabilityGroups};

  const capitalLedgers=group('capital','Capital Account',['capital'],row=>-row.balance,row=>(row.kind==='capital'||['Capital Account','Reserves & Surplus','Retained Earnings'].includes(row.group_name))&&row.name!=='Profit & Loss A/c');
  const loansLiability=group('loans-liability','Loans (Liability)',[],row=>-row.balance,row=>['Loans (Liability)','Secured Loans','Unsecured Loans','Bank OD A/c','Bank OCC A/c'].includes(row.group_name));
  const branchDivisions=group('branch-divisions','Branch / Divisions',[],row=>-row.balance,row=>row.group_name==='Branch / Divisions');
  const suspense=group('suspense','Suspense A/c',[],row=>-row.balance,row=>row.group_name==='Suspense A/c');

  const pnlLedger=trial.rows.find(row=>row.name==='Profit & Loss A/c');
  const pnlOpening=pnlLedger?-(pnlLedger.opening??0):0;
  const nominalKinds=['sales','purchase','expense','income'];
  const nominalGroups=['Sales Accounts','Purchase Accounts','Direct Expenses','Direct Incomes','Indirect Expenses','Indirect Incomes','Expenses (Direct)','Expenses (Indirect)','Income (Direct)','Income (Indirect)'];
  const accumulated=trial.rows.reduce((sum,row)=>sum+((nominalKinds.includes(row.kind)||nominalGroups.includes(row.group_name))?-row.balance:0),0);
  const closingProfit=accumulated+pnlOpening;
  const openingProfit=closingProfit-profit;

  const difference=trial.opening_balances?.difference ?? 0;
  const openingDifference={amount:Math.abs(difference),side:difference>0?'liabilities':'assets',signed:difference};

  const topLevel=[
    {entry:currentAssets,naturalSide:'assets',showZero:true},
    {entry:fixedAssets,naturalSide:'assets',showZero:false},
    {entry:investments,naturalSide:'assets',showZero:false},
    {entry:miscExpenses,naturalSide:'assets',showZero:false},
    {entry:capitalLedgers,naturalSide:'liabilities',showZero:false},
    {entry:loansLiability,naturalSide:'liabilities',showZero:false},
    {entry:currentLiabilities,naturalSide:'liabilities',showZero:true},
    {entry:branchDivisions,naturalSide:'liabilities',showZero:false},
    {entry:suspense,naturalSide:'liabilities',showZero:false}
  ];

  const presentation={assets:[],liabilities:[]};
  for(const {entry,naturalSide,showZero} of topLevel){
    if(entry.amount===0 && !showZero)continue;
    const side=entry.amount<0?(naturalSide==='assets'?'liabilities':'assets'):naturalSide;
    presentation[side].push({key:entry.key,amount:Math.abs(entry.amount)});
  }

  const assets=presentation.assets.reduce((sum,entry)=>sum+entry.amount,0)+Math.max(-closingProfit,0)+Math.max(-difference,0);
  const liabilities=presentation.liabilities.reduce((sum,entry)=>sum+entry.amount,0)+Math.max(closingProfit,0)+Math.max(difference,0);

  const balanceSheetGroups=[currentAssets,currentLiabilities,capitalLedgers];
  if(fixedAssets.amount!==0)balanceSheetGroups.push(fixedAssets);
  if(investments.amount!==0)balanceSheetGroups.push(investments);
  if(loansLiability.amount!==0)balanceSheetGroups.push(loansLiability);
  if(branchDivisions.amount!==0)balanceSheetGroups.push(branchDivisions);
  if(miscExpenses.amount!==0)balanceSheetGroups.push(miscExpenses);
  if(suspense.amount!==0)balanceSheetGroups.push(suspense);

  const plGroups=[purchases,sales,indirect,otherIncome];
  if(directExpenses.amount!==0)plGroups.push(directExpenses);
  if(directIncomes.amount!==0)plGroups.push(directIncomes);

  return {
    period:trial.period,
    profitAndLoss:{
      income:tradingIncome,expenses:tradingExpenses,indirectExpenses:indirect.amount,indirectIncome:otherIncome.amount,profit,netProfit:profit,grossProfit,groups:plGroups,
      tradingTotals:{debit:tradingExpenses+Math.max(grossProfit,0),credit:tradingIncome+Math.max(-grossProfit,0)},
      totals:{debit:indirect.amount+Math.max(-grossProfit,0)+Math.max(profit,0),credit:otherIncome.amount+Math.max(grossProfit,0)+Math.max(-profit,0)}
    },
    balanceSheet:{
      groups:balanceSheetGroups,presentation,openingDifference,profit:{
        opening:openingProfit,current:profit,closing:closingProfit
      },
      totals:{assets,liabilities,balanced:assets===liabilities && trial.totals.balanced}
    },
    trialBalanced:trial.totals.balanced
  };
}
