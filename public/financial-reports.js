import {entryDate,formatRupees,formatBalance} from './entry-values.js';
import {editReportPeriod} from './report-period.js';

export function createFinancialWorkspace({main,hint,api,setScreen,refreshBook,getBook,getView,renderGateway,openLedger,escapeHtml}) {
  let busy=false,context=null,entries=[],index=0;
  const periods=new Map();
  const views=['balance-sheet','profit-loss','financial-group'];
  const label=report=>report==='balance-sheet'?'Balance Sheet':'Profit & Loss A/c';
  const money=amount=>formatRupees(amount);
  const query=period=>period?'?'+new URLSearchParams(Object.entries(period).filter(([,value])=>value!==null)):'';
  function reportDates(){const book=getBook(),dates=book.vouchers.map(voucher=>voucher.date);if(book.ledgers.some(ledger=>ledger.opening_balance))dates.push(book.opening_balances?.date ?? '2026-04-01');return dates.sort();}
  async function run(action){if(busy)return;busy=true;try{await refreshBook();await action();}catch(error){hint.textContent=error.message;}finally{busy=false;}}
  function select(next=index,focus=false){
    if(!entries.length)return;index=(next+entries.length)%entries.length;
    main.querySelectorAll('[data-financial-row]').forEach((row,i)=>{row.classList.toggle('selected',i===index);if(i===index){row.scrollIntoView({block:'nearest'});if(focus)row.querySelector('button').focus({preventScroll:true});}});
  }
  function command(id,text,action){const button=document.createElement('button');button.id=id;button.type='button';button.textContent=text;button.onclick=action;document.querySelector('.command-strip').insertBefore(button,hint);}
  const open=(report,period=periods.get(report) ?? null,origin=null)=>run(()=>render({report,period,path:[],origin}));
  function activate(entry){
    const saved={...context,path:[...context.path]};
    if(entry.profit){open('profit-loss',{from:null,to:saved.period?.to ?? null},()=>run(()=>render(saved)));return;}
    if(entry.ledger){
      // Position reports drill through all movements up to their closing date.
      const period=saved.report==='balance-sheet'?{from:null,to:saved.period?.to ?? null}:saved.period;
      openLedger(entry.id,period,()=>run(()=>render(saved)));return;
    }
    run(()=>render({...saved,path:[...saved.path,entry.key]}));
  }
  function row(entry){
    const i=entries.push(entry)-1;
    const capitalBalance=context.report==='balance-sheet' && context.path.at(-1)==='capital' && entry.ledger;
    return `<tr data-financial-row="${i}"><td><button type="button" data-financial-key="${escapeHtml(entry.key ?? String(entry.id))}">${escapeHtml(entry.name)}</button></td><td class="amount">${capitalBalance?formatBalance(-entry.amount):money(entry.amount)}</td></tr>`;
  }
  function paneHeading(title,caption,first){return `<header class="financial-pane-heading"><strong>${escapeHtml(getBook().company)}</strong><div><h2>${escapeHtml(title)}</h2><span${first?' id="financial-period"':''}>${escapeHtml(caption)}</span></div></header>`;}
  function pane(title,items,result,total,id,caption,first){return `<section class="financial-side">${paneHeading(title,caption,first)}<table><tbody>${items.map(row).join('')}${result?`<tr class="financial-result opening-difference-row"><td>${escapeHtml(result.name)}</td><td class="amount" id="${result.id ?? 'financial-result'}">${money(result.amount)}</td></tr>`:''}</tbody></table><div class="financial-grand-total"><strong>Total</strong><strong id="${id}">${money(total)}</strong></div></section>`;}
  function profitPane(group,profit,left,report,caption){
    const positive=report.grossProfit>=0,amount=Math.abs(report.grossProfit),netPositive=profit>=0;
    const carried=(left===positive)?{name:positive?'Gross Profit c/o':'Gross Loss c/o',amount}:null;
    const brought=(left!==positive)?{name:positive?'Gross Profit b/f':'Gross Loss b/f',amount}:null;
    const net=(left===netPositive)?{name:netPositive?'Net Profit':'Net Loss',amount:Math.abs(profit)}:null;
    const indirect=report.groups[2],otherIncome=report.groups.find(group=>group.key==='indirect-incomes');
    const line=(value,result=false)=>value?`<tr class="financial-result ${result?'financial-net-result':''}"><td>${value.name}</td><td class="amount"${result && value.amount?' id="financial-result"':''}>${value.amount?money(value.amount):''}</td></tr>`:'';
    const carryLine=line(carried) || '<tr class="financial-result" aria-hidden="true"><td>&nbsp;</td><td></td></tr>';
    return `<section class="financial-side">${paneHeading('Particulars',caption,left)}<table><tbody>${row(group)}${carryLine}<tr class="financial-trading-total"><td></td><td class="amount" id="financial-trading-${left?'debit':'credit'}">${money(left?report.tradingTotals.debit:report.tradingTotals.credit)}</td></tr>${line(brought)}${left && indirect && indirect.amount!==0?row(indirect):''}${!left && otherIncome && otherIncome.amount!==0?row(otherIncome):''}${line(net,true)}</tbody></table><div class="financial-grand-total"><strong>Total</strong><strong id="financial-${left?'expenses':'income'}-total">${money(left?report.totals.debit:report.totals.credit)}</strong></div></section>`;
  }
  async function render(next){
    const data=await api('/api/financial-reports'+query(next.period));
    context=next;periods.set(next.report,next.period);entries=[];index=0;
    const bs=next.report==='balance-sheet',report=bs?data.balanceSheet:data.profitAndLoss;
    const dates=reportDates();
    const through=next.period?.to ?? dates.at(-1);
    const from=next.period?.from ?? dates[0];
    const caption=bs?`As at ${through?entryDate(through):'date of last entry'}`:
      from && from===through?`For ${entryDate(from)}`:
      `${from?entryDate(from):'Books beginning'} to ${through?entryDate(through):'date of last entry'}`;
    let group=null,groups=report.groups;
    for(const key of next.path){group=groups.find(g=>g.key===key);if(!group)throw new Error('Report group is unavailable. Return to the report.');groups=group.groups ?? [];}
    setScreen(group?group.name:label(next.report),group?'financial-group':next.report,'↑ ↓ Enter: drill down · F2: Period · Esc: back');
    let body;
    if(group){
      const items=group.groups ?? group.ledgers.map(ledger=>({...ledger,ledger:true}));
      body=`<div class="financial-group-table"><table><thead><tr><th>Particulars</th><th>${bs?'Closing Balance':'Period Amount'} ₹</th></tr></thead><tbody>${items.filter(item=>item.amount!==0).map(row).join('')}</tbody></table>${entries.length?'':'<p class="empty-report">No amounts in this group for the selected dates.</p>'}<div class="financial-grand-total"><strong>Total</strong><strong id="financial-group-total">${money(group.amount)}</strong></div></div>`;
    }else if(bs){
      const profit=report.profit.closing;
      const result={key:'profit',name:'Profit & Loss A/c',amount:Math.abs(profit),profit:true};
      const difference=report.openingDifference?.amount?{id:'financial-opening-difference',name:'Difference in opening balances',amount:report.openingDifference.amount}:null;
      const displayedGroups=side=>report.presentation?.[side]?.map(display=>({...report.groups.find(group=>group.key===display.key),amount:display.amount})) ?? (side==='liabilities'?[...report.groups.filter(group=>group.key==='capital' && group.amount!==0),report.groups[1]]:[report.groups[0]]);
      body='<div class="financial-columns">'+
        pane('Liabilities',[...displayedGroups('liabilities'),...(profit>0?[result]:[])],report.openingDifference?.side==='liabilities'?difference:null,report.totals.liabilities,'financial-liabilities',caption,true)+
        pane('Assets',[...displayedGroups('assets'),...(profit<0?[result]:[])],report.openingDifference?.side==='assets'?difference:null,report.totals.assets,'financial-assets',caption,false)+'</div>';
    }else{
      const profit=report.profit;
      body='<div class="financial-columns">'+profitPane(report.groups[0],profit,true,report,caption)+profitPane(report.groups[1],profit,false,report,caption)+'</div>';
    }
    main.innerHTML=`<section class="financial-report" data-report="${next.report}">${group?`<div class="financial-caption"><strong>${escapeHtml(getBook().company)}</strong><span id="financial-period">${escapeHtml(caption)}</span><span>${escapeHtml(label(next.report)+' / '+group.name)}</span></div>`:''}${body}</section>`;
    const preview=document.querySelector('.rail-preview');
    preview.innerHTML='Bookr<br><span>INR · Fictional accounts</span><span id="financial-status" role="status"></span>';
    const status=preview.querySelector('#financial-status');
    status.textContent=data.trialBalanced && (!bs || report.totals.balanced)?'Balanced':'Unbalanced postings — review Trial Balance';
    if(data.balanceSheet.openingDifference?.amount){status.classList.add('opening-report-warning');status.textContent='Difference in opening balances: '+money(data.balanceSheet.openingDifference.amount);}
    if(bs && !group && report.profit.closing!==0){
      const profitRow=main.querySelector('[data-financial-key="profit"]').closest('tr');
      let previous=profitRow;
      for(const [name,amount,key] of [['Opening Balance',report.profit.opening,'opening'],['Current Period',report.profit.current,'current']]){
        const detail=document.createElement('tr');detail.className='financial-profit-detail';
        const sign=report.profit.closing<0?-1:1;
        detail.innerHTML=`<td>${name}</td><td class="amount" id="financial-profit-${key}">${amount?money(amount*sign):''}</td>`;
        previous.after(detail);previous=detail;
      }
    }
    main.querySelectorAll('[data-financial-row]').forEach((el,i)=>{const button=el.querySelector('button');button.onclick=()=>activate(entries[i]);button.onfocus=()=>select(i);});
    command('financial-period-button','F2: Period',showPeriod);
    if(next.period)command('financial-all-dates','All dates',()=>run(()=>render({...context,period:null})));
    const dateKey=document.querySelector('.function-rail button');dateKey.disabled=false;dateKey.innerHTML='<span><u>F2</u>: Period</span><span>‹</span>';dateKey.onclick=showPeriod;
    select();main.focus();
  }
  function showPeriod(){
    if(busy || document.querySelector('dialog'))return;
    const dates=reportDates();
    const period={from:context.period?.from ?? dates[0] ?? '2026-04-01',to:context.period?.to ?? dates.at(-1) ?? '2026-04-01'};
    editReportPeriod({period,onDone:async next=>{busy=true;try{await refreshBook();await render({...context,period:next});}finally{busy=false;}}});
  }
  function goBack(){if(context.path.length)run(()=>render({...context,path:context.path.slice(0,-1)}));else if(context.origin)context.origin();else renderGateway(context.report==='balance-sheet'?9:10);}
  function onKey(event){
    if(!views.includes(getView()))return false;
    if(busy){event.preventDefault();return true;}
    if(event.altKey || event.ctrlKey || event.metaKey)return false;
    if(event.key==='F2'){event.preventDefault();showPeriod();return true;}
    if(['ArrowUp','ArrowDown','Enter'].includes(event.key)){event.preventDefault();if(event.key==='Enter'){if(entries.length)activate(entries[index]);}else select(index+(event.key==='ArrowDown'?1:-1),true);return true;}
    return false;
  }
  return {openBalanceSheet:()=>open('balance-sheet'),openProfitAndLoss:()=>open('profit-loss'),goBack,onKey,isSaving:()=>busy};
}
