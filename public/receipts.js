import {formatCompanyAmount} from './company-currency.js';
import {entryDate,parseEntryDate,formatRupees,formatBalance,inputRupees,parseRupees} from './entry-values.js';
import {editReceiptAllocations} from './receipt-allocations.js';
import {editBankAllocation} from './bank-allocation.js';
import {savedLedgerBalance} from './ledger-balance.js';
import {workingDateContext} from './company-context.js';
import {createEntryDateState} from './working-date.js';
import {editEntryMode} from './entry-mode.js';
import {sameBill,allocationPayload} from './bill-identity.js';

export function createReceiptWorkspace({main,hint,api,setScreen,getBook,refreshBook,escapeHtml,askDialog,renderGateway,getView,openDayBook,openSale,openPurchase,openPayment,openReceipt,openContra,openJournal,type='receipt'}) {
  const payable=type==='payment',label=payable?'Payment':'Receipt',partyKind=payable?'supplier':'customer',postingsView=payable?'payment-postings':'receipt-postings';
  const entryDates=createEntryDateState(()=>workingDateContext(getBook()));
  let editing=null,origin='gateway',saving=false,loadingBills=false,initial='',currentDate=null,allocations=[],reviewed='';
  let bankData=null,bankReviewed='';
  let entryMode='double';
  const doubleEntry=()=>payable && entryMode==='double';
  const account=()=>getBook().ledgers.find(ledger=>ledger.id===Number(value('receipt-account')));
  const value=id=>main.querySelector('#'+id).value;
  const allowedParty=ledger=>payable?['supplier','expense','capital'].includes(ledger.kind):['customer','income','capital'].includes(ledger.kind);
  const direct=()=>['expense','income','capital'].includes(customer()?.kind);
  const customer=()=>getBook().ledgers.find(l=>allowedParty(l) && l.name.toLocaleLowerCase()===value('receipt-customer').trim().toLocaleLowerCase());
  const snapshot=()=>JSON.stringify({date:value('receipt-date'),customer:value('receipt-customer'),account:value('receipt-account'),amount:value('receipt-amount'),narration:value('receipt-narration'),allocations,bankData});
  const dirty=()=>getView()===type && snapshot()!==initial;
  const signature=input=>`${input.ledger_id ?? input.supplier_id ?? input.customer_id}:${input.amount}`;
  const bankSignature=input=>`${input.account_id}:${input.amount}:${input.date}`;
  function error(message,field){main.querySelector('#receipt-error').textContent=message;if(field)main.querySelector('#'+field).focus();}
  function button(id,label,action){const b=document.createElement('button');b.type='button';b.id=id;b.textContent=label;b.addEventListener('click',action);document.querySelector('.command-strip').insertBefore(b,hint);}
  function leaveFor(action){if(saving || loadingBills || document.querySelector('dialog'))return;if(dirty())askDialog(`Discard unsaved ${type} changes?`,action,'Discard');else action();}
  const returnTo=()=>typeof origin==='function'?origin():origin==='daybook'?openDayBook():renderGateway(3);
  function update(){
    let amount=0;try{amount=parseRupees(value('receipt-amount'));}catch{}
    main.querySelector('#receipt-total').textContent=formatRupees(amount);
    if(doubleEntry()){main.querySelector('#payment-credit').textContent=formatRupees(amount);main.querySelector('#payment-credit-total').textContent=formatRupees(amount);}
    const cash=savedLedgerBalance(getBook(),Number(value('receipt-account')),editing?.id)+(payable?-amount:amount);
    main.querySelector('#receipt-cash-balance').textContent=formatBalance(cash);
    const selected=customer();
    document.querySelector('#receipt-bill-details').hidden=['expense','income','capital'].includes(selected?.kind);
    const saved=selected?savedLedgerBalance(getBook(),selected.id,editing?.id):0;
    const balance=saved+(payable?amount:-amount);
    main.querySelector('#receipt-balance').textContent=selected?formatBalance(balance):'—';
    main.querySelector('#receipt-allocation-summary').innerHTML=allocations.map(a=>`<div>Agst Ref <strong>${escapeHtml((payable?getBook().payables:getBook().outstanding).find(b=>sameBill(b,a))?.reference ?? a.reference ?? '')}</strong><span>${formatRupees(a.amount)} ${payable?'Dr':'Cr'}</span></div>`).join('');
    document.querySelector('#receipt-bank-details').hidden=account()?.kind!=='bank';
    main.querySelector('#receipt-bank-summary').textContent=account()?.kind==='bank' && bankData?`${bankData.transaction_type} · Inst No. ${bankData.instrument_number || '—'} · ${entryDate(bankData.instrument_date)}`:'';
  }
  function renderReceipt(voucher=null,from='gateway',message='',draft=null){
    currentDate=entryDates.forRender(voucher?{savedDate:voucher.date}:{});
    editing=voucher;origin=from;allocations=structuredClone(voucher?.allocations ?? []);reviewed=voucher?signature(voucher):'';
    bankData=structuredClone(voucher?.details?.bank ?? null);bankReviewed=bankData?bankSignature(voucher):'';
    if(voucher)currentDate=voucher.date;
    setScreen(voucher?'Accounting Voucher Alteration':'Accounting Voucher Creation',type,message || `${payable?'F5: Payment · F9: Purchase':'F6: Receipt · F8: Sales'} · Enter: next · Ctrl+A: accept · Esc: back`);
    const number=voucher?.number ?? Math.max(0,...getBook().vouchers.filter(v=>v.type===type).map(v=>v.number))+1;
    const rank=ledger=>ledger.kind==='cash'?(ledger.id===1?0:1):2;
    const accounts=getBook().ledgers.filter(l=>['cash','bank'].includes(l.kind)).sort((a,b)=>rank(a)-rank(b));
    main.innerHTML=`<form id="receipt-form" novalidate autocomplete="off"><div class="voucher-heading"><strong class="voucher-type">${label}</strong><span>No. <b id="receipt-number">${number}</b></span><div class="voucher-date"><label for="receipt-date" class="sr-only">Voucher date</label><input id="receipt-date" value="${entryDate(voucher?.date ?? currentDate)}"><span id="receipt-weekday"></span></div></div><div class="voucher-party receipt-account"><label for="receipt-account">Account</label><span>:</span><select id="receipt-account">${accounts.map(l=>`<option value="${l.id}" ${voucher?.account_id===l.id?'selected':''}>${escapeHtml(l.name)}</option>`).join('')}</select></div><div class="voucher-lines-heading"><strong>Particulars</strong><strong>Amount</strong></div><div class="receipt-line"><label class="sr-only" for="receipt-customer">${payable?'Supplier':'Customer'} ledger</label><input id="receipt-customer" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="receipt-customer-options" value="${escapeHtml(voucher?.customer_name ?? '')}" spellcheck="false"><label class="sr-only" for="receipt-amount">${label} amount</label><input id="receipt-amount" inputmode="decimal" maxlength="20" value="${voucher?inputRupees(voucher.amount):''}"></div><div id="receipt-customer-options" class="party-options" role="listbox" aria-label="Customer ledger accounts" hidden></div><div class="receipt-current-balance"><i>Cur Bal: &nbsp;<span id="receipt-balance"></span></i></div><div id="receipt-allocation-summary"></div><div class="voucher-space"></div><div id="receipt-error" class="ledger-error" role="alert"></div><div class="voucher-bottom"><div class="voucher-narration"><label for="receipt-narration">Narration:</label><textarea id="receipt-narration" maxlength="1000" rows="2">${escapeHtml(voucher?.narration ?? '')}</textarea></div><div class="voucher-total"><span id="receipt-total"></span></div></div></form>`;
    main.querySelector('.receipt-account').insertAdjacentHTML('afterend','<div class="receipt-account-balance"><i>Current balance : &nbsp;<span id="receipt-cash-balance"></span></i></div>');
    if(doubleEntry()){
      const form=main.querySelector('#receipt-form');form.dataset.voucherType=type;
      const account=main.querySelector('.receipt-account'),cashBalance=main.querySelector('.receipt-account-balance');
      const cashLine=document.createElement('div');cashLine.className='payment-cash-line';cashLine.append(account);
      cashLine.insertAdjacentHTML('beforeend','<span id=payment-credit class=amount></span>');
      main.querySelector('#receipt-allocation-summary').after(cashLine,cashBalance);
      account.querySelector('label').textContent='To';main.querySelector('.receipt-line').classList.add('payment-party-line');
      main.querySelector('.receipt-line').insertAdjacentHTML('afterbegin','<span>By</span>');
      main.querySelector('.voucher-lines-heading').innerHTML='<strong>Particulars</strong><strong>Debit</strong><strong>Credit</strong>';
      main.querySelector('.voucher-total').insertAdjacentHTML('beforeend','<span id="payment-credit-total"></span>');
    }
    if(payable && !doubleEntry())main.querySelector('#receipt-form').dataset.voucherType='payment-single';
    button('accept-receipt','A: Accept  Ctrl+A',saveReceipt);
    button('receipt-bill-details','Bill-wise Details',()=>showAllocations());
    button('receipt-bank-details','Bank Allocations',()=>showBank());
    if(payable)button('receipt-change-mode','Ctrl+H: Change Mode',changeMode);
    main.querySelector('#receipt-allocation-summary').insertAdjacentHTML('afterend','<div id="receipt-bank-summary" class="bank-voucher-summary"></div>');
    button('open-day-book','Day Book',()=>leaveFor(openDayBook));
    if(voucher)button('view-receipt-postings','View Entries',()=>leaveFor(showPostings));
    const rail=document.querySelector('.function-rail');
    for(const [label,action] of [['F5: Payment',()=>leaveFor(()=>payable?openNew(origin):openPayment(null,origin))],['F6: Receipt',()=>leaveFor(()=>payable?openReceipt(null,origin):openNew(origin))],['F8: Sales',()=>leaveFor(()=>openSale(null,origin))],['F9: Purchase',()=>leaveFor(()=>openPurchase(null,origin))]]){
      const b=document.createElement('button');b.type='button';b.dataset.salesRail='';b.textContent=label;b.addEventListener('click',action);rail.insertBefore(b,rail.querySelector('.rail-space'));
    }
    const dateKey=rail.querySelector('button');dateKey.disabled=false;dateKey.onclick=()=>main.querySelector('#receipt-date').focus();
    const date=main.querySelector('#receipt-date');
    const contraKey=document.createElement('button');contraKey.type='button';contraKey.dataset.salesRail='';contraKey.textContent='F4: Contra';contraKey.onclick=()=>leaveFor(()=>openContra(null,origin));rail.insertBefore(contraKey,rail.querySelector('[data-sales-rail]'));
    const journalKey=document.createElement('button');journalKey.type='button';journalKey.dataset.salesRail='';journalKey.textContent='F7: Journal';journalKey.onclick=()=>leaveFor(()=>openJournal(null,origin));rail.insertBefore(journalKey,rail.querySelector('.rail-space'));
    function weekday(){try{main.querySelector('#receipt-weekday').textContent=new Intl.DateTimeFormat('en-GB',{weekday:'long',timeZone:'UTC'}).format(new Date(parseEntryDate(date.value)+'T12:00:00Z'));}catch{main.querySelector('#receipt-weekday').textContent='';}}
    date.addEventListener('input',weekday);weekday();
    main.querySelector('#receipt-amount').addEventListener('input',update);
    main.querySelector('#receipt-account').addEventListener('change',()=>{bankData=null;bankReviewed='';update();});
    main.querySelector('#receipt-form').addEventListener('submit',e=>{e.preventDefault();saveReceipt();});
    if(draft){for(const [id,text] of Object.entries(draft.fields))main.querySelector('#'+id).value=text;allocations=draft.allocations;reviewed=draft.reviewed;bankData=draft.bankData;bankReviewed=draft.bankReviewed;weekday();}
    if(payable){main.querySelector('label[for="receipt-customer"]').textContent='Supplier, expense or capital ledger';main.querySelector('#receipt-customer-options').setAttribute('aria-label','Supplier, expense or capital ledger accounts');}
    else {main.querySelector('label[for="receipt-customer"]').textContent='Customer, income or capital ledger';main.querySelector('#receipt-customer-options').setAttribute('aria-label','Customer, income or capital ledger accounts');}
    bindCustomers();update();initial=draft?.initial ?? snapshot();main.querySelector(doubleEntry()?'#receipt-customer':'#receipt-account').focus();
  }
  function changeMode(){
    if(!payable || saving || loadingBills || document.querySelector('dialog'))return;
    const draft={fields:Object.fromEntries(['receipt-date','receipt-customer','receipt-account','receipt-amount','receipt-narration'].map(id=>[id,value(id)])),allocations:structuredClone(allocations),reviewed,bankData:structuredClone(bankData),bankReviewed,initial};
    editEntryMode({mode:entryMode,onDone:mode=>{entryMode=mode;renderReceipt(editing,origin,'',draft);}});
  }
  function bindCustomers(){
    const input=main.querySelector('#receipt-customer'),list=main.querySelector('#receipt-customer-options');let rows=[],index=0;
    function highlight(){list.querySelectorAll('[data-receipt-party]').forEach((b,i)=>{b.classList.toggle('selected',i===index);b.setAttribute('aria-selected',String(i===index));if(i===index)b.scrollIntoView({block:'nearest'});});}
    function close(){list.hidden=true;input.setAttribute('aria-expanded','false');}
    function choose(i){if(!rows[i])return;const changed=customer()?.id!==rows[i].id;input.value=rows[i].name;if(changed){allocations=[];reviewed='';}close();update();main.querySelector('#receipt-amount').focus();}
    function filter(){rows=getBook().ledgers.filter(l=>allowedParty(l) && `${l.name} ${l.alias}`.toLocaleLowerCase().includes(input.value.trim().toLocaleLowerCase()));index=0;list.innerHTML=`<div class="selection-heading">List of Ledger Accounts</div>${rows.map((l,i)=>`<button type="button" role="option" data-receipt-party="${i}" aria-selected="false">${escapeHtml(l.name)}${l.alias?`<small>${escapeHtml(l.alias)}</small>`:''}</button>`).join('')}${rows.length?'':`<p class="no-ledgers">Create a ${payable?'supplier, expense or capital':'customer, income or capital'} ledger from Gateway first.</p>`}`;list.hidden=false;input.setAttribute('aria-expanded','true');list.querySelectorAll('button').forEach((b,i)=>{b.addEventListener('mousedown',e=>e.preventDefault());b.addEventListener('click',()=>choose(i));});highlight();}
    input.addEventListener('focus',filter);input.addEventListener('input',()=>{allocations=[];reviewed='';filter();update();});input.addEventListener('blur',close);
    input.addEventListener('keydown',e=>{if(e.ctrlKey || e.altKey || !['Enter','ArrowDown','ArrowUp','Escape'].includes(e.key) || list.hidden)return;e.preventDefault();e.stopPropagation();if(e.key==='Enter')choose(index);else if(e.key==='Escape')close();else if(rows.length){index=(index+(e.key==='ArrowDown'?1:-1)+rows.length)%rows.length;highlight();}});
  }
  function read(){
    error('');let date,amount;try{date=parseEntryDate(value('receipt-date'));}catch(failure){error(failure.message,'receipt-date');return;}
    const selected=customer();if(!selected){error(`Choose an existing ${payable?'supplier, expense or capital':'customer, income or capital'} ledger.`,'receipt-customer');return;}
    try{amount=parseRupees(value('receipt-amount'));}catch(failure){error(failure.message,'receipt-amount');return;}
    return {type,date,...(direct()?{ledger_id:selected.id}:payable?{supplier_id:selected.id}:{customer_id:selected.id}),account_id:Number(value('receipt-account')),amount,narration:value('receipt-narration'),allocations:direct()?[]:allocationPayload(allocations),details:{...(editing?.details ?? {}),bank:bankData},...(editing?{revision:editing.revision}:{})};
  }
  function showBank(input=null){
    if(saving || loadingBills || document.querySelector('dialog'))return;input ??=read();if(!input || account()?.kind!=='bank')return;
    editBankAllocation({currency:getBook(),account:account(),type,amount:input.amount,date:input.date,bank:bankData,escapeHtml,
      onDone:next=>{bankData=next;bankReviewed=bankSignature(input);update();main.querySelector('#receipt-narration').focus();},onCancel:()=>main.querySelector('#receipt-amount').focus()});
  }
  async function showAllocations(input=null){
    if(saving || loadingBills || document.querySelector('dialog'))return;input ??=read();if(!input)return;
    if(direct()){if(doubleEntry())main.querySelector('#receipt-account').focus();else if(account()?.kind==='bank')showBank(input);else main.querySelector('#receipt-narration').focus();return;}
    loadingBills=true;main.setAttribute('aria-busy','true');
    const fields=[...main.querySelectorAll('input,select,textarea')];fields.forEach(f=>f.disabled=true);
    try{
      const context=await api(`/api/${payable?'payment':'receipt'}-bills?${partyKind}=${input.supplier_id ?? input.customer_id}${editing?`&${type}=${editing.id}`:''}`);
      fields.forEach(f=>f.disabled=false);
      if(!context.bills.some(b=>b.available>0)){error(`No saved bills with an available balance for this ${partyKind}.`,'receipt-customer');return;}
      const key=payable?'payables':'outstanding';getBook()[key]=getBook()[key].filter(b=>b.customer_id!==context.customer.id).concat(context.bills);
      editReceiptAllocations({currency:getBook(),payment:payable,customer:context.customer,amount:input.amount,bills:context.bills,allocations,escapeHtml,onDone:rows=>{allocations=rows;reviewed=signature(input);update();document.querySelector(doubleEntry()?'#receipt-account':account()?.kind==='bank'?'#receipt-bank-details':'#receipt-narration').focus();},onCancel:()=>main.querySelector('#receipt-amount').focus()});
    }catch(failure){error(failure.message);}
    finally{fields.forEach(f=>f.disabled=false);loadingBills=false;main.removeAttribute('aria-busy');}
  }
  async function saveReceipt(){
    if(saving || loadingBills || document.querySelector('dialog') || getView()!==type)return;
    const input=read();if(!input)return;
    if(!direct() && (reviewed!==signature(input) || !allocations.length)){showAllocations(input);return;}
    if(account()?.kind==='bank' && (!bankData || bankReviewed!==bankSignature(input))){showBank(input);return;}
    saving=true;const fields=[...main.querySelectorAll('input,select,textarea')],accept=document.querySelector('#accept-receipt');fields.forEach(f=>f.disabled=true);accept.disabled=true;
    try{
      const saved=await api(editing?`/api/vouchers/${editing.id}`:'/api/vouchers',{method:editing?'PUT':'POST',body:JSON.stringify(input)});
      getBook().vouchers=getBook().vouchers.filter(v=>v.id!==saved.id).concat(saved);
      await refreshBook().catch(()=>{});currentDate=saved.date;if(!editing)entryDates.rememberNew(saved.date);
      if(editing){await returnTo();hint.textContent=`Saved changes to ${label} No. ${saved.number}.`;}
      else renderReceipt(null,origin,`Saved ${label} No. ${saved.number} · ${formatCompanyAmount(saved.amount,getBook())} · next voucher ready`);
    }catch(failure){fields.forEach(f=>f.disabled=false);accept.disabled=false;error(failure.message);}finally{saving=false;}
  }
  async function openNew(from='gateway'){if(saving || loadingBills)return;saving=true;try{await refreshBook();renderReceipt(null,from);}catch(failure){hint.textContent=failure.message;}finally{saving=false;}}
  function showPostings(){
    setScreen('Accounting Entries',postingsView,`Saved ${type} entries · Esc: return to voucher`);
    main.innerHTML=`<section class="accounting-entries receipt-entries"><div class="report-company">${escapeHtml(getBook().company)}</div><div class="entries-header"><strong>${label} No. ${editing.number}</strong><span>${entryDate(editing.date)}</span></div><table class="voucher-report"><thead><tr><th>Particulars</th><th>Debit</th><th>Credit</th></tr></thead><tbody>${editing.postings.map(p=>`<tr><td>${p.side==='debit'?'By':'To'} &nbsp;${escapeHtml(p.name)}</td><td class="amount">${p.side==='debit'?formatRupees(p.amount):''}</td><td class="amount">${p.side==='credit'?formatRupees(p.amount):''}</td></tr>`).join('')}</tbody><tfoot><tr><th>Total</th><th>${formatRupees(editing.amount)}</th><th>${formatRupees(editing.amount)}</th></tr></tfoot></table><div class="posting-status">Balanced · ${payable?'one Supplier debit and one Cash credit':'one Cash debit and one Customer credit'}</div><div class="saved-allocations">${editing.allocations.map(a=>`<p>Agst Ref &nbsp;<strong>${escapeHtml(a.reference)}</strong> &nbsp;${formatRupees(a.amount)} ${payable?'Dr':'Cr'}</p>`).join('')}</div></section>`;
    main.querySelector('.posting-status').textContent=`Balanced · ${payable?({expense:'Expense',capital:'Capital',supplier:'Supplier'}[editing.ledger_kind])+' debit / '+editing.account_name+' credit':editing.account_name+' debit / '+({income:'Income',capital:'Capital',customer:'Customer'}[editing.ledger_kind])+' credit'}`;
    if(editing.details?.bank){const bank=editing.details.bank;main.querySelector('.saved-allocations').insertAdjacentHTML('afterend',`<div class="saved-bank-details">${escapeHtml(bank.transaction_type)} · Inst No. <strong>${escapeHtml(bank.instrument_number || '—')}</strong> · ${entryDate(bank.instrument_date)}</div>`);}
  }
  function goBack(){if(getView()===type)leaveFor(returnTo);else if(getView()===postingsView)renderReceipt(editing,origin);}
  function onKey(e){
    if(![type,postingsView].includes(getView()))return false;
    if(saving || loadingBills){e.preventDefault();return true;}
    if(payable && e.ctrlKey && !e.altKey && e.key.toLowerCase()==='h' && getView()===type){e.preventDefault();changeMode();return true;}
    if(e.ctrlKey && !e.altKey && e.key.toLowerCase()==='a' && getView()===type){e.preventDefault();saveReceipt();return true;}
    if(e.ctrlKey || e.altKey || e.metaKey)return false;
    if(e.key==='F4'){e.preventDefault();leaveFor(()=>openContra(null,origin));return true;}
    if(e.key==='F5'){e.preventDefault();leaveFor(()=>payable?openNew(origin):openPayment(null,origin));return true;}
    if(e.key==='F6'){e.preventDefault();leaveFor(()=>payable?openReceipt(null,origin):openNew(origin));return true;}
    if(e.key==='F7'){e.preventDefault();leaveFor(()=>openJournal(null,origin));return true;}
    if(e.key==='F9'){e.preventDefault();leaveFor(()=>openPurchase(null,origin));return true;}
    if(e.key==='F8'){e.preventDefault();leaveFor(()=>openSale(null,origin));return true;}
    if(getView()!==type)return false;
    if(e.key==='F2'){e.preventDefault();const f=main.querySelector('#receipt-date');f.focus();f.select();return true;}
    if(e.key==='Enter' && !e.shiftKey && !e.target.closest('button')){
      e.preventDefault();if(e.target.id==='receipt-amount'){showAllocations();return true;}
      if(doubleEntry() && e.target.id==='receipt-account'){if(account()?.kind==='bank')showBank();else main.querySelector('#receipt-narration').focus();return true;}
      const fields=[...main.querySelectorAll('input,select,textarea')],i=fields.indexOf(document.activeElement);
      if(i<fields.length-1)fields[i+1].focus();else askDialog(`Accept this ${type} voucher?`,saveReceipt);return true;
    }return false;
  }
  return {renderReceipt,openNew,dirty,isSaving:()=>saving || loadingBills,onKey,goBack};
}
