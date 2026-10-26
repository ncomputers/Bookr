import {savedLedgerBalance} from './ledger-balance.js';
import {workingDateContext} from './company-context.js';
import {createEntryDateState} from './working-date.js';
import {entryDate,parseEntryDate,formatRupees,inputRupees,parseRupees} from './entry-values.js';
import {editVoucherDetails} from './voucher-details.js';
import {editBillReference} from './bill-details.js';

export function createPurchaseWorkspace({main,hint,api,setScreen,getBook,refreshBook,escapeHtml,askDialog,getView,renderGateway,openDayBook,openVoucher}) {
  const entryDates=createEntryDateState(()=>workingDateContext(getBook()));
  let editing=null,origin='gateway',saving=false,initial='',details={},reference='',billTerms=null,reviewed='',currentDate=null,detailsPartyId=null,initialInvoice=null;
  const value=id=>main.querySelector('#purchase-'+id).value;
  const parties=()=>getBook().ledgers.filter(l=>l.kind==='supplier' || (l.kind==='cash' && getBook().capabilities?.cash_purchases===true));
  const supplier=()=>parties().find(l=>l.name.toLocaleLowerCase()===value('supplier').trim().toLocaleLowerCase());
  const cashParty=()=>supplier()?.kind==='cash';
  const snapshot=()=>JSON.stringify({date:value('date'),invoice:value('invoice'),invoiceDate:value('invoice-date'),supplier:value('supplier'),account:value('account'),amount:value('amount'),narration:value('narration'),details,reference,billTerms});
  const dirty=()=>getView()==='purchase' && snapshot()!==initial;
  const signature=input=>`${input.supplier_id}:${input.amount}:${input.date}:${input.details.supplier_invoice?.number ?? ''}`;
  function button(id,label,action){const b=document.createElement('button');b.type='button';b.id=id;b.textContent=label;b.addEventListener('click',action);document.querySelector('.command-strip').insertBefore(b,hint);}
  function error(message,field){main.querySelector('#purchase-error').textContent=message;if(field)main.querySelector('#purchase-'+field).focus();}
  function leaveFor(action){if(saving || document.querySelector('dialog'))return;if(dirty())askDialog('Discard unsaved purchase changes?',action,'Discard');else action();}
  const returnTo=()=>typeof origin==='function'?origin():origin==='daybook'?openDayBook():renderGateway(3);
  function update(){
    let amount=0;try{amount=parseRupees(value('amount'));}catch{}
    main.querySelector('#purchase-total').textContent=formatRupees(amount);
    const party=supplier(),balance=party?savedLedgerBalance(getBook(),party.id):0;
    main.querySelector('#purchase-balance').textContent=party?`${formatRupees(Math.abs(balance))} ${balance<0?'Cr':'Dr'}`:'—';
    document.querySelector('#purchase-bill-details').disabled=party?.kind==='cash';
  }
  function renderPurchase(voucher=null,from='gateway',message=''){
    currentDate=entryDates.forRender(voucher?{savedDate:voucher.date}:{});
    editing=voucher;origin=from;details=structuredClone(voucher?.details ?? {});reference=voucher?.bill?.reference ?? '';billTerms=structuredClone(voucher?.bill?.terms ?? null);detailsPartyId=voucher?.supplier_id ?? null;
    if(voucher)currentDate=voucher.date;
    reviewed='';
    setScreen(voucher?'Accounting Voucher Alteration':'Accounting Voucher Creation','purchase',message || 'F9: Purchase · F5: Payment · F2: date · Enter: next · Ctrl+A: accept');
    const number=voucher?.number ?? Math.max(0,...getBook().vouchers.filter(v=>v.type==='purchase').map(v=>v.number))+1;
    const accounts=getBook().ledgers.filter(l=>l.kind==='purchase');
    main.innerHTML=`<form id="purchase-form" novalidate autocomplete="off"><div class="voucher-heading"><strong class="voucher-type">Purchase</strong><span>No. <b>${number}</b></span><div class="voucher-date"><label class="sr-only" for="purchase-date">Voucher date</label><input id="purchase-date" value="${entryDate(currentDate)}"><span id="purchase-weekday"></span></div></div><div class="supplier-invoice"><label for="purchase-invoice">Supplier Invoice No.</label><span>:</span><input id="purchase-invoice" maxlength="120" value="${escapeHtml(details.supplier_invoice?.number ?? '')}"><label for="purchase-invoice-date">Date</label><span>:</span><input id="purchase-invoice-date" value="${details.supplier_invoice?.date ? entryDate(details.supplier_invoice.date) : ''}"></div><div class="voucher-party"><label for="purchase-supplier">Party A/c name</label><span>:</span><input id="purchase-supplier" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="purchase-party-options" value="${escapeHtml(voucher?.supplier_name ?? '')}" spellcheck="false"></div><div class="party-balance"><i>Current balance &nbsp;:</i><i id="purchase-balance"></i></div><div id="purchase-party-options" class="party-options" role="listbox" aria-label="Supplier and Cash ledger accounts" hidden></div><div class="voucher-lines-heading"><strong>Particulars</strong><strong>Amount</strong></div><div class="sale-line"><label class="sr-only" for="purchase-account">Purchase ledger</label><select id="purchase-account">${accounts.map(l=>`<option value="${l.id}" ${voucher?.account_id===l.id?'selected':''}>${escapeHtml(l.name)}</option>`).join('')}</select><label class="sr-only" for="purchase-amount">Purchase amount in rupees</label><input id="purchase-amount" inputmode="decimal" maxlength="20" value="${voucher?inputRupees(voucher.amount):''}"></div><div class="voucher-space"></div><div id="purchase-error" class="ledger-error" role="alert"></div><div class="voucher-bottom"><div class="voucher-narration"><label for="purchase-narration">Narration:</label><textarea id="purchase-narration" maxlength="1000" rows="2">${escapeHtml(voucher?.narration ?? '')}</textarea></div><div class="voucher-total"><span id="purchase-total"></span></div></div></form>`;
    button('accept-purchase','A: Accept  Ctrl+A',save);
    button('purchase-party-details','Party Details',showDetails);
    button('purchase-bill-details','Bill-wise Details',showBill);
    button('open-day-book','Day Book',()=>leaveFor(openDayBook));
    if(voucher)button('view-purchase-postings','View Entries',()=>leaveFor(showPostings));
    const rail=document.querySelector('.function-rail');
    for(const [key,type,label] of [['F5','payment','Payment'],['F6','receipt','Receipt'],['F7','journal','Journal'],['F8','sale','Sales'],['F9','purchase','Purchase']]){
      const b=document.createElement('button');b.type='button';b.dataset.salesRail='';b.textContent=`${key}: ${label}`;b.onclick=()=>leaveFor(()=>type==='purchase'?renderPurchase(null,origin):openVoucher(null,origin,type));rail.insertBefore(b,rail.querySelector('.rail-space'));
    }
    const dateKey=rail.querySelector('button');dateKey.disabled=false;dateKey.onclick=()=>{main.querySelector('#purchase-date').focus();main.querySelector('#purchase-date').select();};
    const date=main.querySelector('#purchase-date');
    const weekday=()=>{try{main.querySelector('#purchase-weekday').textContent=new Intl.DateTimeFormat('en-GB',{weekday:'long',timeZone:'UTC'}).format(new Date(parseEntryDate(date.value)+'T12:00:00Z'));}catch{main.querySelector('#purchase-weekday').textContent='';}};
    date.addEventListener('input',weekday);weekday();
    main.querySelector('#purchase-amount').addEventListener('input',update);
    main.querySelector('#purchase-form').addEventListener('submit',e=>{e.preventDefault();save();});
    initialInvoice={number:value('invoice'),date:value('invoice-date')};
    bindSupplier();update();initial=snapshot();
    if(voucher){reviewed=signature(read());main.querySelector('#purchase-date').focus();}else main.querySelector('#purchase-invoice').focus();
  }
  function bindSupplier(){
    const input=main.querySelector('#purchase-supplier'),list=main.querySelector('#purchase-party-options');let rows=[],index=0;
    function close(){list.hidden=true;input.setAttribute('aria-expanded','false');}
    function highlight(){list.querySelectorAll('button').forEach((b,i)=>{b.classList.toggle('selected',i===index);b.setAttribute('aria-selected',String(i===index));if(i===index)b.scrollIntoView({block:'nearest'});});}
    function choose(i){
      if(!rows[i])return;
      if(detailsPartyId!==rows[i].id)details.party={mailing_name:rows[i].mailing_name || rows[i].name,address:rows[i].address,state:rows[i].state,country:rows[i].country};
      if(rows[i].kind==='cash'){reference='';billTerms=null;reviewed='';}
      else if(editing?.supplier_id===rows[i].id && editing.bill){reference=editing.bill.reference;billTerms=structuredClone(editing.bill.terms);}
      detailsPartyId=rows[i].id;input.value=rows[i].name;close();update();showDetails();
    }
    function filter(){rows=parties().filter(l=>`${l.name} ${l.alias}`.toLocaleLowerCase().includes(input.value.trim().toLocaleLowerCase()));index=0;list.innerHTML='<div class="selection-heading">List of Ledger Accounts</div>'+rows.map((l,i)=>`<button type="button" role="option" data-supplier="${i}">${escapeHtml(l.name)}${l.alias?`<small>${escapeHtml(l.alias)}</small>`:''}</button>`).join('')+(rows.length?'':'<p class="no-ledgers">Choose an existing supplier or Cash ledger.</p>');list.hidden=false;input.setAttribute('aria-expanded','true');list.querySelectorAll('button').forEach((b,i)=>{b.onmousedown=e=>e.preventDefault();b.onclick=()=>choose(i);});highlight();}
    input.addEventListener('focus',filter);input.addEventListener('input',()=>{filter();update();reviewed='';});input.addEventListener('blur',close);
    input.addEventListener('keydown',e=>{if(e.ctrlKey || e.altKey || list.hidden || !['ArrowDown','ArrowUp','Enter','Escape'].includes(e.key))return;e.preventDefault();e.stopPropagation();if(e.key==='Enter')choose(index);else if(e.key==='Escape')close();else if(rows.length){index=(index+(e.key==='ArrowDown'?1:-1)+rows.length)%rows.length;highlight();}});
  }
  function showDetails(){
    if(saving || document.querySelector('dialog'))return;const party=supplier();if(!party){error('Choose an existing supplier or Cash ledger.','supplier');return;}
    editVoucherDetails({purchase:true,customer:party,details,escapeHtml,setCaption:caption=>{document.querySelector('.screen-title h1').textContent=caption || (editing?'Accounting Voucher Alteration':'Accounting Voucher Creation');},onDone:next=>{details=next;main.querySelector('#purchase-account').focus();},onCancel:()=>main.querySelector('#purchase-supplier').focus()});
  }
  function read(){
    error('');let date,invoiceDate,amount;const party=supplier();
    try{date=parseEntryDate(value('date'));}catch(failure){error(failure.message,'date');return;}
    try{invoiceDate=value('invoice-date').trim()?parseEntryDate(value('invoice-date')):'';}catch(failure){error(failure.message,'invoice-date');return;}
    if(!party){error('Choose an existing supplier or Cash ledger.','supplier');return;}
    try{amount=parseRupees(value('amount'));}catch(failure){error(failure.message,'amount');return;}
    const nextDetails={...details};
    if(editing && value('invoice')===initialInvoice.number && value('invoice-date')===initialInvoice.date){
      // Display defaults must not materialize or fill unrelated saved metadata.
      if(Object.hasOwn(editing.details ?? {},'supplier_invoice'))nextDetails.supplier_invoice=structuredClone(editing.details.supplier_invoice);
      else delete nextDetails.supplier_invoice;
    }else nextDetails.supplier_invoice={number:value('invoice').trim(),date:invoiceDate};
    return {type:'purchase',date,supplier_id:party.id,account_id:Number(value('account')),amount,narration:value('narration'),details:nextDetails,...(party.kind==='cash'?{bill:null}:reference?{bill:{reference,terms:billTerms}}:{}),...(editing?{revision:editing.revision}:{})};
  }
  function showBill(){
    if(cashParty())return;
    if(saving || document.querySelector('dialog'))return;const input=read();if(!input)return;
    const number=editing?.number ?? Math.max(0,...getBook().vouchers.filter(v=>v.type==='purchase').map(v=>v.number))+1;
    editBillReference({customer:supplier(),reference:reference || input.details.supplier_invoice?.number || String(number),terms:billTerms,amount:input.amount,date:input.date,side:'Cr',description:'purchase',escapeHtml,setCaption:caption=>{document.querySelector('.screen-title h1').textContent=caption || (editing?'Accounting Voucher Alteration':'Accounting Voucher Creation');},onDone:(name,terms)=>{reference=name;billTerms=terms;reviewed=signature(input);main.querySelector('#purchase-narration').focus();},onCancel:()=>main.querySelector('#purchase-amount').focus()});
  }
  async function save(){
    if(saving || document.querySelector('dialog') || getView()!=='purchase')return;const input=read();if(!input)return;
    if(!cashParty() && (!reference || reviewed!==signature(input))){showBill();return;}
    saving=true;const fields=[...main.querySelectorAll('input,select,textarea')];fields.forEach(f=>f.disabled=true);document.querySelector('#accept-purchase').disabled=true;
    try{
      const saved=await api(editing?`/api/vouchers/${editing.id}`:'/api/vouchers',{method:editing?'PUT':'POST',body:JSON.stringify(input)});getBook().vouchers=getBook().vouchers.filter(v=>v.id!==saved.id).concat(saved);await refreshBook().catch(()=>{});currentDate=saved.date;if(!editing)entryDates.rememberNew(saved.date);
      if(editing){await returnTo();hint.textContent=`Saved changes to Purchase No. ${saved.number}.`;}else renderPurchase(null,origin,`Saved Purchase No. ${saved.number} · ₹${formatRupees(saved.amount)} · next voucher ready`);
    }catch(failure){fields.forEach(f=>f.disabled=false);document.querySelector('#accept-purchase').disabled=false;error(failure.message);}finally{saving=false;}
  }
  function showPostings(){
    const cash=getBook().ledgers.find(ledger=>ledger.id===editing.supplier_id)?.kind==='cash';
    setScreen('Accounting Entries','purchase-postings','Saved purchase entries · Esc: return to voucher');
    main.innerHTML=`<section class="accounting-entries purchase-entries"><div class="report-company">${escapeHtml(getBook().company)}</div><div class="entries-header"><strong>Purchase No. ${editing.number}</strong><span>${entryDate(editing.date)}</span></div><table class="voucher-report"><thead><tr><th>Particulars</th><th>Debit</th><th>Credit</th></tr></thead><tbody>${editing.postings.map(p=>`<tr><td>${p.side==='debit'?'By':'To'} &nbsp;${escapeHtml(p.name)}</td><td class="amount">${p.side==='debit'?formatRupees(p.amount):''}</td><td class="amount">${p.side==='credit'?formatRupees(p.amount):''}</td></tr>`).join('')}</tbody><tfoot><tr><th>Total</th><th>${formatRupees(editing.amount)}</th><th>${formatRupees(editing.amount)}</th></tr></tfoot></table><div class="posting-status">Balanced · Purchase debit and ${cash?'Cash':'Supplier'} credit${cash?' · Cash purchase':' · New Ref '+escapeHtml(editing.bill.reference)}</div></section>`;
  }
  function goBack(){if(getView()==='purchase')leaveFor(returnTo);else if(getView()==='purchase-postings')renderPurchase(editing,origin);}
  function onKey(e){
    if(!['purchase','purchase-postings'].includes(getView()))return false;if(saving){e.preventDefault();return true;}
    if(e.ctrlKey && !e.altKey && e.key.toLowerCase()==='a' && getView()==='purchase'){e.preventDefault();save();return true;}
    if(e.ctrlKey || e.altKey || e.metaKey)return false;
    const type={F4:'contra',F5:'payment',F6:'receipt',F7:'journal',F8:'sale',F9:'purchase'}[e.key];
    if(type){e.preventDefault();leaveFor(()=>type==='purchase'?renderPurchase(null,origin):openVoucher(null,origin,type));return true;}
    if(getView()!=='purchase')return false;
    if(e.key==='F2'){e.preventDefault();main.querySelector('#purchase-date').focus();main.querySelector('#purchase-date').select();return true;}
    if(e.key==='Enter' && !e.shiftKey && !e.target.closest('button')){
      e.preventDefault();if(e.target.id==='purchase-amount'){if(cashParty()){if(read())main.querySelector('#purchase-narration').focus();}else showBill();return true;}
      const fields=[...main.querySelectorAll('input,select,textarea')],i=fields.indexOf(e.target);if(i<fields.length-1)fields[i+1].focus();else askDialog('Accept this purchase voucher?',save);return true;
    }return false;
  }
  return {renderPurchase,dirty,isSaving:()=>saving,goBack,onKey};
}
