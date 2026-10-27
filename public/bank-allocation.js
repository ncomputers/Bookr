import {entryDate,parseEntryDate,formatRupees} from './entry-values.js';
import {editCashDenominations} from './cash-denominations.js';
import {supportsCompanyDenominations} from './company-currency.js';

export function editBankAllocation({account,type,amount,date,bank,onDone,onCancel,escapeHtml,direction=null,currency={}}) {
  const cash=type==='contra' && direction==='deposit',payment=type==='payment' || (type==='contra' && !cash);
  const dialog=document.createElement('dialog');dialog.id='bank-allocation-dialog';dialog.className='native-entry-dialog bank-allocation';
  dialog.setAttribute('aria-labelledby','bank-allocation-heading');
  const values=bank?.account_id===account.id?bank:{};
  let denominations=structuredClone(values.denominations ?? null);
  dialog.innerHTML=`<form novalidate autocomplete="off"><div class="bank-allocation-heading" id="bank-allocation-heading">Bank Allocations for: &nbsp;<strong>${escapeHtml(account.name)}</strong><p>For: &nbsp;<strong>${formatRupees(amount)}</strong></p></div><div class="bank-allocation-columns"><strong>Transaction Type</strong><strong>Amount</strong></div><div class="bank-allocation-row"><label class="sr-only" for="bank-transaction-type">Transaction Type</label><select id="bank-transaction-type"><option>${payment?'Cheque':'Cheque/DD'}</option></select><label class="sr-only" for="bank-amount">Bank allocation amount</label><input id="bank-amount" value="${formatRupees(amount)}" readonly></div>${payment?'<div class="bank-detail-row"><label for="bank-cheque-range">Cheque range</label><span>:</span><input id="bank-cheque-range" value="Not Applicable" readonly></div>':''}<div class="bank-instrument-row"><div class="bank-detail-row"><label for="bank-instrument-number">Inst No.</label><span>:</span><input id="bank-instrument-number" maxlength="120" value="${escapeHtml(values.instrument_number ?? '')}"></div><div class="bank-detail-row"><label for="bank-instrument-date">Inst Date</label><span>:</span><input id="bank-instrument-date" value="${entryDate(values.instrument_date ?? date)}"></div></div>${payment?'':'<div class="bank-detail-row"><label for="bank-clearing-name">Bank Name</label><span>:</span><select id="bank-clearing-name"><option>Not Applicable</option></select></div>'}<div class="bank-dialog-space"></div><div class="details-error" id="bank-allocation-error" role="alert"></div><div class="details-commands"><button type="button" id="cancel-bank-allocation">Back <small>Esc</small></button><button type="submit" id="accept-bank-allocation">Accept <small>Ctrl+A</small></button></div></form>`;
  document.body.append(dialog);
  if(cash){dialog.querySelector('#bank-transaction-type').replaceChildren(new Option('Cash','Cash'));const button=document.createElement('button');button.type='button';button.id='edit-cash-denominations';button.textContent='Cash Denominations';button.disabled=!supportsCompanyDenominations(currency);button.onclick=showDenominations;dialog.querySelector('.bank-dialog-space').before(button);if(button.disabled){const note=document.createElement('p');note.textContent='Cash denominations currently support only the default INR currency labels.';dialog.querySelector('.bank-dialog-space').before(note);}}
  function showDenominations(){if(!supportsCompanyDenominations(currency)){dialog.querySelector('#bank-instrument-number').focus();return;}editCashDenominations({account,amount,denominations,onDone:next=>{denominations=next;dialog.querySelector('#bank-instrument-number').focus();},onCancel:()=>dialog.querySelector('#bank-amount').focus()});}
  const bankName=dialog.querySelector('#bank-clearing-name');
  if(bankName && values.bank_name && values.bank_name!=='Not Applicable')bankName.add(new Option(values.bank_name,values.bank_name,true,true));
  function close(){dialog.close();dialog.remove();}
  function cancel(){close();onCancel();}
  function accept(){
    let instrumentDate;try{instrumentDate=parseEntryDate(dialog.querySelector('#bank-instrument-date').value);}catch(error){dialog.querySelector('#bank-allocation-error').textContent=error.message;dialog.querySelector('#bank-instrument-date').focus();return;}
    const result={account_id:account.id,transaction_type:cash?'Cash':payment?'Cheque':'Cheque/DD',amount,instrument_number:dialog.querySelector('#bank-instrument-number').value.trim(),instrument_date:instrumentDate,bank_name:payment?(values.bank_name ?? ''):bankName.value,cheque_range:payment?'Not Applicable':'',...(cash?{denominations}:{})};
    close();onDone(result);
  }
  dialog.querySelector('form').onsubmit=event=>{event.preventDefault();accept();};
  dialog.querySelector('form').addEventListener('input',()=>dialog.querySelector('#bank-allocation-error').textContent='');
  dialog.querySelector('#cancel-bank-allocation').onclick=cancel;
  dialog.addEventListener('cancel',event=>{event.preventDefault();cancel();});
  dialog.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancel();return;}
    if(event.ctrlKey && !event.altKey && event.key.toLowerCase()==='a'){event.preventDefault();event.stopPropagation();accept();return;}
    if(event.key==='Enter' && !event.shiftKey && !event.target.closest('button')){
      if(cash && event.target.id==='bank-amount'){event.preventDefault();event.stopPropagation();showDenominations();return;}
      event.preventDefault();event.stopPropagation();const fields=[...dialog.querySelectorAll('input,select')],index=fields.indexOf(document.activeElement);
      if(index<fields.length-1){fields[index+1].focus();if(fields[index+1].select)fields[index+1].select();}else accept();
    }
  });
  dialog.showModal();dialog.querySelector('select').focus();
}
