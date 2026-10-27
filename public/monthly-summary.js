import {companyCurrency} from './company-currency.js';
import {entryDate,formatRupees} from './entry-values.js';

const monthNames=['January','February','March','April','May','June','July','August','September','October','November','December'];
const money=value=>value?formatRupees(value):'';
const closing=value=>value?`${formatRupees(Math.abs(value))} ${value<0?'Cr':'Dr'}`:'';

export function monthlyMarkup(report,company,escapeHtml,currency={}){
  const maximum=Math.max(1,...report.rows.map(row=>Math.abs(row.closing)));
  const chartWidth=Math.max(960,report.rows.length*80);
  // Bar heights use inline SVG geometry because the app disallows inline styles.
  const bars=report.rows.map((row,i)=>{
    const height=row.display_active?Math.round(Math.abs(row.closing)/maximum*90):0;
    return `<rect x="${i*80+12}" y="${96-height}" width="45" height="${height}" class="${row.closing<0?'credit':''}"></rect><text x="${i*80+35}" y="113" text-anchor="middle">${monthNames[Number(row.from.slice(5,7))-1].slice(0,3)}</text>`;
  }).join('');
  return `<section class="monthly-summary day-book" aria-label="Ledger monthly summary"><div class="monthly-heading"><div>Particulars</div><div><em>${escapeHtml(report.ledger.name)}</em><strong>${escapeHtml(company)}</strong><span>${entryDate(report.period.from)} to ${entryDate(report.period.to)}</span></div></div><div class="monthly-table-scroll"><table class="monthly-table"><colgroup><col><col class="money-col"><col class="money-col"><col class="closing-col"></colgroup><thead><tr><th rowspan="2" aria-label="Particulars"></th><th colspan="2">Transactions</th><th rowspan="2">Closing<br>Balance</th></tr><tr><th>Debit</th><th>Credit</th></tr></thead><tbody><tr class="monthly-opening"><td>Opening Balance</td><td></td><td></td><td class="amount" id="monthly-opening">${closing(report.opening)}</td></tr>${report.rows.map((row,i)=>`<tr data-report-row="${i}" data-month="${row.month}"><td><button type="button" data-month-row="${i}">${monthNames[Number(row.from.slice(5,7))-1]}</button></td><td class="amount monthly-debit">${row.display_active?money(row.debit):''}</td><td class="amount monthly-credit">${row.display_active?money(row.credit):''}</td><td class="amount monthly-closing">${row.display_active?closing(row.closing):''}</td></tr>`).join('')}</tbody></table></div><div class="monthly-grand-total"><strong>Grand Total</strong><strong id="monthly-debit">${money(report.totals.debit)}</strong><strong id="monthly-credit">${money(report.totals.credit)}</strong><strong id="monthly-closing">${closing(report.totals.closing)}</strong></div><figure class="monthly-chart"><figcaption>Monthly closing balance · ${escapeHtml(companyCurrency(currency).currency_symbol)} · red: Dr, blue: Cr</figcaption><svg viewBox="0 0 ${chartWidth} 120" role="img" aria-label="Closing balances by month"><line x1="0" x2="${chartWidth}" y1="96" y2="96"></line>${bars}</svg></figure></section>`;
}
