export function editEntryMode({mode,onDone}) {
  const previousFocus=document.activeElement;
  const modes=[{value:'double',label:'Double Entry'},{value:'single',label:'Single Entry'}];let index=Math.max(0,modes.findIndex(item=>item.value===mode));
  const dialog=document.createElement('dialog');dialog.id='entry-mode-dialog';dialog.className='native-entry-dialog voucher-type-dialog';dialog.setAttribute('aria-labelledby','entry-mode-heading');
  dialog.innerHTML='<form><h2 id="entry-mode-heading">Change Voucher Mode</h2><div class="selection-heading">List of Modes/Usages</div><div id="entry-mode-options" role="listbox"></div><div class="details-commands"><button type="button" id="cancel-entry-mode">Back <small>Esc</small></button><button type="submit">Accept <small>Enter</small></button></div></form>';document.body.append(dialog);
  function draw(){dialog.querySelector('#entry-mode-options').innerHTML=modes.map((item,i)=>`<button type="button" role="option" data-entry-mode="${item.value}" class="${i===index?'selected':''}">${item.label}</button>`).join('');dialog.querySelectorAll('[data-entry-mode]').forEach((button,i)=>button.onclick=()=>{index=i;accept();});}
  function close(){dialog.close();dialog.remove();}
  function cancel(){close();if(previousFocus?.isConnected)previousFocus.focus();else document.querySelector('#main').focus();}
  function accept(){close();onDone(modes[index].value);}
  dialog.querySelector('form').onsubmit=event=>{event.preventDefault();accept();};dialog.querySelector('#cancel-entry-mode').onclick=cancel;dialog.addEventListener('cancel',event=>{event.preventDefault();cancel();});dialog.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();event.stopPropagation();index=(index+(event.key==='ArrowDown'?1:-1)+modes.length)%modes.length;draw();dialog.querySelector('[data-entry-mode="'+modes[index].value+'"]').focus();}else if(event.ctrlKey && !event.altKey && event.key.toLowerCase()==='a'){event.preventDefault();event.stopPropagation();accept();}});draw();dialog.showModal();dialog.querySelector('[data-entry-mode="'+modes[index].value+'"]').focus();
}
