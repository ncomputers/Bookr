import {formatCompanyAmount} from './company-currency.js';
import {entryDate,parseEntryDate,formatRupees,formatBalance,inputRupees,parseRupees} from './entry-values.js';
import {editBillReference} from './bill-details.js';
import {savedLedgerBalance} from './ledger-balance.js';
import {workingDateContext} from './company-context.js';
import {createEntryDateState} from './working-date.js';

export function createJournalWorkspace({main,hint,api,setScreen,getBook,refreshBook,escapeHtml,askDialog,renderGateway,getView,openDayBook,openVoucher,openGeneral}){
  const entryDates=createEntryDateState(()=>workingDateContext(getBook()));
  let editing=null,origin='gateway',busy=false,initial='',date=null,reference='',billTerms=null,reviewed='',creditAuto=true;
  const value=id=>main.querySelector('#journal-'+id).value;
  const ledger=(id,kind)=>getBook().ledgers.find(row=>row.kind===kind && row.name.toLowerCase()===value(id).trim().toLowerCase());
  const snapshot=()=>JSON.stringify({date:value('date'),debit:value('debit-ledger'),credit:value('credit-ledger'),debitAmount:value('debit-amount'),creditAmount:value('credit-amount'),narration:value('narration'),reference,billTerms});
  const dirty=()=>getView()==='journal' && snapshot()!==initial;
  const signature=input=>`${input.credit_ledger_id}:${input.date}:${input.credit_amount}`;
  const back=()=>typeof origin==='function'?origin():origin==='daybook'?openDayBook():renderGateway(3);
  const command=(id,text,action)=>{const button=document.createElement('button');button.type='button';button.id=id;button.textContent=text;button.onclick=action;document.querySelector('.command-strip').insertBefore(button,hint);};
  function leave(action){if(busy || document.querySelector('dialog'))return;if(dirty())askDialog('Discard unsaved voucher changes?',action,'Discard');else action();}
  function read(){
    const error=main.querySelector('#journal-error');error.textContent='';
    try{
      const debit=ledger('debit-ledger','expense'),credit=ledger('credit-ledger','supplier');
      if(!debit)throw new Error('Choose an Indirect Expenses ledger in By.');if(!credit)throw new Error('Choose a supplier ledger in To.');
      const debitAmount=parseRupees(value('debit-amount')),creditAmount=parseRupees(value('credit-amount'));
      if(debitAmount!==creditAmount)throw new Error('Journal debit and credit totals must be equal.');
      return {type:'journal',date:parseEntryDate(value('date')),debit_ledger_id:debit.id,credit_ledger_id:credit.id,debit_amount:debitAmount,credit_amount:creditAmount,bill:{reference:reference || String(number()),terms:billTerms},narration:value('narration'),...(editing?{revision:editing.revision}:{})};
    }catch(failure){error.textContent=failure.message;return null;}
  }
  const number=()=>editing?.number ?? Math.max(0,...getBook().vouchers.filter(row=>row.type==='journal').map(row=>row.number))+1;
  function update(){
    const amount=side=>{try{return parseRupees(value(side+'-amount'));}catch{return 0;}};
    const debit=amount('debit'),credit=amount('credit');
    main.querySelector('#journal-debit-total').textContent=formatRupees(debit);main.querySelector('#journal-credit-total').textContent=formatRupees(credit);
    for(const [side,kind,movement] of [['debit','expense',debit],['credit','supplier',-credit]]){
      const selected=ledger(side+'-ledger',kind),balance=selected?savedLedgerBalance(getBook(),selected.id,editing?.id)+movement:0;
      main.querySelector('#journal-'+side+'-balance').textContent=selected?formatBalance(balance):'';
    }
    main.querySelector('#journal-reference-summary').textContent=reference?`New Ref  ${reference}   ${formatRupees(credit)} Cr`:'';
    main.querySelector('#journal-difference').textContent=debit===credit?'':`Difference: ${formatRupees(Math.abs(debit-credit))}`;
    try{main.querySelector('#journal-weekday').textContent=new Intl.DateTimeFormat('en-GB',{weekday:'long',timeZone:'UTC'}).format(new Date(parseEntryDate(value('date'))+'T12:00:00Z'));}catch{main.querySelector('#journal-weekday').textContent='';}
  }
  function bindPicker(side,kind){
    const input=main.querySelector('#journal-'+side+'-ledger'),options=main.querySelector('#journal-'+side+'-options');let candidates=[],index=0;
    const highlight=()=>options.querySelectorAll('button').forEach((button,i)=>{button.classList.toggle('selected',i===index);button.setAttribute('aria-selected',String(i===index));if(i===index)input.setAttribute('aria-activedescendant',button.id);});
    function choose(i){const row=candidates[i];if(!row){main.querySelector('#journal-error').textContent='Choose a matching ledger.';return;}input.value=row.name;options.hidden=true;input.setAttribute('aria-expanded','false');if(side==='credit' && creditAuto)main.querySelector('#journal-credit-amount').value=value('debit-amount');update();main.querySelector('#journal-'+side+'-amount').focus();}
    function filter(){index=0;const query=input.value.trim().toLowerCase();candidates=getBook().ledgers.filter(row=>row.kind===kind && `${row.name} ${row.alias}`.toLowerCase().includes(query)).sort((a,b)=>a.name.localeCompare(b.name));options.innerHTML='<div class="selection-heading">List of Ledger Accounts</div>'+candidates.map((row,i)=>`<button type="button" role="option" id="journal-${side}-option-${i}">${escapeHtml(row.name)}${row.alias?`<small>${escapeHtml(row.alias)}</small>`:''}</button>`).join('');options.hidden=false;input.setAttribute('aria-expanded','true');input.removeAttribute('aria-activedescendant');options.querySelectorAll('button').forEach((button,i)=>{button.onmousedown=e=>e.preventDefault();button.onclick=()=>choose(i);});highlight();}
    input.oninput=()=>{filter();update();};input.onfocus=filter;
    input.onblur=()=>{setTimeout(()=>{if(!options.contains(document.activeElement)){options.hidden=true;input.setAttribute('aria-expanded','false');}},0);};
    input.onkeydown=e=>{if(['ArrowDown','ArrowUp','Enter'].includes(e.key) && !e.ctrlKey && !e.altKey){e.preventDefault();e.stopPropagation();if(e.key==='Enter')choose(index);else if(candidates.length){index=(index+(e.key==='ArrowDown'?1:-1)+candidates.length)%candidates.length;highlight();}}};
  }
  function render(voucher=null,from='gateway',message=''){
    date=entryDates.forRender(voucher?{savedDate:voucher.date}:{});
    editing=voucher;origin=from;reference=voucher?.bill?.reference ?? '';billTerms=structuredClone(voucher?.bill?.terms ?? null);creditAuto=!voucher;if(voucher)date=voucher.date;reviewed=voucher?signature(voucher):'';
    setScreen(voucher?'Accounting Voucher Alteration':'Accounting Voucher Creation','journal',message || 'F7: Journal · Enter: next · Ctrl+A: accept · F2: date · Esc: back');
    main.innerHTML=`<form id="journal-form" novalidate autocomplete="off"><div class="voucher-heading"><strong class="voucher-type">Journal</strong><span>No. &nbsp;${number()}</span><div class="voucher-date"><input id="journal-date" aria-label="Voucher date" value="${entryDate(date)}"><span id="journal-weekday"></span></div></div><div class="journal-columns"><strong>Particulars</strong><span>Debit</span><span>Credit</span></div><div class="journal-entry"><div class="journal-line"><label for="journal-debit-ledger">By</label><input id="journal-debit-ledger" aria-label="Debit expense ledger" role="combobox" aria-controls="journal-debit-options" aria-expanded="false" value="${escapeHtml(voucher?.debit_ledger_name ?? '')}" spellcheck="false"><input id="journal-debit-amount" aria-label="Debit amount" inputmode="decimal" maxlength="20" value="${voucher?inputRupees(voucher.amount):''}"><span></span></div><div id="journal-debit-options" class="party-options" role="listbox" aria-label="Indirect Expenses ledgers" hidden></div><div class="journal-current">Cur Bal: &nbsp;<i id="journal-debit-balance"></i></div></div><div class="journal-entry"><div class="journal-line"><label for="journal-credit-ledger">To</label><input id="journal-credit-ledger" aria-label="Credit supplier ledger" role="combobox" aria-controls="journal-credit-options" aria-expanded="false" value="${escapeHtml(voucher?.credit_ledger_name ?? '')}" spellcheck="false"><span></span><input id="journal-credit-amount" aria-label="Credit amount" inputmode="decimal" maxlength="20" value="${voucher?inputRupees(voucher.amount):''}"></div><div id="journal-credit-options" class="party-options" role="listbox" aria-label="Supplier ledgers" hidden></div><div class="journal-current">Cur Bal: &nbsp;<i id="journal-credit-balance"></i></div><div id="journal-reference-summary"></div></div><div class="voucher-space"><p class="journal-scope">Credit expense · one expense and one supplier · New Ref · no tax</p></div><div id="journal-error" class="ledger-error" role="alert"></div><div id="journal-difference" role="status"></div><div class="journal-totals"><span></span><strong id="journal-debit-total"></strong><strong id="journal-credit-total"></strong></div><div class="voucher-bottom"><div class="voucher-narration"><label for="journal-narration">Narration:</label><textarea id="journal-narration" rows="2" maxlength="1000">${escapeHtml(voucher?.narration ?? '')}</textarea></div></div></form>`;
    command('accept-journal','A: Accept  Ctrl+A',save);command('journal-bill-details','Bill-wise Details',showBill);command('journal-daybook','Day Book',()=>leave(openDayBook));if(voucher)command('journal-postings','View Entries',()=>leave(showPostings));
    if(!voucher && getBook().capabilities?.general_journal===true)command('open-general-journal','General Journal',()=>leave(()=>openGeneral(origin)));
    const rail=document.querySelector('.function-rail');for(const [key,type,label] of [['F4','contra','Contra'],['F5','payment','Payment'],['F6','receipt','Receipt'],['F7','journal','Journal'],['F8','sale','Sales'],['F9','purchase','Purchase']]){const button=document.createElement('button');button.type='button';button.dataset.salesRail='';button.textContent=key+': '+label;button.onclick=()=>leave(()=>openVoucher(null,origin,type));rail.insertBefore(button,rail.querySelector('.rail-space'));}
    const dateKey=rail.querySelector('button');dateKey.disabled=false;dateKey.onclick=()=>main.querySelector('#journal-date').focus();
    bindPicker('debit','expense');bindPicker('credit','supplier');main.querySelector('#journal-debit-amount').oninput=()=>{if(creditAuto && ledger('credit-ledger','supplier'))main.querySelector('#journal-credit-amount').value=value('debit-amount');update();};main.querySelector('#journal-credit-amount').oninput=()=>{creditAuto=false;update();};main.querySelector('#journal-date').oninput=update;main.querySelector('form').onsubmit=e=>{e.preventDefault();save();};update();initial=snapshot();main.querySelector(voucher?'#journal-date':'#journal-debit-ledger').focus();
  }
  function showBill(){
    if(busy || document.querySelector('dialog'))return;const input=read();if(!input)return;
    main.querySelector('#journal-debit-amount').value=inputRupees(input.debit_amount);main.querySelector('#journal-credit-amount').value=inputRupees(input.credit_amount);update();
    editBillReference({currency:getBook(),customer:ledger('credit-ledger','supplier'),reference:input.bill.reference,terms:billTerms,amount:input.credit_amount,date:input.date,side:'Cr',description:'Journal credit',escapeHtml,setCaption:caption=>{document.querySelector('.screen-title h1').textContent=caption || (editing?'Accounting Voucher Alteration':'Accounting Voucher Creation');},onDone:(next,terms)=>{reference=next;billTerms=terms;reviewed=signature(input);update();main.querySelector('#journal-narration').focus();},onCancel:()=>main.querySelector('#journal-credit-amount').focus()});
  }
  async function save(){
    if(busy || document.querySelector('dialog') || getView()!=='journal')return;const input=read();if(!input)return;if(reviewed!==signature(input)){showBill();return;}
    busy=true;const fields=[...main.querySelectorAll('input,textarea')];fields.forEach(field=>field.disabled=true);document.querySelector('#accept-journal').disabled=true;
    try{const saved=await api(editing?'/api/vouchers/'+editing.id:'/api/vouchers',{method:editing?'PUT':'POST',body:JSON.stringify(input)});getBook().vouchers=getBook().vouchers.filter(row=>row.id!==saved.id).concat(saved);await refreshBook().catch(()=>{});date=saved.date;if(!editing)entryDates.rememberNew(saved.date);if(editing){await back();hint.textContent='Saved changes to Journal No. '+saved.number+'.';}else render(null,origin,'Saved Journal No. '+saved.number+' · '+formatCompanyAmount(saved.amount,getBook())+' · next voucher ready');}
    catch(failure){fields.forEach(field=>field.disabled=false);document.querySelector('#accept-journal').disabled=false;main.querySelector('#journal-error').textContent=failure.message;}finally{busy=false;}
  }
  function showPostings(){setScreen('Accounting Entries','journal-postings','Saved Journal · Esc: return to voucher');main.innerHTML=`<section class="accounting-entries"><div class="report-company">${escapeHtml(getBook().company)}</div><div class="entries-header"><strong>Journal No. ${editing.number}</strong><span>${entryDate(editing.date)}</span></div><table class="voucher-report"><thead><tr><th>Particulars</th><th>Debit</th><th>Credit</th></tr></thead><tbody>${editing.postings.map(row=>`<tr><td>${escapeHtml(row.name)}</td><td class="amount">${row.side==='debit'?formatRupees(row.amount):''}</td><td class="amount">${row.side==='credit'?formatRupees(row.amount):''}</td></tr>`).join('')}</tbody><tfoot><tr><th>Total</th><th>${formatRupees(editing.amount)}</th><th>${formatRupees(editing.amount)}</th></tr></tfoot></table><p class="posting-status">Balanced · Expense debit / Supplier credit</p></section>`;}
  function goBack(){if(getView()==='journal-postings')render(editing,origin);else leave(back);}
  function onKey(e){
    if(!['journal','journal-postings'].includes(getView()))return false;if(busy){e.preventDefault();return true;}
    if(e.ctrlKey && !e.altKey && e.key.toLowerCase()==='a' && getView()==='journal'){e.preventDefault();save();return true;}if(e.ctrlKey || e.altKey || e.metaKey)return false;
    const type={F4:'contra',F5:'payment',F6:'receipt',F7:'journal',F8:'sale',F9:'purchase'}[e.key];if(type){e.preventDefault();leave(()=>openVoucher(null,origin,type));return true;}
    if(getView()!=='journal')return false;if(e.key==='F2'){e.preventDefault();main.querySelector('#journal-date').focus();main.querySelector('#journal-date').select();return true;}
    if(e.key==='Enter' && !e.shiftKey && !e.target.closest('button')){e.preventDefault();const next={'journal-date':'debit-ledger','journal-debit-amount':'credit-ledger'}[e.target.id];if(next)main.querySelector('#journal-'+next).focus();else if(e.target.id==='journal-credit-amount')showBill();else if(e.target.id==='journal-narration')askDialog('Accept this Journal voucher?',save);return true;}return false;
  }
  return {render,dirty,isSaving:()=>busy,goBack,onKey};
}
