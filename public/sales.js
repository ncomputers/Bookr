import {formatCompanyAmount} from './company-currency.js';
import {savedLedgerBalance} from './ledger-balance.js';
import {initialEntryDate,workingDateContext} from './company-context.js';
import {createEntryDateState} from './working-date.js';
import { parseRupees, formatRupees, inputRupees, parseEntryDate, entryDate } from './entry-values.js';
import { editVoucherDetails } from './voucher-details.js';
import { editBillReference } from './bill-details.js';
import { editReportDate,editReportPeriod } from './report-period.js';
import { editVoucherType } from './voucher-type.js';
import { editCostAllocations } from './cost-allocations.js';
import { STATE_CODE_TO_NAME } from './gst.js';

export function createSalesWorkspace({main,hint,api,setScreen,getBook,refreshBook,escapeHtml,askDialog,renderGateway,getView,openLedgerFromSale,openReceipt,openOtherVoucher}) {
  const typeLabel=type=>({sale:'Sales',receipt:'Receipt',purchase:'Purchase',payment:'Payment',contra:'Contra',journal:'Journal',credit_note:'Credit Note',debit_note:'Debit Note'}[type]);
  const partyDebit=type=>type==='sale' || type==='payment' || type==='debit_note';
  const entryDates=createEntryDateState(()=>workingDateContext(getBook()));
  let editing= null, origin = 'gateway', initialValues = '', saving = false, currentDate = null;
  let invoiceMode = 'accounting';
  let reportRows = [], reportIndex = 0;
  let dayBookFilter={from:null,to:null,type:'all'};
  let details = {};
  let billReference = '', billTerms=null, reviewedBill = '';
  const book = getBook;
  const value = id => main.querySelector('#'+id)?.value ?? '';
  const fields = () => [...main.querySelectorAll('#sales-form input,#sales-form select,#sales-form textarea')];
  const formValues = () => ({
    mode: invoiceMode,
    date: value('sale-date'),
    customer: value('sale-customer'),
    account: main.querySelector('#sale-account')?.value ?? '',
    amount: main.querySelector('#sale-amount')?.value ?? '',
    item_lines: invoiceMode === 'item' ? [...main.querySelectorAll('.sale-line.item-line')].map(el => ({
      item_id: el.querySelector('.line-item')?.value,
      godown_id: el.querySelector('.line-godown')?.value,
      qty: el.querySelector('.line-qty')?.value,
      rate: el.querySelector('.line-rate')?.value
    })) : [],
    narration: value('sale-narration'),
    details,
    billReference,
    billTerms
  });
  const billSignature = input => `${input.customer_id}:${input.date}:${input.amount ?? main.querySelector('#sale-total')?.textContent}`;
  const dirty = () => getView() === 'sale' && JSON.stringify(formValues()) !== initialValues;
  function button(id,html,action) {
    const element = document.createElement('button');
    element.type = 'button'; element.id = id; element.innerHTML = html; element.addEventListener('click',action);
    document.querySelector('.command-strip').insertBefore(element,hint); return element;
  }
  function error(message,field) {
    main.querySelector('#sale-error').textContent = message;
    if (field) main.querySelector('#'+field)?.focus();
  }
  function updateTotal() {
    let amount = 0;
    if (invoiceMode === 'item') {
      let taxable = 0;
      let cgstTotal = 0, sgstTotal = 0, igstTotal = 0;
      const customer = customerForName(value('sale-customer'));
      const companyState = book().companyState || (book().companyGstin ? (STATE_CODE_TO_NAME[book().companyGstin.slice(0, 2)] || '') : '') || 'Not Applicable';
      const partyState = customer?.state || (customer?.gstin ? (STATE_CODE_TO_NAME[customer.gstin.slice(0, 2)] || '') : '') || (details.party?.state ?? 'Not Applicable');
      const isInterState = companyState !== 'Not Applicable' && partyState !== 'Not Applicable' && companyState.toLowerCase() !== partyState.toLowerCase();

      main.querySelectorAll('.sale-line.item-line').forEach(el => {
        const qty = parseFloat(el.querySelector('.line-qty')?.value) || 0;
        let rate = 0;
        try { rate = parseRupees(el.querySelector('.line-rate')?.value || '0'); } catch {}
        const lineAmt = Math.round(qty * rate);
        const amtInput = el.querySelector('.line-amount');
        if (amtInput) amtInput.value = lineAmt ? (lineAmt / 100).toFixed(2) : '0.00';
        taxable += lineAmt;
        const itemSelect = el.querySelector('.line-item');
        const gstRate = parseFloat(itemSelect?.selectedOptions[0]?.dataset.gst) || 0;
        if (gstRate > 0) {
          if (isInterState) {
            igstTotal += Math.round(lineAmt * gstRate / 100);
          } else {
            const halfTax = Math.round(lineAmt * gstRate / 200);
            cgstTotal += halfTax;
            sgstTotal += halfTax;
          }
        }
      });
      const totalTax = isInterState ? igstTotal : (cgstTotal + sgstTotal);
      amount = taxable + totalTax;
      const gstSummaryEl = main.querySelector('#sale-gst-summary');
      if (gstSummaryEl) {
        if (totalTax > 0) {
          gstSummaryEl.innerHTML = `<span>Taxable: ${formatRupees(taxable)}</span>` +
            (isInterState ? `<span>IGST: ${formatRupees(igstTotal)}</span>` : `<span>CGST: ${formatRupees(cgstTotal)}</span><span>SGST: ${formatRupees(sgstTotal)}</span>`) +
            `<span>Total Tax: ${formatRupees(totalTax)}</span>`;
          gstSummaryEl.hidden = false;
        } else {
          gstSummaryEl.hidden = true;
        }
      }
    } else {
      const inputs = main.querySelectorAll('.sale-line:not(.item-line) input[inputmode="decimal"], #sale-amount');
      inputs.forEach(inp => {
        try { amount += parseRupees(inp.value); } catch {}
      });
    }
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
  function renderSale(voucher = null,from = 'gateway',message = '',preserveMode = false) {
    currentDate=entryDates.forRender(voucher?{savedDate:voucher.date}:{});
    editing = voucher; origin = from;
    if (!preserveMode) {
      invoiceMode = (voucher?.details?.invoice_mode === 'item' || voucher?.item_lines?.length) ? 'item' : 'accounting';
    }
    details = structuredClone(voucher?.details ?? {});
    if (voucher) currentDate = voucher.date;
    setScreen(voucher ? 'Accounting Voucher Alteration' : 'Accounting Voucher Creation','sale',message || 'F8: Sales · F2: date · Enter: next · Ctrl+A: accept · Esc: back');
    const customers = book().ledgers.filter(row => ['customer','cash'].includes(row.kind));
    const allParticulars = book().ledgers.filter(row => ['sales','income','expense','general'].includes(row.kind));
    const stockItems = book().inventory?.stock_items || [];
    const godowns = book().inventory?.godowns || [];
    const defaultGodownId = godowns.find(g => g.is_default)?.id ?? godowns[0]?.id ?? '';
    const savedItemLines = voucher?.item_lines ?? (voucher?.details?.item_lines || []);
    if (invoiceMode === 'item' && !savedItemLines.length) {
      savedItemLines.push({ item_id: stockItems[0]?.id, godown_id: defaultGodownId, quantity: '', rate: '', amount: 0 });
    }
    const number = voucher?.number ?? Math.max(0,...book().vouchers.filter(row => row.type === 'sale').map(row => row.number))+1;
    billReference = voucher?.bill?.reference ?? String(number);
    billTerms=structuredClone(voucher?.bill?.terms ?? null);
    reviewedBill = voucher ? billSignature(voucher) : '';
    const savedLines = voucher?.lines ?? (voucher?.details?.lines || []);
    const primaryLine = savedLines[0] ?? { ledger_id: voucher?.account_id, amount: voucher?.amount };
    const extraLines = savedLines.slice(1);
    main.innerHTML = `<form id="sales-form" autocomplete="off" novalidate>
      <div class="voucher-heading"><strong class="voucher-type">Sales</strong><span>No. <b id="sale-number">${number}</b></span><div class="voucher-date"><label for="sale-date" class="sr-only">Voucher date</label><input id="sale-date" value="${entryDate(voucher?.date ?? currentDate)}" aria-describedby="sale-date-help" spellcheck="false"><span id="sale-weekday"></span></div></div>
      <div class="voucher-party"><label for="sale-customer">Party A/c name</label><span>:</span><input id="sale-customer" role="combobox" aria-autocomplete="list" aria-controls="party-options" aria-expanded="false" spellcheck="false" data-customer-id="${voucher?.customer_id ?? ''}" value="${escapeHtml(voucher?.customer_name ?? '')}"></div><div id="party-options" class="party-options" role="listbox" aria-label="Customer and Cash ledger accounts" hidden></div>
      <div class="party-balance"><i>Current balance</i><span>:</span><i id="party-balance">—</i></div>
      ${invoiceMode === 'item' ? `
        <div class="voucher-lines-heading item-mode-heading"><strong>Name of Item</strong><span class="godown-heading">Godown</span><span class="qty-heading">Quantity</span><span class="rate-heading">Rate &nbsp; per</span><strong>Amount</strong></div>
        <div id="voucher-lines">
          ${savedItemLines.map((line, idx) => `
            <div class="sale-line item-line" data-line="${idx}" ${voucher ? '' : 'hidden'}>
              <select class="line-item" aria-label="Item name">
                <option value="">Select Item</option>
                ${stockItems.map(it => `<option value="${it.id}" data-rate="${(it.opening_rate / 100).toFixed(2)}" data-unit="${escapeHtml(it.unit_symbol || 'Nos')}" data-gst="${it.gst_rate || 0}" ${(line.item_id || line.id) === it.id ? 'selected' : ''}>${escapeHtml(it.name)}</option>`).join('')}
              </select>
              <select class="line-godown" aria-label="Godown">
                ${godowns.map(g => `<option value="${g.id}" ${(line.godown_id || defaultGodownId) === g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}
              </select>
              <input class="line-qty" type="number" step="any" min="0" placeholder="0" value="${line.quantity || ''}" aria-label="Quantity">
              <div class="rate-group" style="display:inline-flex;align-items:center;gap:4px;">
                <input class="line-rate" inputmode="decimal" maxlength="20" placeholder="0.00" value="${line.rate ? (line.rate / 100).toFixed(2) : ''}" aria-label="Rate" style="width:75px;">
                <span class="line-unit">${line.unit_symbol || stockItems.find(it => it.id === line.item_id)?.unit_symbol || 'Nos'}</span>
              </div>
              <input class="line-amount" readonly value="${line.amount ? (line.amount / 100).toFixed(2) : '0.00'}" aria-label="Amount">
              <button type="button" class="remove-line-btn" tabindex="-1" title="Remove line">✕</button>
            </div>
          `).join('')}
        </div>
        <div class="item-gst-summary" id="sale-gst-summary" hidden></div>
        <div class="line-tools" ${voucher ? '' : 'hidden'}><button type="button" id="sale-add-item-line" class="add-line-button" tabindex="-1">+ Add Item</button></div>
      ` : `
        <div class="voucher-lines-heading"><strong>Particulars</strong><span class="rate-heading">Rate &nbsp; per</span><strong>Amount</strong></div>
        <div id="voucher-lines">
          <div class="sale-line" data-line="0" ${voucher ? '' : 'hidden'}><label for="sale-account" class="sr-only">Sales ledger</label><select id="sale-account" class="line-ledger"><option value=""></option>${allParticulars.map(row => `<option value="${row.id}" ${row.id === (primaryLine.ledger_id ?? voucher?.account_id) ? 'selected' : ''}>${escapeHtml(row.name)}</option>`).join('')}</select><label for="sale-amount" class="sr-only">Sale amount</label><input id="sale-amount" class="line-amount" inputmode="decimal" maxlength="20" value="${voucher ? inputRupees(primaryLine.amount ?? voucher.amount) : ''}" aria-describedby="sale-amount-help"></div>
          ${extraLines.map((line, idx) => `
            <div class="sale-line" data-line="${idx + 1}"><select class="line-ledger"><option value=""></option>${allParticulars.map(row => `<option value="${row.id}" ${row.id === line.ledger_id ? 'selected' : ''}>${escapeHtml(row.name)}</option>`).join('')}</select><input class="line-amount" inputmode="decimal" maxlength="20" value="${inputRupees(line.amount)}"><button type="button" class="remove-line-btn" tabindex="-1" title="Remove line">✕</button></div>
          `).join('')}
        </div>
        <div class="line-tools" ${voucher ? '' : 'hidden'}><button type="button" id="sale-add-line" class="add-line-button" tabindex="-1">+ Add Line</button></div>
      `}
      <div class="voucher-space"><span id="sale-date-help" class="sr-only">Date: 1-Apr-2026 or 2026-04-01.</span><span id="sale-amount-help" class="sr-only">Sale amount, no tax or inventory, up to two decimal places.</span>${!customers.length ? '<div class="voucher-scope"><strong>Create a customer or Cash ledger before entering a sale.</strong></div>' : ''}</div>
      <div id="sale-error" class="ledger-error" role="alert"></div>
      <div class="voucher-bottom"><div class="voucher-narration"><label for="sale-narration">Narration:</label><textarea id="sale-narration" rows="2" maxlength="1000">${escapeHtml(voucher?.narration ?? '')}</textarea></div><div class="voucher-total"><span id="sale-total">0.00</span></div></div>
    </form>`;
    button('toggle-mode', invoiceMode === 'item' ? 'As Accounting Invoice' : 'As Item Invoice', toggleMode);
    button('accept-sale','<u>A</u>: Accept <span>Ctrl+A</span>',saveSale);
    button('sale-cost-allocations','Cost Allocations',showCostAllocations);
    button('bill-details','Bill-wise Details',() => showBillDetails());
    button('open-day-book','Day Book',() => leaveFor(openDayBook));
    button('party-details','Party Details',()=>showDetails());
    if (voucher) button('view-postings','View Entries',showPostings);
    const rail = document.querySelector('.function-rail');
    const salesKey = document.createElement('button'); salesKey.type = 'button'; salesKey.dataset.salesRail = '';
    salesKey.innerHTML = '<span><u>F8</u>: Sales</span><span>‹</span>'; salesKey.addEventListener('click',() => leaveFor(openNewSale));
    rail.insertBefore(salesKey,rail.querySelector('.rail-space'));
    const modeKey = document.createElement('button'); modeKey.type = 'button'; modeKey.dataset.salesRail = '';
    modeKey.innerHTML = '<span><u>Ctrl+H</u>: Mode</span>'; modeKey.onclick = toggleMode;
    rail.insertBefore(modeKey, salesKey);
    const receiptKey = document.createElement('button'); receiptKey.type='button'; receiptKey.dataset.salesRail=''; receiptKey.textContent='F6: Receipt';
    receiptKey.addEventListener('click',() => leaveFor(() => openReceipt(null,origin))); rail.insertBefore(receiptKey,salesKey);
    for(const [key,type,label] of [['F4','contra','Contra'],['F5','payment','Payment'],['F7','journal','Journal'],['F9','purchase','Purchase'],['Alt+F5','debit_note','Debit Note'],['Alt+F6','credit_note','Credit Note']]){
      const entryKey=document.createElement('button');entryKey.type='button';entryKey.dataset.salesRail='';entryKey.textContent=`${key}: ${label}`;entryKey.onclick=()=>leaveFor(()=>openOtherVoucher(null,origin,type));rail.insertBefore(entryKey,type==='payment'?receiptKey:rail.querySelector('.rail-space'));
    }
    const dateKey = rail.querySelector('button'); dateKey.disabled = false; dateKey.onclick = () => main.querySelector('#sale-date')?.focus();
    const date = main.querySelector('#sale-date');
    function weekday() {
      try { main.querySelector('#sale-weekday').textContent = new Intl.DateTimeFormat('en-GB',{weekday:'long',timeZone:'UTC'}).format(new Date(parseEntryDate(date.value)+'T12:00:00Z')); }
      catch { main.querySelector('#sale-weekday').textContent = ''; }
    }
    date.addEventListener('input',weekday); weekday();
    main.querySelector('#sale-amount')?.addEventListener('input',updateTotal);
    main.querySelector('#sales-form').addEventListener('submit',event => { event.preventDefault(); saveSale(); });
    function bindLineEvents(container = main) {
      if (invoiceMode === 'item') {
        container.querySelectorAll('.line-item').forEach(sel => {
          sel.onchange = () => {
            const opt = sel.selectedOptions[0];
            const row = sel.closest('.item-line');
            if (opt && row) {
              const unitSpan = row.querySelector('.line-unit');
              if (unitSpan && opt.dataset.unit) unitSpan.textContent = opt.dataset.unit;
              const rateInput = row.querySelector('.line-rate');
              if (rateInput && !rateInput.value && Number(opt.dataset.rate) > 0) rateInput.value = opt.dataset.rate;
            }
            updateTotal();
          };
        });
        container.querySelectorAll('.line-qty, .line-rate').forEach(inp => {
          inp.oninput = updateTotal;
        });
        container.querySelectorAll('.remove-line-btn').forEach(btn => {
          btn.onclick = () => {
            btn.closest('.sale-line').remove();
            updateTotal();
          };
        });
      } else {
        container.querySelectorAll('.line-amount').forEach(inp => {
          inp.removeEventListener('input', updateTotal);
          inp.addEventListener('input', updateTotal);
        });
        container.querySelectorAll('.remove-line-btn').forEach(btn => {
          btn.onclick = () => {
            btn.closest('.sale-line').remove();
            updateTotal();
          };
        });
      }
    }
    bindLineEvents();
    main.querySelector('#sale-add-item-line')?.addEventListener('click', () => {
      const container = main.querySelector('#voucher-lines');
      const idx = container.querySelectorAll('.sale-line').length;
      const div = document.createElement('div');
      div.className = 'sale-line item-line';
      div.dataset.line = String(idx);
      div.innerHTML = `
        <select class="line-item" aria-label="Item name">
          <option value="">Select Item</option>
          ${stockItems.map(it => `<option value="${it.id}" data-rate="${(it.opening_rate / 100).toFixed(2)}" data-unit="${escapeHtml(it.unit_symbol || 'Nos')}" data-gst="${it.gst_rate || 0}">${escapeHtml(it.name)}</option>`).join('')}
        </select>
        <select class="line-godown" aria-label="Godown">
          ${godowns.map(g => `<option value="${g.id}" ${g.id === defaultGodownId ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}
        </select>
        <input class="line-qty" type="number" step="any" min="0" placeholder="0" value="" aria-label="Quantity">
        <div class="rate-group" style="display:inline-flex;align-items:center;gap:4px;">
          <input class="line-rate" inputmode="decimal" maxlength="20" placeholder="0.00" value="" aria-label="Rate" style="width:75px;">
          <span class="line-unit">${stockItems[0]?.unit_symbol || 'Nos'}</span>
        </div>
        <input class="line-amount" readonly value="0.00" aria-label="Amount">
        <button type="button" class="remove-line-btn" tabindex="-1" title="Remove line">✕</button>
      `;
      container.appendChild(div);
      bindLineEvents(div);
      div.querySelector('.line-item').focus();
    });
    main.querySelector('#sale-add-line')?.addEventListener('click', () => {
      const container = main.querySelector('#voucher-lines');
      const idx = container.querySelectorAll('.sale-line').length;
      const div = document.createElement('div');
      div.className = 'sale-line';
      div.dataset.line = String(idx);
      div.innerHTML = `<select class="line-ledger"><option value=""></option>${allParticulars.map(row => `<option value="${row.id}">${escapeHtml(row.name)}</option>`).join('')}</select><input class="line-amount" inputmode="decimal" maxlength="20" value=""><button type="button" class="remove-line-btn" tabindex="-1" title="Remove line">✕</button>`;
      container.appendChild(div);
      bindLineEvents(div);
      div.querySelector('.line-ledger').focus();
    });
    bindCustomerPicker(); updateTotal(); updateBalance();
    initialValues = JSON.stringify(formValues()); main.querySelector(voucher?'#sale-date':'#sale-customer').focus();
  }
  function toggleMode() {
    invoiceMode = invoiceMode === 'item' ? 'accounting' : 'item';
    const currentCustomer = value('sale-customer');
    const customerId = main.querySelector('#sale-customer')?.dataset.customerId;
    renderSale(editing, origin, '', true);
    if (currentCustomer) {
      const input = main.querySelector('#sale-customer');
      if (input) {
        input.value = currentCustomer;
        if (customerId) input.dataset.customerId = customerId;
        main.querySelectorAll('.sale-line').forEach(el => el.hidden = false);
        const tools = main.querySelector('.line-tools'); if (tools) tools.hidden = false;
      }
    }
  }
  function showDetails() {
    const customer = customerForName(value('sale-customer'));
    if (!customer) { error('Choose an existing customer or Cash ledger.','sale-customer'); return; }
    if(customer.kind==='cash'){
      main.querySelectorAll('.sale-line').forEach(el => el.hidden = false);
      const tools = main.querySelector('.line-tools'); if (tools) tools.hidden = false;
      updateBalance();
    }
    editVoucherDetails({customer,details,escapeHtml,setCaption:name => { document.querySelector('.screen-title h1').textContent = name || (editing ? 'Accounting Voucher Alteration' : 'Accounting Voucher Creation'); },
      onDone:next => {
        details = next;
        main.querySelectorAll('.sale-line').forEach(el => el.hidden = false);
        const tools = main.querySelector('.line-tools'); if (tools) tools.hidden = false;
        main.querySelector(invoiceMode === 'item' ? '.line-item' : '#sale-account')?.focus();
      },
      onCancel:() => main.querySelector(customer.kind==='cash'?(invoiceMode === 'item' ? '.line-item' : '#sale-account'):'#sale-customer')?.focus()});
  }
  function readLines() {
    const lineEls = main.querySelectorAll('.sale-line:not(.item-line)');
    const lines = [];
    for (const el of lineEls) {
      const select = el.querySelector('.line-ledger, #sale-account');
      const input = el.querySelector('.line-amount, #sale-amount');
      const lid = Number(select?.value);
      if (!lid) continue;
      let amt = 0;
      try { amt = parseRupees(input?.value); } catch { amt = 0; }
      if (amt > 0) lines.push({ ledger_id: lid, amount: amt });
    }
    return lines;
  }
  function readSaleInput() {
    main.querySelector('#sale-error').textContent = '';
    let date;
    try { date = parseEntryDate(value('sale-date')); } catch (failure) { error(failure.message,'sale-date'); return; }
    const customer = customerForName(value('sale-customer'));
    if (!customer) { error('Choose an existing customer or Cash ledger.','sale-customer'); return; }
    if (main.querySelector('.sale-line').hidden) { showDetails(); return; }
    if (invoiceMode === 'item') {
      const item_lines = [];
      const lineEls = main.querySelectorAll('.sale-line.item-line');
      for (const el of lineEls) {
        const select = el.querySelector('.line-item');
        const itemId = Number(select?.value);
        if (!itemId) continue;
        const godownId = Number(el.querySelector('.line-godown')?.value) || null;
        const qty = parseFloat(el.querySelector('.line-qty')?.value) || 0;
        let rate = 0;
        try { rate = parseRupees(el.querySelector('.line-rate')?.value || '0'); } catch {}
        if (qty > 0 && rate > 0) {
          item_lines.push({ item_id: itemId, godown_id: godownId, quantity: qty, rate });
        }
      }
      if (!item_lines.length) {
        error('Choose a stock item and enter quantity and rate.', 'first-item-select');
        return;
      }
      const nextDetails = { ...details, invoice_mode: 'item', item_lines };
      return {
        type: 'sale',
        date,
        customer_id: customer.id,
        narration: value('sale-narration'),
        details: nextDetails,
        ...(editing ? { revision: editing.revision } : {})
      };
    }
    const lines = readLines();
    if (!lines.length) {
      let amount = 0;
      try { amount = parseRupees(value('sale-amount')); } catch (failure) { error(failure.message,'sale-amount'); return; }
      const account = Number(value('sale-account'));
      if (!account) { error('Choose a sales ledger.','sale-account'); return; }
      lines.push({ ledger_id: account, amount });
    }
    const hasMultiple = lines.length > 1;
    const totalAmount = lines.reduce((sum, l) => sum + l.amount, 0);
    const nextDetails = { ...details };
    if (hasMultiple) nextDetails.lines = lines;
    return {
      type: 'sale',
      date,
      customer_id: customer.id,
      account_id: lines[0].ledger_id,
      amount: totalAmount,
      ...(hasMultiple ? { lines } : {}),
      narration: value('sale-narration'),
      details: nextDetails,
      ...(editing ? { revision: editing.revision } : {})
    };
  }
  function showCostAllocations() {
    if (saving || getView() !== 'sale' || document.querySelector('dialog')) return;
    const lines = readLines();
    const account = Number(value('sale-account'));
    let amount = 0;
    try { amount = parseRupees(value('sale-amount')); } catch {}
    const targetLedgerId = lines[0]?.ledger_id ?? account;
    const targetAmount = lines[0]?.amount ?? amount;
    const targetLedger = book().ledgers.find(l => l.id === targetLedgerId);
    if (!targetLedger) { error('Choose a particulars ledger first.','sale-account'); return; }
    if (!targetAmount) { error('Enter an amount first.','sale-amount'); return; }
    editCostAllocations({
      ledger: targetLedger,
      amount: targetAmount,
      existingAllocations: details.cost_allocations || [],
      api,
      escapeHtml,
      setCaption: name => { document.querySelector('.screen-title h1').textContent = name || (editing ? 'Accounting Voucher Alteration' : 'Accounting Voucher Creation'); },
      onDone: allocs => {
        const others = (details.cost_allocations || []).filter(ca => ca.ledger_id !== targetLedger.id);
        details.cost_allocations = [...others, ...allocs];
        main.querySelector('#sale-narration').focus();
      },
      onCancel: () => main.querySelector('#sale-amount').focus()
    });
  }
  function showBillDetails(input = null) {
    if (saving || getView() !== 'sale' || document.querySelector('dialog')) return;
    input ??= readSaleInput();
    if (!input) return;
    if(book().ledgers.find(row=>row.id===input.customer_id)?.kind==='cash'){main.querySelector('#sale-narration').focus();return;}
    let billAmt = input.amount;
    if (invoiceMode === 'item' && billAmt === undefined) {
      try { billAmt = parseRupees(main.querySelector('#sale-total').textContent); } catch { billAmt = 0; }
    }
    editBillReference({currency:getBook(),customer:book().ledgers.find(row => row.id === input.customer_id),reference:billReference,terms:billTerms,amount:billAmt,date:input.date,escapeHtml,
      setCaption:name => { document.querySelector('.screen-title h1').textContent = name || (editing ? 'Accounting Voucher Alteration' : 'Accounting Voucher Creation'); },
      onDone:(reference,terms) => { billReference = reference; billTerms=terms; reviewedBill = billSignature(input); main.querySelector('#sale-narration').focus(); },
      onCancel:() => main.querySelector(invoiceMode === 'item' ? '.line-qty' : '#sale-amount')?.focus()});
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
      currentDate=saved.date;if(!editing)entryDates.rememberNew(saved.date);
      if (editing) { if(typeof origin==='function') await origin(); else await renderDayBook(); hint.textContent = `Saved changes to Sales No. ${saved.number}.`; }
      else renderSale(null,origin,`Saved Sales No. ${saved.number} · ${formatCompanyAmount(saved.amount,getBook())} · next voucher ready`);
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
    if (event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'h' && getView() === 'sale') { event.preventDefault(); toggleMode(); return true; }
    if(getView()==='daybook' && event.key==='F2' && !event.ctrlKey && !event.metaKey){event.preventDefault();showDayBookDates(event.altKey);return true;}
    if(getView()==='daybook' && event.key==='F4' && !event.ctrlKey && !event.altKey && !event.metaKey){event.preventDefault();showDayBookType();return true;}
    if(getView()==='daybook' && ['F6','F8'].includes(event.key) && !event.ctrlKey && !event.altKey && !event.metaKey){event.preventDefault();hint.textContent=event.key==='F8'?'Columnar view is not available yet.':'Choose New Receipt to enter a receipt voucher.';return true;}
    if (event.altKey && !event.ctrlKey && !event.metaKey) {
      if (event.key === 'F5') { event.preventDefault(); leaveFor(() => openOtherVoucher(null, origin, 'debit_note')); return true; }
      if (event.key === 'F6') { event.preventDefault(); leaveFor(() => openOtherVoucher(null, origin, 'credit_note')); return true; }
    }
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
