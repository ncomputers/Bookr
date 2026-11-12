import {entryDate,formatRupees,formatBalance} from './entry-values.js';
import {editReportPeriod,editReportDate} from './report-period.js';
import {monthlyMarkup} from './monthly-summary.js';
import {dueDateText} from './bill-terms.js';
import {companyPeriod,initialEntryDate} from './company-context.js';

export function createReports({main,hint,api,setScreen,getBook,refreshBook,escapeHtml,getView,renderGateway,openVoucher,openOpeningMaster}) {
  let ledgerId=null,rows=[],index=0,busy=false;
  let outstandingDirection='receivable',trialPeriod=null,showZero=false,statementOrigin='selector';
  let outstandingAsOf=null;
  let monthlyContext=null;
  const typeLabel=type=>({sale:'Sales',receipt:'Receipt',purchase:'Purchase',payment:'Payment',contra:'Contra',journal:'Journal',credit_note:'Credit Note',debit_note:'Debit Note'}[type]);
  const periods=new Map();
  const outstandingDates=new Map();
  const balance=value=>`${formatRupees(Math.abs(value))} ${value<0?'Cr':'Dr'}`;
  function button(id,label,action){const b=document.createElement('button');b.type='button';b.id=id;b.textContent=label;b.addEventListener('click',action);document.querySelector('.command-strip').insertBefore(b,hint);}
  function highlight(step=0){if(!rows.length)return;index=(index+step+rows.length)%rows.length;main.querySelectorAll('[data-report-row]').forEach((r,i)=>{r.classList.toggle('selected',i===index);if(i===index)r.scrollIntoView({block:'nearest'});});}
  async function run(action){if(busy)return;busy=true;try{await refreshBook();await action();}catch(failure){hint.textContent=failure.message;}finally{busy=false;}}
  const chooseLedger=()=>run(()=>{statementOrigin='selector';renderSelector();});
  function renderSelector(){
    setScreen('Select Ledger','report-selector','Choose a ledger · ↑ ↓ Enter · Esc: Gateway');
    main.innerHTML=`<section class="ledger-selector"><label for="report-ledger-search">Name of Ledger</label><input id="report-ledger-search" autocomplete="off"><div class="selection-heading">List of Ledger Accounts</div><div id="report-ledger-options" role="listbox" aria-label="Ledger accounts"></div></section>`;
    const search=main.querySelector('input');
    function filter(){index=0;rows=getBook().ledgers.filter(l=>`${l.name} ${l.alias}`.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()));main.querySelector('#report-ledger-options').innerHTML=rows.map((l,i)=>`<button type="button" role="option" data-report-row="${i}">${escapeHtml(l.name)}</button>`).join('') || '<p class="no-ledgers">No ledgers found.</p>';main.querySelectorAll('[data-report-row]').forEach((b,i)=>b.addEventListener('click',()=>openStatement(rows[i].id)));highlight();}
    search.addEventListener('input',filter);filter();search.focus();
  }
  async function renderStatement(id,period=periods.get(id) ?? null){
    const query=period?'&'+new URLSearchParams(Object.entries(period).filter(([,value])=>value!==null)):'';
    const statement=await api(`/api/statement?ledger=${id}${query}`);ledgerId=id;rows=statement.rows;index=0;periods.set(id,period);
    setScreen('Ledger Vouchers','statement','↑ ↓ Enter: reopen voucher · F6: monthly · Esc: back');
    main.innerHTML=`<section class="day-book ledger-statement"><div class="report-ledger-name">Ledger: &nbsp;<strong>${escapeHtml(statement.ledger.name)}</strong><span>All saved vouchers</span></div><div class="report-table-scroll"><table class="voucher-report"><colgroup><col class="date-col"><col><col class="type-col"><col class="number-col"><col class="money-col"><col class="money-col"></colgroup><thead><tr><th>Date</th><th>Particulars</th><th>Vch Type</th><th>Vch No.</th><th>Debit</th><th>Credit</th></tr></thead><tbody>${rows.map((r,i)=>`<tr data-report-row="${i}"><td>${entryDate(r.date)}</td><td><button type="button" data-report-voucher="${r.id}">${escapeHtml(r.particulars)}</button></td><td>${typeLabel(r.type)}</td><td>${r.number}</td><td class="amount">${r.side==='debit'?formatRupees(r.amount):''}</td><td class="amount">${r.side==='credit'?formatRupees(r.amount):''}</td></tr>`).join('')}</tbody></table></div>${rows.length?'':'<p class="empty-report">No vouchers in this ledger.</p>'}<div class="ledger-report-totals"><div><span>Opening Balance :</span><b>0.00 Dr</b><b></b></div><div><span>Current Total :</span><b>${formatRupees(rows.filter(r=>r.side==='debit').reduce((s,r)=>s+r.amount,0))}</b><b>${formatRupees(rows.filter(r=>r.side==='credit').reduce((s,r)=>s+r.amount,0))}</b></div><div class="closing"><strong>Closing Balance :</strong><strong id="statement-closing">${balance(statement.balance)}</strong><b></b></div></div></section>`;
    main.querySelectorAll('[data-report-voucher]').forEach((b,i)=>{b.addEventListener('click',()=>reopen(rows[i].id));b.addEventListener('focus',()=>{index=i;highlight();});});
    main.querySelector('.report-ledger-name>span').textContent=period?(period.from && period.from===period.to?`For ${entryDate(period.from)}`:`${period.from?entryDate(period.from):'Books beginning'} to ${period.to?entryDate(period.to):'last entry'}`):'All saved vouchers';
    const opening=main.querySelector('.ledger-report-totals>div:first-child');
    opening.querySelector('b').id='statement-opening';opening.querySelector('b').textContent=balance(statement.opening);
    if(!rows.length)main.querySelector('.empty-report').textContent='No vouchers in this period.';
    button('statement-period','F2: Period',showPeriod);
    button('statement-monthly','F6: Monthly',openMonthly);
    const monthlyKey=document.createElement('button');monthlyKey.dataset.salesRail='true';monthlyKey.innerHTML='<span><u>F6</u>: Monthly</span>';monthlyKey.onclick=openMonthly;document.querySelector('.function-rail .rail-space').before(monthlyKey);
    if(['customer','supplier'].includes(statement.ledger.kind))button('statement-outstanding','F5: Outstanding',()=>openOutstanding(ledgerId));
    if(period)button('statement-all-dates','All dates',()=>run(()=>renderStatement(ledgerId,null)));
    const dateKey=document.querySelector('.function-rail button');dateKey.disabled=false;dateKey.innerHTML='<span><u>F2</u>: Period</span><span>‹</span>';dateKey.onclick=showPeriod;
    highlight();main.focus();
  }
  const openStatement=id=>run(()=>renderStatement(id));
  const openLedgerFromReport=(id,period,onBack)=>run(()=>{statementOrigin=onBack;return renderStatement(id,period);});
  function openMonthly(){
    if(busy)return;
    if(statementOrigin?.monthlyContext){statementOrigin();return;}
    const id=ledgerId,period=periods.get(id),origin=statementOrigin,selected=index;
    const back=()=>run(async()=>{statementOrigin=origin;await renderStatement(id,period);index=selected;highlight();});
    run(()=>renderMonthly({id,back,index:0}));
  }
  async function renderMonthly(context){
    const report=await api('/api/monthly-summary?ledger='+context.id);
    monthlyContext=context;ledgerId=context.id;rows=report.rows;index=context.index;
    setScreen('Ledger Monthly Summary','monthly-summary','Company year: '+entryDate(report.period.from)+' to '+entryDate(report.period.to)+' · ↑ ↓ Enter: month vouchers · Esc: back');
    main.innerHTML=monthlyMarkup(report,getBook().company,escapeHtml,getBook());
    const dateKey=document.querySelector('.function-rail button');dateKey.innerHTML='<span><u>F2</u>: Period</span><span>‹</span>';
    main.querySelectorAll('[data-month-row]').forEach((button,i)=>{button.onclick=()=>openMonth(i);button.onfocus=()=>{index=i;highlight();};});
    button('monthly-vouchers','Enter: Vouchers',()=>openMonth(index));
    highlight();main.focus();
  }
  function openMonth(selected){
    const context={...monthlyContext,index:selected},row=rows[selected];
    const back=()=>run(()=>renderMonthly(context));back.monthlyContext=context;
    run(()=>{statementOrigin=back;return renderStatement(context.id,{from:row.from,to:row.to});});
  }
  function showPeriod(){
    if(busy || document.querySelector('dialog'))return;
    const trial=getView()==='trial-balance',gst=getView()==='gst-summary',stock=getView()==='stock-summary';
    const dates=getBook().vouchers.filter(v=>trial || gst || stock || v.customer_id===ledgerId || v.account_id===ledgerId).map(v=>v.date).sort();
    const selected=trial?trialPeriod:gst?gstPeriod:stock?stockPeriod:periods.get(ledgerId);
    const period={from:selected?.from ?? dates[0] ?? initialEntryDate(getBook()),to:selected?.to ?? dates.at(-1) ?? initialEntryDate(getBook())};
    editReportPeriod({period,onDone:async next=>{busy=true;try{await refreshBook();if(trial)await renderTrialBalance(next);else if(gst)await renderGstSummary(next);else if(stock)await renderStockSummary(next);else await renderStatement(ledgerId,next);}finally{busy=false;}}});
  }
  async function renderOutstanding(id=null,direction=null,asOf=undefined){
    const nextDirection=direction ?? (getBook().ledgers.find(l=>l.id===id)?.kind==='supplier'?'payable':'receivable');
    const cutoff=asOf===undefined?(outstandingDates.get(nextDirection) ?? null):asOf;
    const query=new URLSearchParams({direction:nextDirection});if(cutoff)query.set('as_of',cutoff);if(id!=null)query.set('ledger',String(id));
    // Fetch before changing report state so a failed date request retains both
    // the previous report and the date dialog's draft.
    const report=await api('/api/outstanding?'+query);
    outstandingDirection=nextDirection;outstandingAsOf=cutoff;outstandingDates.set(nextDirection,cutoff);
    const payable=outstandingDirection==='payable',side=payable?'Cr':'Dr';
    ledgerId=id;rows=report.rows;index=0;
    setScreen(payable?'Bills Payable':'Bills Receivable','outstanding','Pending saved bills · F2: As of · ↑ ↓ Enter: open voucher or opening · Esc: back');
    const name=id?getBook().ledgers.find(l=>l.id===id)?.name:(payable?'All suppliers':'All customers');
    main.innerHTML=`<section class="day-book outstanding-report"><div class="report-ledger-name">${id?'Ledger: &nbsp;':''}<strong>${escapeHtml(name)}</strong><span>Pending bills</span></div><div class="report-table-scroll"><table class="voucher-report"><colgroup><col class="date-col"><col>${id?'':'<col>'}<col class="money-col"><col class="money-col"><col class="date-col"></colgroup><thead><tr><th>Date</th><th>Ref. No.</th>${id?'':`<th>${payable?'Supplier':'Customer'}</th>`}<th class="amount">Opening Amount</th><th class="amount">Pending Amount</th><th class="bill-due-date">Due Date</th></tr></thead><tbody>${rows.map((r,i)=>`<tr data-report-row="${i}"><td>${entryDate(r.date)}</td><td><button type="button" data-outstanding-sale="${r.id}">${escapeHtml(r.reference)}</button></td>${id?'':`<td>${escapeHtml(r.customer_name)}</td>`}<td class="amount">${formatRupees(r.original)} ${side}</td><td class="amount">${formatRupees(r.pending)} ${side}</td><td class="bill-due-date">${dueDateText(r.due_date)}</td></tr>`).join('')}</tbody></table></div>${rows.length?'':'<p class="empty-report">No outstanding bills.</p>'}<div class="report-total">Pending <strong id="outstanding-total">${formatRupees(report.totals.pending)} ${side}</strong></div></section>`;
    main.querySelectorAll('[data-outstanding-sale]').forEach((b,i)=>{b.addEventListener('click',()=>reopen(rows[i].id));b.addEventListener('focus',()=>{index=i;highlight();});});highlight();main.focus();
    main.querySelector('.report-ledger-name>span').textContent=cutoff?'As at '+entryDate(cutoff):'Current balances · vouchers and opening references';
    button('outstanding-asof','F2: As of',showOutstandingAsOf);
    if(cutoff)button('outstanding-current','All dates',()=>run(()=>renderOutstanding(ledgerId,outstandingDirection,null)));
    const dateKey=document.querySelector('.function-rail button');dateKey.disabled=false;dateKey.innerHTML='<span><u>F2</u>: As of</span><span>‹</span>';dateKey.onclick=showOutstandingAsOf;
  }
  function showOutstandingAsOf(){
    if(busy || getView()!=='outstanding' || document.querySelector('dialog'))return;
    const customer=ledgerId,direction=outstandingDirection,date=outstandingAsOf ?? getBook().vouchers.map(voucher=>voucher.date).sort().at(-1) ?? initialEntryDate(getBook());
    const dialog=editReportDate({date,onDone:async period=>{busy=true;try{await refreshBook();await renderOutstanding(customer,direction,period.from);}finally{busy=false;}}});
    dialog.classList.add('outstanding-asof-dialog');
  }
  const openOutstanding=(id=null)=>run(()=>renderOutstanding(id));
  const openPayables=()=>run(()=>renderOutstanding(null,'payable'));
  function reopen(id){
    const current=getView(),customer=ledgerId,direction=outstandingDirection,cutoff=outstandingAsOf;
    const opening=current==='outstanding'?rows.find(row=>row.id===id && row.source==='opening'):null;
    const back=()=>current==='statement'?openStatement(customer):run(async()=>{await renderOutstanding(customer,direction,cutoff);const selected=rows.findIndex(row=>row.id===id);if(selected>=0){index=selected;highlight();}});
    run(async()=>{if(opening){await openOpeningMaster(opening.customer_id,back,opening.opening_bill_id);return;}const voucher=await api(`/api/vouchers/${id}`);openVoucher(voucher,back);});
  }

  let gstPeriod = null;
  let stockPeriod = null;
  let stockOrigin = 'gateway';
  function renderMoreReports(){
    setScreen('Display More Reports','more-reports','Trial Balance · GST Summary · Stock Summary · Enter: open · Esc: Gateway');
    main.innerHTML='<section class="master-menu"><div class="gateway-menu-title">Display More Reports</div><div class="master-menu-content"><h2 class="menu-heading">ACCOUNTING</h2><button id="open-trial-balance" class="selected">Trial Balance</button><button id="open-gst-summary">GST Summary</button><h2 class="menu-heading">INVENTORY</h2><button id="open-stock-summary">Stock Summary</button></div></section>';
    main.querySelector('#open-trial-balance').onclick=openTrialBalance;
    main.querySelector('#open-gst-summary').onclick=openGstSummary;
    main.querySelector('#open-stock-summary').onclick=()=>openStockSummary('reports');
    main.querySelector('#open-trial-balance').focus();
  }
  const openMoreReports=()=>run(()=>renderMoreReports());
  const openTrialBalance=()=>run(()=>renderTrialBalance());
  const openGstSummary=()=>run(()=>renderGstSummary());
  const openStockSummary=(from='gateway',period=stockPeriod)=>{stockOrigin=from;return run(()=>renderStockSummary(period));};
  function openTrialLedger(id){statementOrigin='trial-balance';run(()=>renderStatement(id,trialPeriod));}
  async function renderTrialBalance(period=trialPeriod){
    const query=period?'?'+new URLSearchParams(period):'';
    const report=await api('/api/trial-balance'+query);trialPeriod=period;rows=report.rows.filter(l=>showZero || l.balance!==0);index=0;
    setScreen('Trial Balance','trial-balance','Ledger-wise closing balances · F2: period · ↑ ↓ Enter: ledger · Esc: reports');
    const caption=period?entryDate(period.from)+' to '+entryDate(period.to):'All saved vouchers';
    main.innerHTML='<section class="day-book trial-balance"><div class="report-ledger-name"><strong>Particulars</strong><span id="trial-period-caption">'+caption+'</span></div><div class="report-table-scroll"><table class="voucher-report"><thead><tr><th>Ledger</th><th>Closing Balance<br>Debit</th><th>Closing Balance<br>Credit</th></tr></thead><tbody>'+rows.map((r,i)=>'<tr data-report-row="'+i+'"><td><button type="button" data-trial-ledger="'+r.id+'">'+escapeHtml(r.name)+'</button></td><td class="amount">'+(r.balance>0?formatRupees(r.balance):'')+'</td><td class="amount">'+(r.balance<0?formatRupees(-r.balance):'')+'</td></tr>').join('')+'</tbody></table></div>'+(rows.length?'':'<p class="empty-report">No ledger balances in this period.</p>')+'<div class="trial-totals"><strong>Grand Total</strong><strong id="trial-debit">'+formatRupees(report.totals.debit)+'</strong><strong id="trial-credit">'+formatRupees(report.totals.credit)+'</strong></div><div class="posting-status" id="trial-status">'+(report.totals.balanced?'Balanced':'Unbalanced')+'</div></section>';
    if(report.opening_balances?.difference){main.querySelector('#trial-status').textContent='Difference in opening balances';main.querySelector('#trial-status').insertAdjacentHTML('afterend','<p class="opening-report-warning" id="trial-opening-difference" role="status">'+formatBalance(report.opening_balances.difference)+'</p>');}
    main.querySelectorAll('[data-trial-ledger]').forEach((b,i)=>{b.onclick=()=>openTrialLedger(rows[i].id);b.onfocus=()=>{index=i;highlight();};});
    button('trial-period','F2: Period',showPeriod);
    button('trial-zero',showZero?'Hide zero balances':'Show zero balances',()=>run(()=>{showZero=!showZero;return renderTrialBalance();}));
    if(period)button('trial-all-dates','All dates',()=>run(()=>renderTrialBalance(null)));
    const dateKey=document.querySelector('.function-rail button');dateKey.disabled=false;dateKey.innerHTML='<span><u>F2</u>: Period</span><span>‹</span>';dateKey.onclick=showPeriod;
    highlight();main.focus();
  }
  async function renderGstSummary(period=gstPeriod){
    const query=period?'?'+new URLSearchParams(period):'';
    const report=await api('/api/gst-summary'+query);gstPeriod=period;
    setScreen('GST Summary','gst-summary','Statutory GST Summary · F2: Period · Esc: reports');
    const caption=period?entryDate(period.from)+' to '+entryDate(period.to):'All saved vouchers';
    main.innerHTML=`<section class="day-book gst-summary-report">
      <div class="report-ledger-name"><strong>GST Summary Report</strong><span id="gst-period-caption">${caption}</span></div>
      <div class="report-table-scroll">
        <h2 style="padding:6px 4px 2px;font-size:12px;color:#124;">1. Outward Supplies (Sales & Credit Notes)</h2>
        <table class="voucher-report">
          <thead><tr><th>Category</th><th>Taxable Amount</th><th>CGST</th><th>SGST</th><th>IGST</th><th>Total Tax</th><th>Total Value</th></tr></thead>
          <tbody>
            <tr><td>B2B Supplies</td><td class="amount">${formatRupees(report.outward_supplies.b2b.taxable_amount)}</td><td class="amount">${formatRupees(report.outward_supplies.b2b.cgst_amount)}</td><td class="amount">${formatRupees(report.outward_supplies.b2b.sgst_amount)}</td><td class="amount">${formatRupees(report.outward_supplies.b2b.igst_amount)}</td><td class="amount">${formatRupees(report.outward_supplies.b2b.total_tax)}</td><td class="amount">${formatRupees(report.outward_supplies.b2b.total_value)}</td></tr>
            <tr><td>B2C Supplies</td><td class="amount">${formatRupees(report.outward_supplies.b2c.taxable_amount)}</td><td class="amount">${formatRupees(report.outward_supplies.b2c.cgst_amount)}</td><td class="amount">${formatRupees(report.outward_supplies.b2c.sgst_amount)}</td><td class="amount">${formatRupees(report.outward_supplies.b2c.igst_amount)}</td><td class="amount">${formatRupees(report.outward_supplies.b2c.total_tax)}</td><td class="amount">${formatRupees(report.outward_supplies.b2c.total_value)}</td></tr>
            <tr style="font-weight:bold;border-top:1px solid #c4c4c4;"><td>Total Outward</td><td class="amount">${formatRupees(report.outward_supplies.total.taxable_amount)}</td><td class="amount">${formatRupees(report.outward_supplies.total.cgst_amount)}</td><td class="amount">${formatRupees(report.outward_supplies.total.sgst_amount)}</td><td class="amount">${formatRupees(report.outward_supplies.total.igst_amount)}</td><td class="amount">${formatRupees(report.outward_supplies.total.total_tax)}</td><td class="amount">${formatRupees(report.outward_supplies.total.total_value)}</td></tr>
          </tbody>
        </table>

        <h2 style="padding:10px 4px 2px;font-size:12px;color:#124;">2. Inward Supplies (Purchases & Debit Notes - Eligible ITC)</h2>
        <table class="voucher-report">
          <thead><tr><th>Supply Type</th><th>Taxable Amount</th><th>Input CGST</th><th>Input SGST</th><th>Input IGST</th><th>Total Tax</th><th>Total Value</th></tr></thead>
          <tbody>
            <tr><td>Inward Supplies</td><td class="amount">${formatRupees(report.inward_supplies.taxable_amount)}</td><td class="amount">${formatRupees(report.inward_supplies.cgst_amount)}</td><td class="amount">${formatRupees(report.inward_supplies.sgst_amount)}</td><td class="amount">${formatRupees(report.inward_supplies.igst_amount)}</td><td class="amount">${formatRupees(report.inward_supplies.total_tax)}</td><td class="amount">${formatRupees(report.inward_supplies.total_value)}</td></tr>
          </tbody>
        </table>

        <h2 style="padding:10px 4px 2px;font-size:12px;color:#124;">3. Net Tax Payable</h2>
        <table class="voucher-report">
          <thead><tr><th>Tax Head</th><th>Output Tax Liability</th><th>Input Tax Credit (ITC)</th><th>Net Tax Payable</th></tr></thead>
          <tbody>
            <tr><td>Central Tax (CGST)</td><td class="amount">${formatRupees(report.net_tax_payable.output_cgst)}</td><td class="amount">${formatRupees(report.net_tax_payable.input_cgst)}</td><td class="amount">${formatRupees(report.net_tax_payable.net_cgst)}</td></tr>
            <tr><td>State Tax (SGST)</td><td class="amount">${formatRupees(report.net_tax_payable.output_sgst)}</td><td class="amount">${formatRupees(report.net_tax_payable.input_sgst)}</td><td class="amount">${formatRupees(report.net_tax_payable.net_sgst)}</td></tr>
            <tr><td>Integrated Tax (IGST)</td><td class="amount">${formatRupees(report.net_tax_payable.output_igst)}</td><td class="amount">${formatRupees(report.net_tax_payable.input_igst)}</td><td class="amount">${formatRupees(report.net_tax_payable.net_igst)}</td></tr>
            <tr style="font-weight:bold;border-top:1px solid #c4c4c4;"><td>Total Tax</td><td class="amount">${formatRupees(report.outward_supplies.total.total_tax)}</td><td class="amount">${formatRupees(report.inward_supplies.total_tax)}</td><td class="amount" id="gst-net-total">${formatRupees(report.net_tax_payable.total_net_tax)}</td></tr>
          </tbody>
        </table>

        <h2 style="padding:10px 4px 2px;font-size:12px;color:#124;">4. Rate-wise Summary</h2>
        <table class="voucher-report">
          <thead><tr><th>GST Rate</th><th>Taxable Amount</th><th>CGST</th><th>SGST</th><th>IGST</th><th>Total Tax</th></tr></thead>
          <tbody>${report.rate_wise.map(r=>`<tr><td>${r.rate}%</td><td class="amount">${formatRupees(r.taxable_amount)}</td><td class="amount">${formatRupees(r.cgst_amount)}</td><td class="amount">${formatRupees(r.sgst_amount)}</td><td class="amount">${formatRupees(r.igst_amount)}</td><td class="amount">${formatRupees(r.total_tax)}</td></tr>`).join('') || '<tr><td colspan="6">No entries.</td></tr>'}</tbody>
        </table>

        <h2 style="padding:10px 4px 2px;font-size:12px;color:#124;">5. HSN/SAC Summary</h2>
        <table class="voucher-report">
          <thead><tr><th>HSN / SAC</th><th>Taxable Amount</th><th>CGST</th><th>SGST</th><th>IGST</th><th>Total Tax</th></tr></thead>
          <tbody>${report.hsn_wise.map(h=>`<tr><td>${escapeHtml(h.hsn_sac)}</td><td class="amount">${formatRupees(h.taxable_amount)}</td><td class="amount">${formatRupees(h.cgst_amount)}</td><td class="amount">${formatRupees(h.sgst_amount)}</td><td class="amount">${formatRupees(h.igst_amount)}</td><td class="amount">${formatRupees(h.total_tax)}</td></tr>`).join('') || '<tr><td colspan="6">No entries.</td></tr>'}</tbody>
        </table>
      </div>
    </section>`;
    button('gst-period','F2: Period',showPeriod);
    if(period)button('gst-all-dates','All dates',()=>run(()=>renderGstSummary(null)));
    const dateKey=document.querySelector('.function-rail button');dateKey.disabled=false;dateKey.innerHTML='<span><u>F2</u>: Period</span><span>‹</span>';dateKey.onclick=showPeriod;
  }

  async function renderStockSummary(period=stockPeriod){
    const query=period?'?'+new URLSearchParams(period):'';
    const report=await api('/api/stock-summary'+query);
    stockPeriod=period;
    rows=report.items;
    index=0;
    setScreen('Stock Summary','stock-summary','Stock items closing balance and valuation · F2: Period · Esc: back');
    const caption=period?entryDate(period.from)+' to '+entryDate(period.to):'All saved movements';
    main.innerHTML=`<section class="day-book stock-summary-report">
      <div class="report-ledger-name"><strong>Stock Summary</strong><span id="stock-period-caption">${caption}</span></div>
      <div class="report-table-scroll">
        <table class="voucher-report">
          <thead>
            <tr>
              <th rowspan="2">Item Name</th>
              <th colspan="2" style="text-align:center;">Opening Balance</th>
              <th colspan="2" style="text-align:center;">Inwards</th>
              <th colspan="2" style="text-align:center;">Outwards</th>
              <th colspan="3" style="text-align:center;">Closing Balance</th>
            </tr>
            <tr>
              <th class="amount">Quantity</th>
              <th class="amount">Value</th>
              <th class="amount">Quantity</th>
              <th class="amount">Value</th>
              <th class="amount">Quantity</th>
              <th class="amount">Value</th>
              <th class="amount">Quantity</th>
              <th class="amount">Rate</th>
              <th class="amount">Value</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r,i)=>`
              <tr data-report-row="${i}">
                <td><strong>${escapeHtml(r.item_name)}</strong>${r.part_number?` <small>[${escapeHtml(r.part_number)}]</small>`:''}${r.group_name?` <small>(${escapeHtml(r.group_name)})</small>`:''}</td>
                <td class="amount">${r.opening_qty?r.opening_qty+' '+(r.unit_symbol||''):''}</td>
                <td class="amount">${r.opening_val?formatRupees(r.opening_val):''}</td>
                <td class="amount">${r.inward_qty?r.inward_qty+' '+(r.unit_symbol||''):''}</td>
                <td class="amount">${r.inward_val?formatRupees(r.inward_val):''}</td>
                <td class="amount">${r.outward_qty?r.outward_qty+' '+(r.unit_symbol||''):''}</td>
                <td class="amount">${r.outward_val?formatRupees(r.outward_val):''}</td>
                <td class="amount"><strong>${r.closing_qty} ${r.unit_symbol||''}</strong></td>
                <td class="amount">${r.closing_rate?formatRupees(r.closing_rate):''}</td>
                <td class="amount"><strong class="stock-closing-val">${formatRupees(r.closing_val)}</strong></td>
              </tr>
            `).join('') || '<tr><td colspan="10" class="empty-report">No stock items in this period.</td></tr>'}
          </tbody>
        </table>
      </div>
      <div class="trial-totals">
        <strong>Grand Total</strong>
        <strong id="stock-total-val">${formatRupees(report.totals.closing_val)}</strong>
      </div>
    </section>`;
    button('stock-period','F2: Period',showPeriod);
    if(period)button('stock-all-dates','All dates',()=>run(()=>renderStockSummary(null)));
    const dateKey=document.querySelector('.function-rail button');dateKey.disabled=false;dateKey.innerHTML='<span><u>F2</u>: Period</span><span>‹</span>';dateKey.onclick=showPeriod;
    highlight();main.focus();
  }

  function goBack(){if(getView()==='monthly-summary')monthlyContext.back();else if(getView()==='trial-balance'||getView()==='gst-summary')openMoreReports();else if(getView()==='stock-summary'){if(stockOrigin==='gateway')renderGateway(11);else openMoreReports();}else if(getView()==='more-reports')renderGateway(7);else if(getView()==='statement'){if(typeof statementOrigin==='function')statementOrigin();else if(statementOrigin==='trial-balance')openTrialBalance();else chooseLedger();}else if(getView()==='outstanding' && ledgerId)openStatement(ledgerId);else renderGateway(getView()==='outstanding'?(outstandingDirection==='payable'?8:6):5);}
  function onKey(e){
    if(!['report-selector','statement','outstanding','more-reports','trial-balance','monthly-summary','gst-summary','stock-summary'].includes(getView()))return false;
    if(busy){e.preventDefault();return true;}
    if(e.ctrlKey || e.altKey || e.metaKey)return false;
    if(getView()==='monthly-summary'){
      if(e.key==='Enter' && e.target.closest('button') && !e.target.closest('[data-month-row]'))return false;
      if(['ArrowDown','ArrowUp','Home','End','Enter','F2'].includes(e.key)){
        e.preventDefault();
        if(e.key==='Enter')openMonth(index);
        else if(e.key==='F2'){const period=companyPeriod(getBook());hint.textContent='Monthly Summary covers '+entryDate(period.from)+' to '+entryDate(period.to)+'. Change the company period at Gateway with Alt+F2, or choose dates in Ledger Vouchers.';}
        else {if(e.key==='Home')index=0;else if(e.key==='End')index=rows.length-1;highlight(e.key==='ArrowDown'?1:e.key==='ArrowUp'?-1:0);}
        return true;
      }return false;
    }
    if(e.key==='F6' && getView()==='statement'){e.preventDefault();openMonthly();return true;}
    if(e.key==='F2' && ['statement','trial-balance','gst-summary','stock-summary'].includes(getView())){e.preventDefault();showPeriod();return true;}
    if(e.key==='F2' && getView()==='outstanding'){e.preventDefault();showOutstandingAsOf();return true;}
    if(e.key==='F5' && getView()==='statement'){e.preventDefault();if(['customer','supplier'].includes(getBook().ledgers.find(l=>l.id===ledgerId)?.kind))openOutstanding(ledgerId);return true;}
    if(getView()==='more-reports'){if(e.key==='Enter'){e.preventDefault();openTrialBalance();return true;}return false;}
    if(e.key==='Enter' && e.target.closest('button'))return false;
    if(['ArrowDown','ArrowUp','Enter'].includes(e.key)){
      e.preventDefault();if(e.key==='Enter'){if(rows.length){if(getView()==='report-selector')openStatement(rows[index].id);else if(getView()==='trial-balance')openTrialLedger(rows[index].id);else reopen(rows[index].id);}}else highlight(e.key==='ArrowDown'?1:-1);return true;
    }return false;
  }
  return {chooseLedger,openStatement,openLedgerFromReport,openOutstanding,openPayables,openMoreReports,openGstSummary,openStockSummary,goBack,onKey,isSaving:()=>busy};
}
