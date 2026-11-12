import {entryDate,formatRupees,formatBalance} from './entry-values.js';

export function createFundsFlow({main,hint,api,setScreen,escapeHtml,getBook,refreshBook,onBack}) {
  let mode='summary',months=[],drilldownData=null,selectedIndex=0,busy=false;

  const formatWc=val=>val===0?'0.00':`${formatRupees(Math.abs(val))} ${val>0?'Dr':'Cr'}`;
  const formatFlow=val=>val===0?'0.00':`${formatRupees(Math.abs(val))} ${val>=0?'':'(-)'}`;

  function highlight(step=0){
    if(mode!=='summary'||!months.length)return;
    selectedIndex=(selectedIndex+step+months.length)%months.length;
    main.querySelectorAll('[data-funds-flow-row]').forEach((r,i)=>{
      r.classList.toggle('selected',i===selectedIndex);
      if(i===selectedIndex)r.scrollIntoView({block:'nearest'});
    });
  }

  async function openSummary(){
    if(busy)return;busy=true;
    try{
      await refreshBook();
      const res=await api('/api/funds-flow');
      months=res.months||[];
      drilldownData=null;
      mode='summary';
      selectedIndex=0;
      renderSummary(res);
    }catch(err){
      hint.textContent=err.message;
    }finally{
      busy=false;
    }
  }

  function renderSummary(data){
    setScreen('Funds Flow','funds-flow','Working Capital & Movement · ↑ ↓ Enter: month drilldown · Esc: reports');
    main.innerHTML=`<section class="day-book funds-flow-report">
      <div class="report-ledger-name"><strong>Funds Flow</strong><span>${entryDate(data.period.from)} to ${entryDate(data.period.to)}</span></div>
      <div class="report-table-scroll">
        <table class="voucher-report">
          <colgroup><col><col class="money-col"><col class="money-col"><col class="money-col"></colgroup>
          <thead>
            <tr>
              <th>Particulars</th>
              <th class="amount">Opening Working Capital</th>
              <th class="amount">Closing Working Capital</th>
              <th class="amount">Funds Flow</th>
            </tr>
          </thead>
          <tbody>
            ${months.map((m,i)=>`
              <tr data-funds-flow-row="${i}">
                <td><button type="button" data-month-btn="${m.month}">${escapeHtml(m.name)}</button></td>
                <td class="amount">${formatWc(m.opening)}</td>
                <td class="amount">${formatWc(m.closing)}</td>
                <td class="amount"><strong>${formatFlow(m.funds_flow)}</strong></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div class="ledger-report-totals">
        <div><span>Opening Working Capital :</span><b>${formatWc(data.totals.opening)}</b><b></b></div>
        <div><span>Closing Working Capital :</span><b>${formatWc(data.totals.closing)}</b><b></b></div>
        <div class="closing"><strong>Nett Funds Flow :</strong><strong id="funds-flow-total">${formatFlow(data.totals.funds_flow)}</strong><b></b></div>
      </div>
    </section>`;

    main.querySelectorAll('[data-month-btn]').forEach((btn,i)=>{
      btn.onclick=()=>openDrilldown(months[i].month);
      btn.onfocus=()=>{selectedIndex=i;highlight();};
    });

    const commandStrip=document.querySelector('.command-strip');
    const existing=commandStrip.querySelector('#funds-flow-drilldown');
    if(existing)existing.remove();
    const b=document.createElement('button');
    b.type='button';
    b.id='funds-flow-drilldown';
    b.textContent='Enter: Month Details';
    b.onclick=()=>openDrilldown(months[selectedIndex].month);
    commandStrip.insertBefore(b,hint);

    highlight();
    main.focus();
  }

  async function openDrilldown(mKey){
    if(busy)return;busy=true;
    try{
      const res=await api(`/api/funds-flow?month=${encodeURIComponent(mKey)}`);
      drilldownData=res.drilldown;
      mode='drilldown';
      renderDrilldown(drilldownData);
    }catch(err){
      hint.textContent=err.message;
    }finally{
      busy=false;
    }
  }

  function renderDrilldown(dd){
    setScreen(`Funds Flow - ${dd.name}`,'funds-flow-drilldown',`Funds Flow for ${dd.name} (${entryDate(dd.period.from)} to ${entryDate(dd.period.to)}) · Esc: summary`);

    const sources=dd.sources||[];
    const applications=dd.applications||[];
    const wcm=dd.working_capital_movement||{};
    const ca=wcm.current_assets||{groups:[]};
    const cl=wcm.current_liabilities||{groups:[]};
    const wc=wcm.working_capital||{};

    main.innerHTML=`<section class="funds-flow-detail-wrap">
      <div class="report-ledger-name"><strong>Funds Flow Statement</strong><span>${entryDate(dd.period.from)} to ${entryDate(dd.period.to)}</span></div>
      
      <div class="ratio-columns">
        <div class="ratio-pane">
          <div class="ratio-heading">Sources of Funds</div>
          <table class="ratio-table" id="table-sources">
            <tbody>
              ${sources.map(s=>`
                <tr>
                  <td>${escapeHtml(s.particular)}</td>
                  <td class="ratio-val">${formatRupees(s.amount)}</td>
                </tr>
              `).join('') || '<tr><td colspan="2" class="empty-report">No sources in this period.</td></tr>'}
            </tbody>
            <tfoot>
              <tr class="group-bold">
                <td><strong>Total Sources</strong></td>
                <td class="ratio-val" id="total-sources-val"><strong>${formatRupees(dd.totals.sources)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div class="ratio-pane">
          <div class="ratio-heading">Applications of Funds</div>
          <table class="ratio-table" id="table-applications">
            <tbody>
              ${applications.map(a=>`
                <tr>
                  <td>${escapeHtml(a.particular)}</td>
                  <td class="ratio-val">${formatRupees(a.amount)}</td>
                </tr>
              `).join('') || '<tr><td colspan="2" class="empty-report">No applications in this period.</td></tr>'}
            </tbody>
            <tfoot>
              <tr class="group-bold">
                <td><strong>Total Applications</strong></td>
                <td class="ratio-val" id="total-applications-val"><strong>${formatRupees(dd.totals.applications)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div class="funds-flow-changes-heading" style="margin-top:20px;margin-bottom:8px;">
        <h2 class="menu-heading" style="margin:0;font-size:14px;padding:6px 12px;background:#285484;color:#fff;">Statement of Changes in Working Capital</h2>
      </div>

      <div class="report-table-scroll">
        <table class="voucher-report" id="table-working-capital-changes">
          <colgroup><col><col class="money-col"><col class="money-col"><col class="money-col"></colgroup>
          <thead>
            <tr>
              <th>Particulars</th>
              <th class="amount">Opening Balance</th>
              <th class="amount">Closing Balance</th>
              <th class="amount">Wkg Cap Increase / (Decrease)</th>
            </tr>
          </thead>
          <tbody>
            <tr class="group-bold"><td colspan="4">Current Assets</td></tr>
            ${(ca.groups||[]).map(g=>`
              <tr>
                <td class="indent-ledger">${escapeHtml(g.group_name)}</td>
                <td class="amount">${formatWc(g.opening)}</td>
                <td class="amount">${formatWc(g.closing)}</td>
                <td class="amount">${formatRupees(g.change)}</td>
              </tr>
            `).join('')}
            <tr class="group-bold">
              <td>Total Current Assets</td>
              <td class="amount">${formatWc(ca.opening)}</td>
              <td class="amount">${formatWc(ca.closing)}</td>
              <td class="amount"><strong>${formatRupees(ca.change)}</strong></td>
            </tr>

            <tr class="group-bold"><td colspan="4">Current Liabilities</td></tr>
            ${(cl.groups||[]).map(g=>`
              <tr>
                <td class="indent-ledger">${escapeHtml(g.group_name)}</td>
                <td class="amount">${formatWc(g.opening)}</td>
                <td class="amount">${formatWc(g.closing)}</td>
                <td class="amount">${formatRupees(g.change)}</td>
              </tr>
            `).join('')}
            <tr class="group-bold">
              <td>Total Current Liabilities</td>
              <td class="amount">${formatWc(cl.opening)}</td>
              <td class="amount">${formatWc(cl.closing)}</td>
              <td class="amount"><strong>${formatRupees(cl.change)}</strong></td>
            </tr>

            <tr class="group-bold" style="background:#eaf0f8;border-top:2px solid #285484;">
              <td><strong>Working Capital (Current Assets - Current Liabilities)</strong></td>
              <td class="amount"><strong>${formatWc(wc.opening)}</strong></td>
              <td class="amount"><strong>${formatWc(wc.closing)}</strong></td>
              <td class="amount" id="net-working-capital-change"><strong>${formatRupees(wc.net_change)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>`;

    const commandStrip=document.querySelector('.command-strip');
    const existing=commandStrip.querySelector('#funds-flow-drilldown');
    if(existing)existing.remove();

    main.focus();
  }

  function goBack(){
    if(mode==='drilldown'){
      openSummary();
    }else if(onBack){
      onBack();
    }
  }

  function onKey(e){
    if(mode==='summary'){
      if(['ArrowDown','ArrowUp','Enter'].includes(e.key)){
        e.preventDefault();
        if(e.key==='Enter'){
          if(months.length)openDrilldown(months[selectedIndex].month);
        }else{
          highlight(e.key==='ArrowDown'?1:-1);
        }
        return true;
      }
    }
    return false;
  }

  return {openSummary,openDrilldown,goBack,onKey};
}
