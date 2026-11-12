export function createCashFlowWorkspace({main,hint,api,setScreen,getBook,renderGateway,formatRupees,entryDate}) {
  let period = null;
  let data = null;
  let currentMonth = null;

  const monthNames = {
    '01': 'January', '02': 'February', '03': 'March',
    '04': 'April', '05': 'May', '06': 'June',
    '07': 'July', '08': 'August', '09': 'September',
    '10': 'October', '11': 'November', '12': 'December'
  };

  function fmtPaise(val) {
    if (!val) return '';
    return formatRupees(Math.abs(val));
  }

  function renderSummary() {
    setScreen('Cash Flow', 'cash-flow', 'Enter: month details · F2: Period · Esc: reports');
    const pFrom = period?.from ? entryDate(period.from) : '1-Apr-2026';
    const pTo = period?.to ? entryDate(period.to) : '31-Mar-2027';

    const months = data?.months || [];
    const totals = data?.totals || { inflow: 0, outflow: 0, nett_flow: 0 };

    main.innerHTML = `
      <section class="day-book cash-flow-screen">
        <div class="report-ledger-name">
          <strong>${escapeHtml(getBook()?.company || 'Bookr')}</strong>
          <span>For ${pFrom} to ${pTo}</span>
        </div>

        <div class="report-table-scroll">
          <table class="voucher-report">
            <thead>
              <tr>
                <th>Particulars</th>
                <th class="amount">Inflow</th>
                <th class="amount">Outflow</th>
                <th class="amount">Nett Flow</th>
              </tr>
            </thead>
            <tbody>
              ${months.map(m => {
                const mm = m.month.slice(5, 7);
                const name = monthNames[mm] || m.month;
                return `
                  <tr>
                    <td>
                      <button type="button" class="table-link" data-cash-flow-month="${m.month}">${name}</button>
                    </td>
                    <td class="amount">${fmtPaise(m.inflow)}</td>
                    <td class="amount">${fmtPaise(m.outflow)}</td>
                    <td class="amount">${fmtPaise(m.nett_flow)}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>

        <div class="trial-totals">
          <strong>Grand Total</strong>
          <strong id="cf-total-inflow">${fmtPaise(totals.inflow)}</strong>
          <strong id="cf-total-outflow">${fmtPaise(totals.outflow)}</strong>
          <strong id="cf-total-nett">${fmtPaise(totals.nett_flow)}</strong>
        </div>
      </section>
    `;

    main.querySelectorAll('[data-cash-flow-month]').forEach(btn => {
      btn.onclick = () => openMonthDetails(btn.dataset.cashFlowMonth);
    });

    main.focus();
  }

  function renderMonthDrilldown(drill) {
    setScreen('Cash Flow', 'cash-flow-drilldown', 'Esc: back to monthly summary');
    const mm = drill.month.slice(5, 7);
    const mName = monthNames[mm] || drill.month;
    const totals = drill.totals || { inflow: 0, outflow: 0, nett_inflow: 0 };

    main.innerHTML = `
      <section class="day-book cash-flow-drilldown-screen">
        <div class="report-ledger-name">
          <strong>${escapeHtml(getBook()?.company || 'Bookr')}</strong>
          <span>${mName}: ${entryDate(drill.period.from)} to ${entryDate(drill.period.to)}</span>
        </div>

        <div class="cashflow-columns">
          <!-- Inflow Pane -->
          <div class="cashflow-pane">
            <div class="cashflow-heading">Inflow</div>
            <table class="ratio-table">
              <tbody>
                ${drill.inflow_groups.map(g => `
                  <tr class="group-bold">
                    <td><strong>${escapeHtml(g.group_name)}</strong></td>
                    <td class="ratio-val"><strong>${fmtPaise(g.amount)}</strong></td>
                  </tr>
                  ${g.ledgers.map(l => `
                    <tr>
                      <td class="indent-ledger">${escapeHtml(l.name)}</td>
                      <td class="ratio-val">${fmtPaise(l.amount)}</td>
                    </tr>
                  `).join('')}
                `).join('')}
              </tbody>
            </table>
          </div>

          <!-- Outflow Pane -->
          <div class="cashflow-pane">
            <div class="cashflow-heading">Outflow</div>
            <table class="ratio-table">
              <tbody>
                ${drill.outflow_groups.map(g => `
                  <tr class="group-bold">
                    <td><strong>${escapeHtml(g.group_name)}</strong></td>
                    <td class="ratio-val"><strong>${fmtPaise(g.amount)}</strong></td>
                  </tr>
                  ${g.ledgers.map(l => `
                    <tr>
                      <td class="indent-ledger">${escapeHtml(l.name)}</td>
                      <td class="ratio-val">${fmtPaise(l.amount)}</td>
                    </tr>
                  `).join('')}
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="cashflow-total-bar">
          <div>
            <span>Total Inflow: <strong id="drill-inflow">${fmtPaise(totals.inflow)}</strong></span>
            &nbsp;·&nbsp;
            <span>Total Outflow: <strong id="drill-outflow">${fmtPaise(totals.outflow)}</strong></span>
          </div>
          <div>
            <span>Nett Inflow: <strong id="drill-nett-inflow">${fmtPaise(totals.nett_inflow)}</strong></span>
          </div>
        </div>
      </section>
    `;

    main.focus();
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function openMonthDetails(mKey) {
    currentMonth = mKey;
    const res = await api(`/api/cash-flow?month=${mKey}`);
    if (res?.drilldown) {
      renderMonthDrilldown(res.drilldown);
    }
  }

  async function openCashFlow(customPeriod = null) {
    period = customPeriod;
    currentMonth = null;
    const query = period ? `?from=${period.from}&to=${period.to}` : '';
    data = await api(`/api/cash-flow${query}`);
    renderSummary();
  }

  return {
    open: openCashFlow,
    back: () => {
      if (currentMonth) {
        currentMonth = null;
        renderSummary();
        return true;
      }
      return false;
    }
  };
}
