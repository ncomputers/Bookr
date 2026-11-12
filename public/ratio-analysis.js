export function createRatioAnalysisWorkspace({main,hint,api,setScreen,getBook,renderGateway,formatRupees,entryDate}) {
  let period = null;
  let data = null;

  function fmtPaise(val, side = '') {
    if (val === null || val === undefined || val === 0) return '0.00';
    const num = formatRupees(Math.abs(val));
    return side ? `${num} ${side}` : num;
  }

  function render() {
    setScreen('Ratio Analysis', 'ratio-analysis', 'F2: Period · Esc: Gateway');
    const currency = getBook()?.currency_symbol || '₹';
    const pFrom = period?.from ? entryDate(period.from) : '1-Apr-2026';
    const pTo = period?.to ? entryDate(period.to) : '31-Mar-2027';

    const g = data?.groups || {};
    const r = data?.ratios || {};

    const wcSide = g.working_capital >= 0 ? 'Dr' : 'Cr';
    const npSide = g.nett_profit >= 0 ? 'Cr' : 'Dr';

    main.innerHTML = `
      <section class="day-book ratio-analysis-screen">
        <div class="report-ledger-name">
          <strong>${escapeHtml(getBook()?.company || 'Bookr')}</strong>
          <span>For ${pFrom} to ${pTo}</span>
        </div>

        <div class="ratio-columns">
          <!-- Left Pane: Principal Groups -->
          <div class="ratio-pane">
            <div class="ratio-heading">Principal Groups</div>
            <table class="ratio-table">
              <tbody>
                <tr>
                  <td><strong>Working Capital</strong><span class="ratio-sub">(Current Assets - Current Liabilities)</span></td>
                  <td class="ratio-val" id="val-working-capital">${fmtPaise(g.working_capital, wcSide)}</td>
                </tr>
                <tr>
                  <td>Cash-in-Hand</td>
                  <td class="ratio-val" id="val-cash-in-hand">${fmtPaise(g.cash_in_hand, 'Dr')}</td>
                </tr>
                <tr>
                  <td>Bank Accounts</td>
                  <td class="ratio-val" id="val-bank-accounts">${fmtPaise(g.bank_accounts, 'Dr')}</td>
                </tr>
                <tr>
                  <td>Bank OD A/c</td>
                  <td class="ratio-val" id="val-bank-od">${fmtPaise(g.bank_od_ac, 'Cr')}</td>
                </tr>
                <tr>
                  <td>Sundry Debtors<span class="ratio-sub">(due till today)</span></td>
                  <td class="ratio-val" id="val-debtors">${fmtPaise(g.sundry_debtors, 'Dr')}</td>
                </tr>
                <tr>
                  <td>Sundry Creditors<span class="ratio-sub">(due till today)</span></td>
                  <td class="ratio-val" id="val-creditors">${fmtPaise(g.sundry_creditors, 'Cr')}</td>
                </tr>
                <tr>
                  <td>Sales Accounts</td>
                  <td class="ratio-val" id="val-sales">${fmtPaise(g.sales_accounts, 'Cr')}</td>
                </tr>
                <tr>
                  <td>Purchase Accounts</td>
                  <td class="ratio-val" id="val-purchases">${fmtPaise(g.purchase_accounts, 'Dr')}</td>
                </tr>
                <tr>
                  <td>Stock-in-Hand</td>
                  <td class="ratio-val" id="val-stock">${fmtPaise(g.stock_in_hand, 'Dr')}</td>
                </tr>
                <tr>
                  <td>Nett Profit</td>
                  <td class="ratio-val" id="val-net-profit">${fmtPaise(g.nett_profit, npSide)}</td>
                </tr>
                <tr>
                  <td><strong>Wkg. Capital Turnover</strong><span class="ratio-sub">(Sales Accounts / Working Capital)</span></td>
                  <td class="ratio-val" id="val-wkg-cap-turnover">${g.wkg_capital_turnover !== null ? g.wkg_capital_turnover.toFixed(2) : '—'}</td>
                </tr>
                <tr>
                  <td><strong>Inventory Turnover</strong><span class="ratio-sub">(Sales Accounts / Closing Stock)</span></td>
                  <td class="ratio-val" id="val-inv-turnover">${g.inventory_turnover !== null ? g.inventory_turnover.toFixed(2) : '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Right Pane: Principal Ratios -->
          <div class="ratio-pane">
            <div class="ratio-heading">Principal Ratios</div>
            <table class="ratio-table">
              <tbody>
                <tr>
                  <td><strong>Current Ratio</strong><span class="ratio-sub">(Current Assets : Current Liabilities)</span></td>
                  <td class="ratio-val" id="val-current-ratio">${r.current_ratio !== null ? r.current_ratio.toFixed(2) : '—'}</td>
                </tr>
                <tr>
                  <td><strong>Quick Ratio</strong><span class="ratio-sub">(Current Assets - Stock : Current Liabilities)</span></td>
                  <td class="ratio-val" id="val-quick-ratio">${r.quick_ratio !== null ? r.quick_ratio.toFixed(2) : '—'}</td>
                </tr>
                <tr>
                  <td><strong>Debt/Equity Ratio</strong><span class="ratio-sub">(Loans : Capital + Nett Profit)</span></td>
                  <td class="ratio-val" id="val-debt-equity">${r.debt_equity_ratio !== null ? r.debt_equity_ratio.toFixed(2) : '—'}</td>
                </tr>
                <tr>
                  <td><strong>Gross Profit %</strong></td>
                  <td class="ratio-val" id="val-gross-profit-pct">${r.gross_profit_pct !== null ? r.gross_profit_pct.toFixed(2) + ' %' : '—'}</td>
                </tr>
                <tr>
                  <td><strong>Nett Profit %</strong></td>
                  <td class="ratio-val" id="val-net-profit-pct">${r.nett_profit_pct !== null ? r.nett_profit_pct.toFixed(2) + ' %' : '—'}</td>
                </tr>
                <tr>
                  <td><strong>Cost %</strong><span class="ratio-sub">(as percentage of Sales Accounts)</span></td>
                  <td class="ratio-val" id="val-cost-pct">${r.cost_pct !== null ? r.cost_pct.toFixed(2) + ' %' : '—'}</td>
                </tr>
                <tr>
                  <td><strong>Recv. Turnover in days</strong><span class="ratio-sub">(payment performance of Debtors)</span></td>
                  <td class="ratio-val" id="val-recv-turnover">${r.recv_turnover_days !== null ? r.recv_turnover_days.toFixed(2) + ' days' : '—'}</td>
                </tr>
                <tr>
                  <td><strong>Return on Investment %</strong><span class="ratio-sub">(Nett Profit / Capital + Nett Profit)</span></td>
                  <td class="ratio-val" id="val-roi">${r.return_on_investment_pct !== null ? r.return_on_investment_pct.toFixed(2) + ' %' : '—'}</td>
                </tr>
                <tr>
                  <td><strong>Return on Wkg. Capital %</strong><span class="ratio-sub">(Nett Profit / Working Capital) %</span></td>
                  <td class="ratio-val" id="val-return-wkg-cap">${r.return_on_wkg_capital_pct !== null ? r.return_on_wkg_capital_pct.toFixed(2) + ' %' : '—'}</td>
                </tr>
              </tbody>
            </table>
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

  async function openRatioAnalysis(customPeriod = null) {
    period = customPeriod;
    const query = period ? `?from=${period.from}&to=${period.to}` : '';
    data = await api(`/api/ratio-analysis${query}`);
    render();
  }

  return {
    open: openRatioAnalysis
  };
}
