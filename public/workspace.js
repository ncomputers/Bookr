import { createSalesWorkspace } from './sales.js';
import { createReceiptWorkspace } from './receipts.js';
import { createReports } from './reports.js';
import { createPurchaseWorkspace } from './purchases.js';
import { createFinancialWorkspace } from './financial-reports.js';
import { createContraWorkspace } from './contra.js';
import { createChartWorkspace } from './chart-of-accounts.js';
import {createJournalWorkspace} from './journal.js';
import {createGeneralJournalWorkspace} from './general-journal.js';
import {askDialog} from './confirmation-dialog.js';
import {createOpeningBalanceEditor,supportsOpeningBalance,partyOpening} from './opening-balance.js';
import {ledgerGroups} from './ledger-groups.js';
import {createListPicker} from './list-picker.js';
import {createCompanyWorkspace} from './companies.js';
import {companyCalendar,companyPeriod,shortCompanyDate,companyDateCaption} from './company-context.js';
import {entryDate} from './entry-values.js';
import {createWorkingDateContext,followingWorkingDate} from './working-date.js';
import {editReportDate,editReportPeriod} from './report-period.js';
import {createCompanyDataWorkspace} from './company-data.js';
import {createCompanyLifecycle} from './company-lifecycle.js';

const main = document.querySelector('#main');
const hint = document.querySelector('#screen-hint');
const title = document.querySelector('.screen-title h1');
const commands = document.querySelector('.command-strip');
const closeButton = document.querySelector('.screen-title button');
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
})[char]);
const groups = [
  { title:'MASTERS', items:[{ label:'Create', hot:0 }, { label:'Alter', hot:0 }, { label:'Chart of Accounts', hot:1 }] },
  { title:'TRANSACTIONS', items:[{ label:'Vouchers', hot:0 }, { label:'Day Book', hot:4 }] },
  { title:'REPORTS', className:'reports', items:[{ label:'Ledger Vouchers', hot:0 }, { label:'Bills Receivable', hot:0 }, { label:'Display More Reports', hot:0 }, {label:'Bills Payable',hot:5}, {label:'Balance Sheet',hot:0}, {label:'Profit & Loss A/c',hot:0}] }
];
const menu = [...groups.flatMap(group => group.items), { label:'Quit', hot:0 }];
let book, view = 'loading', selected = 0, mode = 'create', editing = null, initialValues = '', saving = false;
let candidates = [], candidateIndex = 0;
let ledgerReturn = null;
let ledgerKind='customer';
let openingEditor=null;
let ledgerGroupPicker=null;
let workingDateStore=null;
let activeCompanyId=null,loadedSummaries=[],serverCapabilities={};
const lifecycle=createCompanyLifecycle({storage:sessionStorage,api,reload:()=>location.reload()});
const ledgerFields=()=>[...main.querySelectorAll('#ledger-form input,#ledger-form select,#ledger-form textarea')].filter(field=>!field.disabled && field.getClientRects().length>0);
function openVoucher(voucher,from='gateway',type=voucher?.type ?? 'sale'){
  if(type==='purchase')purchases.renderPurchase(voucher,from);
  else if(type==='payment')payments.renderReceipt(voucher,from);
  else if(type==='receipt')receipts.renderReceipt(voucher,from);
  else if(type==='contra')contra.render(voucher,from);
  else if(type==='journal' && (voucher?.journal_mode==='general' || voucher?.details?.journal_mode==='general'))generalJournal.render(voucher,from);
  else if(type==='journal')journal.render(voucher,from);
  else sales.renderSale(voucher,from);
}
const sales = createSalesWorkspace({main,hint,api,setScreen,getBook:() => book,refreshBook,escapeHtml,askDialog,renderGateway,getView:() => view,
  openReceipt:(voucher,from) => voucher ? receipts.renderReceipt(voucher,from) : receipts.openNew(from),
  openOtherVoucher:openVoucher,
  openLedgerFromSale:callbacks => {ledgerKind='customer';renderLedger(null,'Create a customer, then return to the sales voucher.',callbacks);}});
const receipts = createReceiptWorkspace({main,hint,api,setScreen,getBook:()=>book,refreshBook,escapeHtml,askDialog,renderGateway,getView:()=>view,
  openJournal:(voucher,from)=>openFresh(()=>journal.render(voucher,from)),
  openContra:(voucher,from)=>openFresh(()=>contra.render(voucher,from)),
  openDayBook:()=>sales.openDayBook(),openSale:(voucher,from)=>openFresh(()=>sales.renderSale(voucher,from)),
  openPurchase:(voucher,from)=>openFresh(()=>purchases.renderPurchase(voucher,from)),openPayment:(voucher,from)=>openFresh(()=>payments.renderReceipt(voucher,from))});
const payments=createReceiptWorkspace({main,hint,api,setScreen,getBook:()=>book,refreshBook,escapeHtml,askDialog,renderGateway,getView:()=>view,type:'payment',
  openJournal:(voucher,from)=>openFresh(()=>journal.render(voucher,from)),
  openContra:(voucher,from)=>openFresh(()=>contra.render(voucher,from)),
  openDayBook:()=>sales.openDayBook(),openSale:(voucher,from)=>openFresh(()=>sales.renderSale(voucher,from)),openPurchase:(voucher,from)=>openFresh(()=>purchases.renderPurchase(voucher,from)),openReceipt:(voucher,from)=>openFresh(()=>receipts.renderReceipt(voucher,from))});
