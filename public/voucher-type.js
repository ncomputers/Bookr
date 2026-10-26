const types=[{value:'all',label:'All Items'},{value:'contra',label:'Contra'},{value:'journal',label:'Journal'},{value:'payment',label:'Payment'},{value:'purchase',label:'Purchase'},{value:'receipt',label:'Receipt'},{value:'sale',label:'Sales'}];

export function editVoucherType({type,onDone}) {
  let rows=types,index=Math.max(0,types.findIndex(t=>t.value===type)),saving=false;
  const dialog=document.createElement('dialog');dialog.id='voucher-type-dialog';dialog.className='native-entry-dialog voucher-type-dialog';dialog.setAttribute('aria-labelledby','type-heading');
  dialog.innerHTML=`<form novalidate autocomplete="off"><h2 id="type-heading">Name of Voucher Type</h2><input id="voucher-type-search" role="combobox" aria-label="Name of Voucher Type" aria-controls="voucher-type-options" aria-expanded="true" autocomplete="off"><div class="selection-heading">Voucher Types</div><div id="voucher-type-options" role="listbox"></div><p class="type-scope">Sales and cash receipts are the supported types in Bookr.</p><div id="voucher-type-error" class="details-error" role="alert"></div><div class="details-commands"><button type="button" id="cancel-voucher-type">Back <small>Esc</small></button><button type="submit">Accept <small>Enter</small></button></div></form>`;
  dialog.querySelector('.type-scope').textContent='Sales, receipts, purchases, payments, cash/bank Contra and credit-expense Journal vouchers are supported.';
  document.body.append(dialog);const input=dialog.querySelector('input'),options=dialog.querySelector('#voucher-type-options');input.value=types[index].label;
  function highlight(){options.querySelectorAll('button').forEach((b,i)=>{b.classList.toggle('selected',i===index);b.setAttribute('aria-selected',String(i===index));if(i===index)input.setAttribute('aria-activedescendant',b.id);});if(!rows.length)input.removeAttribute('aria-activedescendant');}
  function render(){options.innerHTML=rows.map((t,i)=>`<button type="button" role="option" id="voucher-type-option-${i}" data-type="${t.value}">${t.label}</button>`).join('');options.querySelectorAll('button').forEach((b,i)=>b.addEventListener('click',()=>{index=i;accept();}));highlight();}
  function close(){dialog.close();dialog.remove();document.querySelector('#main').focus();}
  async function accept(){
    if(saving)return;const error=dialog.querySelector('#voucher-type-error');if(!rows[index]){error.textContent='Choose one of the supported voucher types.';return;}
    saving=true;dialog.querySelectorAll('input,button').forEach(f=>f.disabled=true);
    try{await onDone(rows[index].value);close();}catch(failure){error.textContent=failure.message;dialog.querySelectorAll('input,button').forEach(f=>f.disabled=false);input.focus();}finally{saving=false;}
  }
  input.addEventListener('input',()=>{index=0;rows=types.filter(t=>t.label.toLowerCase().includes(input.value.trim().toLowerCase()));dialog.querySelector('#voucher-type-error').textContent='';render();});
  input.addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();e.stopPropagation();if(rows.length){index=(index+(e.key==='ArrowDown'?1:-1)+rows.length)%rows.length;highlight();}}});
  dialog.querySelector('form').addEventListener('submit',e=>{e.preventDefault();accept();});
  dialog.querySelector('#cancel-voucher-type').addEventListener('click',()=>{if(!saving)close();});dialog.addEventListener('cancel',e=>{e.preventDefault();if(!saving)close();});
  dialog.addEventListener('keydown',e=>{if(e.ctrlKey && !e.altKey && e.key.toLowerCase()==='a'){e.preventDefault();e.stopPropagation();accept();}});
  render();dialog.showModal();input.focus();input.select();
}
