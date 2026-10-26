import {entryDate,parseEntryDate,formatRupees,inputRupees,parseRupees} from './entry-values.js';
import {termText,parseTerm,termPreview} from './bill-terms.js';

// This edits only a master draft. Accepting the breakup never writes a ledger
// or creates voucher postings; the separate master acceptance saves it.
export function editOpeningBills({name,amount,side,bills=[],selectedId=null,escapeHtml,onDone,onCancel}){
  if(document.querySelector('dialog'))return;
  const previousFocus=document.activeElement,dialog=document.createElement('dialog');
  dialog.id='opening-bills-dialog';dialog.className='native-entry-dialog billwise-dialog opening-bills';
  dialog.setAttribute('aria-labelledby','opening-bills-heading');
  let rows=bills.map(row=>({...(row.id==null?{}:{id:row.id}),date:entryDate(row.date),reference:row.reference,amount:inputRupees(row.amount),term:termText(row.terms)})),active=0;
  if(!rows.length)rows.push({date:'31-Mar-2026',reference:'',amount:inputRupees(amount)});
  dialog.innerHTML=`<form novalidate autocomplete="off"><div class="bill-dialog-heading"><div id="opening-bills-heading">Opening Bill-wise Details: <strong>${escapeHtml(name)}</strong></div><div>Up to: <strong>${formatRupees(amount)} ${side}</strong></div></div><div class="opening-bill-columns bill-column-headings"><span>Date</span><span>Reference</span><span class="bill-amount-column">Amount</span><span>Dr/Cr</span></div><div id="opening-bills-rows"></div><div class="allocation-row-commands"><button type="button" id="opening-bills-add">Add reference</button><button type="button" id="opening-bills-remove">Remove reference</button></div><div id="opening-bills-error" class="details-error" role="alert"></div><div class="bill-dialog-space"></div><p class="bill-dialog-scope">Opening references dated before 1-Apr-2026 · full bill-wise breakup · Alt+Insert: add · Alt+Delete: remove</p><div id="opening-bills-total" class="bill-dialog-total"></div><div class="details-commands"><button type="button" id="opening-bills-cancel">Back <small>Esc</small></button><button type="submit" id="opening-bills-accept">Accept <small>Ctrl+A</small></button></div></form>`;
  document.body.append(dialog);const list=dialog.querySelector('#opening-bills-rows');
  const parsed=value=>{try{return parseRupees(value);}catch{return 0;}};
  const total=()=>rows.reduce((sum,row)=>sum+parsed(row.amount),0);
  function error(message,field){dialog.querySelector('#opening-bills-error').textContent=message;if(field)dialog.querySelector('#'+field)?.focus();}
  function updateTotal(){dialog.querySelector('#opening-bills-total').textContent=`${formatRupees(total())} ${side} / ${formatRupees(amount)} ${side}`;}
  function updateDue(i){let date;try{date=parseEntryDate(rows[i].date);}catch{}dialog.querySelector('#opening-bill-due-'+i).textContent=termPreview(rows[i].term ?? '',date);}
  function render(){
    list.innerHTML=rows.map((row,i)=>`<div class="opening-bill-columns bill-entry-row" data-opening-bill-row="${i}"><label class="sr-only" for="opening-bill-date-${i}">Opening bill ${i+1} date</label><input id="opening-bill-date-${i}" data-opening-step="date" value="${escapeHtml(row.date)}"><label class="sr-only" for="opening-bill-reference-${i}">Opening bill ${i+1} reference</label><input id="opening-bill-reference-${i}" data-opening-step="reference" maxlength="120" value="${escapeHtml(row.reference)}"><div class="opening-term-editor"><label for="opening-bill-term-${i}">Due date or credit days</label><input id="opening-bill-term-${i}" data-opening-step="term" value="${escapeHtml(row.term ?? '')}" maxlength="30" placeholder="Not specified" aria-describedby="opening-bill-due-${i} opening-bills-error"><output id="opening-bill-due-${i}" aria-live="polite"></output></div><label class="sr-only" for="opening-bill-amount-${i}">Opening bill ${i+1} amount in rupees</label><input id="opening-bill-amount-${i}" data-opening-step="amount" inputmode="decimal" maxlength="20" value="${escapeHtml(row.amount)}"><input id="opening-bill-side-${i}" data-opening-step="side" value="${side}" readonly aria-label="Opening bill ${i+1} side"></div>`).join('');
    list.querySelectorAll('[data-opening-bill-row]').forEach((element,i)=>{for(const key of ['date','reference','amount','term'])element.querySelector('[data-opening-step="'+key+'"]').addEventListener('input',event=>{rows[i][key]=event.target.value;error('');updateTotal();updateDue(i);});});updateTotal();rows.forEach((_,i)=>updateDue(i));
  }
  function add(){if(rows.length>=100){error('Use up to 100 opening references.');return;}const rest=amount-total();rows.push({date:'31-Mar-2026',reference:'',amount:rest>0?inputRupees(rest):''});active=rows.length-1;render();dialog.querySelector('#opening-bill-date-'+active).focus();}
  function remove(){rows.splice(active,1);if(!rows.length)rows.push({date:'31-Mar-2026',reference:'',amount:''});active=Math.min(active,rows.length-1);render();dialog.querySelector('#opening-bill-date-'+active).focus();error('');}
  function close(){dialog.close();dialog.remove();}
  function restore(){if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});}
  function cancel(){close();restore();onCancel?.();}
  function accept(){
    const result=[];
    for(let i=0;i<rows.length;i++){
      const row=rows[i];if(row.id==null && !row.reference.trim() && !row.amount.trim())continue;
      let date,value;try{date=parseEntryDate(row.date);if(date>='2026-04-01')throw new Error('Opening bill dates must be before 1-Apr-2026.');}catch(failure){error(failure.message,'opening-bill-date-'+i);return;}
      const reference=row.reference.trim();if(!reference){error('Enter a reference for every opening bill.','opening-bill-reference-'+i);return;}
      try{value=parseRupees(row.amount);}catch(failure){error(failure.message,'opening-bill-amount-'+i);return;}
      let terms;try{terms=parseTerm(row.term ?? '',date);}catch(failure){error(failure.message,'opening-bill-term-'+i);return;}
      result.push({...(row.id==null?{}:{id:row.id}),date,reference,amount:value,terms});
    }
    if(!result.length || result.reduce((sum,row)=>sum+row.amount,0)!==amount){error('Opening bill amounts must equal the ledger opening balance.');return;}
    close();restore();onDone(result);
  }
  list.addEventListener('focusin',event=>{const row=event.target.closest('[data-opening-bill-row]');if(row)active=Number(row.dataset.openingBillRow);});
  dialog.querySelector('form').addEventListener('submit',event=>{event.preventDefault();accept();});dialog.querySelector('#opening-bills-add').onclick=add;dialog.querySelector('#opening-bills-remove').onclick=remove;dialog.querySelector('#opening-bills-cancel').onclick=cancel;
  dialog.addEventListener('cancel',event=>{event.preventDefault();cancel();});
  dialog.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancel();return;}
    if(event.ctrlKey && !event.altKey && event.key.toLowerCase()==='a'){event.preventDefault();event.stopPropagation();accept();return;}
    if(event.altKey && ['Insert','Delete'].includes(event.key)){event.preventDefault();event.stopPropagation();if(event.key==='Insert')add();else remove();return;}
    if(event.ctrlKey || event.altKey || event.metaKey || event.key!=='Enter' || event.shiftKey || !event.target.dataset.openingStep)return;
    event.preventDefault();event.stopPropagation();const index=Number(event.target.closest('[data-opening-bill-row]').dataset.openingBillRow),step=event.target.dataset.openingStep;
    if(step==='date')dialog.querySelector('#opening-bill-reference-'+index).focus();
    else if(step==='reference')dialog.querySelector('#opening-bill-term-'+index).focus();
    else if(step==='term')dialog.querySelector('#opening-bill-amount-'+index).focus();
    else if(step==='amount')dialog.querySelector('#opening-bill-side-'+index).focus();
    else if(index<rows.length-1)dialog.querySelector('#opening-bill-date-'+(index+1)).focus();
    else if(total()<amount && rows[index].reference.trim() && parsed(rows[index].amount)>0)add();
    else accept();
  });
  render();dialog.showModal();const selected=selectedId==null?-1:rows.findIndex(row=>row.id===selectedId);active=selected<0?0:selected;dialog.querySelector('#opening-bill-'+(selected<0?'date':'reference')+'-'+active).focus();
}