const purchases=createPurchaseWorkspace({main,hint,api,setScreen,getBook:()=>book,refreshBook,escapeHtml,askDialog,renderGateway,getView:()=>view,openDayBook:()=>sales.openDayBook(),openVoucher:(voucher,from,type)=>openFresh(()=>openVoucher(voucher,from,type))});
const contra=createContraWorkspace({main,hint,api,setScreen,getView:()=>view,getBook:()=>book,refreshBook,escapeHtml,askDialog,renderGateway,openDayBook:()=>sales.openDayBook(),openVoucher:(voucher,from,type)=>openFresh(()=>openVoucher(voucher,from,type))});
const journal=createJournalWorkspace({main,hint,api,setScreen,getView:()=>view,getBook:()=>book,refreshBook,escapeHtml,askDialog,renderGateway,openDayBook:()=>sales.openDayBook(),openVoucher:(voucher,from,type)=>openFresh(()=>openVoucher(voucher,from,type)),openGeneral:from=>openFresh(()=>generalJournal.render(null,from))});
const generalJournal=createGeneralJournalWorkspace({main,hint,api,setScreen,getView:()=>view,getBook:()=>book,refreshBook,escapeHtml,askDialog,renderGateway,openDayBook:()=>sales.openDayBook(),openVoucher:(voucher,from,type)=>openFresh(()=>openVoucher(voucher,from,type)),openLegacy:from=>openFresh(()=>journal.render(null,from))});
const reports = createReports({main,hint,api,setScreen,getBook:()=>book,refreshBook,escapeHtml,renderGateway,getView:()=>view,
  openVoucher,openOpeningMaster:async(id,back,openingBillId)=>{await refreshBook();renderLedger(await api('/api/ledgers/'+id),'',{onSaved:back,onCancel:back,lockKind:true});if(openingBillId!=null)openingEditor.showBills(openingBillId);}});
const financial=createFinancialWorkspace({main,hint,api,setScreen,refreshBook,getBook:()=>book,getView:()=>view,renderGateway,escapeHtml,openLedger:reports.openLedgerFromReport});
const chart=createChartWorkspace({main,hint,setScreen,getView:()=>view,getBook:()=>book,refreshBook,renderGateway,escapeHtml,openLedger:(ledger,returnTo)=>openFresh(async()=>renderLedger(await api('/api/ledgers/'+ledger.id),'',returnTo)),createLedger:(kind,returnTo)=>openFresh(()=>{ledgerKind=kind;renderLedger(null,'',returnTo);})});
const companyUI=createCompanyWorkspace({main,hint,api,setScreen,getView:()=>view,getBook:()=>book,renderGateway,escapeHtml,askDialog,isBusy:()=>busy(),isDirty:()=>isDirty(),activeId:()=>activeCompanyId,onSelect:id=>lifecycle.select(id),getLoadedIds:()=>lifecycle.read().loadedIds,onShut:id=>lifecycle.shut(id)});
const companyDataUI=createCompanyDataWorkspace({main,hint,api,setScreen,getView:()=>view,getBook:()=>book,getCapabilities:()=>serverCapabilities,refreshBook,renderGateway,escapeHtml,askDialog,isBusy:()=>busy(),isDirty:()=>isDirty(),activeId:()=>activeCompanyId,onSelect:id=>lifecycle.select(id)});
const busy = () => saving || sales.isSaving() || receipts.isSaving() || payments.isSaving() || purchases.isSaving() || contra.isSaving() || journal.isSaving() || generalJournal.isSaving() || reports.isSaving() || financial.isSaving() || chart.isSaving() || companyUI.isSaving() || companyDataUI.isSaving();

