// Shared confirmation for voucher/master workflows. The callback runs only
// after an explicit affirmative choice; cancellation restores the draft focus.
export function askDialog(message,action,affirmative='Yes'){
  if(document.querySelector('dialog'))return;
  const previousFocus=document.activeElement,discard=affirmative.trim().toLowerCase()==='discard';
  const dialog=document.createElement('dialog');dialog.id='entry-dialog';dialog.className='confirmation-dialog';
  dialog.setAttribute('aria-labelledby','confirmation-message');dialog.setAttribute('aria-describedby','confirmation-help');
  const form=document.createElement('form');form.method='dialog';
  const question=document.createElement('p');question.id='confirmation-message';question.textContent=message;
  const choices=document.createElement('div');choices.className='confirmation-choices';
  const yes=document.createElement('button'),no=document.createElement('button');
  for(const [button,value,label,key] of [[yes,'yes',affirmative,discard?'D / Y':'Y'],[no,'no','No','Esc / N']]){
    button.type='button';button.value=value;button.setAttribute('aria-label',label);
    const text=document.createElement('span');text.textContent=label;
    const shortcut=document.createElement('kbd');shortcut.textContent=key;shortcut.setAttribute('aria-hidden','true');
    button.append(text,shortcut);choices.append(button);
    button.addEventListener('click',()=>finish(value));
  }
  const help=document.createElement('p');help.id='confirmation-help';help.className='confirmation-help';
  help.textContent=`Left / Right or Tab: select · Enter: choose · Esc / N: No${discard?' · D / Y: Discard':' · Y: '+affirmative}`;
  const consequence=document.createElement('p');consequence.className='confirmation-consequence';consequence.textContent=discard?'No keeps your unsaved changes.':'No returns without accepting.';
  form.append(question,choices,consequence,help);dialog.append(form);document.body.append(dialog);
  let finished=false;
  function finish(choice){if(!finished && dialog.open){finished=true;dialog.close(choice);}}
  form.addEventListener('submit',event=>{event.preventDefault();finish(document.activeElement===yes?'yes':'no');});
  dialog.addEventListener('cancel',event=>{event.preventDefault();finish('no');});
  dialog.addEventListener('keydown',event=>{
    if(event.ctrlKey || event.altKey || event.metaKey)return;
    const key=event.key.toLowerCase();
    if(!['escape','enter','arrowleft','arrowright','tab','y','n',...(discard?['d']:[])].includes(key))return;
    event.preventDefault();event.stopPropagation();
    if(key==='escape' || key==='n')finish('no');
    else if(key==='y' || (discard && key==='d'))finish('yes');
    else if(key==='enter')finish(document.activeElement===yes?'yes':'no');
    else (document.activeElement===yes?no:yes).focus();
  });
  dialog.addEventListener('close',()=>{
    const confirmed=dialog.returnValue==='yes';dialog.remove();
    if(confirmed)action();
    else if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});
    else document.querySelector('#main')?.focus({preventScroll:true});
  },{once:true});
  dialog.showModal();no.focus();
}

// Field dialogs share modal keyboard/focus behavior. Their caller owns data
// validation and publication; returning false keeps the current dialog open.
export function openFormDialog({id,title,body,fields=()=>[],onAccept,onClose,acceptLabel='Accept',cancelLabel='Back',initialFocus}){
  if(document.querySelector('dialog'))return null;
  const previous=document.activeElement,dialog=document.createElement('dialog');dialog.id=id;dialog.className='native-entry-dialog shared-field-dialog';dialog.setAttribute('aria-labelledby',id+'-heading');
  const form=document.createElement('form');form.noValidate=true;form.autocomplete='off';const heading=document.createElement('h2');heading.id=id+'-heading';heading.textContent=title;
  const lock=document.createElement('fieldset');lock.className='dialog-fields';lock.append(body);
  const error=document.createElement('p');error.id=id+'-error';error.className='details-error';error.setAttribute('role','alert');
  const commands=document.createElement('div');commands.className='details-commands';const cancel=document.createElement('button');cancel.type='button';cancel.id=id+'-cancel';cancel.textContent=cancelLabel+'  Esc';commands.append(cancel);
  const acceptButton=acceptLabel===null?null:document.createElement('button');if(acceptButton){acceptButton.type='submit';acceptButton.id=id+'-accept';acceptButton.textContent=acceptLabel+'  Ctrl+A';commands.append(acceptButton);}
  form.append(heading,lock,error,commands);dialog.append(form);document.body.append(dialog);let busy=false,finished=false;
  function finish(accepted=false,internal=false){if(finished||busy&&!internal)return false;finished=true;dialog.close(accepted?'accepted':'cancelled');return true;}
  async function accept(){
    if(busy||finished||!onAccept)return;const focused=document.activeElement;busy=true;lock.disabled=true;cancel.disabled=true;if(acceptButton)acceptButton.disabled=true;error.textContent='';
    try{if(await onAccept()!==false)finish(true,true);}catch(failure){error.textContent=failure.message;}
    finally{busy=false;lock.disabled=false;cancel.disabled=false;if(acceptButton)acceptButton.disabled=false;if(!finished&&dialog.isConnected){const available=fields().filter(field=>field.isConnected&&!field.disabled&&!field.readOnly&&field.getClientRects().length);(available.includes(focused)?focused:available[0]??acceptButton??cancel).focus({preventScroll:true});}}
  }
  cancel.onclick=()=>finish();form.onsubmit=event=>{event.preventDefault();accept();};dialog.addEventListener('cancel',event=>{event.preventDefault();finish();});
  dialog.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();finish();}
    else if(event.ctrlKey&&!event.altKey&&!event.metaKey&&event.key.toLowerCase()==='a'){event.preventDefault();event.stopPropagation();accept();}
    else if(event.key==='Enter'&&!event.shiftKey&&!event.target.closest('button')){event.preventDefault();event.stopPropagation();if(busy)return;const visible=fields().filter(field=>!field.disabled&&!field.readOnly&&field.getClientRects().length),index=visible.indexOf(document.activeElement);if(index>=0&&index<visible.length-1)visible[index+1].focus();else if(onAccept)accept();else cancel.focus();}
  });
  dialog.addEventListener('close',()=>{const accepted=dialog.returnValue==='accepted';dialog.remove();if(previous?.isConnected&&previous.getClientRects().length)previous.focus({preventScroll:true});else document.querySelector('#main')?.focus({preventScroll:true});onClose?.(accepted);},{once:true});
  dialog.showModal();(initialFocus??fields()[0]??cancel).focus();return {dialog,acceptButton,close:()=>finish()};
}
