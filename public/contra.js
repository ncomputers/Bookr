import {formatCompanyAmount} from './company-currency.js';
import {entryDate,parseEntryDate,formatRupees,formatBalance,inputRupees,parseRupees} from './entry-values.js';
import {savedLedgerBalance} from './ledger-balance.js';
import {workingDateContext} from './company-context.js';
import {createEntryDateState} from './working-date.js';
import {editBankAllocation} from './bank-allocation.js';

export function createContraWorkspace({main,hint,api,setScreen,getView,getBook,refreshBook,escapeHtml,askDialog,renderGateway,openDayBook,openVoucher}) {
  const entryDates=createEntryDateState(()=>workingDateContext(getBook()));
  let editing=null,origin='gateway',busy=false,initial='',bankData=null,sourceBankData=null,reviewed='',currentDate=null;
  const value=id=>main.querySelector('#'+id).value;
  const signature=input=>`${input.source_id}:${input.destination_id}:${input.amount}:${input.date}`;
  const snapshot=()=>JSON.stringify({date:value('contra-date'),source:value('contra-source'),destination:value('contra-destination'),amount:value('contra-amount'),narration:value('contra-narration'),bankData,sourceBankData});
  const dirty=()=>getView()==='contra' && snapshot()!==initial;
  const back=()=>typeof origin==='function'?origin():origin==='daybook'?openDayBook():renderGateway(3);
  const ledger=id=>getBook().ledgers.find(ledger=>ledger.id===Number(id));
  const balance=formatBalance;
  function leave(action){if(busy || document.querySelector('dialog'))return;if(dirty())askDialog('Discard unsaved voucher changes?',action,'Discard');else action();}
  function command(id,label,action){const button=document.createElement('button');button.type='button';button.id=id;button.textContent=label;button.onclick=action;document.querySelector('.command-strip').insertBefore(button,hint);}
  function update(){
    let amount=0;try{amount=parseRupees(value('contra-amount'));}catch{}
    for(const [field,sign] of [['source',-1],['destination',1]]){const id=Number(value('contra-'+field));main.querySelector('#contra-'+field+'-balance').textContent=id?balance(savedLedgerBalance(getBook(),id,editing?.id)+sign*amount):'—';}
    main.querySelector('#contra-total').textContent=formatRupees(amount);
    const source=ledger(value('contra-source')),destination=ledger(value('contra-destination'));
    const describe=allocation=>`${allocation.transaction_type} · Inst No. ${allocation.instrument_number || '—'} · ${entryDate(allocation.instrument_date)}`;
    main.querySelector('#contra-bank-summary').textContent=source?.kind==='bank' && destination?.kind==='bank'?
      [sourceBankData?`${source.name}: ${describe(sourceBankData)}`:'',bankData?`${destination.name}: ${describe(bankData)}`:''].filter(Boolean).join(' · '):bankData?describe(bankData):'';
  }
  function read(){
    main.querySelector('#contra-error').textContent='';
    try{const source=ledger(value('contra-source')),destination=ledger(value('contra-destination'));
      if(!source || !destination || source.id===destination.id || !['cash','bank'].includes(source.kind) || !['cash','bank'].includes(destination.kind) || (source.kind==='cash' && destination.kind==='cash'))throw new Error('Choose different Cash/Bank accounts with at least one Bank account.');
      return {type:'contra',date:parseEntryDate(value('contra-date')),source_id:source.id,destination_id:destination.id,amount:parseRupees(value('contra-amount')),narration:value('contra-narration'),details:{bank:bankData,...(source.kind==='bank' && destination.kind==='bank'?{source_bank:sourceBankData}:{})},...(editing?{revision:editing.revision}:{})};
    }catch(error){main.querySelector('#contra-error').textContent=error.message;}
  }
  function render(voucher=null,from='gateway',message=''){
    currentDate=entryDates.forRender(voucher?{savedDate:voucher.date}:{});
    editing=voucher;origin=from;bankData=structuredClone(voucher?.details?.bank ?? null);sourceBankData=structuredClone(voucher?.details?.source_bank ?? null);reviewed=voucher?signature(voucher):'';if(voucher)currentDate=voucher.date;
    setScreen(voucher?'Accounting Voucher Alteration':'Accounting Voucher Creation','contra',message || 'F4: Contra · Enter: next · Ctrl+A: accept · F2: date · Esc: back');
    const accounts=getBook().ledgers.filter(ledger=>['cash','bank'].includes(ledger.kind)).sort((a,b)=>a.name.localeCompare(b.name));
    const options=id=>'<option value="">Select account</option>'+accounts.map(ledger=>`<option value="${ledger.id}" ${ledger.id===id?'selected':''}>${escapeHtml(ledger.name)}</option>`).join('');
    const number=voucher?.number ?? Math.max(0,...getBook().vouchers.filter(voucher=>voucher.type==='contra').map(voucher=>voucher.number))+1;
    main.innerHTML=`<form id="contra-form" novalidate autocomplete="off"><div class="voucher-heading"><strong class="voucher-type">Contra</strong><span>No. &nbsp;${number}</span><div class="voucher-date"><input id="contra-date" aria-label="Voucher date" value="${entryDate(currentDate)}"></div></div><div class="contra-account-row"><label for="contra-destination">Account</label><span>:</span><select id="contra-destination">${options(voucher?.destination_id)}</select></div><div class="contra-balance"><i>Current balance: <span id="contra-destination-balance"></span></i></div><div class="voucher-lines-heading"><strong>Particulars</strong><strong>Amount</strong></div><div class="contra-line"><label class="sr-only" for="contra-source">Source account</label><select id="contra-source">${options(voucher?.source_id)}</select><label class="sr-only" for="contra-amount">Transfer amount</label><input id="contra-amount" inputmode="decimal" value="${voucher?inputRupees(voucher.amount):''}"></div><div class="contra-balance"><i>Cur Bal: <span id="contra-source-balance"></span></i></div><div id="contra-bank-summary" class="bank-voucher-summary"></div><div class="voucher-space"></div><div id="contra-error" class="ledger-error" role="alert"></div><div class="voucher-bottom"><div class="voucher-narration"><label for="contra-narration">Narration:</label><textarea id="contra-narration" maxlength="1000" rows="2">${escapeHtml(voucher?.narration ?? '')}</textarea></div><div class="voucher-total"><strong id="contra-total"></strong></div></div></form>`;
    command('accept-contra','A: Accept  Ctrl+A',save);command('contra-bank-details','Bank Allocations',showBank);command('contra-daybook','Day Book',()=>leave(openDayBook));
    if(voucher)command('contra-postings','View Entries',()=>leave(showPostings));
    const rail=document.querySelector('.function-rail');for(const [key,type,label] of [['F4','contra','Contra'],['F5','payment','Payment'],['F6','receipt','Receipt'],['F7','journal','Journal'],['F8','sale','Sales'],['F9','purchase','Purchase']]){const button=document.createElement('button');button.type='button';button.dataset.salesRail='';button.textContent=key+': '+label;button.onclick=()=>leave(()=>openVoucher(null,origin,type));rail.insertBefore(button,rail.querySelector('.rail-space'));}
    const dateKey=rail.querySelector('button');dateKey.disabled=false;dateKey.onclick=()=>main.querySelector('#contra-date').focus();
    for(const id of ['contra-source','contra-destination'])main.querySelector('#'+id).addEventListener('change',()=>{bankData=null;sourceBankData=null;reviewed='';update();});
    main.querySelector('#contra-amount').addEventListener('input',update);main.querySelector('form').onsubmit=event=>{event.preventDefault();save();};update();initial=snapshot();main.querySelector('#contra-destination').focus();
  }
  function showBank(){
    if(busy || document.querySelector('dialog'))return;const input=read();if(!input)return;
    const destination=ledger(input.destination_id),source=ledger(input.source_id),bank=destination.kind==='bank'?destination:source;
    if(source.kind==='bank' && destination.kind==='bank'){
      const beforeReview=reviewed;reviewed='';
      editBankAllocation({currency:getBook(),account:source,type:'payment',amount:input.amount,date:input.date,bank:sourceBankData,escapeHtml,onDone:next=>{
        sourceBankData=next;update();
        editBankAllocation({currency:getBook(),account:destination,type:'receipt',amount:input.amount,date:input.date,bank:bankData,escapeHtml,onDone:incoming=>{
          bankData=incoming;reviewed=signature(input);update();main.querySelector('#contra-narration').focus();
        },onCancel:()=>main.querySelector('#contra-amount').focus()});
      },onCancel:()=>{reviewed=beforeReview;main.querySelector('#contra-amount').focus();}});
      return;
    }
    editBankAllocation({currency:getBook(),account:bank,type:'contra',direction:destination.kind==='bank'?'deposit':'withdrawal',amount:input.amount,date:input.date,bank:bankData,escapeHtml,onDone:next=>{bankData=next;reviewed=signature(input);update();main.querySelector('#contra-narration').focus();},onCancel:()=>main.querySelector('#contra-amount').focus()});
  }
  async function save(){
    if(busy || document.querySelector('dialog') || getView()!=='contra')return;const input=read();if(!input)return;
    if(!bankData || (Object.hasOwn(input.details,'source_bank') && !sourceBankData) || reviewed!==signature(input)){showBank();return;}
    busy=true;const fields=[...main.querySelectorAll('input,select,textarea')];fields.forEach(field=>field.disabled=true);document.querySelector('#accept-contra').disabled=true;
    try{const saved=await api(editing?'/api/vouchers/'+editing.id:'/api/vouchers',{method:editing?'PUT':'POST',body:JSON.stringify(input)});getBook().vouchers=getBook().vouchers.filter(voucher=>voucher.id!==saved.id).concat(saved);await refreshBook().catch(()=>{});currentDate=saved.date;if(!editing)entryDates.rememberNew(saved.date);if(editing){await back();hint.textContent='Saved changes to Contra No. '+saved.number+'.';}else render(null,origin,'Saved Contra No. '+saved.number+' · '+formatCompanyAmount(saved.amount,getBook())+' · next voucher ready');}
    catch(error){fields.forEach(field=>field.disabled=false);document.querySelector('#accept-contra').disabled=false;main.querySelector('#contra-error').textContent=error.message;}finally{busy=false;}
  }
  function showPostings(){setScreen('Accounting Entries','contra-postings','Saved Contra entries · Esc: return to voucher');main.innerHTML=`<section class="accounting-entries"><div class="report-company">${escapeHtml(getBook().company)}</div><div class="entries-header"><strong>Contra No. ${editing.number}</strong><span>${entryDate(editing.date)}</span></div><table class="voucher-report"><thead><tr><th>Particulars</th><th>Debit</th><th>Credit</th></tr></thead><tbody>${editing.postings.map(posting=>`<tr><td>${escapeHtml(posting.name)}</td><td class="amount">${posting.side==='debit'?formatRupees(posting.amount):''}</td><td class="amount">${posting.side==='credit'?formatRupees(posting.amount):''}</td></tr>`).join('')}</tbody><tfoot><tr><th>Total</th><th>${formatRupees(editing.amount)}</th><th>${formatRupees(editing.amount)}</th></tr></tfoot></table><p class="posting-status">Balanced · Destination debit / Source credit</p></section>`;}
  function goBack(){if(getView()==='contra-postings')render(editing,origin);else leave(back);}
  function onKey(event){
    if(!['contra','contra-postings'].includes(getView()))return false;if(busy){event.preventDefault();return true;}
    if(event.ctrlKey && !event.altKey && event.key.toLowerCase()==='a' && getView()==='contra'){event.preventDefault();save();return true;}if(event.ctrlKey || event.altKey || event.metaKey)return false;
    const type={F4:'contra',F5:'payment',F6:'receipt',F7:'journal',F8:'sale',F9:'purchase'}[event.key];if(type){event.preventDefault();leave(()=>openVoucher(null,origin,type));return true;}
    if(getView()!=='contra')return false;if(event.key==='F2'){event.preventDefault();const date=main.querySelector('#contra-date');date.focus();date.select();return true;}
    if(event.key==='Enter' && !event.shiftKey && !event.target.closest('button')){event.preventDefault();if(event.target.id==='contra-amount'){showBank();return true;}const fields=[...main.querySelectorAll('input,select,textarea')],index=fields.indexOf(event.target);if(index<fields.length-1)fields[index+1].focus();else askDialog('Accept this Contra voucher?',save);return true;}return false;
  }
  return {render,dirty,isSaving:()=>busy,goBack,onKey};
}
