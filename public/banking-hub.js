export function createBankingHubWorkspace({main,hint,api,setScreen,getBook,renderGateway,formatRupees,entryDate,openBankReconciliation}) {
  let viewMode = 'menu'; // 'menu', 'cheque-register', 'cheque-items', 'deposit-slip', 'payment-advice'
  let selectedBank = null;
  let bankRegisterData = null;
  let chequeItemsData = null;
  let slipData = null;
  let adviceData = null;

  function fmtPaise(val) {
    if (!val) return '';
    return formatRupees(Math.abs(val));
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderMenu() {
    viewMode = 'menu';
    setScreen('Banking', 'banking-hub', 'Enter: open · Esc: Gateway');

    main.innerHTML = `
      <section class="master-menu banking-menu-screen">
        <div class="gateway-menu-title">Banking</div>
        <div class="master-menu-content">
          <h2 class="menu-heading">BANKING UTILITIES</h2>
          <button id="open-brs" class="selected"><u>B</u>ank Reconciliation</button>
          <button id="open-cheque-register">Cheque <u>R</u>egister</button>
          <h2 class="menu-heading">STATEMENTS</h2>
          <button id="open-deposit-slip"><u>D</u>eposit Slip</button>
          <button id="open-payment-advice"><u>P</u>ayment Advice</button>
        </div>
      </section>
    `;

    main.querySelector('#open-brs').onclick = () => {
      if (openBankReconciliation) openBankReconciliation();
    };
    main.querySelector('#open-cheque-register').onclick = () => openChequeRegister();
    main.querySelector('#open-deposit-slip').onclick = () => openDepositSlipSelector();
    main.querySelector('#open-payment-advice').onclick = () => openPaymentAdviceSelector();

    main.focus();
  }

  // --- Cheque Register ---
  async function openChequeRegister() {
    viewMode = 'cheque-register';
    selectedBank = null;
    bankRegisterData = await api('/api/banking/cheque-register');
    renderChequeRegister();
  }

  function renderChequeRegister() {
    setScreen('Cheque Register', 'cheque-register', 'Enter: bank cheques · Esc: Banking');
    const banks = bankRegisterData?.banks || [];
    const totals = bankRegisterData?.totals || { unreconciled: 0, reconciled: 0, total_cheques: 0 };

    main.innerHTML = `
      <section class="day-book cheque-register-screen">
        <div class="report-ledger-name">
          <strong>Bank wise Register</strong>
          <span>${escapeHtml(getBook()?.company || 'Bookr')}</span>
        </div>

        <div class="report-table-scroll">
          <table class="voucher-report">
            <thead>
              <tr>
                <th>Particulars</th>
                <th class="amount">Unreconciled</th>
                <th class="amount">Reconciled</th>
                <th class="amount">Total Cheques</th>
              </tr>
            </thead>
            <tbody>
              ${banks.map(b => `
                <tr>
                  <td>
                    <button type="button" class="table-link" data-bank-id="${b.id}">${escapeHtml(b.name)}</button>
                  </td>
                  <td class="amount">${b.unreconciled}</td>
                  <td class="amount">${b.reconciled}</td>
                  <td class="amount">${b.total_cheques}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div class="trial-totals">
          <strong>Grand Total</strong>
          <strong id="cr-total-unreconciled">${totals.unreconciled}</strong>
          <strong id="cr-total-reconciled">${totals.reconciled}</strong>
          <strong id="cr-total-cheques">${totals.total_cheques}</strong>
        </div>
      </section>
    `;

    main.querySelectorAll('[data-bank-id]').forEach(btn => {
      btn.onclick = () => openChequeItems(Number(btn.dataset.bankId));
    });

    main.focus();
  }

  async function openChequeItems(bankId) {
    selectedBank = bankId;
    viewMode = 'cheque-items';
    chequeItemsData = await api(`/api/banking/cheque-register?ledger=${bankId}`);
    renderChequeItems();
  }

  function renderChequeItems() {
    setScreen('Cheque Register', 'cheque-items', 'Enter: open voucher · Esc: Cheque Register');
    const b = chequeItemsData?.bank || {};
    const items = chequeItemsData?.items || [];
    const totals = chequeItemsData?.totals || { count: 0, unreconciled: 0, reconciled: 0 };

    main.innerHTML = `
      <section class="day-book cheque-items-screen">
        <div class="report-ledger-name">
          <strong>Ledger: ${escapeHtml(b.name)}</strong>
          <span>Total Cheques: ${totals.count} (Unreconciled: ${totals.unreconciled})</span>
        </div>

        <div class="report-table-scroll">
          <table class="voucher-report">
            <thead>
              <tr>
                <th>Chq No.</th>
                <th>Particulars</th>
                <th>Vch Type</th>
                <th>Vch No.</th>
                <th>Inst. Date</th>
                <th class="amount">Amount</th>
                <th>Status</th>
                <th>Bank Date</th>
              </tr>
            </thead>
            <tbody>
              ${items.length === 0 ? `<tr><td colspan="8">No cheques found for this bank.</td></tr>` : items.map(item => `
                <tr>
                  <td><strong>${escapeHtml(item.instrument_number)}</strong></td>
                  <td>${escapeHtml(item.particulars)}</td>
                  <td>${escapeHtml(item.type)}</td>
                  <td>${item.number}</td>
                  <td>${entryDate(item.instrument_date)}</td>
                  <td class="amount">${fmtPaise(item.amount)}</td>
                  <td><span class="status-badge ${item.status === 'Reconciled' ? 'badge-ok' : 'badge-warn'}">${item.status}</span></td>
                  <td>${item.bank_date ? entryDate(item.bank_date) : '—'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div class="command-strip-sub">
          <button type="button" id="btn-reconcile-this">R: Reconcile Bank</button>
        </div>
      </section>
    `;

    main.querySelector('#btn-reconcile-this').onclick = () => {
      if (openBankReconciliation) openBankReconciliation(selectedBank);
    };

    main.focus();
  }

  // --- Deposit Slip ---
  function openDepositSlipSelector() {
    const banks = getBook()?.ledgers?.filter(l => l.kind === 'bank') || [];
    if (banks.length === 1) {
      openDepositSlip(banks[0].id);
      return;
    }
    viewMode = 'deposit-slip-select';
    setScreen('Select Bank', 'banking-bank-select', 'Choose bank · Esc: Banking');
    main.innerHTML = `
      <section class="ledger-selector">
        <label for="bank-selector-search">Name of Bank</label>
        <div class="selection-heading">List of Bank Accounts</div>
        <div role="listbox">
          ${banks.map(b => `<button type="button" role="option" data-select-bank="${b.id}">${escapeHtml(b.name)}</button>`).join('')}
        </div>
      </section>
    `;
    main.querySelectorAll('[data-select-bank]').forEach(btn => {
      btn.onclick = () => openDepositSlip(Number(btn.dataset.selectBank));
    });
    main.focus();
  }

  async function openDepositSlip(bankId) {
    selectedBank = bankId;
    viewMode = 'deposit-slip';
    slipData = await api(`/api/banking/deposit-slip?ledger=${bankId}`);
    renderDepositSlip();
  }

  function renderDepositSlip() {
    setScreen('Deposit Slip', 'deposit-slip', 'Esc: Banking');
    const bank = slipData?.bank || {};
    const items = slipData?.items || [];
    const totals = slipData?.totals || { count: 0, total_amount: 0 };

    main.innerHTML = `
      <section class="day-book deposit-slip-screen">
        <div class="report-ledger-name">
          <strong>Deposit Slip: ${escapeHtml(bank.name)}</strong>
          <span>Cheque & Cash Deposits</span>
        </div>

        <div class="report-table-scroll">
          <table class="voucher-report">
            <thead>
              <tr>
                <th>Date</th>
                <th>Particulars</th>
                <th>Instrument Date</th>
                <th>Instrument No.</th>
                <th class="amount">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${items.length === 0 ? `<tr><td colspan="5">No deposits found for this bank.</td></tr>` : items.map(item => `
                <tr>
                  <td>${entryDate(item.date)}</td>
                  <td>${escapeHtml(item.particulars)}</td>
                  <td>${entryDate(item.instrument_date)}</td>
                  <td>${escapeHtml(item.instrument_number)}</td>
                  <td class="amount">${fmtPaise(item.amount)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div class="trial-totals">
          <strong>Grand Total</strong>
          <strong id="slip-total-amount">${fmtPaise(totals.total_amount)}</strong>
        </div>
      </section>
    `;

    main.focus();
  }

  // --- Payment Advice ---
  function openPaymentAdviceSelector() {
    const banks = getBook()?.ledgers?.filter(l => l.kind === 'bank') || [];
    if (banks.length === 1) {
      openPaymentAdvice(banks[0].id);
      return;
    }
    viewMode = 'payment-advice-select';
    setScreen('Select Bank', 'banking-bank-select', 'Choose bank · Esc: Banking');
    main.innerHTML = `
      <section class="ledger-selector">
        <label for="bank-selector-search">Name of Bank</label>
        <div class="selection-heading">List of Bank Accounts</div>
        <div role="listbox">
          ${banks.map(b => `<button type="button" role="option" data-select-bank="${b.id}">${escapeHtml(b.name)}</button>`).join('')}
        </div>
      </section>
    `;
    main.querySelectorAll('[data-select-bank]').forEach(btn => {
      btn.onclick = () => openPaymentAdvice(Number(btn.dataset.selectBank));
    });
    main.focus();
  }

  async function openPaymentAdvice(bankId) {
    selectedBank = bankId;
    viewMode = 'payment-advice';
    adviceData = await api(`/api/banking/payment-advice?ledger=${bankId}`);
    renderPaymentAdvice();
  }

  function renderPaymentAdvice() {
    setScreen('Payment Advice', 'payment-advice', 'Esc: Banking');
    const bank = adviceData?.bank || {};
    const items = adviceData?.items || [];
    const totals = adviceData?.totals || { count: 0, total_amount: 0 };

    main.innerHTML = `
      <section class="day-book payment-advice-screen">
        <div class="report-ledger-name">
          <strong>Payment Advice: ${escapeHtml(bank.name)}</strong>
          <span>Payments Issued</span>
        </div>

        <div class="report-table-scroll">
          <table class="voucher-report">
            <thead>
              <tr>
                <th>Date</th>
                <th>Particulars</th>
                <th>Instrument Date</th>
                <th>Instrument No.</th>
                <th class="amount">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${items.length === 0 ? `<tr><td colspan="5">No payments found for this bank.</td></tr>` : items.map(item => `
                <tr>
                  <td>${entryDate(item.date)}</td>
                  <td>${escapeHtml(item.particulars)}</td>
                  <td>${entryDate(item.instrument_date)}</td>
                  <td>${escapeHtml(item.instrument_number)}</td>
                  <td class="amount">${fmtPaise(item.amount)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div class="trial-totals">
          <strong>Grand Total</strong>
          <strong id="advice-total-amount">${fmtPaise(totals.total_amount)}</strong>
        </div>
      </section>
    `;

    main.focus();
  }

  return {
    open: renderMenu,
    openChequeRegister,
    openDepositSlip: openDepositSlipSelector,
    openPaymentAdvice: openPaymentAdviceSelector
  };
}
