import {formatCompanyAmount} from './company-currency.js';
import {savedLedgerBalance} from './ledger-balance.js';
import {workingDateContext} from './company-context.js';
import {createEntryDateState} from './working-date.js';
import {entryDate,parseEntryDate,formatRupees,inputRupees,parseRupees} from './entry-values.js';
import {editVoucherDetails} from './voucher-details.js';
import {editBillReference} from './bill-details.js';
import {editCostAllocations} from './cost-allocations.js';

export function createNotesWorkspace({main,hint,api,setScreen,getBook,refreshBook,escapeHtml,askDialog,getView,renderGateway,openDayBook,openVoucher}) {
  const entryDates=createEntryDateState(()=>workingDateContext(getBook()));
  let editing=null,currentType='credit_note',origin='gateway',saving=false,initial='',details={},reference='',billTerms=null,reviewed='',currentDate=null,detailsPartyId=null,initialInvoice=null;

  const isCredit=()=>currentType==='credit_note';
  const partyKind=()=>isCredit()?'customer':'supplier';
  const accountKind=()=>isCredit()?'sales':'purchase';
  const value=id=>main.querySelector('#note-'+id).value;
  const parties=()=>getBook().ledgers.filter(l=>l.kind===partyKind() || l.kind==='cash');
  const selectedParty=()=>parties().find(l=>l.name.toLocaleLowerCase()===value('party').trim().toLocaleLowerCase());
  const cashParty=()=>selectedParty()?.kind==='cash';
  const snapshot=()=>JSON.stringify({type:currentType,date:value('date'),invoice:value('invoice'),invoiceDate:value('invoice-date'),party:value('party'),account:value('account'),amount:value('amount'),narration:value('narration'),details,reference,billTerms});
  const currentView=()=>isCredit()?'credit-note':'debit-note';
  const postingsView=()=>isCredit()?'credit-note-postings':'debit-note-postings';
  const dirty=()=>getView()===currentView() && snapshot()!==initial;
  const signature=input=>`${input.customer_id ?? input.supplier_id}:${input.amount}:${input.date}:${input.details.original_invoice?.number ?? ''}`;

  function button(id,label,action){const b=document.createElement('button');b.type='button';b.id=id;b.textContent=label;b.addEventListener('click',action);document.querySelector('.command-strip').insertBefore(b,hint);}
  function error(message,field){main.querySelector('#note-error').textContent=message;if(field)main.querySelector('#note-'+field).focus();}
  function leaveFor(action){if(saving || document.querySelector('dialog'))return;if(dirty())askDialog(`Discard unsaved ${isCredit()?'credit note':'debit note'} changes?`,action,'Discard');else action();}
  const returnTo=()=>typeof origin==='function'?origin():origin==='daybook'?openDayBook():renderGateway(3);

  function update(){
    let amount=0;
    main.querySelectorAll('.sale-line input[inputmode="decimal"], #note-amount').forEach(inp=>{
      try{amount+=parseRupees(inp.value);}catch{}
    });
    main.querySelector('#note-total').textContent=formatRupees(amount);
    const party=selectedParty(),balance=party?savedLedgerBalance(getBook(),party.id):0;
    main.querySelector('#note-balance').textContent=party?`${formatRupees(Math.abs(balance))} ${balance<0?'Cr':'Dr'}`:'—';
    const billBtn=document.querySelector('#note-bill-details');if(billBtn)billBtn.disabled=party?.kind==='cash';
  }

  function render(voucher=null,from='gateway',type='credit_note',message=''){
    currentType=voucher?.type ?? type;
    currentDate=entryDates.forRender(voucher?{savedDate:voucher.date}:{});
    editing=voucher;origin=from;details=structuredClone(voucher?.details ?? {});reference=voucher?.bill?.reference ?? '';billTerms=structuredClone(voucher?.bill?.terms ?? null);detailsPartyId=voucher?.customer_id ?? voucher?.supplier_id ?? null;
    if(voucher)currentDate=voucher.date;
    reviewed='';
    const title=isCredit()?'Credit Note':'Debit Note';
    setScreen(voucher?'Accounting Voucher Alteration':'Accounting Voucher Creation',currentView(),message || `${isCredit()?'Alt+F6: Credit Note':'Alt+F5: Debit Note'} · F2: date · Enter: next · Ctrl+A: accept`);
    const number=voucher?.number ?? Math.max(0,...getBook().vouchers.filter(v=>v.type===currentType).map(v=>v.number))+1;
    const allParticulars=getBook().ledgers.filter(l=>[accountKind(),'expense','income','general'].includes(l.kind));
    const partyName=voucher?.customer_name ?? voucher?.supplier_name ?? '';
    const savedLines=voucher?.lines ?? (voucher?.details?.lines || []);
    const primaryLine=savedLines[0] ?? {ledger_id:voucher?.account_id,amount:voucher?.amount};
    const extraLines=savedLines.slice(1);

    main.innerHTML=`<form id="note-form" novalidate autocomplete="off"><div class="voucher-heading"><strong class="voucher-type">${title}</strong><span>No. <b>${number}</b></span><div class="voucher-date"><label class="sr-only" for="note-date">Voucher date</label><input id="note-date" value="${entryDate(currentDate)}"><span id="note-weekday"></span></div></div><div class="supplier-invoice"><label for="note-invoice">Original Invoice No.</label><span>:</span><input id="note-invoice" maxlength="120" value="${escapeHtml(details.original_invoice?.number ?? '')}"><label for="note-invoice-date">Date</label><span>:</span><input id="note-invoice-date" value="${details.original_invoice?.date ? entryDate(details.original_invoice.date) : ''}"></div><div class="voucher-party"><label for="note-party">Party A/c name</label><span>:</span><input id="note-party" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="note-party-options" value="${escapeHtml(partyName)}" spellcheck="false"></div><div class="party-balance"><i>Current balance &nbsp;:</i><i id="note-balance"></i></div><div id="note-party-options" class="party-options" role="listbox" aria-label="${isCredit()?'Customer':'Supplier'} and Cash ledger accounts" hidden></div><div class="voucher-lines-heading"><strong>Particulars</strong><strong>Amount</strong></div><div id="note-lines"><div class="sale-line" data-line="0"><label class="sr-only" for="note-account">${isCredit()?'Sales':'Purchase'} ledger</label><select id="note-account" class="line-ledger">${allParticulars.map((l,i)=>`<option value="${l.id}" ${(primaryLine.ledger_id ?? voucher?.account_id ?? allParticulars[0]?.id)===l.id?'selected':''}>${escapeHtml(l.name)}</option>`).join('')}</select><label class="sr-only" for="note-amount">Amount</label><input id="note-amount" class="line-amount" inputmode="decimal" maxlength="20" value="${voucher?inputRupees(primaryLine.amount ?? voucher.amount):''}"></div>${extraLines.map((line,idx)=>`<div class="sale-line" data-line="${idx+1}"><select class="line-ledger"><option value=""></option>${allParticulars.map(l=>`<option value="${l.id}" ${line.ledger_id===l.id?'selected':''}>${escapeHtml(l.name)}</option>`).join('')}</select><input class="line-amount" inputmode="decimal" maxlength="20" value="${inputRupees(line.amount)}"><button type="button" class="remove-line-btn" tabindex="-1" title="Remove line">✕</button></div>`).join('')}</div><div class="line-tools"><button type="button" id="note-add-line" class="add-line-button" tabindex="-1">+ Add Line</button></div><div class="voucher-space"></div><div id="note-error" class="ledger-error" role="alert"></div><div class="voucher-bottom"><div class="voucher-narration"><label for="note-narration">Narration:</label><textarea id="note-narration" maxlength="1000" rows="2">${escapeHtml(voucher?.narration ?? '')}</textarea></div><div class="voucher-total"><span id="note-total"></span></div></div></form>`;

    button('accept-note','A: Accept  Ctrl+A',save);
    button('note-cost-allocations','Cost Allocations',showCostAllocations);
    button('note-party-details','Party Details',showDetails);
    button('note-bill-details','Bill-wise Details',showBill);
    button('open-day-book','Day Book',()=>leaveFor(openDayBook));
    if(voucher)button('view-note-postings','View Entries',()=>leaveFor(showPostings));

    const rail=document.querySelector('.function-rail');
    for(const [key,t,label] of [['F4','contra','Contra'],['F5','payment','Payment'],['F6','receipt','Receipt'],['F7','journal','Journal'],['F8','sale','Sales'],['F9','purchase','Purchase'],['Alt+F5','debit_note','Debit Note'],['Alt+F6','credit_note','Credit Note']]){
      const b=document.createElement('button');b.type='button';b.dataset.salesRail='';b.textContent=`${key}: ${label}`;
      b.onclick=()=>leaveFor(()=>t===currentType?render(null,origin,t):openVoucher(null,origin,t));
      rail.insertBefore(b,rail.querySelector('.rail-space'));
    }
    const dateKey=rail.querySelector('button');dateKey.disabled=false;dateKey.onclick=()=>{main.querySelector('#note-date').focus();main.querySelector('#note-date').select();};
    const date=main.querySelector('#note-date');
    const weekday=()=>{try{main.querySelector('#note-weekday').textContent=new Intl.DateTimeFormat('en-GB',{weekday:'long',timeZone:'UTC'}).format(new Date(parseEntryDate(date.value)+'T12:00:00Z'));}catch{main.querySelector('#note-weekday').textContent='';}};
    date.addEventListener('input',weekday);weekday();
    function bindLineEvents(container=main){
      container.querySelectorAll('.line-amount').forEach(inp=>{
        inp.removeEventListener('input',update);inp.addEventListener('input',update);
      });
      container.querySelectorAll('.remove-line-btn').forEach(btn=>{
        btn.onclick=()=>{btn.closest('.sale-line').remove();update();};
      });
    }
    bindLineEvents();
    main.querySelector('#note-add-line')?.addEventListener('click',()=>{
      const container=main.querySelector('#note-lines');
      const idx=container.querySelectorAll('.sale-line').length;
      const div=document.createElement('div');div.className='sale-line';div.dataset.line=String(idx);
      div.innerHTML=`<select class="line-ledger"><option value=""></option>${allParticulars.map(l=>`<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('')}</select><input class="line-amount" inputmode="decimal" maxlength="20" value=""><button type="button" class="remove-line-btn" tabindex="-1" title="Remove line">✕</button>`;
      container.appendChild(div);bindLineEvents(div);div.querySelector('.line-ledger').focus();
    });
    main.querySelector('#note-amount').addEventListener('input',update);
    main.querySelector('#note-form').addEventListener('submit',e=>{e.preventDefault();save();});
    initialInvoice={number:value('invoice'),date:value('invoice-date')};
    bindParty();update();initial=snapshot();
    if(voucher){reviewed=signature(read());main.querySelector('#note-date').focus();}else main.querySelector('#note-invoice').focus();
  }

  function bindParty(){
    const input=main.querySelector('#note-party'),list=main.querySelector('#note-party-options');let rows=[],index=0;
    function close(){list.hidden=true;input.setAttribute('aria-expanded','false');}
    function highlight(){list.querySelectorAll('button').forEach((b,i)=>{b.classList.toggle('selected',i===index);b.setAttribute('aria-selected',String(i===index));if(i===index)b.scrollIntoView({block:'nearest'});});}
    function choose(i){
      if(!rows[i])return;
      if(detailsPartyId!==rows[i].id)details.party={mailing_name:rows[i].mailing_name || rows[i].name,address:rows[i].address,state:rows[i].state,country:rows[i].country};
      if(rows[i].kind==='cash'){reference='';billTerms=null;reviewed='';}
      else if((editing?.customer_id===rows[i].id || editing?.supplier_id===rows[i].id) && editing.bill){reference=editing.bill.reference;billTerms=structuredClone(editing.bill.terms);}
      detailsPartyId=rows[i].id;input.value=rows[i].name;close();update();showDetails();
    }
    function filter(){
      rows=parties().filter(l=>`${l.name} ${l.alias}`.toLocaleLowerCase().includes(input.value.trim().toLocaleLowerCase()));
      index=0;
      list.innerHTML=`<div class="selection-heading">List of Ledger Accounts</div>`+rows.map((l,i)=>`<button type="button" role="option" data-party-idx="${i}">${escapeHtml(l.name)}${l.alias?`<small>${escapeHtml(l.alias)}</small>`:''}</button>`).join('')+(rows.length?'':`<p class="no-ledgers">Choose an existing ${isCredit()?'customer':'supplier'} or Cash ledger.</p>`);
      list.hidden=false;input.setAttribute('aria-expanded','true');
      list.querySelectorAll('button').forEach((b,i)=>{b.onmousedown=e=>e.preventDefault();b.onclick=()=>choose(i);});
      highlight();
    }
    input.addEventListener('focus',filter);input.addEventListener('input',()=>{filter();update();reviewed='';});input.addEventListener('blur',close);
    input.addEventListener('keydown',e=>{
      if(e.ctrlKey || e.altKey || list.hidden || !['ArrowDown','ArrowUp','Enter','Escape'].includes(e.key))return;
      e.preventDefault();e.stopPropagation();
      if(e.key==='Enter')choose(index);else if(e.key==='Escape')close();else if(rows.length){index=(index+(e.key==='ArrowDown'?1:-1)+rows.length)%rows.length;highlight();}
    });
  }

  function showDetails(){
    if(saving || document.querySelector('dialog'))return;const party=selectedParty();if(!party){error(`Choose an existing ${isCredit()?'customer':'supplier'} or Cash ledger.`,'party');return;}
    editVoucherDetails({purchase:!isCredit(),customer:party,details,escapeHtml,setCaption:caption=>{document.querySelector('.screen-title h1').textContent=caption || (editing?'Accounting Voucher Alteration':'Accounting Voucher Creation');},onDone:next=>{details=next;main.querySelector('#note-account').focus();},onCancel:()=>main.querySelector('#note-party').focus()});
  }

  function readLines(){
    const lineEls=main.querySelectorAll('.sale-line');const lines=[];
    for(const el of lineEls){
      const select=el.querySelector('.line-ledger, #note-account');
      const input=el.querySelector('.line-amount, #note-amount');
      const lid=Number(select?.value);if(!lid)continue;
      let amt=0;try{amt=parseRupees(input?.value);}catch{amt=0;}
      if(amt>0)lines.push({ledger_id:lid,amount:amt});
    }
    return lines;
  }

  function read(){
    error('');let date,invoiceDate;const party=selectedParty();
    try{date=parseEntryDate(value('date'));}catch(failure){error(failure.message,'date');return;}
    try{invoiceDate=value('invoice-date').trim()?parseEntryDate(value('invoice-date')):'';}catch(failure){error(failure.message,'invoice-date');return;}
    if(!party){error(`Choose an existing ${isCredit()?'customer':'supplier'} or Cash ledger.`,'party');return;}
    const lines=readLines();
    if(!lines.length){
      let amount=0;try{amount=parseRupees(value('amount'));}catch(failure){error(failure.message,'amount');return;}
      const account=Number(value('account'));
      if(!account){error(`Choose a ${isCredit()?'sales':'purchase'} ledger.`,'account');return;}
      lines.push({ledger_id:account,amount});
    }
    const hasMultiple=lines.length>1;
    const totalAmount=lines.reduce((sum,l)=>sum+l.amount,0);
    const nextDetails={...details};
    if(editing && value('invoice')===initialInvoice.number && value('invoice-date')===initialInvoice.date){
      if(Object.hasOwn(editing.details ?? {},'original_invoice'))nextDetails.original_invoice=structuredClone(editing.details.original_invoice);
      else delete nextDetails.original_invoice;
    }else nextDetails.original_invoice={number:value('invoice').trim(),date:invoiceDate};
    if(hasMultiple)nextDetails.lines=lines;
    return {
      type:currentType,date,
      ...(isCredit()?{customer_id:party.id}:{supplier_id:party.id,customer_id:party.id}),
      account_id:lines[0].ledger_id,amount:totalAmount,...(hasMultiple?{lines}:{}),narration:value('narration'),details:nextDetails,
      ...(party.kind==='cash'?{bill:null}:reference?{bill:{reference,terms:billTerms}}:{}),
      ...(editing?{revision:editing.revision}:{})
    };
  }

  function showCostAllocations(){
    if(saving || document.querySelector('dialog') || getView()!==currentView())return;
    const lines=readLines();const account=Number(value('account'));let amount=0;try{amount=parseRupees(value('amount'));}catch{}
    const targetLedgerId=lines[0]?.ledger_id ?? account;const targetAmount=lines[0]?.amount ?? amount;
    const targetLedger=getBook().ledgers.find(l=>l.id===targetLedgerId);
    if(!targetLedger){error(`Choose a ${isCredit()?'sales':'purchase'} ledger first.`,'account');return;}
    if(!targetAmount){error('Enter an amount first.','amount');return;}
    editCostAllocations({ledger:targetLedger,amount:targetAmount,existingAllocations:details.cost_allocations || [],api,escapeHtml,setCaption:caption=>{document.querySelector('.screen-title h1').textContent=caption || (editing?'Accounting Voucher Alteration':'Accounting Voucher Creation');},onDone:allocs=>{const others=(details.cost_allocations || []).filter(ca=>ca.ledger_id!==targetLedger.id);details.cost_allocations=[...others,...allocs];main.querySelector('#note-narration').focus();},onCancel:()=>main.querySelector('#note-amount').focus()});
  }

  function showBill(){
    if(cashParty())return;
    if(saving || document.querySelector('dialog'))return;const input=read();if(!input)return;
    const number=editing?.number ?? Math.max(0,...getBook().vouchers.filter(v=>v.type===currentType).map(v=>v.number))+1;
    editBillReference({currency:getBook(),customer:selectedParty(),reference:reference || input.details.original_invoice?.number || String(number),terms:billTerms,amount:input.amount,date:input.date,side:isCredit()?'Cr':'Dr',description:isCredit()?'credit note':'debit note',escapeHtml,setCaption:caption=>{document.querySelector('.screen-title h1').textContent=caption || (editing?'Accounting Voucher Alteration':'Accounting Voucher Creation');},onDone:(name,terms)=>{reference=name;billTerms=terms;reviewed=signature(input);main.querySelector('#note-narration').focus();},onCancel:()=>main.querySelector('#note-amount').focus()});
  }

  async function save(){
    if(saving || document.querySelector('dialog') || getView()!==currentView())return;const input=read();if(!input)return;
    if(!cashParty() && (!reference || reviewed!==signature(input))){showBill();return;}
    saving=true;const fields=[...main.querySelectorAll('input,select,textarea')];fields.forEach(f=>f.disabled=true);document.querySelector('#accept-note').disabled=true;
    try{
      const saved=await api(editing?`/api/vouchers/${editing.id}`:'/api/vouchers',{method:editing?'PUT':'POST',body:JSON.stringify(input)});getBook().vouchers=getBook().vouchers.filter(v=>v.id!==saved.id).concat(saved);await refreshBook().catch(()=>{});currentDate=saved.date;if(!editing)entryDates.rememberNew(saved.date);
      const title=isCredit()?'Credit Note':'Debit Note';
      if(editing){await returnTo();hint.textContent=`Saved changes to ${title} No. ${saved.number}.`;}else render(null,origin,currentType,`Saved ${title} No. ${saved.number} · ${formatCompanyAmount(saved.amount,getBook())} · next voucher ready`);
    }catch(failure){fields.forEach(f=>f.disabled=false);document.querySelector('#accept-note').disabled=false;error(failure.message);}finally{saving=false;}
  }

  function showPostings(){
    const cash=getBook().ledgers.find(ledger=>ledger.id===(editing.customer_id ?? editing.supplier_id))?.kind==='cash';
    const title=isCredit()?'Credit Note':'Debit Note';
    setScreen('Accounting Entries',postingsView(),`Saved ${title.toLowerCase()} entries · Esc: return to voucher`);
    main.innerHTML=`<section class="accounting-entries note-entries"><div class="report-company">${escapeHtml(getBook().company)}</div><div class="entries-header"><strong>${title} No. ${editing.number}</strong><span>${entryDate(editing.date)}</span></div><table class="voucher-report"><thead><tr><th>Particulars</th><th>Debit</th><th>Credit</th></tr></thead><tbody>${editing.postings.map(p=>`<tr><td>${p.side==='debit'?'By':'To'} &nbsp;${escapeHtml(p.name)}</td><td class="amount">${p.side==='debit'?formatRupees(p.amount):''}</td><td class="amount">${p.side==='credit'?formatRupees(p.amount):''}</td></tr>`).join('')}</tbody><tfoot><tr><th>Total</th><th>${formatRupees(editing.amount)}</th><th>${formatRupees(editing.amount)}</th></tr></tfoot></table><div class="posting-status">Balanced · ${isCredit()?'Sales Accounts debit and Customer':'Supplier debit and Purchase Accounts'} credit${cash?' · Cash voucher':editing.bill?' · Ref '+escapeHtml(editing.bill.reference):''}</div></section>`;
  }

  function goBack(){if(getView()===currentView())leaveFor(returnTo);else if(getView()===postingsView())render(editing,origin,currentType);}

  function onKey(e){
    if(![currentView(),postingsView()].includes(getView()))return false;if(saving){e.preventDefault();return true;}
    if(e.ctrlKey && !e.altKey && e.key.toLowerCase()==='a' && getView()===currentView()){e.preventDefault();save();return true;}
    if(e.altKey && !e.ctrlKey && !e.metaKey){
      if(e.key==='F5'){e.preventDefault();leaveFor(()=>render(null,origin,'debit_note'));return true;}
      if(e.key==='F6'){e.preventDefault();leaveFor(()=>render(null,origin,'credit_note'));return true;}
    }
    if(e.ctrlKey || e.altKey || e.metaKey)return false;
    const type={F4:'contra',F5:'payment',F6:'receipt',F7:'journal',F8:'sale',F9:'purchase'}[e.key];
    if(type){e.preventDefault();leaveFor(()=>openVoucher(null,origin,type));return true;}
    if(getView()!==currentView())return false;
    if(e.key==='F2'){e.preventDefault();main.querySelector('#note-date').focus();main.querySelector('#note-date').select();return true;}
    if(e.key==='Enter' && !e.shiftKey && !e.target.closest('button')){
      e.preventDefault();if(e.target.id==='note-amount'){if(cashParty()){if(read())main.querySelector('#note-narration').focus();}else showBill();return true;}
      const fields=[...main.querySelectorAll('input,select,textarea')],i=fields.indexOf(e.target);if(i<fields.length-1)fields[i+1].focus();else askDialog(`Accept this ${isCredit()?'credit note':'debit note'} voucher?`,save);return true;
    }return false;
  }

  return {renderCreditNote:(v,from,msg)=>render(v,from,'credit_note',msg),renderDebitNote:(v,from,msg)=>render(v,from,'debit_note',msg),render,dirty,isSaving:()=>saving,goBack,onKey};
}