async function refreshBook() {
  if(activeCompanyId===null)throw new Error('Select a company to open its books.');
  const next=await api('/api/state');
  for(const voucher of next.vouchers){
    if(voucher.type==='purchase' && next.ledgers.find(ledger=>ledger.id===voucher.customer_id)?.kind==='cash' && next.capabilities?.cash_purchases!==true)throw new Error('This preview cannot safely open Cash Purchases. Open the latest Bookr server before continuing.');
    if(voucher.type!=='journal' || (voucher.journal_mode!=='general' && voucher.details?.journal_mode!=='general'))continue;
    const entries=voucher.entries;
    if(next.capabilities?.general_journal!==true || !Array.isArray(entries) || entries.length<2 || entries.length>100 ||
      new Set(entries.map(entry=>entry.ledger_id)).size!==entries.length ||
      entries.some(entry=>!Number.isSafeInteger(entry.ledger_id) || !['debit','credit'].includes(entry.side) || !Number.isSafeInteger(entry.amount) || entry.amount<=0) ||
      ['debit','credit'].some(side=>entries.filter(entry=>entry.side===side).reduce((sum,entry)=>sum+entry.amount,0)!==voucher.amount)){
      throw new Error('This preview returned unsupported or incomplete General Journal entries. Open the latest Bookr server before continuing.');
    }
  }
  const calendar=companyCalendar(next);
  workingDateStore??=createWorkingDateContext({companyId:activeCompanyId,booksFrom:calendar.books_from,period:{from:calendar.financial_year_from,to:calendar.financial_year_to},storage:sessionStorage});
  next.working_context=workingDateStore.current();
  next.current_period=workingDateStore.period();
  loadedSummaries=await lifecycle.loadedSummaries();
  book=next;document.querySelector('.application-name strong').textContent=book.preview?.label || 'DEMO';return book;
}
async function openFresh(action) {
  if (busy()) return;
  saving = true;
  const paused=view==='gateway'?[...main.querySelectorAll('button')].map(button=>({button,disabled:button.disabled})):[];
  if(paused.length){main.setAttribute('aria-busy','true');for(const {button}of paused)button.disabled=true;}
  try { await refreshBook(); await action(); }
  catch (error) { hint.textContent = `Unable to refresh company: ${error.message}`; }
  finally {for(const {button,disabled}of paused)if(button.isConnected)button.disabled=disabled;if(paused.length)main.removeAttribute('aria-busy');saving = false;}
}

