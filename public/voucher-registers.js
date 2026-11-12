export function createVoucherRegistersWorkspace({
  main,
  hint,
  api,
  setScreen,
  getBook,
  refreshBook,
  escapeHtml,
  renderGateway,
  formatRupees,
  entryDate,
  openVoucher
}) {
  let currentSummary = null;
  let currentMonthData = null;
  let currentRegisterType = 'sales';
  let isColumnar = false;
  let selectedRowIndex = 0;

  async function openSummary(type = 'sales') {
    currentRegisterType = type;
    isColumnar = false;
    currentSummary = await api(`/api/registers/summary?type=${type}`);
    renderSummary();
  }

  function registerTitle(type) {
    if (type === 'sales' || type === 'sale') return 'Sales Register';
    if (type === 'purchase') return 'Purchase Register';
    if (type === 'journal') return 'Journal Register';
    if (type === 'payment') return 'Payment Register';
    if (type === 'receipt') return 'Receipt Register';
    if (type === 'contra') return 'Contra Register';
    if (type === 'credit_note') return 'Credit Note Register';
    if (type === 'debit_note') return 'Debit Note Register';
    return `${type.charAt(0).toUpperCase() + type.slice(1)} Register`;
  }

  function renderSummary() {
    const book = getBook();
    const title = registerTitle(currentRegisterType);
    setScreen(title, 'voucher-register-summary', '↑ ↓ Enter: select month · Esc: Gateway');

    const isTransactionRegister = !['sales', 'sale', 'purchase'].includes(currentRegisterType);
    const isSales = currentRegisterType === 'sales' || currentRegisterType === 'sale';

    main.innerHTML = `
      <section class="day-book register-summary-screen">
        <div class="report-ledger-name">
          <strong>${title}</strong>
          <span class="report-period-caption">${escapeHtml(book.company || '')}</span>
        </div>
        <div class="report-table-scroll">
          <table class="voucher-report">
            <thead>
              <tr>
                <th>Particulars</th>
                ${isTransactionRegister ? '<th>Total Vouchers</th><th>Debit</th><th>Credit</th>' : '<th>Debit</th><th>Credit</th><th>Closing Balance</th>'}
              </tr>
            </thead>
            <tbody>
              ${currentSummary.months.map((m, i) => `
                <tr class="month-row ${i === 0 ? 'selected' : ''}" data-month-index="${i}" data-year="${m.year}" data-month="${m.month_index}">
                  <td><button type="button" class="month-btn" data-idx="${i}"><strong>${escapeHtml(m.month_name)}</strong></button></td>
                  ${isTransactionRegister ? `
                    <td class="amount">${m.voucher_count > 0 ? m.voucher_count : ''}</td>
                    <td class="amount">${m.debit > 0 ? formatRupees(m.debit) : ''}</td>
                    <td class="amount">${m.credit > 0 ? formatRupees(m.credit) : ''}</td>
                  ` : `
                    <td class="amount">${m.debit > 0 ? formatRupees(m.debit) : ''}</td>
                    <td class="amount">${m.credit > 0 ? formatRupees(m.credit) : ''}</td>
                    <td class="amount"><strong>${m.closing_balance !== 0 ? formatRupees(Math.abs(m.closing_balance)) + (isSales ? ' Cr' : ' Dr') : ''}</strong></td>
                  `}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="trial-totals">
          <strong>Grand Total</strong>
          ${isTransactionRegister ? `
            <strong>${currentSummary.totals.voucher_count}</strong>
            <strong>${formatRupees(currentSummary.totals.debit)}</strong>
            <strong>${formatRupees(currentSummary.totals.credit)}</strong>
          ` : `
            <strong>${formatRupees(currentSummary.totals.debit)}</strong>
            <strong>${formatRupees(currentSummary.totals.credit)}</strong>
            <strong>${formatRupees(Math.abs(currentSummary.totals.closing_balance)) + (isSales ? ' Cr' : ' Dr')}</strong>
          `}
        </div>
      </section>
    `;

    main.querySelectorAll('.month-btn').forEach(btn => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.idx);
        const m = currentSummary.months[idx];
        openMonth(m.year, m.month_index);
      };
    });

    const first = main.querySelector('.month-btn');
    first?.focus();
  }

  async function openMonth(year, month) {
    currentMonthData = await api(`/api/registers/month?type=${currentRegisterType}&year=${year}&month=${month}&columnar=${isColumnar}`);
    renderMonth();
  }

  function renderMonth() {
    const title = registerTitle(currentRegisterType);
    setScreen(`Voucher Register`, 'voucher-register-month', '↑ ↓ Enter: alter voucher · F8: Columnar · Esc: months');

    const fromDate = entryDate(currentMonthData.from);
    const toDate = entryDate(currentMonthData.to);
    const vchs = currentMonthData.rows;

    let headersHtml = '';
    if (isColumnar && currentMonthData.column_headers) {
      headersHtml = `
        <th>Date</th>
        <th>Particulars</th>
        <th>Voucher Type</th>
        <th>Voucher No.</th>
        ${currentMonthData.column_headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}
      `;
    } else {
      headersHtml = `
        <th>Date</th>
        <th>Particulars</th>
        <th>Vch Type</th>
        <th>Vch No.</th>
        <th>Debit Amount</th>
        <th>Credit Amount</th>
      `;
    }

    main.innerHTML = `
      <section class="day-book register-month-screen">
        <div class="report-ledger-name">
          <strong>List of All ${escapeHtml(currentMonthData.voucher_type === 'sale' ? 'Sales' : currentMonthData.voucher_type.charAt(0).toUpperCase() + currentMonthData.voucher_type.slice(1))} Vouchers</strong>
          <span class="report-period-caption">${fromDate} to ${toDate}</span>
        </div>
        <div class="report-table-scroll">
          <table class="voucher-report">
            <thead>
              <tr>${headersHtml}</tr>
            </thead>
            <tbody>
              ${vchs.map((v, i) => `
                <tr class="vch-row ${i === selectedRowIndex ? 'selected' : ''}" data-vch-id="${v.voucher_id}" data-idx="${i}">
                  <td>${entryDate(v.date)}</td>
                  <td><button type="button" class="vch-btn" data-vch-id="${v.voucher_id}"><strong>${escapeHtml(v.particulars)}</strong></button></td>
                  <td>${escapeHtml(v.voucher_type)}</td>
                  <td>${v.voucher_number}</td>
                  ${isColumnar && currentMonthData.column_headers ? currentMonthData.column_headers.map(h => `
                    <td class="amount">${v.columns?.[h] ? formatRupees(v.columns[h]) : ''}</td>
                  `).join('') : `
                    <td class="amount">${v.debit > 0 ? formatRupees(v.debit) : ''}</td>
                    <td class="amount">${v.credit > 0 ? formatRupees(v.credit) : ''}</td>
                  `}
                </tr>
              `).join('') || '<tr><td colspan="6" class="empty-report">No vouchers entered for this period.</td></tr>'}
            </tbody>
          </table>
        </div>
        <div class="trial-totals">
          <strong>Total:</strong>
          <strong>${formatRupees(currentMonthData.total_amount)}</strong>
        </div>
      </section>
    `;

    // Hook buttons
    main.querySelectorAll('.vch-btn').forEach(btn => {
      btn.onclick = () => {
        const vchId = Number(btn.dataset.vchId);
        const book = getBook();
        const vch = (book.vouchers || []).find(v => v.id === vchId);
        if (vch && openVoucher) {
          openVoucher(vch, () => openMonth(currentMonthData.year, currentMonthData.month));
        }
      };
    });

    const first = main.querySelector('.vch-btn');
    first?.focus();
  }

  function toggleColumnar() {
    isColumnar = !isColumnar;
    if (currentMonthData) {
      openMonth(currentMonthData.year, currentMonthData.month);
    }
  }

  function onKey(e) {
    if (main.dataset.screen === 'voucher-register-summary') {
      const buttons = Array.from(main.querySelectorAll('.month-btn'));
      const active = document.activeElement;
      const idx = buttons.indexOf(active);
      if (['ArrowDown', 'ArrowUp'].includes(e.key) && buttons.length > 0) {
        e.preventDefault();
        const next = (idx + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
        return true;
      }
      if (e.key === 'Escape') {
        return false;
      }
    } else if (main.dataset.screen === 'voucher-register-month') {
      const buttons = Array.from(main.querySelectorAll('.vch-btn'));
      const active = document.activeElement;
      const idx = buttons.indexOf(active);
      if (['ArrowDown', 'ArrowUp'].includes(e.key) && buttons.length > 0) {
        e.preventDefault();
        const next = (idx + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
        return true;
      }
      if (e.key === 'F8') {
        e.preventDefault();
        toggleColumnar();
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        renderSummary();
        return true;
      }
    }
    return false;
  }

  return {
    openSummary,
    openMonth,
    toggleColumnar,
    onKey
  };
}
