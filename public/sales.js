import {savedLedgerBalance} from './ledger-balance.js';
import {initialEntryDate} from './company-context.js';
import { parseRupees, formatRupees, inputRupees, parseEntryDate, entryDate } from './entry-values.js';
import { editVoucherDetails } from './voucher-details.js';
import { editBillReference } from './bill-details.js';
import { editReportDate,editReportPeriod } from './report-period.js';
import { editVoucherType } from './voucher-type.js';

export function createSalesWorkspace({main,hint,api,setScreen,getBook,refreshBook,escapeHtml,askDialog,renderGateway,getView,openLedgerFromSale,openReceipt,openOtherVoucher}) {
  const typeLabel=type=>({sale:'Sales',receipt:'Receipt',purchase:'Purchase',payment:'Payment',contra:'Contra',journal:'Journal'}[type]);
  const partyDebit=type=>type==='sale' || type==='payment';
  let editing = null, origin = 'gateway', initialValues = '', saving = false, currentDate = null;
  let reportRows = [], reportIndex = 0;
  let dayBookFilter={from:null,to:null,type:'all'};
  let details = {};
  let billReference = '', billTerms=null, reviewedBill = '';
  const book = getBook;
  const value = id => main.querySelector('#'+id).value;
  const fields = () => [...main.querySelectorAll('#sales-form input,#sales-form select,#sales-form textarea')];
  const formValues = () => ({date:value('sale-date'),customer:value('sale-customer'),account:value('sale-account'),amount:value('sale-amount'),narration:value('sale-narration'),details,billReference,billTerms});
  const billSignature = input => `${input.customer_id}:${input.date}:${input.amount}`;
  const dirty = () => getView() === 'sale' && JSON.stringify(formValues()) !== initialValues;
  function button(id,html,action) {
    const element = document.createElement('button');
    element.type = 'button'; element.id = id; element.innerHTML = html; element.addEventListener('click',action);
    document.querySelector('.command-strip').insertBefore(element,hint); return element;
  }
  function error(message,field) {
    main.querySelector('#sale-error').textContent = message;
    if (field) main.querySelector('#'+field).focus();
  }
  function updateTotal() {
    let amount = 0;
    try { amount = parseRupees(value('sale-amount')); } catch {}
    main.querySelector('#sale-total').textContent = formatRupees(amount);
    updateBalance();
  }
  function customerForName(name) {
    name = name.trim().toLocaleLowerCase();
    return book().ledgers.find(row => ['customer','cash'].includes(row.kind) && row.name.toLocaleLowerCase() === name);
  }
  function updateBalance() {
    const customer = customerForName(value('sale-customer'));
    const cash=customer?.kind==='cash';
    const balance=customer?savedLedgerBalance(book(),customer.id):0;
    main.querySelector('#party-balance').textContent = customer ? `${formatRupees(Math.abs(balance))} ${balance < 0 ? 'Cr' : 'Dr'}` : '—';
    const billButton=document.querySelector('#bill-details');if(billButton)billButton.disabled=cash;
  }
  function bindCustomerPicker() {
    const input = main.querySelector('#sale-customer');
    const list = main.querySelector('#party-options');
    let rows = [], index = 0;
    function close() { list.hidden = true; input.setAttribute('aria-expanded','false'); input.removeAttribute('aria-activedescendant'); }
    function highlight() {
      list.querySelectorAll('[data-party]').forEach((option,i) => {
        option.classList.toggle('selected',i === index); option.setAttribute('aria-selected',String(i === index));
        if (i === index) { input.setAttribute('aria-activedescendant',option.id); option.scrollIntoView({block:'nearest'}); }
      });
    }
    function filter() {
      const query = input.value.toLocaleLowerCase().trim();
      rows = book().ledgers.filter(row => ['customer','cash'].includes(row.kind) && `${row.name} ${row.alias}`.toLocaleLowerCase().includes(query));
      index = 0;
      list.innerHTML = `<div class="selection-heading" role="presentation">List of Ledger Accounts</div><div class="picker-create-row"><button type="button" id="create-party">Create</button></div>${rows.length ? rows.map((row,i) => `<button type="button" id="party-option-${i}" role="option" data-party="${i}" aria-selected="false">${escapeHtml(row.name)}${row.alias ? `<small>${escapeHtml(row.alias)}</small>` : ''}</button>`).join('') : '<p class="no-ledgers">No matching customer or Cash ledger.</p>'}`;
      list.hidden = false; input.setAttribute('aria-expanded','true');
      list.querySelectorAll('[data-party]').forEach(option => {
        option.addEventListener('mousedown',event => event.preventDefault());
        option.addEventListener('click',() => choose(Number(option.dataset.party)));
      });
      list.querySelector('#create-party').addEventListener('mousedown',event => event.preventDefault());
      list.querySelector('#create-party').addEventListener('click',startInlineCustomer);
      highlight();
    }
    function choose(selected) {
      if (!rows[selected]) return;
      if (input.dataset.customerId !== String(rows[selected].id)) details = {dispatch:details.dispatch || {},party:{mailing_name:rows[selected].mailing_name || rows[selected].name,address:rows[selected].address || '',state:rows[selected].state || 'Not Applicable',country:rows[selected].country || 'India'}};
      input.dataset.customerId = rows[selected].id;
      input.value = rows[selected].name; close(); updateBalance(); showDetails();
    }
    input.addEventListener('focus',filter);
    input.addEventListener('input',() => { filter(); updateBalance(); });
    input.addEventListener('blur',close);
    input.addEventListener('keydown',event => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (['ArrowDown','ArrowUp','Enter','Escape'].includes(event.key) && !list.hidden) {
        event.preventDefault(); event.stopPropagation();
        if (event.key === 'Escape') close();
        else if (event.key === 'Enter') {
          if (rows.length) choose(index); else error('Choose an existing customer or Cash ledger.','sale-customer');
        } else if (rows.length) { index = (index+(event.key === 'ArrowDown' ? 1 : -1)+rows.length)%rows.length; highlight(); }
      }
    });
  }
  function startInlineCustomer() {
    if (saving) return;
    const draft = {editing,origin,values:formValues(),initialValues,reviewedBill,lineHidden:main.querySelector('.sale-line').hidden};
    function restore() {
      renderSale(draft.editing,draft.origin);
      for (const [key,id] of Object.entries({date:'sale-date',customer:'sale-customer',account:'sale-account',amount:'sale-amount',narration:'sale-narration'})) main.querySelector('#'+id).value = draft.values[key];
      details = structuredClone(draft.values.details); initialValues = draft.initialValues;
      billReference = draft.values.billReference; billTerms=structuredClone(draft.values.billTerms); reviewedBill = draft.reviewedBill;
      main.querySelector('.sale-line').hidden = draft.lineHidden;
      updateTotal(); updateBalance();
    }
    openLedgerFromSale({onSaved:customer => {
      restore();
      main.querySelector('#sale-customer').value = customer.name;
      main.querySelector('#sale-customer').dataset.customerId = customer.id;
      details.party = {mailing_name:customer.mailing_name || customer.name,address:customer.address,state:customer.state,country:customer.country};
      showDetails();
    },onCancel:restore});
  }
  function renderSale(voucher = null,from = 'gateway',message = '') {
    currentDate??=initialEntryDate(getBook());
    editing = voucher; origin = from;
    details = structuredClone(voucher?.details ?? {});
    if (voucher) currentDate = voucher.date;
    setScreen(voucher ? 'Accounting Voucher Alteration' : 'Accounting Voucher Creation','sale',message || 'F8: Sales · F2: date · Enter: next · Ctrl+A: accept · Esc: back');
    const customers = book().ledgers.filter(row => ['customer','cash'].includes(row.kind));
    const accounts = book().ledgers.filter(row => row.kind === 'sales');
    const number = voucher?.number ?? Math.max(0,...book().vouchers.filter(row => row.type === 'sale').map(row => row.number))+1;
    billReference = voucher?.bill?.reference ?? String(number);
    billTerms=structuredClone(voucher?.bill?.terms ?? null);
    reviewedBill = voucher ? billSignature(voucher) : '';
    main.innerHTML = `<form id="sales-form" autocomplete="off" novalidate>
      <div class="voucher-heading"><strong class="voucher-type">Sales</strong><span>No. <b id="sale-number">${number}</b></span><div class="voucher-date"><label for="sale-date" class="sr-only">Voucher date</label><input id="sale-date" value="${entryDate(voucher?.date ?? currentDate)}" aria-describedby="sale-date-help" spellcheck="false"><span id="sale-weekday"></span></div></div>
      <div class="voucher-party"><label for="sale-customer">Party A/c name</label><span>:</span><input id="sale-customer" role="combobox" aria-autocomplete="list" aria-controls="party-options" aria-expanded="false" spellcheck="false" data-customer-id="${voucher?.customer_id ?? ''}" value="${escapeHtml(voucher?.customer_name ?? '')}"></div><div id="party-options" class="party-options" role="listbox" aria-label="Customer and Cash ledger accounts" hidden></div>
      <div class="party-balance"><i>Current balance</i><span>:</span><i id="party-balance">—</i></div>
      <div class="voucher-lines-heading"><strong>Particulars</strong><span class="rate-heading">Rate &nbsp; per</span><strong>Amount</strong></div>
      <div class="sale-line" ${voucher ? '' : 'hidden'}><label for="sale-account" class="sr-only">Sales ledger</label><select id="sale-account"><option value=""></option>${accounts.map(row => `<option value="${row.id}" ${row.id === voucher?.account_id ? 'selected' : ''}>${escapeHtml(row.name)}</option>`).join('')}</select><label for="sale-amount" class="sr-only">Sale amount in rupees</label><input id="sale-amount" inputmode="decimal" maxlength="20" value="${voucher ? inputRupees(voucher.amount) : ''}" aria-describedby="sale-amount-help"></div>
      <div class="voucher-space"><span id="sale-date-help" class="sr-only">Date: 1-Apr-2026 or 2026-04-01.</span><span id="sale-amount-help" class="sr-only">Sale in rupees, no tax or inventory, up to two decimal places.</span>${!customers.length ? '<div class="voucher-scope"><strong>Create a customer or Cash ledger before entering a sale.</strong></div>' : ''}</div>
      <div id="sale-error" class="ledger-error" role="alert"></div>
      <div class="voucher-bottom"><div class="voucher-narration"><label for="sale-narration">Narration:</label><textarea id="sale-narration" rows="2" maxlength="1000">${escapeHtml(voucher?.narration ?? '')}</textarea></div><div class="voucher-total"><span id="sale-total">0.00</span></div></div>
    </form>`;
    button('accept-sale','<u>A</u>: Accept <span>Ctrl+A</span>',saveSale);
    button('bill-details','Bill-wise Details',() => showBillDetails());
    button('open-day-book','Day Book',() => leaveFor(openDayBook));
    button('party-details','Party Details',()=>showDetails());
    if (voucher) button('view-postings','View Entries',showPostings);
    const rail = document.querySelector('.function-rail');
    const salesKey = document.createElement('button'); salesKey.type = 'button'; salesKey.dataset.salesRail = '';
    salesKey.innerHTML = '<span><u>F8</u>: Sales</span><span>‹</span>'; salesKey.addEventListener('click',() => leaveFor(openNewSale));
    rail.insertBefore(salesKey,rail.querySelector('.rail-space'));
    const receiptKey = document.createElement('button'); receiptKey.type='button'; receiptKey.dataset.salesRail=''; receiptKey.textContent='F6: Receipt';
    receiptKey.addEventListener('click',() => leaveFor(() => openReceipt(null,origin))); rail.insertBefore(receiptKey,salesKey);
    for(const [key,type,label] of [['F4','contra','Contra'],['F5','payment','Payment'],['F7','journal','Journal'],['F9','purchase','Purchase']]){
      const entryKey=document.createElement('button');entryKey.type='button';entryKey.dataset.salesRail='';entryKey.textContent=`${key}: ${label}`;entryKey.onclick=()=>leaveFor(()=>openOtherVoucher(null,origin,type));rail.insertBefore(entryKey,type==='payment'?receiptKey:rail.querySelector('.rail-space'));
    }
    const dateKey = rail.querySelector('button'); dateKey.disabled = false; dateKey.onclick = () => main.querySelector('#sale-date')?.focus();
    const date = main.querySelector('#sale-date');
    function weekday() {
      try { main.querySelector('#sale-weekday').textContent = new Intl.DateTimeFormat('en-GB',{weekday:'long',timeZone:'UTC'}).format(new Date(parseEntryDate(date.value)+'T12:00:00Z')); }
      catch { main.querySelector('#sale-weekday').textContent = ''; }
    }
    date.addEventListener('input',weekday); weekday();
    main.querySelector('#sale-amount').addEventListener('input',updateTotal);
    main.querySelector('#sales-form').addEventListener('submit',event => { event.preventDefault(); saveSale(); });
    bindCustomerPicker(); updateTotal(); updateBalance();
    initialValues = JSON.stringify(formValues()); main.querySelector(voucher?'#sale-date':'#sale-customer').focus();
  }
  function showDetails() {
    const customer = customerForName(value('sale-customer'));
    if (!customer) { error('Choose an existing customer or Cash ledger.','sale-customer'); return; }
    if(customer.kind==='cash'){
      main.querySelector('.sale-line').hidden=false;updateBalance();
    }
    editVoucherDetails({customer,details,escapeHtml,setCaption:name => { document.querySelector('.screen-title h1').textContent = name || (editing ? 'Accounting Voucher Alteration' : 'Accounting Voucher Creation'); },
      onDone:next => { details = next; main.querySelector('.sale-line').hidden = false; main.querySelector('#sale-account').focus(); },
      onCancel:() => main.querySelector(customer.kind==='cash'?'#sale-account':'#sale-customer').focus()});
  }
  function readSaleInput() {
    main.querySelector('#sale-error').textContent = '';
    let date, amount;
    try { date = parseEntryDate(value('sale-date')); } catch (failure) { error(failure.message,'sale-date'); return; }
    const customer = customerForName(value('sale-customer'));
    if (!customer) { error('Choose an existing customer or Cash ledger.','sale-customer'); return; }
    if (main.querySelector('.sale-line').hidden) { showDetails(); return; }
    try { amount = parseRupees(value('sale-amount')); } catch (failure) { error(failure.message,'sale-amount'); return; }
    const account = Number(value('sale-account'));
    if (!account) { error('Choose a sales ledger.','sale-account'); return; }
    return {type:'sale',date,customer_id:customer.id,account_id:account,amount,narration:value('sale-narration'),details,...(editing ? {revision:editing.revision} : {})};
  }
  function showBillDetails(input = null) {
    if (saving || getView() !== 'sale' || document.querySelector('dialog')) return;
    input ??= readSaleInput();
    if (!input) return;
    if(book().ledgers.find(row=>row.id===input.customer_id)?.kind==='cash'){main.querySelector('#sale-narration').focus();return;}
    editBillReference({customer:book().ledgers.find(row => row.id === input.customer_id),reference:billReference,terms:billTerms,amount:input.amount,date:input.date,escapeHtml,
      setCaption:name => { document.querySelector('.screen-title h1').textContent = name || (editing ? 'Accounting Voucher Alteration' : 'Accounting Voucher Creation'); },
      onDone:(reference,terms) => { billReference = reference; billTerms=terms; reviewedBill = billSignature(input); main.querySelector('#sale-narration').focus(); },
      onCancel:() => main.querySelector('#sale-amount').focus()});
  }
  async function saveSale() {
    if (saving || getView() !== 'sale' || document.querySelector('dialog')) return;
    const input = readSaleInput();
    if (!input) return;
    if(book().ledgers.find(row=>row.id===input.customer_id)?.kind!=='cash'){
      if (reviewedBill !== billSignature(input)) { showBillDetails(input); return; }
      input.bill = {reference:billReference,terms:billTerms};
    }
    saving = true;
    const accept = document.querySelector('#accept-sale'); accept.disabled = true;
    const inputs = fields(); inputs.forEach(field => { field.disabled = true; });
    try {
      const saved = await api(editing ? `/api/vouchers/${editing.id}` : '/api/vouchers',{method:editing ? 'PUT' : 'POST',body:JSON.stringify(input)});
      book().vouchers = book().vouchers.filter(row => row.id !== saved.id).concat(saved).sort((a,b) => a.date.localeCompare(b.date) || a.id-b.id);
      await refreshBook().catch(() => {});
      currentDate = saved.date;
      if (editing) { if(typeof origin==='function') await origin(); else await renderDayBook(); hint.textContent = `Saved changes to Sales No. ${saved.number}.`; }
      else renderSale(null,origin,`Saved Sales No. ${saved.number} · ₹${formatRupees(saved.amount)} · next voucher ready`);
    } catch (failure) {
      inputs.forEach(field => { field.disabled = false; }); accept.disabled = false;
      error(failure.message);
    } finally { saving = false; }
  }
  function leaveFor(action) {
    if (saving || document.querySelector('dialog')) return;
    if (dirty()) askDialog('Discard unsaved voucher changes?',action,'Discard'); else action();
  }
  async function openDayBook() {
    if (saving) return;
    saving = true;
    try { await refreshBook(); await renderDayBook(); }
    catch (failure) { hint.textContent = `Unable to refresh Day Book: ${failure.message}`; }
    finally { saving = false; }
  }
  async function openNewSale() {
    if (saving) return;
    saving = true;
    try { await refreshBook(); renderSale(null,origin); }
    catch (failure) { hint.textContent = failure.message; }
    finally { saving = false; }
  }
  async function renderDayBook(nextFilter=dayBookFilter) {
    const query=new URLSearchParams();
    for(const [key,value] of Object.entries(nextFilter))if(value!==null)query.set(key,value);
    const report=await api('/api/day-book?'+query);
    dayBookFilter=report.filter;reportRows=report.rows;reportIndex=0;
    setScreen('Day Book','daybook','F2: date · Alt+F2: period · F4: voucher type · ↑ ↓ Enter: reopen');
    const caption=report.filter.from && report.filter.to?(report.filter.from===report.filter.to?`For ${entryDate(report.filter.from)}`:`${entryDate(report.filter.from)} to ${entryDate(report.filter.to)}`):'All dates';
    const heading=report.filter.type==='all'?'Day Book':`List of ${typeLabel(report.filter.type)} Vouchers`;
    main.innerHTML = `<section class="day-book filtered-day-book"><div class="report-ledger-name"><strong>${heading}</strong><span id="daybook-period-caption">${caption}</span></div><div class="report-table-scroll"><table class="voucher-report"><colgroup><col class="date-col"><col><col class="type-col"><col class="number-col"><col class="money-col"><col class="money-col"></colgroup><thead><tr><th>Date</th><th>Particulars</th><th>Vch Type</th><th>Vch No.</th><th>Debit<br>Amount</th><th>Credit<br>Amount</th></tr></thead><tbody>${reportRows.map((row,index) => `<tr data-sale-row="${index}"><td>${entryDate(row.date)}</td><td><button type="button" data-open-sale="${row.id}">${escapeHtml(row.particulars ?? row.customer_name)}</button></td><td>${typeLabel(row.type)}</td><td>${row.number}</td><td class="amount">${partyDebit(row.type)?formatRupees(row.amount):''}</td><td class="amount">${!partyDebit(row.type)?formatRupees(row.amount):''}</td></tr>`).join('')}</tbody></table></div>${reportRows.length?'':'<p class="empty-report">No vouchers match this date and voucher type.</p>'}<div class="report-total" id="daybook-totals">${report.filter.type==='all'?'':`Total: <strong>${formatRupees(partyDebit(report.filter.type)?report.totals.debit:report.totals.credit)}</strong>`}</div></section>`;
    main.querySelector('.filtered-day-book').dataset.voucherType=report.filter.type;
    main.querySelectorAll('[data-open-sale]').forEach((element,index) => {
      element.addEventListener('click',() => openSale(Number(element.dataset.openSale)));
      element.addEventListener('focus',() => { reportIndex = index; selectReport(0); });
    });
    button('daybook-date','F2: Date',()=>showDayBookDates(false));
    button('daybook-period','Alt+F2: Period',()=>showDayBookDates(true));
    button('daybook-type','F4: Voucher Type',showDayBookType);
    button('new-sale','New Sales',() => { origin = 'daybook'; openNewSale(); });
    button('new-receipt','New Receipt',() => openReceipt(null,'daybook'));
    button('new-purchase','New Purchase',()=>openOtherVoucher(null,'daybook','purchase'));
    button('new-payment','New Payment',()=>openOtherVoucher(null,'daybook','payment'));
    button('new-contra','New Contra',()=>openOtherVoucher(null,'daybook','contra'));
    button('new-journal','New Journal',()=>openOtherVoucher(null,'daybook','journal'));
    if(report.filter.from || report.filter.to)button('daybook-all-dates','All dates',()=>changeDayBook({...dayBookFilter,from:null,to:null}));
    const dateKey=document.querySelector('.function-rail button');dateKey.disabled=false;dateKey.onclick=()=>showDayBookDates(false);
    const typeKey=document.createElement('button');typeKey.type='button';typeKey.dataset.salesRail='';typeKey.textContent='F4: Voucher Type';typeKey.addEventListener('click',showDayBookType);document.querySelector('.function-rail').insertBefore(typeKey,document.querySelector('.rail-space'));
    const columnKey=document.createElement('button');columnKey.type='button';columnKey.dataset.salesRail='';columnKey.disabled=true;columnKey.textContent='F8: Columnar';document.querySelector('.function-rail').insertBefore(columnKey,document.querySelector('.rail-space'));
    selectReport(0); main.focus();
  }
  async function changeDayBook(filter){
    if(saving)return;saving=true;
    try{await refreshBook();await renderDayBook(filter);}catch(failure){hint.textContent=failure.message;}finally{saving=false;}
  }
  function filterCommit(filter){return async()=>{saving=true;try{await refreshBook();await renderDayBook(filter);}finally{saving=false;}};}
  function showDayBookDates(range){
    if(saving || document.querySelector('dialog'))return;
    const date=dayBookFilter.from ?? currentDate ?? initialEntryDate(getBook());
    const onDone=next=>filterCommit({...dayBookFilter,...next})();
    if(range)editReportPeriod({period:{from:date,to:dayBookFilter.to ?? date},onDone});
    else editReportDate({date,onDone});
  }
  function showDayBookType(){
    if(saving || document.querySelector('dialog'))return;
    editVoucherType({type:dayBookFilter.type,onDone:type=>filterCommit({...dayBookFilter,type})()});
  }
  function selectReport(step) {
    if (!reportRows.length) return;
    reportIndex = (reportIndex+step+reportRows.length)%reportRows.length;
    main.querySelectorAll('[data-sale-row]').forEach((row,index) => {
      row.classList.toggle('selected',index === reportIndex);
      if (index === reportIndex) row.scrollIntoView({block:'nearest'});
    });
  }
  async function openSale(id) {
    if (saving) return;
    saving = true;
    try { await refreshBook(); const voucher = await api(`/api/vouchers/${id}`); if(voucher.type==='sale')renderSale(voucher,'daybook');else if(voucher.type==='receipt')openReceipt(voucher,'daybook');else openOtherVoucher(voucher,'daybook'); }
    catch (failure) { hint.textContent = failure.message; }
    finally { saving = false; }
  }
  function showPostings() {
    if (!editing) return;
    leaveFor(() => {
      setScreen('Accounting Entries','postings','Saved voucher entries · Esc: return to voucher');
      const billStatus=book().ledgers.find(row=>row.id===editing.customer_id)?.kind==='cash'?'Cash sale':`Bill reference <strong>${escapeHtml(editing.bill?.reference ?? String(editing.number))}</strong>`;
      const totals = editing.postings.reduce((sum,row) => ({...sum,[row.side]:sum[row.side]+row.amount}),{debit:0,credit:0});
      main.innerHTML = `<section class="accounting-entries"><div class="report-company">${escapeHtml(book().company)}</div><div class="entries-header"><strong>Sales No. ${editing.number}</strong><span>${entryDate(editing.date)}</span></div><table class="voucher-report"><thead><tr><th>Particulars</th><th>Debit</th><th>Credit</th></tr></thead><tbody>${editing.postings.map(row => `<tr><td>${row.side === 'debit' ? 'By' : 'To'} &nbsp; ${escapeHtml(row.name)}</td><td class="amount">${row.side === 'debit' ? formatRupees(row.amount) : ''}</td><td class="amount">${row.side === 'credit' ? formatRupees(row.amount) : ''}</td></tr>`).join('')}</tbody><tfoot><tr><th>Total</th><th>${formatRupees(totals.debit)}</th><th>${formatRupees(totals.credit)}</th></tr></tfoot></table><div class="posting-status">${totals.debit === totals.credit ? 'Balanced' : 'Unbalanced'} · ${billStatus}</div><p class="entries-narration">Narration: ${escapeHtml(editing.narration)}</p></section>`;
    });
  }
  function goBack() {
    if (getView() === 'sale') leaveFor(() => typeof origin==='function' ? origin() : origin === 'daybook' ? openDayBook() : renderGateway(3));
    else if (getView() === 'daybook') renderGateway(4);
    else if (getView() === 'postings') renderSale(editing,origin);
  }
  function onKey(event) {
    if (!['sale','daybook','postings'].includes(getView())) return false;
    if (saving) { event.preventDefault(); return true; }
    if (event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'a' && getView() === 'sale') { event.preventDefault(); saveSale(); return true; }
    if(getView()==='daybook' && event.key==='F2' && !event.ctrlKey && !event.metaKey){event.preventDefault();showDayBookDates(event.altKey);return true;}
    if(getView()==='daybook' && event.key==='F4' && !event.ctrlKey && !event.altKey && !event.metaKey){event.preventDefault();showDayBookType();return true;}
    if(getView()==='daybook' && ['F6','F8'].includes(event.key) && !event.ctrlKey && !event.altKey && !event.metaKey){event.preventDefault();hint.textContent=event.key==='F8'?'Columnar view is not available yet.':'Choose New Receipt to enter a receipt voucher.';return true;}
    if (event.altKey || event.ctrlKey || event.metaKey) return false;
    if(['F4','F5','F7','F9'].includes(event.key) && getView()==='sale'){event.preventDefault();leaveFor(()=>openOtherVoucher(null,origin,{F4:'contra',F5:'payment',F7:'journal',F9:'purchase'}[event.key]));return true;}
    if (event.key === 'F6') { event.preventDefault(); leaveFor(() => openReceipt(null,getView()==='daybook'?'daybook':origin)); return true; }
    if (event.key === 'F8') { event.preventDefault(); if (getView() === 'daybook') origin = 'daybook'; leaveFor(openNewSale); return true; }
    if (event.key === 'F2' && getView() === 'sale') { event.preventDefault(); main.querySelector('#sale-date').focus(); main.querySelector('#sale-date').select(); return true; }
    if (event.key === 'Enter' && event.target.closest('button')) return false;
    if (getView() === 'daybook' && ['ArrowDown','ArrowUp','Enter'].includes(event.key)) {
      event.preventDefault();
      if (event.key === 'Enter') { if(reportRows.length) openSale(reportRows[reportIndex].id); }
      else selectReport(event.key === 'ArrowDown' ? 1 : -1);
      return true;
    }
    if (getView() === 'sale' && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (document.activeElement.id === 'sale-amount') { showBillDetails(); return true; }
      const inputs = fields(); const index = inputs.indexOf(document.activeElement);
      if (index < inputs.length-1) inputs[index+1].focus(); else askDialog('Accept this sales voucher?',saveSale);
      return true;
    }
    return false;
  }
  return {renderSale,renderDayBook,openDayBook,dirty,goBack,onKey,isSaving:() => saving};
}
