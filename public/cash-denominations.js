import {formatRupees,inputRupees,parseRupees} from './entry-values.js';
export function editCashDenominations({account,amount,denominations,onDone,onCancel}) {
  const notes=[2000,1000,500,200,100,50,20,10,5,2,1];
  const dialog=document.createElement('dialog');dialog.id='cash-denominations-dialog';dialog.className='native-entry-dialog cash-denominations';
  dialog.setAttribute('aria-labelledby','denominations-heading');
  dialog.innerHTML=`<form novalidate><h2 id="denominations-heading"></h2><p>Denominations For: <strong>${formatRupees(amount)}</strong></p><table><thead><tr><th>Denominations</th><th>Amount</th></tr></thead><tbody>${notes.map(note=>`<tr><td><label for="denomination-${note}">${note} ×</label><input id="denomination-${note}" data-denomination="${note}" inputmode="numeric" maxlength="12" value="${denominations?.counts?.[note] || ''}"></td><td id="denomination-value-${note}" class="amount"></td></tr>`).join('')}<tr><td><label for="denomination-others">Others</label></td><td><input id="denomination-others" inputmode="decimal" value="${denominations?.others?inputRupees(denominations.others):''}"></td></tr></tbody><tfoot><tr><th>Total</th><td id="denomination-total"></td></tr><tr><th>Difference</th><td id="denomination-difference"></td></tr></tfoot></table><div id="denominations-error" class="details-error" role="alert"></div><div class="details-commands"><button type="button" id="cancel-denominations">Back <small>Esc</small></button><button type="submit">Accept <small>Ctrl+A</small></button></div></form>`;
  dialog.querySelector('h2').textContent=account.name;document.body.append(dialog);
  function read(){
    const counts={};let total=0;
    for(const note of notes){const text=dialog.querySelector('#denomination-'+note).value.trim();if(!/^\d*$/.test(text))throw new Error('Enter whole, non-negative note counts.');const count=Number(text || 0);if(!Number.isSafeInteger(count))throw new Error('Note count is too large.');counts[note]=count;total+=count*note*100;if(!Number.isSafeInteger(total))throw new Error('Denomination total is too large.');}
    const otherText=dialog.querySelector('#denomination-others').value.trim();const others=!otherText || /^0+(\.0{1,2})?$/.test(otherText)?0:parseRupees(otherText);total+=others;if(!Number.isSafeInteger(total))throw new Error('Denomination total is too large.');return {counts,others,total,difference:amount-total};
  }
  function update(){try{const result=read();for(const note of notes)dialog.querySelector('#denomination-value-'+note).textContent=result.counts[note]?formatRupees(result.counts[note]*note*100):'';dialog.querySelector('#denomination-total').textContent=formatRupees(result.total);dialog.querySelector('#denomination-difference').textContent=formatRupees(result.difference);dialog.querySelector('#denominations-error').textContent='';}catch(error){dialog.querySelector('#denominations-error').textContent=error.message;}}
  function close(){dialog.close();dialog.remove();}
  function cancel(){close();onCancel();}
  function accept(){let result;try{result=read();}catch(error){dialog.querySelector('#denominations-error').textContent=error.message;return;}close();onDone(result);}
  dialog.querySelector('form').addEventListener('input',update);dialog.querySelector('form').onsubmit=event=>{event.preventDefault();accept();};dialog.querySelector('#cancel-denominations').onclick=cancel;
  dialog.addEventListener('cancel',event=>{event.preventDefault();cancel();});
  dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancel();}else if(event.ctrlKey && !event.altKey && event.key.toLowerCase()==='a'){event.preventDefault();event.stopPropagation();accept();}else if(event.key==='Enter' && !event.shiftKey && !event.target.closest('button')){event.preventDefault();event.stopPropagation();const fields=[...dialog.querySelectorAll('input')],i=fields.indexOf(event.target);if(i<fields.length-1)fields[i+1].focus();else accept();}});
  update();dialog.showModal();dialog.querySelector('input').focus();
}