async function api(path, options = {}) {
  const period=workingDateStore?.period();
  const response = await fetch(path, { ...options, headers:{ 'Content-Type':'application/json',...(activeCompanyId!==null?{'X-Bookr-Company':activeCompanyId}:{}),...(period?{'X-Bookr-Period':period.from+'/'+period.to}:{}), ...options.headers } });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Unable to complete this request.');
  return value;
}
function setScreen(name, screen, message) {
  ledgerGroupPicker?.destroy();ledgerGroupPicker=null;
  generalJournal.dispose();
  view = screen;
  main.dataset.screen=screen;
  delete main.dataset.mode;
  main.className = screen === 'gateway' ? '' : 'entry-workspace';
  title.textContent = name;
  document.querySelector('.screen-company')?.remove();
  if (['ledger','sale','receipt','purchase','payment','contra','contra-postings','daybook','postings','receipt-postings','purchase-postings','payment-postings','statement','outstanding','trial-balance','balance-sheet','profit-loss','financial-group','chart-ledgers','monthly-summary','journal','journal-postings','journal-general','journal-general-postings','company-alter'].includes(screen)) {
    const company = document.createElement('span');
    company.className = 'screen-company'; company.textContent = book.company; title.after(company);
  }
  document.title = `${name} | Bookr`;
  const dataKey=document.querySelector('[data-company-data]');if(dataKey)dataKey.disabled=serverCapabilities.company_backup!==true;
  document.querySelectorAll('[data-sales-rail]').forEach(button => button.remove());
  const dateKey = document.querySelector('.function-rail button');
  dateKey.disabled = true; dateKey.onclick = null;dateKey.innerHTML='<span><u>F2</u>: Date</span><span>‹</span>';
  closeButton.disabled = screen === 'gateway';
  hint.textContent = message;
  commands.querySelectorAll('button,.empty-command').forEach(element => element.remove());
  const quit = document.createElement('button');
  quit.type = 'button'; quit.innerHTML = '<u>Q</u>: Back <span>Esc</span>';
  quit.disabled = screen === 'gateway'; quit.addEventListener('click', goBack);
  commands.prepend(quit);
  if (screen === 'ledger') {
    const accept = document.createElement('button');
    accept.type = 'button'; accept.id = 'accept-ledger'; accept.innerHTML = '<u>A</u>: Accept <span>Ctrl+A</span>';
    accept.addEventListener('click', saveLedger); quit.after(accept);
  }
  document.querySelector('.rail-preview').innerHTML = 'Bookr<br><span>INR · Fictional accounts</span>';
}
function selectMenu(index, focus = false) {
  selected = (index + menu.length) % menu.length;
  document.querySelectorAll('[data-menu]').forEach((button, i) => {
    button.classList.toggle('selected', selected === i);
    button.setAttribute('aria-current', String(selected === i));
    button.tabIndex = selected === i ? 0 : -1;
    if (focus && selected === i) button.focus({ preventScroll:true });
  });
  hint.textContent = 'Create / Alter ledgers · Sales / Receipts / Purchases / Payments · Reports · ↑ ↓ Enter';
}
function menuButton(item, index, className = '') {
  const label = `${escapeHtml(item.label.slice(0,item.hot))}<span class="hot-letter">${escapeHtml(item.label[item.hot])}</span>${escapeHtml(item.label.slice(item.hot+1))}`;
  const enabled = [0,1,2,3,4,5,6,7,8,9,10].includes(index);
  return `<button class="${className}" data-menu="${index}" aria-disabled="${!enabled}" title="${enabled ? 'Open ' + escapeHtml(item.label) : 'Available in a later layer'}">${label}</button>`;
}
function renderGateway(focusIndex = 0) {
  if(!book){renderEmptyCompany();return;}
  setScreen('Gateway of Bookr', 'gateway', '');
  let itemIndex = 0;
  const lastVoucherDate = loadedSummaries.find(row=>row.profile.id===activeCompanyId)?.last_voucher_date??null;
  const period=companyPeriod(book);
  const dateCaption=value=>value?entryDate(value):'No Vouchers Entered';
  const lastEntry = dateCaption(lastVoucherDate);
  main.innerHTML = `
    <section class="company-pane" aria-label="Selected company">
      <div class="period-info"><div><div class="small-label">CURRENT PERIOD</div><button type="button" id="change-company-period" class="period-value" aria-label="Change current period" ${book.capabilities?.current_period===true?'':'disabled'}>${shortCompanyDate(period.from)} to ${shortCompanyDate(period.to)}</button></div><div class="date"><div class="small-label">CURRENT DATE</div><div class="period-value">${companyDateCaption(book)}</div></div></div>
      <div class="company-table-heading"><span class="small-label">NAME OF COMPANY</span><span class="small-label">DATE OF LAST ENTRY</span></div>
      <div class="company-row"><span class="company-name">${escapeHtml(book.company)}</span><span class="last-entry">${escapeHtml(lastEntry)}</span></div>
      <div class="loaded-companies" aria-label="Loaded companies">${loadedSummaries.map(row=>`<button type="button" class="company-row loaded-company-row" data-loaded-company="${row.profile.id}" ${row.profile.id===activeCompanyId?'aria-current="true"':''}><span>${escapeHtml(row.profile.name)}</span><span>${dateCaption(row.last_voucher_date)}</span></button>`).join('')}</div>
    </section>
    <section class="menu-pane" aria-label="Gateway menu"><div class="gateway-menu"><div class="gateway-menu-title">Gateway of Bookr</div><div class="gateway-menu-body">
      ${groups.map(group => `<div class="menu-section ${group.className || ''}"><h2 class="menu-heading">${group.title}</h2>${group.items.map(item => menuButton(item,itemIndex++)).join('')}</div>`).join('')}
      ${menuButton(menu.at(-1),itemIndex,'quit-row')}
    </div></div></section>`;
  main.querySelectorAll('[data-menu]').forEach(button => button.addEventListener('click', () => {
    selectMenu(Number(button.dataset.menu)); openGatewayItem();
  }));
  selectMenu(focusIndex);
  const dateKey=document.querySelector('.function-rail button');dateKey.disabled=false;dateKey.onclick=changeWorkingDate;
  main.querySelector('#change-company-period').onclick=changeCompanyPeriod;
  main.querySelectorAll('[data-loaded-company]').forEach(button=>button.onclick=()=>{if(busy())return;saving=true;lifecycle.select(button.dataset.loadedCompany).catch(error=>{hint.textContent=error.message;}).finally(()=>{saving=false;});});
}
function renderEmptyCompany(){
  book=null;workingDateStore=null;loadedSummaries=[];
  setScreen('Gateway of Bookr','company-empty','Alt+F3: select company · Alt+K: company · Alt+Y: restore');
  main.innerHTML=`<section class="company-empty"><h2>No company loaded</h2><p>Select a company to open its books.</p><button type="button" id="select-company-empty">Select Company <small>Alt+F3</small></button><button type="button" id="create-company-empty">Create Company</button></section>`;
  main.querySelector('#select-company-empty').onclick=()=>companyUI.openSelector('select');main.querySelector('#create-company-empty').onclick=companyUI.openCreate;main.querySelector('#select-company-empty').focus();
}
function changeWorkingDate(){
  if(view!=='gateway'||busy()||document.querySelector('dialog')||!workingDateStore)return;
  let proposed;try{proposed=followingWorkingDate(workingDateStore.current().date);}catch{proposed=workingDateStore.current().date;}
  if(proposed>companyPeriod(book).to)proposed=companyPeriod(book).to;
  title.textContent='Change Current Date';document.title='Change Current Date | Bookr';
  hint.textContent='Enter: accept current date · Ctrl+A: accept · Esc: clear, then back';
  editReportDate({date:proposed,companyDate:true,onDone:({from})=>{
    book.working_context=workingDateStore.accept(from);renderGateway(selected);
  },onClose:()=>{title.textContent='Gateway of Bookr';document.title='Gateway of Bookr | Bookr';selectMenu(selected);}});
}
function changeCompanyPeriod(){
  if(view!=='gateway'||busy()||document.querySelector('dialog')||!workingDateStore||book.capabilities?.current_period!==true)return;
  let accepted=false;title.textContent='Change Period';document.title='Change Period | Bookr';
  editReportPeriod({period:workingDateStore.period(),companyPeriod:true,onDone:next=>{
    workingDateStore.acceptPeriod(next);accepted=true;
  },onClose:()=>{if(accepted)location.reload();else{title.textContent='Gateway of Bookr';document.title='Gateway of Bookr | Bookr';selectMenu(selected);}}});
}
function openGatewayItem() {
  if (selected < 2) renderMasters(selected === 0 ? 'create' : 'alter');
  else if (selected === 3) openFresh(() => sales.renderSale());
  else if (selected === 2) chart.open();
  else if (selected === 4) sales.openDayBook();
  else if (selected === 5) reports.chooseLedger();
  else if (selected === 6) reports.openOutstanding();
  else if (selected === 7) reports.openMoreReports();
  else if (selected === 8) reports.openPayables();
  else if (selected === 9) financial.openBalanceSheet();
  else if (selected === 10) financial.openProfitAndLoss();
  else hint.textContent = `${menu[selected].label} will be connected in a later layer.`;
}
function renderMasters(nextMode = mode) {
  mode = nextMode;
  ledgerKind='customer';
  setScreen(mode === 'create' ? 'Master Creation' : 'Master Alteration', 'masters', 'Ledger · Enter to open · Esc to Gateway');
  main.innerHTML = `<section class="master-menu" aria-label="${mode === 'create' ? 'Create' : 'Alter'} masters"><div class="gateway-menu-title">${mode === 'create' ? 'Master Creation' : 'Master Alteration'}</div><div class="master-menu-content"><h2 class="menu-heading">ACCOUNTING MASTERS</h2><button id="open-ledger" class="selected">Ledger</button><p>Cash / Bank / Sales / Purchases / Customers / Suppliers / Expenses / Incomes / Capital</p></div></section>`;
  main.querySelector('#open-ledger').addEventListener('click', () => openFresh(() => mode === 'create' ? renderLedger() : renderSelector()));
  main.querySelector('#open-ledger').focus();
}
function renderSelector() {
  setScreen('Select Ledger', 'selector', 'Type a name or alias · ↑ ↓ Enter · Esc to masters');
  main.innerHTML = `<section class="ledger-selector" aria-label="Select ledger"><label for="ledger-search">Name of Ledger</label><input id="ledger-search" type="text" autocomplete="off" aria-controls="ledger-options"><div class="selection-heading">List of Ledgers</div><div id="ledger-options" role="listbox" aria-label="Ledgers"></div><p class="selection-note">Cash / Bank / Sales / Purchases / Customers / Suppliers / Expenses / Incomes / Capital · ${book.ledgers.length} saved</p></section>`;
  const search = main.querySelector('#ledger-search');
  search.addEventListener('input', () => { candidateIndex = 0; filterLedgers(search.value); });
  filterLedgers(''); search.focus();
}
function filterLedgers(query) {
  query = query.toLocaleLowerCase().trim();
  candidates = book.ledgers.filter(row => `${row.name} ${row.alias}`.toLocaleLowerCase().includes(query));
  const options = main.querySelector('#ledger-options');
  options.innerHTML = candidates.length ? candidates.map((row,index) => `<button type="button" role="option" data-candidate="${index}" aria-selected="false">${escapeHtml(row.name)}${row.alias ? `<small>${escapeHtml(row.alias)}</small>` : ''}</button>`).join('') : '<p class="no-ledgers">No ledgers found. Use Create → Ledger to add one.</p>';
  options.querySelectorAll('button').forEach(button => button.addEventListener('click', () => { candidateIndex = Number(button.dataset.candidate); openCustomer(); }));
  selectCandidate(0);
}
function selectCandidate(step) {
  if (!candidates.length) return;
  candidateIndex = (candidateIndex + step + candidates.length) % candidates.length;
  main.querySelectorAll('[data-candidate]').forEach((button,index) => {
    button.classList.toggle('selected', index === candidateIndex);
    button.setAttribute('aria-selected', String(index === candidateIndex));
    if (index === candidateIndex) button.scrollIntoView({ block:'nearest' });
  });
}
async function openCustomer() {
  if (!candidates.length || saving) return;
  saving = true;
  try { const candidate=candidates[candidateIndex];await refreshBook();const ledger=await api('/api/ledgers/'+candidate.id);renderLedger(ledger); }
  catch (error) { hint.textContent = error.message; }
  finally { saving = false; }
}
function ledgerValues() {
  const kind=main.querySelector('#ledger-group').value;
  return {kind,...Object.fromEntries(['name','alias','mailing_name','address','state','country','pincode'].map(name => [name,main.querySelector(`[name="${name}"]`).value])),...(['expense','income'].includes(kind)?{ledger_type:'Not Applicable'}:{}),...(kind==='bank'?{bank:Object.fromEntries([...main.querySelectorAll('[data-bank-field]')].map(field=>[field.dataset.bankField,field.value]))}:{})};
}
const ledgerDraft=()=>({...ledgerValues(),opening:openingEditor?.snapshot()});
function isDirty() { return (view === 'ledger' && JSON.stringify(ledgerDraft()) !== initialValues) || sales.dirty() || receipts.dirty() || payments.dirty() || purchases.dirty() || contra.dirty() || journal.dirty() || generalJournal.dirty() || companyUI.dirty() || companyDataUI.dirty(); }
function renderLedger(ledger = null, message = '',returnTo = null) {
  editing = ledger;
  if(ledger)ledgerKind=ledger.kind;
  ledgerReturn = returnTo;
  setScreen(ledger ? 'Ledger Alteration' : 'Ledger Creation', 'ledger', message || 'Enter: next field · Shift+Tab: back · Ctrl+A: save · Esc: back');
  main.innerHTML = `<form id="ledger-form" novalidate autocomplete="off">
    <div class="ledger-identity">
      <div class="identity-fields"><div class="identity-row"><label for="ledger-name">Name</label><span>:</span><input id="ledger-name" name="name" maxlength="120" required value="${escapeHtml(ledger?.name ?? '')}" aria-describedby="ledger-error" spellcheck="false"></div><div class="identity-row"><label for="ledger-alias"><i>(alias)</i></label><span>:</span><input id="ledger-alias" name="alias" maxlength="120" value="${escapeHtml(ledger?.alias ?? '')}" spellcheck="false"></div></div>
      <aside class="opening-total"><strong>Total Opening Balance</strong><span>0.00</span></aside>
    </div>
    <div class="ledger-detail-columns"><section class="ledger-accounting" aria-label="Accounting details">
      <div class="accounting-row"><label for="ledger-group">Under</label><span>:</span><div><select id="ledger-group" aria-describedby="ledger-scope" ${ledger || (returnTo && returnTo.lockKind!==false)?'disabled':''}>${ledgerGroups.map(group=>`<option value="${group.kind}" ${ledgerKind===group.kind?'selected':''}>${group.name}</option>`).join('')}</select><i class="parent-group"></i></div></div>
      <div class="accounting-row billwise-row"><label for="ledger-billwise">Maintain balances bill-by-bill</label><span>:</span><select id="ledger-billwise" aria-describedby="ledger-scope"><option>Yes</option></select></div>
    </section><section class="ledger-mailing" aria-label="Mailing details"><h2>Mailing Details</h2>
      <div class="mailing-row"><label for="mailing-name">Name</label><span>:</span><input id="mailing-name" name="mailing_name" maxlength="120" value="${escapeHtml(ledger?.mailing_name ?? ledger?.name ?? '')}"></div>
      <div class="mailing-row address-row"><label for="mailing-address">Address</label><span>:</span><textarea id="mailing-address" name="address" maxlength="1000" rows="3">${escapeHtml(ledger?.address ?? '')}</textarea></div>
      <div class="mailing-row"><label for="mailing-state">State</label><span>:</span><input id="mailing-state" name="state" maxlength="120" value="${escapeHtml(ledger?.state ?? 'Not Applicable')}"></div>
      <div class="mailing-row"><label for="mailing-country">Country</label><span>:</span><input id="mailing-country" name="country" maxlength="120" value="${escapeHtml(ledger?.country ?? 'India')}"></div>
      <div class="mailing-row"><label for="mailing-pincode">Pincode</label><span>:</span><input id="mailing-pincode" name="pincode" maxlength="20" value="${escapeHtml(ledger?.pincode ?? '')}"></div>
      <p id="ledger-scope" class="ledger-scope">Customer ledger · Sundry Debtors · bill-by-bill balances · no opening balance.</p></section></div>
    <div id="ledger-error" class="ledger-error" role="alert"></div>
    <div id="ledger-opening-editor"></div>
  </form>`;
  const name = main.querySelector('#ledger-name');
  openingEditor=createOpeningBalanceEditor({host:main.querySelector('#ledger-opening-editor'),summary:main.querySelector('.opening-total'),ledger,openingDate:companyCalendar(book).books_from,getLedgers:()=>book.ledgers,getName:()=>name.value || 'Ledger',escapeHtml,onError:message=>{main.querySelector('#ledger-error').textContent=message;}});
  const bankSection=document.createElement('div');bankSection.className='bank-ledger-fields';
  bankSection.innerHTML='<h2>Bank Account Details</h2>'+Object.entries({account_holder:"A/c Holder's Name",account_number:'A/c No.',ifs_code:'IFS Code',swift_code:'SWIFT Code',bank_name:'Bank Name',branch:'Branch'}).map(([key,label])=>`<div class="accounting-row"><label for="bank-${key}">${label}</label><span>:</span><input id="bank-${key}" data-bank-field="${key}" maxlength="120" value="${escapeHtml(ledger?.bank?.[key] ?? (key==='account_holder'?book.company:key==='bank_name'?'Not Applicable':''))}" ${key==='bank_name'?'readonly':''}></div>`).join('');
  main.querySelector('.ledger-accounting').append(bankSection);
  const expenseSettings=document.createElement('div');expenseSettings.className='expense-ledger-settings';expenseSettings.innerHTML='<div class="accounting-row"><label for="expense-ledger-type">Type of Ledger</label><span>:</span><input id="expense-ledger-type" value="Not Applicable" readonly></div>';main.querySelector('.ledger-accounting').append(expenseSettings);
  for(const [key,limit] of Object.entries({account_number:80,ifs_code:40,swift_code:40}))bankSection.querySelector(`[data-bank-field="${key}"]`).maxLength=limit;
  const updateKind=()=>{
    ledgerKind=main.querySelector('#ledger-group').value;
    const bank=ledgerKind==='bank',expense=['expense','income'].includes(ledgerKind),party=['customer','supplier'].includes(ledgerKind),group=ledgerGroups.find(group=>group.kind===ledgerKind);
    main.querySelector('.parent-group').textContent=expense || ledgerKind==='capital'?'':'('+(['sales','purchase'].includes(ledgerKind)?'Primary':ledgerKind==='supplier'?'Current Liabilities':'Current Assets')+')';
    main.querySelector('.billwise-row').hidden=!party;main.querySelector('#ledger-billwise').disabled=!party;bankSection.hidden=!bank;bankSection.querySelectorAll('input').forEach(field=>field.disabled=!bank);
    expenseSettings.hidden=!expense;main.querySelector('#expense-ledger-type').disabled=!expense;
    if(expense && !ledger){if(main.querySelector('#mailing-name').value===name.value)main.querySelector('#mailing-name').value='';if(main.querySelector('#mailing-state').value==='Not Applicable')main.querySelector('#mailing-state').value='';if(main.querySelector('#mailing-country').value==='India')main.querySelector('#mailing-country').value='';}
    main.querySelector('#ledger-scope').textContent=`${group.name} · ${party?'bill-by-bill balances · ':''}${supportsOpeningBalance(ledgerKind)?'opening balance on '+entryDate(companyCalendar(book).books_from)+'.':'opening balance is zero in this version.'}`;
    openingEditor.setKind(ledgerKind);
  };
  main.querySelector('#ledger-group').addEventListener('change',updateKind);updateKind();
  ledgerGroupPicker=createListPicker({host:main,select:main.querySelector('#ledger-group'),id:'ledger-group',title:'List of Groups',searchLabel:'Search groups',acceptControl:document.querySelector('#accept-ledger'),onAcceptAll:()=>saveLedger(),onAccepted:()=>{
    const fields=ledgerFields();
    const index=fields.indexOf(main.querySelector('#ledger-group'));fields[index+1]?.focus();
  }});
  let previousName = name.value;
  name.addEventListener('input', () => {
    const mailing = main.querySelector('#mailing-name');
    if (!['expense','income'].includes(ledgerKind) && (!mailing.value || mailing.value === previousName)) mailing.value = name.value;
    previousName = name.value;
  });
  main.querySelector('#ledger-form').addEventListener('input',() => {
    main.querySelector('#ledger-error').textContent = '';
    name.removeAttribute('aria-invalid');
  });
  main.querySelector('#ledger-form').addEventListener('submit', event => { event.preventDefault(); saveLedger(); });
  initialValues = JSON.stringify(ledgerDraft()); name.focus(); name.select();
}
async function saveLedger() {
  if (view !== 'ledger' || saving) return;
  if(ledgerGroupPicker?.isOpen() && !ledgerGroupPicker.accept())return;
  const values = ledgerValues();
  const errorBox = main.querySelector('#ledger-error');
  errorBox.textContent = '';
  main.querySelector('#ledger-name').removeAttribute('aria-invalid');
  if (!values.name.trim()) {
    errorBox.textContent = `Enter a ${ledgerKind} name.`;
    main.querySelector('#ledger-name').setAttribute('aria-invalid','true');
    main.querySelector('#ledger-name').focus(); return;
  }
  try { if(supportsOpeningBalance(values.kind))values.opening_balance=openingEditor.read(); }
  catch(error){errorBox.textContent=error.message;openingEditor.focusError();return;}
  if(partyOpening(values.kind)){if(!openingEditor.billsReady()){openingEditor.showBills();return;}values.opening_bills=openingEditor.billValues();}
  saving = true;
  const accept = document.querySelector('#accept-ledger');
  accept.disabled = true;
  const fields = [...main.querySelectorAll('input,select,textarea')];
  fields.forEach(field => { field.disabled = true; });
  openingEditor.setDisabled(true);
  let saved;
  try {
    const route='ledgers';
    saved = await api(editing ? `/api/${route}/${editing.id}` : `/api/${route}`, {
      method:editing ? 'PUT' : 'POST', body:JSON.stringify({ ...values, ...(editing ? { revision:editing.revision } : {}) })
    });
    book.ledgers = book.ledgers.filter(row => row.id !== saved.id).concat(saved).sort((a,b) => a.name.localeCompare(b.name));
    await refreshBook().catch(() => {});
    const wasEditing = Boolean(editing);
    if (ledgerReturn) { const returnTo = ledgerReturn; ledgerReturn = null; returnTo.onSaved(saved); }
    else if (wasEditing) { renderSelector(); hint.textContent = `Saved changes to ${saved.name}. Select a ledger to reopen.`; }
    else renderLedger(null, `Saved ${saved.name}. Enter the next ledger, or Esc to return.`);
  } catch (error) {
    errorBox.textContent = error.message;
    fields.forEach(field => { field.disabled = false; });
    main.querySelector('#ledger-group').disabled=Boolean(editing || (ledgerReturn && ledgerReturn.lockKind!==false));
    main.querySelectorAll('[data-bank-field]').forEach(field=>field.disabled=ledgerKind!=='bank');main.querySelector('#ledger-billwise').disabled=!['customer','supplier'].includes(ledgerKind);
    main.querySelector('#expense-ledger-type').disabled=!['expense','income'].includes(ledgerKind);
    openingEditor.setDisabled(false);
    accept.disabled = false;
    main.querySelector('#ledger-name').focus();
  } finally { saving = false; }
}
function goBack() {
  if (busy() || document.querySelector('dialog')) return;
  if(['company-menu','companies','company-create','company-alter'].includes(view)){companyUI.back();return;}
  if(['company-data-menu','company-backup','company-restore'].includes(view)){companyDataUI.back();return;}
  if(!book)return;
  if (['sale','daybook','postings'].includes(view)) { sales.goBack(); return; }
  if (['receipt','receipt-postings'].includes(view)) { receipts.goBack(); return; }
  if (['payment','payment-postings'].includes(view)) { payments.goBack(); return; }
  if (['purchase','purchase-postings'].includes(view)) { purchases.goBack(); return; }
  if (['contra','contra-postings'].includes(view)) { contra.goBack(); return; }
  if (['journal','journal-postings'].includes(view)) { journal.goBack(); return; }
  if (['journal-general','journal-general-postings'].includes(view)) { generalJournal.goBack(); return; }
  if (['chart-masters','chart-ledgers'].includes(view)) { chart.goBack(); return; }
  if (['report-selector','statement','outstanding','more-reports','trial-balance','monthly-summary'].includes(view)) { reports.goBack(); return; }
  if (['balance-sheet','profit-loss','financial-group'].includes(view)) { financial.goBack(); return; }
  if (view === 'ledger') {
    const back = () => {
      if (ledgerReturn) { const returnTo = ledgerReturn; ledgerReturn = null; returnTo.onCancel(); }
      else if (editing) renderSelector(); else renderMasters('create');
    };
    if (isDirty()) askDialog('Discard unsaved ledger changes?', back, 'Discard');
    else back();
  } else if (view === 'selector') renderMasters('alter');
  else if (view === 'masters') renderGateway(mode === 'create' ? 0 : 1);
}
document.addEventListener('keydown', event => {
  const dialog = document.querySelector('dialog');
  if (dialog) return;
  if(companyDataUI.onKey(event))return;
  if(view==='gateway'&&event.altKey&&!event.ctrlKey&&!event.metaKey&&event.key==='F2'){event.preventDefault();changeCompanyPeriod();return;}
  if(companyUI.onKey(event))return;
  if(ledgerGroupPicker?.onKey(event))return;
  if (sales.onKey(event)) return;
  if (receipts.onKey(event) || payments.onKey(event) || purchases.onKey(event) || contra.onKey(event) || journal.onKey(event) || generalJournal.onKey(event) || reports.onKey(event) || financial.onKey(event) || chart.onKey(event)) return;
  if (view === 'ledger' && event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'a') {
    event.preventDefault(); saveLedger(); return;
  }
  if (event.ctrlKey || event.altKey || event.metaKey || saving) return;
  if (event.key === 'Escape') { event.preventDefault(); goBack(); return; }
  if (view === 'gateway') {
    if (event.key === 'F2') { event.preventDefault(); changeWorkingDate(); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); selectMenu(selected + (event.key === 'ArrowDown' ? 1 : -1),true); }
    else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); selectMenu(event.key === 'Home' ? 0 : menu.length-1,true); }
    else if (event.key === 'Enter') { if(event.target.closest('button:not([data-menu])'))return;event.preventDefault(); openGatewayItem(); }
    else if (event.key.toLowerCase() === 'c' || event.key.toLowerCase() === 'a') { event.preventDefault(); renderMasters(event.key.toLowerCase() === 'c' ? 'create' : 'alter'); }
  } else if (view === 'selector') {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); selectCandidate(event.key === 'ArrowDown' ? 1 : -1); }
    else if (event.key === 'Enter') { event.preventDefault(); openCustomer(); }
  } else if (view === 'ledger' && event.key === 'Enter') {
    if (event.target.closest('button')) return;
    event.preventDefault();
    const fields = ledgerFields();
    const index = fields.indexOf(document.activeElement);
    if (index < fields.length-1) fields[index+1].focus();
    else askDialog('Accept this ledger?', saveLedger);
  }
});
closeButton.addEventListener('click', goBack);
document.querySelector('[data-company-menu]').addEventListener('click',companyUI.openMenu);
document.querySelector('[data-company-data]').addEventListener('click',companyDataUI.openMenu);
const companyKey=document.querySelectorAll('.function-rail>button')[1];companyKey.disabled=false;companyKey.onclick=()=>companyUI.openSelector();
document.querySelector('#home').addEventListener('click', event => {
  event.preventDefault();
  if (busy() || document.querySelector('dialog')) return;
  const home=()=>book?openFresh(()=>renderGateway()):renderGateway();
  if (isDirty()) askDialog('Discard unsaved changes and return to Gateway?',home);
  else home();
});
try { const selectedCompany=await lifecycle.initialize();activeCompanyId=selectedCompany.activeId;serverCapabilities=lifecycle.capabilities();if(activeCompanyId!==null)await refreshBook();renderGateway(); }
catch (error) {
  main.innerHTML = `<div class="connection-error"><strong>Unable to open company</strong>${escapeHtml(error.message)}</div>`;
  hint.textContent = 'Connection unavailable';
}
