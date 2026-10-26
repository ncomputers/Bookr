import { entryDate,formatRupees } from './entry-values.js';
import {termText,parseTerm,termPreview} from './bill-terms.js';

// This layer supports the observed single New Ref for the whole sales amount.
export function editBillReference({customer,reference,amount,date,terms=null,escapeHtml,setCaption,onDone,onCancel,side='Dr',description='sale'}) {
  const dialog = document.createElement('dialog');
  dialog.id = 'bill-details-dialog'; dialog.className = 'native-entry-dialog billwise-dialog bill-terms-dialog';
  dialog.setAttribute('aria-labelledby','bill-heading');
  dialog.innerHTML = `<form novalidate autocomplete="off">
    <div class="bill-dialog-heading"><div id="bill-heading">Bill-wise Details for : &nbsp;<strong>${escapeHtml(customer.name)}</strong></div><div>Up to: &nbsp;₹ <strong>${formatRupees(amount)} ${side}</strong></div></div>
    <div class="bill-columns bill-column-headings"><span>Type of Ref</span><span>Name</span><span class="bill-due-column">Due Date, or<br>Credit Days<br>(wef: ${entryDate(date)})</span><span class="bill-amount-column">Amount</span><span>Dr/<br>Cr</span></div>
    <div class="bill-columns bill-entry-row"><label class="sr-only" for="bill-method">Type of reference</label><select id="bill-method"><option>New Ref</option></select><label class="sr-only" for="bill-reference">Bill reference name</label><input id="bill-reference" maxlength="120" value="${escapeHtml(reference)}" spellcheck="false" aria-describedby="bill-reference-error"><div class="bill-due-column bill-term-editor"><label class="sr-only" for="bill-credit-term">Due date or credit days</label><input id="bill-credit-term" value="${escapeHtml(termText(terms))}" maxlength="30" aria-describedby="bill-due-date bill-reference-error" placeholder="Not specified"><output id="bill-due-date" aria-live="polite"></output></div><label class="sr-only" for="bill-amount">Bill amount</label><input id="bill-amount" value="${formatRupees(amount)}" readonly><label class="sr-only" for="bill-side">Debit or credit</label><input id="bill-side" value="${side}" readonly></div>
    <div id="bill-reference-error" class="details-error" role="alert"></div>
    <div class="bill-dialog-space"></div><p class="bill-dialog-scope">One New Ref for the full ${description} amount · per-reference due date or credit days</p>
    <div class="bill-dialog-total">${formatRupees(amount)} ${side}</div>
    <div class="details-commands"><button type="button" id="cancel-bill-reference">Back <small>Esc</small></button><button type="submit" id="accept-bill-reference">Accept <small>Ctrl+A</small></button></div>
  </form>`;
  document.body.append(dialog); setCaption('Bill-wise Details');
  const name = dialog.querySelector('#bill-reference'),term=dialog.querySelector('#bill-credit-term');
  const updateDue=()=>{dialog.querySelector('#bill-due-date').textContent=termPreview(term.value,date);};
  term.addEventListener('input',()=>{term.removeAttribute('aria-invalid');dialog.querySelector('#bill-reference-error').textContent='';updateDue();});updateDue();
  const fields = [...dialog.querySelectorAll('select,input')];
  function close() { dialog.close(); dialog.remove(); setCaption(null); }
  function accept() {
    const next = name.value.trim();
    if (!next) {
      dialog.querySelector('#bill-reference-error').textContent = 'Enter a bill reference name.';
      name.setAttribute('aria-invalid','true'); name.focus(); return;
    }
    let nextTerms;try{nextTerms=parseTerm(term.value,date);}catch(failure){dialog.querySelector('#bill-reference-error').textContent=failure.message;term.setAttribute('aria-invalid','true');term.focus();return;}
    close(); onDone(next,nextTerms);
  }
  function cancel() { close(); onCancel(); }
  dialog.querySelector('form').addEventListener('submit',event => { event.preventDefault(); accept(); });
  dialog.querySelector('#cancel-bill-reference').addEventListener('click',cancel);
  dialog.addEventListener('cancel',event => { event.preventDefault(); cancel(); });
  name.addEventListener('input',() => { dialog.querySelector('#bill-reference-error').textContent = ''; name.removeAttribute('aria-invalid'); });
  dialog.addEventListener('keydown',event => {
    if (event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'a') { event.preventDefault(); event.stopPropagation(); accept(); }
    else if (event.key === 'Enter' && !event.shiftKey && !event.target.closest('button')) {
      event.preventDefault(); event.stopPropagation(); const index = fields.indexOf(document.activeElement);
      if (index < fields.length-1) { fields[index+1].focus(); fields[index+1].select?.(); } else accept();
    }
  });
  dialog.showModal(); fields[0].focus();
}
