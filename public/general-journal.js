import {entryDate,parseEntryDate,formatRupees,formatBalance,inputRupees,parseRupees} from './entry-values.js';
import {savedLedgerBalance} from './ledger-balance.js';
import {createListPicker} from './list-picker.js';

// Original, bounded multi-line entry mode. Party bills and bank allocations
// remain in their dedicated voucher workflows.
export function createGeneralJournalWorkspace({main,hint,api,setScreen,getView,getBook,refreshBook,escapeHtml,askDialog,renderGateway,openDayBook,openVoucher,openLegacy}){
  const kinds=['cash','capital','expense','income','sales','purchase'];
  let editing=null,origin='gateway',busy=false,initial='',date='2026-04-01',pickers=[],nextRow=0;
  const active=()=>getView()==='journal-general';
  const rows=()=>[...main.querySelectorAll('[data-journal-line]')];
  const field=(row,key)=>row.querySelector('[data-entry-'+key+']');
  const snapshot=()=>JSON.stringify({date:main.querySelector('#general-journal-date').value,narration:main.querySelector('#general-journal-narration').value,entries:rows().map(row=>({ledger:field(row,'ledger').value,side:field(row,'side').value,amount:field(row,'amount').value}))});
  const dirty=()=>active() && snapshot()!==initial;
  const back=()=>typeof origin==='function'?origin():origin==='daybook'?openDayBook():renderGateway(3);
  const number=()=>editing?.number ?? Math.max(0,...getBook().vouchers.filter(row=>row.type==='journal').map(row=>row.number))+1;
  const command=(id,label,action)=>{const button=document.createElement('button');button.type='button';button.id=id;button.textContent=label;button.onclick=action;document.querySelector('.command-strip').insertBefore(button,hint);return button;};
  function dispose(){pickers.forEach(picker=>picker.destroy());pickers=[];}
  function leave(action){if(busy || document.querySelector('dialog'))return;if(dirty())askDialog('Discard unsaved voucher changes?',action,'Discard');else action();}
  function update(){
    if(!active())return;
    let debit=0,credit=0;const movements=new Map();
    for(const row of rows()){
      let amount=0;try{amount=parseRupees(field(row,'amount').value);}catch{}
      const side=field(row,'side').value,id=Number(field(row,'ledger').value);
      if(side==='debit')debit+=amount;else credit+=amount;
      movements.set(id,(movements.get(id) ?? 0)+(side==='debit'?amount:-amount));
      row.dataset.side=side;row.querySelector('[data-remove-entry]').disabled=rows().length<=2 || busy;
    }
    for(const row of rows()){
      const id=Number(field(row,'ledger').value);
      row.querySelector('[data-entry-balance]').textContent=id?formatBalance(savedLedgerBalance(getBook(),id,editing?.id)+(movements.get(id) ?? 0)):'';
    }
    main.querySelector('#general-journal-debit-total').textContent=formatRupees(debit);
    main.querySelector('#general-journal-credit-total').textContent=formatRupees(credit);
    main.querySelector('#general-journal-difference').textContent=debit===credit?'Balanced':`Difference: ${formatRupees(Math.abs(debit-credit))}`;
    main.querySelector('#general-journal-add-line').disabled=busy || rows().length>=100;
  }
  function movement(exclude=null){
    return rows().filter(row=>row!==exclude).reduce((total,row)=>{let amount=0;try{amount=parseRupees(field(row,'amount').value);}catch{}return total+(field(row,'side').value==='debit'?amount:-amount);},0);
  }
  function suggestAmount(row){
    const amount=field(row,'amount'),difference=movement(row);
    if(field(row,'ledger').value && !amount.value.trim() && difference)amount.value=inputRupees(Math.abs(difference));
  }
  function addLine(entry={side:'debit'},focus=false){
    if(rows().length>=100)return;
    const index=nextRow++,row=document.createElement('div');row.dataset.journalLine='';row.className='general-journal-line';
    row.innerHTML=`<select data-entry-side aria-label="Entry ${index+1} side"><option value="debit">By</option><option value="credit">To</option></select><div class="general-ledger-cell"><select data-entry-ledger id="general-entry-ledger-${index}" aria-label="Entry ${index+1} ledger"><option value="" disabled>Choose ledger</option>${getBook().ledgers.filter(ledger=>kinds.includes(ledger.kind)).map(ledger=>`<option value="${ledger.id}">${escapeHtml(ledger.name)}</option>`).join('')}</select><div class="general-current">Cur Bal: <i data-entry-balance></i></div></div><div class="general-entry-money"><input data-entry-amount aria-label="Entry ${index+1} amount in rupees" inputmode="decimal" maxlength="20" value="${entry.amount?inputRupees(entry.amount):''}"></div><button type="button" data-remove-entry aria-label="Remove entry ${index+1}">×</button>`;
    main.querySelector('#general-journal-lines').append(row);
    field(row,'side').value=entry.side;field(row,'ledger').value=entry.ledger_id ?? '';
    const picker=createListPicker({host:main,select:field(row,'ledger'),id:'general-entry-'+index,title:'List of Ledger Accounts',searchLabel:'Search ledger accounts',itemLabel:'ledger',extraValues:getBook().ledgers.filter(ledger=>ledger.kind==='cash').map(ledger=>ledger.id),acceptControl:document.querySelector('#accept-general-journal'),onAccepted:()=>{suggestAmount(row);const amount=field(row,'amount');amount.focus();amount.select();},onAcceptAll:save});pickers.push(picker);
    row.oninput=update;row.onchange=event=>{if(event.target===field(row,'ledger'))suggestAmount(row);update();};
    row.querySelector('[data-remove-entry]').onclick=()=>{if(busy || rows().length<=2)return;picker.destroy();pickers=pickers.filter(item=>item!==picker);row.remove();update();};
    if(focus)field(row,'side').focus();
  }
  function read(){
    const error=main.querySelector('#general-journal-error');error.textContent='';
    try{
      const seen=new Set(),entries=rows().map(row=>{
        const ledger=getBook().ledgers.find(item=>item.id===Number(field(row,'ledger').value) && kinds.includes(item.kind));
        if(!ledger)throw new Error('Choose a supported ledger on every Journal line.');
        if(seen.has(ledger.id))throw new Error('Choose each Journal ledger once.');seen.add(ledger.id);
        return {ledger_id:ledger.id,side:field(row,'side').value,amount:parseRupees(field(row,'amount').value)};
      });
      const debit=entries.filter(row=>row.side==='debit').reduce((sum,row)=>sum+row.amount,0),credit=entries.filter(row=>row.side==='credit').reduce((sum,row)=>sum+row.amount,0);
      if(!debit || debit!==credit)throw new Error('Journal debit and credit totals must be equal.');
      return {type:'journal',date:parseEntryDate(main.querySelector('#general-journal-date').value),entries,narration:main.querySelector('#general-journal-narration').value,...(editing?{revision:editing.revision}:{})};
    }catch(failure){error.textContent=failure.message;return null;}
  }
  function render(voucher=null,from='gateway',message=''){
    editing=voucher;origin=from;if(voucher)date=voucher.date;nextRow=0;
    setScreen(voucher?'Accounting Voucher Alteration':'Accounting Voucher Creation','journal-general',message || 'General Journal · Enter: next field · Ctrl+A: save · F2: date · Esc: back');
    main.innerHTML=`<form id="general-journal-form" novalidate autocomplete="off"><div class="voucher-heading"><strong class="voucher-type">Journal</strong><span>No. &nbsp;${number()}</span><div class="voucher-date"><input id="general-journal-date" aria-label="Voucher date" value="${entryDate(date)}"></div></div><div class="general-journal-columns"><span></span><strong>Particulars</strong><span>Debit</span><span>Credit</span><span></span></div><div id="general-journal-lines"></div><div class="general-add-row"><button type="button" id="general-journal-add-line">Add line</button></div><p class="general-journal-scope">General Journal · Cash, Capital, Expenses, Incomes, Sales and Purchases · no tax or bill allocations</p><div id="general-journal-error" class="ledger-error" role="alert"></div><div id="general-journal-difference" role="status"></div><div class="general-journal-totals"><span>Total</span><strong id="general-journal-debit-total"></strong><strong id="general-journal-credit-total"></strong><span></span></div><div class="voucher-bottom"><div class="voucher-narration"><label for="general-journal-narration">Narration:</label><textarea id="general-journal-narration" rows="2" maxlength="1000">${escapeHtml(voucher?.narration ?? '')}</textarea></div></div></form>`;
    command('accept-general-journal','A: Accept  Ctrl+A',save);
    command('general-journal-daybook','Day Book',()=>leave(openDayBook));
    if(voucher)command('general-journal-postings','View Entries',()=>leave(showPostings));else command('open-legacy-journal','Credit Expense Journal',()=>leave(()=>openLegacy(origin)));
    for(const entry of voucher?.entries ?? [{side:'debit'},{side:'debit'}])addLine(entry);
    main.querySelector('#general-journal-add-line').onclick=()=>{addLine({side:'debit'},true);update();};
    main.querySelector('#general-journal-date').oninput=update;
    main.querySelector('form').onsubmit=event=>{event.preventDefault();save();};
    const rail=document.querySelector('.function-rail');
    for(const [key,type,label] of [['F4','contra','Contra'],['F5','payment','Payment'],['F6','receipt','Receipt'],['F7','journal','Journal'],['F8','sale','Sales'],['F9','purchase','Purchase']]){const button=document.createElement('button');button.type='button';button.dataset.salesRail='';button.textContent=key+': '+label;button.onclick=()=>leave(()=>openVoucher(null,origin,type));rail.insertBefore(button,rail.querySelector('.rail-space'));}
    const dateKey=rail.querySelector('button');dateKey.disabled=false;dateKey.onclick=()=>main.querySelector('#general-journal-date').focus();
    update();initial=snapshot();main.querySelector(voucher?'#general-journal-date':'[data-entry-ledger]').focus();
  }
  async function save(){
    if(!active() || busy || document.querySelector('dialog'))return;
    for(const picker of pickers)if(picker.isOpen() && !picker.accept())return;
    const input=read();if(!input)return;
    busy=true;const fields=[...main.querySelectorAll('input,select,textarea,button')];fields.forEach(field=>field.disabled=true);document.querySelector('#accept-general-journal').disabled=true;
    try{
      const saved=await api(editing?'/api/vouchers/'+editing.id:'/api/vouchers',{method:editing?'PUT':'POST',body:JSON.stringify(input)});
      getBook().vouchers=getBook().vouchers.filter(row=>row.id!==saved.id).concat(saved);await refreshBook().catch(()=>{});date=saved.date;
      if(editing){await back();hint.textContent='Saved changes to Journal No. '+saved.number+'.';}else render(null,origin,'Saved Journal No. '+saved.number+' · next voucher ready');
    }catch(failure){fields.forEach(field=>field.disabled=false);document.querySelector('#accept-general-journal').disabled=false;main.querySelector('#general-journal-error').textContent=failure.message;}
    finally{busy=false;if(active())update();}
  }
  function showPostings(){
    setScreen('Accounting Entries','journal-general-postings','Saved General Journal · Esc: return to voucher');
    main.innerHTML=`<section class="accounting-entries"><div class="report-company">${escapeHtml(getBook().company)}</div><div class="entries-header"><strong>Journal No. ${editing.number}</strong><span>${entryDate(editing.date)}</span></div><table class="voucher-report"><thead><tr><th>Particulars</th><th>Debit</th><th>Credit</th></tr></thead><tbody>${editing.entries.map(row=>`<tr><td>${escapeHtml(row.name)}</td><td class="amount">${row.side==='debit'?formatRupees(row.amount):''}</td><td class="amount">${row.side==='credit'?formatRupees(row.amount):''}</td></tr>`).join('')}</tbody><tfoot><tr><th>Total</th><th>${formatRupees(editing.amount)}</th><th>${formatRupees(editing.amount)}</th></tr></tfoot></table><p class="posting-status">Balanced · ${editing.entries.length} accounting entries</p></section>`;
  }
  function goBack(){if(getView()==='journal-general-postings')render(editing,origin);else leave(back);}
  function onKey(event){
    if(!['journal-general','journal-general-postings'].includes(getView()))return false;
    if(busy){event.preventDefault();return true;}
    for(const picker of pickers)if(picker.onKey(event))return true;
    if(event.ctrlKey && !event.altKey && event.key.toLowerCase()==='a' && active()){event.preventDefault();save();return true;}
    if(event.ctrlKey || event.altKey || event.metaKey)return false;
    const type={F4:'contra',F5:'payment',F6:'receipt',F7:'journal',F8:'sale',F9:'purchase'}[event.key];
    if(type){event.preventDefault();leave(()=>openVoucher(null,origin,type));return true;}
    if(!active())return false;
    if(event.key==='F2'){event.preventDefault();const input=main.querySelector('#general-journal-date');input.focus();input.select();return true;}
    if(event.key==='Enter' && !event.shiftKey && !event.target.closest('button')){
      event.preventDefault();
      if(event.target.matches('[data-entry-amount]')){
        const row=event.target.closest('[data-journal-line]'),list=rows(),error=main.querySelector('#general-journal-error');error.textContent='';
        try{if(!field(row,'ledger').value)throw new Error('Choose a ledger for this Journal line.');parseRupees(field(row,'amount').value);}catch(failure){error.textContent=failure.message;return true;}
        const index=list.indexOf(row);
        if(index<list.length-1)field(list[index+1],'side').focus();
        else if(movement()!==0){
          if(list.length>=100){error.textContent='Balance the existing Journal lines; at most 100 lines are supported.';return true;}
          addLine({side:movement()>0?'credit':'debit'},true);update();
        }else main.querySelector('#general-journal-narration').focus();
        return true;
      }
      const fields=[...main.querySelectorAll('#general-journal-form input,#general-journal-form select,#general-journal-form textarea')].filter(item=>!item.disabled && item.getClientRects().length);
      const index=fields.indexOf(event.target);if(index>=0 && index<fields.length-1)fields[index+1].focus();else if(index===fields.length-1)askDialog('Accept this Journal voucher?',save);return true;
    }
    return false;
  }
  return {render,dirty,isSaving:()=>busy,onKey,goBack,dispose};
}
