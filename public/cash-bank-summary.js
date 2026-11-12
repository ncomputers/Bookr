export function createCashBankSummaryWorkspace({main,hint,api,setScreen,getBook,renderGateway,formatRupees,entryDate,openMonthlySummary}) {
  let period = null;
  let data = null;

  function fmtPaise(val) {
    if (!val) return '';
    return formatRupees(Math.abs(val));
  }

  function render() {
    setScreen('Cash/Bank Summary', 'cash-bank-summary', 'Enter: open ledger · F2: Period · Esc: reports');
    const pFrom = period?.from ? entryDate(period.from) : '1-Apr-2026';
    const pTo = period?.to ? entryDate(period.to) : '31-Mar-2027';

    const groups = data?.groups || [];
    const totals = data?.totals || { debit: 0, credit: 0, closing: 0 };

    main.innerHTML = `
      <section class="day-book cash-bank-summary-screen">
        <div class="report-ledger-name">
          <strong>${escapeHtml(getBook()?.company || 'Bookr')}</strong>
          <span>For ${pFrom} to ${pTo}</span>
        </div>

        <div class="report-table-scroll">
          <table class="voucher-report">
            <thead>
              <tr>
                <th>Particulars</th>
                <th class="amount">Debit</th>
                <th class="amount">Credit</th>
              </tr>
            </thead>
            <tbody>
              ${groups.map(group => `
                <tr class="group-bold">
                  <td><strong>${escapeHtml(group.name)}</strong></td>
                  <td class="amount"><strong>${fmtPaise(group.debit)}</strong></td>
                  <td class="amount"><strong>${fmtPaise(group.credit)}</strong></td>
                </tr>
                ${group.ledgers.map(l => `
                  <tr>
                    <td class="indent-ledger">
                      <button type="button" class="table-link" data-ledger-id="${l.id}">${escapeHtml(l.name)}</button>
                    </td>
                    <td class="amount">${fmtPaise(l.debit)}</td>
                    <td class="amount">${fmtPaise(l.credit)}</td>
                  </tr>
                `).join('')}
              `).join('')}
            </tbody>
          </table>
        </div>

        <div class="trial-totals">
          <strong>Grand Total</strong>
          <strong id="cash-bank-debit">${fmtPaise(totals.debit)}</strong>
          <strong id="cash-bank-credit">${fmtPaise(totals.credit)}</strong>
        </div>
      </section>
    `;

    main.querySelectorAll('[data-ledger-id]').forEach(btn => {
      btn.onclick = () => {
        const id = Number(btn.dataset.ledgerId);
        if (openMonthlySummary) openMonthlySummary(id);
      };
    });

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

  async function openCashBankSummary(customPeriod = null) {
    period = customPeriod;
    const query = period ? `?from=${period.from}&to=${period.to}` : '';
    data = await api(`/api/cash-bank-summary${query}`);
    render();
  }

  return {
    open: openCashBankSummary
  };
}
