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
