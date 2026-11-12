export function createBankReconciliationWorkspace({
  main,
  hint,
  api,
  setScreen,
  getBook,
  refreshBook,
  escapeHtml,
  renderGateway,
  formatRupees,
  entryDate
}) {
  let activeBankId = null;
  let activeAsOf = null;
  let includeReconciled = false;
  let currentBrs = null;
  let pendingChanges = new Map(); // vchId:side -> bank_date

  function chooseBank() {
    const book = getBook();
    const bankLedgers = (book.ledgers || []).filter(l => l.kind === 'bank');
    if (bankLedgers.length === 0) {
      alert('No Bank Account ledgers found. Create a bank ledger first.');
      renderGateway();
      return;
    }
    if (bankLedgers.length === 1) {
      openReconciliation(bankLedgers[0].id);
      return;
    }

    setScreen('Select Bank', 'select-bank', 'Choose a bank account to reconcile · ↑ ↓ Enter · Esc: Gateway');
    main.innerHTML = `
      <section class="master-menu">
        <div class="gateway-menu-title">Name of Bank Ledger</div>
        <div class="master-menu-content">
          <h2 class="menu-heading">List of Bank Ledgers</h2>
          ${bankLedgers.map((b, i) => `
            <button type="button" class="bank-choice ${i === 0 ? 'selected' : ''}" data-bank-id="${b.id}">
              <span>${escapeHtml(b.name)}</span>
              <small>${escapeHtml(b.bank?.account_number || '')}</small>
            </button>
          `).join('')}
        </div>
      </section>
    `;

    main.querySelectorAll('[data-bank-id]').forEach(btn => {
      btn.onclick = () => openReconciliation(Number(btn.dataset.bankId));
    });

    const first = main.querySelector('.bank-choice');
    first?.focus();
  }

  async function openReconciliation(bankId, asOf = null) {
    activeBankId = bankId;
    activeAsOf = asOf;
    pendingChanges.clear();
    await loadAndRender();
  }

  async function loadAndRender() {
    const query = new URLSearchParams({
      ledger: String(activeBankId),
      include_reconciled: String(includeReconciled)
    });
    if (activeAsOf) query.set('as_of', activeAsOf);

    currentBrs = await api('/api/banking/reconciliation?' + query);
    renderBrs();
  }

  function recalculateLive() {
    let unreflectedDebit = 0;
    let unreflectedCredit = 0;

    for (const row of currentBrs.rows) {
      const key = `${row.voucher_id}:${row.side || 'bank'}`;
      const bankDate = pendingChanges.has(key) ? pendingChanges.get(key) : row.bank_date;
      const isReconciled = Boolean(bankDate && (!activeAsOf || bankDate <= activeAsOf));

      if (!isReconciled) {
        unreflectedDebit += row.debit;
        unreflectedCredit += row.credit;
      }
    }

    const bankBalance = currentBrs.balance_as_per_company_books - unreflectedDebit + unreflectedCredit;

    const debEl = main.querySelector('#unreflected-debit');
    const credEl = main.querySelector('#unreflected-credit');
    const bankEl = main.querySelector('#balance-as-per-bank');

    if (debEl) debEl.textContent = unreflectedDebit > 0 ? formatRupees(unreflectedDebit) : '';
    if (credEl) credEl.textContent = unreflectedCredit > 0 ? formatRupees(unreflectedCredit) : '';
    if (bankEl) bankEl.textContent = formatRupees(bankBalance);
  }

  function renderBrs() {
    const ledger = currentBrs.ledger;
    const subTitle = includeReconciled ? '(Reconciliation - All Vouchers)' : '(Reconciliation)';
    const asOfCaption = currentBrs.as_of_date ? entryDate(currentBrs.as_of_date) : '';

    setScreen('Bank Reconciliation', 'bank-reconciliation', 'Enter Bank Dates · Ctrl+A: Accept · Ctrl+B: Basis of Values · Esc: Back');

    main.innerHTML = `
      <section class="day-book bank-reconciliation-screen">
        <div class="report-ledger-name">
          <strong>Ledger: ${escapeHtml(ledger.name)}</strong>
          <em>${subTitle}</em>
          <span class="report-period-caption">For ${asOfCaption}</span>
        </div>
        <div class="report-table-scroll">
          <table class="voucher-report brs-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Particulars</th>
                <th>Vch Type</th>
                <th>Transaction Type</th>
                <th>Instrument No.</th>
                <th>Instrument Date</th>
                <th class="brs-date-th">Bank Date</th>
                <th>Debit</th>
                <th>Credit</th>
              </tr>
            </thead>
            <tbody>
              ${currentBrs.rows.map((r, i) => {
                const key = `${r.voucher_id}:${r.side || 'bank'}`;
                const currentDate = pendingChanges.has(key) ? pendingChanges.get(key) : (r.bank_date || '');
                return `
                  <tr data-row-key="${key}" data-row-index="${i}">
                    <td>${entryDate(r.date)}</td>
                    <td><strong>${escapeHtml(r.particulars)}</strong></td>
                    <td>${escapeHtml(r.voucher_type)}</td>
                    <td>${escapeHtml(r.transaction_type || '')}</td>
                    <td>${escapeHtml(r.instrument_number || '')}</td>
                    <td>${r.instrument_date ? entryDate(r.instrument_date) : ''}</td>
                    <td>
                      <input type="text"
                             class="brs-date-input"
                             data-key="${key}"
                             data-vch-date="${r.date}"
                             placeholder="YYYY-MM-DD"
                             value="${escapeHtml(currentDate)}"
                             autocomplete="off" />
                    </td>
                    <td class="amount">${r.debit > 0 ? formatRupees(r.debit) : ''}</td>
                    <td class="amount">${r.credit > 0 ? formatRupees(r.credit) : ''}</td>
                  </tr>
                `;
              }).join('') || '<tr><td colspan="9" class="empty-report">No pending transactions to reconcile.</td></tr>'}
            </tbody>
          </table>
        </div>
        <div class="brs-summary-pane">
          <div class="brs-summary-row">
            <span>Balance as per Company Books:</span>
            <strong>${formatRupees(currentBrs.balance_as_per_company_books)}</strong>
          </div>
          <div class="brs-summary-row">
            <span>Amounts not reflected in Bank:</span>
            <span>
              <span id="unreflected-debit" class="brs-unreflected-debit">${currentBrs.amounts_not_reflected.debit > 0 ? formatRupees(currentBrs.amounts_not_reflected.debit) : ''}</span>
              <span id="unreflected-credit">${currentBrs.amounts_not_reflected.credit > 0 ? formatRupees(currentBrs.amounts_not_reflected.credit) : ''}</span>
            </span>
          </div>
          <div class="brs-summary-final">
            <span>Balance as per Bank:</span>
            <strong id="balance-as-per-bank">${formatRupees(currentBrs.balance_as_per_bank)}</strong>
          </div>
        </div>
      </section>
    `;

    // Hook events on date inputs
    const inputs = main.querySelectorAll('.brs-date-input');
    inputs.forEach((input, idx) => {
      input.addEventListener('input', () => {
        const key = input.dataset.key;
        const val = input.value.trim();
        pendingChanges.set(key, val || null);
        recalculateLive();
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (idx + 1 < inputs.length) {
            inputs[idx + 1].focus();
            inputs[idx + 1].select();
          } else {
            saveChanges();
          }
        } else if (e.key === 'ArrowDown' && idx + 1 < inputs.length) {
          e.preventDefault();
          inputs[idx + 1].focus();
        } else if (e.key === 'ArrowUp' && idx > 0) {
          e.preventDefault();
          inputs[idx - 1].focus();
        }
      });
    });

    if (inputs.length > 0) {
      inputs[0].focus();
    }
  }

  async function saveChanges() {
    if (pendingChanges.size === 0) {
      hint.textContent = 'No reconciliation changes to save.';
      return;
    }

    const reconciliations = [];
    for (const [key, bankDate] of pendingChanges.entries()) {
      const [vchIdStr, side] = key.split(':');
      reconciliations.push({
        voucher_id: Number(vchIdStr),
        side,
        bank_date: bankDate
      });
    }

    try {
      await api('/api/banking/reconciliation', {
        method: 'POST',
        body: JSON.stringify({
          ledger_id: activeBankId,
          reconciliations
        })
      });
      pendingChanges.clear();
      await loadAndRender();
      hint.textContent = 'Bank reconciliation saved successfully.';
    } catch (err) {
      alert('Error saving reconciliation: ' + err.message);
    }
  }

  function toggleBasisOfValues() {
    includeReconciled = !includeReconciled;
    loadAndRender();
  }

  function onKey(e) {
    if (main.dataset.screen === 'select-bank') {
      const buttons = Array.from(main.querySelectorAll('.bank-choice'));
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
      return false;
    }

    if (main.dataset.screen !== 'bank-reconciliation') return false;

    // Ctrl+A: Accept / Save
    if (e.ctrlKey && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      saveChanges();
      return true;
    }

    // Ctrl+B: Basis of Values
    if (e.ctrlKey && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      toggleBasisOfValues();
      return true;
    }

    // Escape
    if (e.key === 'Escape') {
      if (pendingChanges.size > 0) {
        e.preventDefault();
        if (!confirm('Discard unsaved bank reconciliation changes?')) return true;
        pendingChanges.clear();
      }
      return false;
    }

    return false;
  }

  return {
    chooseBank,
    openReconciliation,
    saveChanges,
    toggleBasisOfValues,
    onKey
  };
}
