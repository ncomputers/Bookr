export function createStatisticsWorkspace({
  main,
  hint,
  api,
  setScreen,
  getBook,
  escapeHtml,
  openRegister,
  openMasters
}) {
  let statsData = null;

  async function open() {
    statsData = await api('/api/statistics');
    render();
  }

  function render() {
    const book = getBook();
    setScreen('Statistics', 'statistics', '↑ ↓ ← →: navigate · Enter: open register or master · Esc: Back');

    const vchTypes = statsData.voucher_types || [];
    const accTypes = statsData.types_of_accounts || [];

    main.innerHTML = `
      <section class="day-book statistics-screen">
        <div class="report-ledger-name">
          <strong>Statistics</strong>
          <span class="report-period-caption">${escapeHtml(book.company || '')}</span>
        </div>
        <div class="statistics-columns">
          <!-- Left Pane: Voucher Types -->
          <div class="statistics-pane">
            <div class="statistics-heading">VOUCHER TYPES</div>
            <table class="voucher-report statistics-table">
              <thead>
                <tr>
                  <th>Type of Voucher</th>
                  <th class="stats-right">Total</th>
                  <th class="stats-right">Cancelled</th>
                </tr>
              </thead>
              <tbody>
                ${vchTypes.map((v, i) => `
                  <tr class="stats-vch-row" data-vch-type="${v.type}">
                    <td><button type="button" class="stats-btn stats-vch-btn" data-vch-type="${v.type}"><strong>${escapeHtml(v.name)}</strong></button></td>
                    <td class="amount">${v.count}</td>
                    <td class="amount">0</td>
                  </tr>
                `).join('')}
              </tbody>
              <tfoot>
                <tr>
                  <th>Total</th>
                  <th class="stats-right">${statsData.voucher_total || 0}</th>
                  <th class="stats-right">0</th>
                </tr>
              </tfoot>
            </table>
          </div>

          <!-- Right Pane: Types of Accounts -->
          <div class="statistics-pane">
            <div class="statistics-heading">TYPES OF ACCOUNTS</div>
            <table class="voucher-report statistics-table">
              <thead>
                <tr>
                  <th>Particulars</th>
                  <th class="stats-right">Total</th>
                </tr>
              </thead>
              <tbody>
                ${accTypes.map((a, i) => `
                  <tr class="stats-acc-row" data-acc-key="${a.key}">
                    <td><button type="button" class="stats-btn stats-acc-btn" data-acc-key="${a.key}"><strong>${escapeHtml(a.name)}</strong></button></td>
                    <td class="amount">${a.count}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    `;

    // Hook buttons
    main.querySelectorAll('.stats-vch-btn').forEach(btn => {
      btn.onclick = () => {
        const type = btn.dataset.vchType;
        if (openRegister) openRegister(type);
      };
    });

    main.querySelectorAll('.stats-acc-btn').forEach(btn => {
      btn.onclick = () => {
        const key = btn.dataset.accKey;
        if (openMasters) openMasters(key);
      };
    });

    const first = main.querySelector('.stats-btn');
    first?.focus();
  }

  function onKey(e) {
    if (main.dataset.screen !== 'statistics') return false;

    const allButtons = Array.from(main.querySelectorAll('.stats-btn'));
    const active = document.activeElement;
    const idx = allButtons.indexOf(active);

    const vchButtons = Array.from(main.querySelectorAll('.stats-vch-btn'));
    const accButtons = Array.from(main.querySelectorAll('.stats-acc-btn'));

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const inVch = vchButtons.includes(active);
      const col = inVch ? vchButtons : accButtons;
      const colIdx = col.indexOf(active);
      const nextColIdx = (colIdx + (e.key === 'ArrowDown' ? 1 : -1) + col.length) % col.length;
      col[nextColIdx]?.focus();
      return true;
    }

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const vchIdx = vchButtons.indexOf(active);
      if (vchIdx >= 0) {
        const targetIdx = Math.min(vchIdx, accButtons.length - 1);
        accButtons[targetIdx]?.focus();
      }
      return true;
    }

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const accIdx = accButtons.indexOf(active);
      if (accIdx >= 0) {
        const targetIdx = Math.min(accIdx, vchButtons.length - 1);
        vchButtons[targetIdx]?.focus();
      }
      return true;
    }

    if (e.key === 'Escape') {
      return false; // let goBack() handle returning to More Reports
    }

    return false;
  }

  return {
    open,
    onKey
  };
}
