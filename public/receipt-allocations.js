import {entryDate,formatRupees,inputRupees,parseRupees} from './entry-values.js';
import {billIdentity,billReference,sameBill} from './bill-identity.js';

// Agst Ref supports voucher bills and the documented opening-reference model.
// Other adjustment methods remain outside this layer. Drafts never post.
export function editReceiptAllocations({customer,amount,bills,allocations,escapeHtml,onDone,onCancel,payment=false}) {
  const side=payment?'Dr':'Cr',kind=payment?'payment':'receipt';
  const dialog=document.createElement('dialog');
  dialog.id='receipt-bills-dialog'; dialog.className='native-entry-dialog billwise-dialog receipt-bills';
  dialog.setAttribute('aria-labelledby','receipt-bills-heading');
  let rows=allocations.map(row=>({...billReference(row),amount:inputRupees(row.amount)}));
  if (!rows.length) rows.push({bill_id:null,amount:''});
  let pickerIndex=0,pickerRow=0,pending=[],activeRow=0;
  dialog.innerHTML=`<form novalidate autocomplete="off"><div class="bill-dialog-heading"><div id="receipt-bills-heading">Bill-wise Details for : &nbsp;<strong>${escapeHtml(customer.name)}</strong></div><div>Up to: &nbsp;₹ <strong>${formatRupees(amount)} Cr</strong></div></div><div class="receipt-bill-columns bill-column-headings"><span>Type of Ref</span><span>Name</span><span class="bill-amount-column">Amount</span><span>Dr/Cr</span></div><div id="allocation-rows"></div><div id="pending-picker" hidden></div><div id="allocation-error" class="details-error" role="alert"></div><div class="bill-dialog-space"></div><p class="bill-dialog-scope">Agst Ref · saved bills · no advance or on-account receipts</p><div class="bill-dialog-total" id="allocation-total"></div><div class="details-commands"><button type="button" id="cancel-allocations">Back <small>Esc</small></button><button type="submit" id="accept-allocations">Accept <small>Ctrl+A</small></button></div></form>`;
  dialog.querySelector('.bill-dialog-heading>div:last-child strong').textContent=`${formatRupees(amount)} ${side}`;
  dialog.querySelector('.bill-dialog-scope').textContent=`Agst Ref · saved bills · no advance or on-account ${kind}s`;
  const rowCommands=document.createElement('div');rowCommands.className='allocation-row-commands';
  rowCommands.innerHTML='<button type="button" id="add-allocation">Add reference</button><button type="button" id="remove-allocation">Remove reference</button>';
  dialog.querySelector('.bill-dialog-space').before(rowCommands);
  document.body.append(dialog);
  const list=dialog.querySelector('#allocation-rows'),picker=dialog.querySelector('#pending-picker');
  const parse=value=>{try{return parseRupees(value);}catch{return 0;}};
  const total=()=>rows.reduce((sum,row)=>sum+parse(row.amount),0);
  function error(message){dialog.querySelector('#allocation-error').textContent=message;}
  function updateTotal(){dialog.querySelector('#allocation-total').textContent=`${formatRupees(total())} ${side} / ${formatRupees(amount)} ${side}`;}
  function render(){
    list.innerHTML=rows.map((row,i)=>`<div class="receipt-bill-columns bill-entry-row" data-allocation-row="${i}"><label class="sr-only" for="allocation-method-${i}">Type of reference ${i+1}</label><select id="allocation-method-${i}" data-step="method"><option>Agst Ref</option></select><button type="button" class="allocation-reference" id="allocation-ref-${i}" aria-label="Choose bill ${i+1}" data-step="reference">${escapeHtml(bills.find(b=>sameBill(b,row))?.reference ?? '')}</button><label class="sr-only" for="allocation-amount-${i}">Allocation ${i+1} amount in rupees</label><input id="allocation-amount-${i}" data-step="amount" inputmode="decimal" maxlength="20" value="${escapeHtml(row.amount)}"><input data-step="side" value="Cr" readonly aria-label="Credit ${i+1}"></div>`).join('');
    list.querySelectorAll('[data-allocation-row]').forEach((element,i)=>{
      const direction=element.querySelector('[data-step=side]');direction.value=side;direction.setAttribute('aria-label',`${payment?'Debit':'Credit'} ${i+1}`);
      element.querySelector('button').addEventListener('click',()=>openPicker(i));
      element.querySelector('[data-step=amount]').addEventListener('input',event=>{rows[i].amount=event.target.value;error('');updateTotal();});
    });
    updateTotal();
  }
  function addRow(){
    if(rows.length>=100){error('This version supports up to 100 bill allocations in a receipt.');return;}
    rows.push({bill_id:null,amount:''});activeRow=rows.length-1;closePicker();render();list.lastElementChild.querySelector('select').focus();
  }
  list.addEventListener('focusin',event=>{const row=event.target.closest('[data-allocation-row]');if(row)activeRow=Number(row.dataset.allocationRow);});
  dialog.querySelector('#add-allocation').addEventListener('click',addRow);
  dialog.querySelector('#remove-allocation').addEventListener('click',()=>{
    rows.splice(activeRow,1);if(!rows.length)rows.push({bill_id:null,amount:''});activeRow=Math.min(activeRow,rows.length-1);
    closePicker();render();list.children[activeRow].querySelector('select').focus();error('');
  });
  function highlight(){picker.querySelectorAll('[data-pending]').forEach((el,i)=>{el.classList.toggle('selected',i===pickerIndex);if(i===pickerIndex)el.scrollIntoView({block:'nearest'});});}
  function closePicker(){picker.hidden=true;}
  function choose(index){
    const bill=pending[index]; if(!bill)return;
    const row=rows[pickerRow];rows[pickerRow]={...billReference(bill),amount:row.amount};
    const rest=amount-rows.reduce((sum,r,i)=>sum+(i===pickerRow?0:parse(r.amount)),0);
    if(!row.amount)rows[pickerRow].amount=inputRupees(Math.min(rest,bill.available));
    closePicker();render();const field=dialog.querySelector(`#allocation-amount-${pickerRow}`);field.focus();field.select();
  }
  function openPicker(index){
    pickerRow=index;pickerIndex=0;
    pending=bills.filter(b=>b.available>0 && !rows.some((r,i)=>i!==index && sameBill(r,b)));
    picker.innerHTML=`<div class="selection-heading">Pending Bills</div><table class="voucher-report"><thead><tr><th>Name / Date</th><th>Balance</th><th>Final balance</th></tr></thead><tbody>${pending.map((b,i)=>`<tr data-pending="${i}"><td><button type="button" ${b.opening_bill_id!=null?`data-opening-bill-id="${b.opening_bill_id}"`:`data-bill-id="${b.bill_id}"`}>${escapeHtml(b.reference)}</button><small>${b.source==='opening'?'Opening balance · ':''}${entryDate(b.date)}</small></td><td class="amount">${formatRupees(b.pending)} Dr</td><td class="amount">${formatRupees(b.available-(sameBill(rows[index],b)?parse(rows[index].amount):0))} Dr</td></tr>`).join('')}</tbody></table>${pending.length?'':'<p class="empty-report">No available bills for this customer.</p>'}`;
    if(payment){picker.querySelectorAll('td.amount').forEach(td=>td.textContent=td.textContent.replace(/ Dr$/,' Cr'));const empty=picker.querySelector('.empty-report');if(empty)empty.textContent='No available bills for this supplier.';}
    picker.hidden=false;
    picker.querySelectorAll('button').forEach((button,i)=>button.addEventListener('click',()=>choose(i)));
    highlight();
  }
  function close(){dialog.close();dialog.remove();}
  function cancel(){close();onCancel();}
  function accept(){
    if(!picker.hidden){choose(pickerIndex);return;}
    const result=[];
    for(const row of rows){
      if(!billIdentity(row) && !row.amount)continue;
      const bill=bills.find(b=>sameBill(b,row));
      if(!bill){error('Choose a saved bill for every allocation.');return;}
      let value;try{value=parseRupees(row.amount);}catch(failure){error(failure.message);return;}
      if(value>bill.available){error('Allocation exceeds this bill’s available balance. Advances are outside this version.');return;}
      if(result.some(r=>sameBill(r,row))){error(`Choose each bill once in this ${kind}.`);return;}
      result.push({...billReference(bill),amount:value});
    }
    if(!result.length || result.reduce((sum,row)=>sum+row.amount,0)!==amount){error(`Bill allocations must equal the ${kind} amount.`);return;}
    close();onDone(result);
  }
  dialog.querySelector('form').addEventListener('submit',event=>{event.preventDefault();accept();});
  dialog.querySelector('#cancel-allocations').addEventListener('click',cancel);
  dialog.addEventListener('cancel',event=>{event.preventDefault();if(!picker.hidden){closePicker();dialog.querySelector(`#allocation-ref-${pickerRow}`).focus();}else cancel();});
  dialog.addEventListener('keydown',event=>{
    if(event.ctrlKey && !event.altKey && event.key.toLowerCase()==='a'){event.preventDefault();event.stopPropagation();accept();return;}
    if(event.ctrlKey || event.altKey || event.metaKey)return;
    if(!picker.hidden && ['ArrowDown','ArrowUp','Enter'].includes(event.key)){
      event.preventDefault();event.stopPropagation();
      if(event.key==='Enter')choose(pickerIndex);
      else if(pending.length){pickerIndex=(pickerIndex+(event.key==='ArrowDown'?1:-1)+pending.length)%pending.length;highlight();}
      return;
    }
    if(event.key!=='Enter' || event.shiftKey || !event.target.dataset.step)return;
    event.preventDefault();event.stopPropagation();
    const element=event.target.closest('[data-allocation-row]'),index=Number(element.dataset.allocationRow);
    const step=event.target.dataset.step;
    if(step==='method')element.querySelector('[data-step=reference]').focus();
    else if(step==='reference')openPicker(index);
    else if(step==='amount')element.querySelector('[data-step=side]').focus();
    else if(index<rows.length-1)list.children[index+1].querySelector('select').focus();
    else if(total()<amount && billIdentity(rows[index]) && parse(rows[index].amount)>0)addRow();
    else accept();
  });
  render();dialog.showModal();list.querySelector('select').focus();
}
