import {entryDate,formatRupees,formatBalance} from './entry-values.js';
import {dueDateText} from './bill-terms.js';
import {editReportDate} from './report-period.js';

export function createExceptionReports({main,hint,api,setScreen,escapeHtml,getBook,refreshBook,openStatement,openVoucher,onBack}) {
  let currentView='menu';
  let rows=[],selectedIndex=0,busy=false;
  let receivablesAsOf=null,payablesAsOf=null;

  function highlight(step=0){
    if(currentView==='menu'||!rows.length)return;
    selectedIndex=(selectedIndex+step+rows.length)%rows.length;
    main.querySelectorAll('[data-report-row]').forEach((r,i)=>{
      r.classList.toggle('selected',i===selectedIndex);
      if(i===selectedIndex)r.scrollIntoView({block:'nearest'});
    });
  }

  function renderMenu(){
    currentView='menu';
    setScreen('Exception Reports','exception-reports','Negative Ledgers · Overdue Receivables · Overdue Payables · Enter: open · Esc: reports');
    main.innerHTML=`<section class="master-menu">
      <div class="gateway-menu-title">Exception Reports</div>
      <div class="master-menu-content">
        <h2 class="menu-heading">REPORTS</h2>
        <button id="open-negative-ledgers" class="selected"><u>N</u>egative Ledgers</button>
        <button id="open-overdue-receivables">Overdue <u>R</u>eceivables</button>
        <button id="open-overdue-payables">Overdue <u>P</u>ayables</button>
      </div>
    </section>`;

    main.querySelector('#open-negative-ledgers').onclick=openNegativeLedgers;
    main.querySelector('#open-overdue-receivables').onclick=()=>openOverdueReceivables();
    main.querySelector('#open-overdue-payables').onclick=()=>openOverduePayables();
    main.querySelector('#open-negative-ledgers').focus();
  }

  async function openNegativeLedgers(){
    if(busy)return;busy=true;
    try{
      await refreshBook();
      const res=await api('/api/exception-reports/negative-ledgers');
      currentView='negative-ledgers';
      rows=res.rows||[];
      selectedIndex=0;
      renderNegativeLedgers(res);
    }catch(err){
      hint.textContent=err.message;
    }finally{
      busy=false;
    }
  }

  function renderNegativeLedgers(data){
    setScreen('List of Negative Ledgers','negative-ledgers','Ledgers with abnormal balances · ↑ ↓ Enter: statement · Esc: back');
    main.innerHTML=`<section class="day-book negative-ledgers-report">
      <div class="report-ledger-name"><strong>List of Negative Ledgers</strong><span>Abnormal closing balances</span></div>
      <div class="report-table-scroll">
        <table class="voucher-report">
          <colgroup><col><col><col class="money-col"><col class="money-col"></colgroup>
          <thead>
            <tr>
              <th>Particulars</th>
              <th>Group</th>
              <th class="amount">Closing Balance<br>Debit</th>
              <th class="amount">Closing Balance<br>Credit</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r,i)=>`
              <tr data-report-row="${i}">
                <td><button type="button" data-ledger-btn="${r.id}">${escapeHtml(r.name)}</button></td>
                <td><small>${escapeHtml(r.group_name)}</small></td>
                <td class="amount">${r.debit>0?formatRupees(r.debit):''}</td>
                <td class="amount">${r.credit>0?formatRupees(r.credit):''}</td>
              </tr>
            `).join('') || '<tr><td colspan="4" class="empty-report">No negative ledgers found.</td></tr>'}
          </tbody>
        </table>
      </div>
      <div class="trial-totals">
        <strong>Grand Total</strong>
        <strong id="neg-ledger-debit">${formatRupees(data.totals.debit)}</strong>
        <strong id="neg-ledger-credit">${formatRupees(data.totals.credit)}</strong>
      </div>
    </section>`;

    main.querySelectorAll('[data-ledger-btn]').forEach((btn,i)=>{
      btn.onclick=()=>openStatement(rows[i].id);
      btn.onfocus=()=>{selectedIndex=i;highlight();};
    });

    highlight();
    main.focus();
  }

  async function openOverdueReceivables(asOf=receivablesAsOf){
    if(busy)return;busy=true;
    try{
      await refreshBook();
      const query=asOf?`?as_of=${encodeURIComponent(asOf)}`:'';
      const res=await api(`/api/exception-reports/overdue-receivables${query}`);
      currentView='overdue-receivables';
      receivablesAsOf=res.as_of;
      rows=res.rows||[];
      selectedIndex=0;
      renderOverdueBills(res,'receivable');
    }catch(err){
      hint.textContent=err.message;
    }finally{
      busy=false;
    }
  }

  async function openOverduePayables(asOf=payablesAsOf){
    if(busy)return;busy=true;
    try{
      await refreshBook();
      const query=asOf?`?as_of=${encodeURIComponent(asOf)}`:'';
      const res=await api(`/api/exception-reports/overdue-payables${query}`);
      currentView='overdue-payables';
      payablesAsOf=res.as_of;
      rows=res.rows||[];
      selectedIndex=0;
      renderOverdueBills(res,'payable');
    }catch(err){
      hint.textContent=err.message;
    }finally{
      busy=false;
    }
  }

  function renderOverdueBills(data,direction){
    const isReceivable=direction==='receivable';
    const screenTitle=isReceivable?'Bills - Overdue Receivables':'Bills - Overdue Payables';
    const partyHeader=isReceivable?'Customer':'Supplier';
    const viewKey=isReceivable?'overdue-receivables':'overdue-payables';

    setScreen(screenTitle,viewKey,`Overdue bills as at ${entryDate(data.as_of)} · F2: As of · ↑ ↓ Enter: voucher · Esc: back`);
    main.innerHTML=`<section class="day-book overdue-bills-report">
      <div class="report-ledger-name"><strong>${screenTitle}</strong><span>As at ${entryDate(data.as_of)}</span></div>
      <div class="report-table-scroll">
        <table class="voucher-report">
          <colgroup><col class="date-col"><col><col><col class="money-col"><col class="date-col"><col class="number-col"></colgroup>
          <thead>
            <tr>
              <th>Date</th>
              <th>Ref. No.</th>
              <th>${partyHeader}</th>
              <th class="amount">Pending Amount</th>
              <th class="bill-due-date">Due on</th>
              <th class="amount">Overdue (days)</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r,i)=>`
              <tr data-report-row="${i}">
                <td>${entryDate(r.date)}</td>
                <td><button type="button" data-bill-btn="${r.id}">${escapeHtml(r.reference)}</button></td>
                <td>${escapeHtml(isReceivable?r.customer_name:r.supplier_name)}</td>
                <td class="amount">${formatRupees(r.pending)}</td>
                <td class="bill-due-date">${dueDateText(r.due_date)}</td>
                <td class="amount"><strong>${r.overdue_days}</strong></td>
              </tr>
            `).join('') || `<tr><td colspan="6" class="empty-report">No overdue ${direction} bills.</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="report-total">
        Total Overdue <strong id="overdue-total-val">${formatRupees(data.totals.pending)} ${isReceivable?'Dr':'Cr'}</strong>
      </div>
    </section>`;

    main.querySelectorAll('[data-bill-btn]').forEach((btn,i)=>{
      btn.onclick=()=>reopen(rows[i].id);
      btn.onfocus=()=>{selectedIndex=i;highlight();};
    });

    const commandStrip=document.querySelector('.command-strip');
    const existing=commandStrip.querySelector('#overdue-as-of-btn');
    if(existing)existing.remove();
    const b=document.createElement('button');
    b.type='button';
    b.id='overdue-as-of-btn';
    b.textContent='F2: As of';
    b.onclick=()=>showAsOf(direction);
    commandStrip.insertBefore(b,hint);

    highlight();
    main.focus();
  }

  function showAsOf(direction){
    if(busy||document.querySelector('dialog'))return;
    const currentCutoff=direction==='receivable'?receivablesAsOf:payablesAsOf;
    const date=currentCutoff||new Date().toISOString().slice(0,10);
    const dialog=editReportDate({
      date,
      onDone:async period=>{
        if(direction==='receivable')await openOverdueReceivables(period.from);
        else await openOverduePayables(period.from);
      }
    });
    dialog.classList.add('outstanding-asof-dialog');
  }

  function reopen(voucherId){
    const back=()=>currentView==='overdue-receivables'?openOverdueReceivables():openOverduePayables();
    api(`/api/vouchers/${voucherId}`).then(voucher=>{
      openVoucher(voucher,back);
    }).catch(err=>{
      hint.textContent=err.message;
    });
  }

  function goBack(){
    if(currentView==='menu'){
      if(onBack)onBack();
    }else{
      renderMenu();
    }
  }

  function onKey(e){
    if(busy)return false;
    if(currentView==='menu'){
      const buttons=Array.from(main.querySelectorAll('.master-menu-content button'));
      const active=document.activeElement;
      const idx=buttons.indexOf(active);
      if(['ArrowDown','ArrowUp'].includes(e.key)){
        e.preventDefault();
        const next=(idx+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;
        buttons.forEach((b,i)=>b.classList.toggle('selected',i===next));
        buttons[next].focus();
        return true;
      }
      if(e.key==='Enter'){
        e.preventDefault();
        if(active&&active.click)active.click();
        else openNegativeLedgers();
        return true;
      }
      if(e.key==='n'||e.key==='N'){
        e.preventDefault();
        openNegativeLedgers();
        return true;
      }
      if(e.key==='r'||e.key==='R'){
        e.preventDefault();
        openOverdueReceivables();
        return true;
      }
      if(e.key==='p'||e.key==='P'){
        e.preventDefault();
        openOverduePayables();
        return true;
      }
      return false;
    }

    if(['negative-ledgers','overdue-receivables','overdue-payables'].includes(currentView)){
      if(e.key==='F2'&&['overdue-receivables','overdue-payables'].includes(currentView)){
        e.preventDefault();
        showAsOf(currentView==='overdue-receivables'?'receivable':'payable');
        return true;
      }
      if(['ArrowDown','ArrowUp','Enter'].includes(e.key)){
        e.preventDefault();
        if(e.key==='Enter'){
          if(rows.length){
            if(currentView==='negative-ledgers')openStatement(rows[selectedIndex].id);
            else reopen(rows[selectedIndex].id);
          }
        }else{
          highlight(e.key==='ArrowDown'?1:-1);
        }
        return true;
      }
    }
    return false;
  }

  return {
    openMenu:renderMenu,
    openNegativeLedgers,
    openOverdueReceivables,
    openOverduePayables,
    goBack,
    onKey,
    getView:()=>currentView
  };
}
