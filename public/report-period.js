import {entryDate,parseEntryDate} from './entry-values.js';

export function editReportDate({date,onDone,companyDate=false,onClose}) { return editReportPeriod({period:{from:date,to:date},onDone,mode:'date',companyDate,onClose}); }

export function editReportPeriod({period,onDone,mode='period',companyDate=false,companyPeriod=false,onClose}) {
  let saving=false;
  const dialog=document.createElement('dialog');dialog.id='report-period-dialog';dialog.className='native-entry-dialog period-dialog';dialog.setAttribute('aria-labelledby','period-heading');
  if(mode==='date')dialog.id='report-date-dialog';
  dialog.innerHTML=`<form novalidate autocomplete="off"><h2 id="period-heading">Change ${mode==='date'?'Date':'Period'}</h2><div class="period-field"><label for="period-from">${mode==='date'?'Date':'From'}</label><span>:</span><input id="period-from" value="${entryDate(period.from)}" spellcheck="false"></div>${mode==='date'?'':`<div class="period-field"><label for="period-to">To</label><span>:</span><input id="period-to" value="${entryDate(period.to)}" spellcheck="false"></div>`}<div id="period-error" class="details-error" role="alert"></div><div class="details-commands"><button type="button" id="cancel-period">Back <small>Esc</small></button><button type="submit" id="accept-period">Accept <small>Ctrl+A</small></button></div></form>`;
  if(companyDate){
    dialog.id='company-date-dialog';dialog.classList.add('company-working-date-dialog');
    dialog.querySelector('h2').textContent='Current Date';
    dialog.querySelector('label').textContent='Current Date';
    dialog.querySelector('input').value=Number(period.from.slice(8,10))+'-'+Number(period.from.slice(5,7))+'-'+period.from.slice(0,4);
  }
  if(companyPeriod){
    dialog.id='company-period-dialog';dialog.classList.add('company-current-period-dialog');
    for(const [i,date]of [period.from,period.to].entries())dialog.querySelectorAll('input')[i].value=Number(date.slice(8,10))+'-'+Number(date.slice(5,7))+'-'+date.slice(0,4);
  }
  document.body.append(dialog);
  const fields=[...dialog.querySelectorAll('input')];
  function close(){dialog.close();dialog.remove();onClose?.();document.querySelector('#main').focus();}
  async function accept(){
    if(saving)return;const error=dialog.querySelector('#period-error');error.textContent='';let from,to;
    try{from=parseEntryDate(fields[0].value);to=mode==='date'?from:parseEntryDate(fields[1].value);if(from>to)throw new Error('From date must not be after To date.');}
    catch(failure){error.textContent=failure.message;return;}
    saving=true;dialog.querySelectorAll('input,button').forEach(f=>f.disabled=true);
    try{await onDone({from,to});close();}
    catch(failure){error.textContent=failure.message;dialog.querySelectorAll('input,button').forEach(f=>f.disabled=false);fields[0].focus();}
    finally{saving=false;}
  }
  dialog.querySelector('form').addEventListener('submit',e=>{e.preventDefault();accept();});
  dialog.querySelector('#cancel-period').addEventListener('click',()=>{if(!saving)close();});
  dialog.addEventListener('cancel',e=>{e.preventDefault();if(!saving)close();});
  dialog.addEventListener('keydown',e=>{
    if(companyDate && e.key==='Escape'){
      e.preventDefault();e.stopPropagation();if(saving)return;
      if(fields[0].value){fields[0].value='';dialog.querySelector('#period-error').textContent='';fields[0].focus();}else close();
    }
    else if(e.ctrlKey && !e.altKey && e.key.toLowerCase()==='a'){e.preventDefault();e.stopPropagation();accept();}
    else if(e.key==='Enter' && !e.shiftKey && !e.target.closest('button')){e.preventDefault();e.stopPropagation();if(fields.length>1 && document.activeElement===fields[0]){fields[1].focus();fields[1].select();}else accept();}
  });
  dialog.showModal();fields[0].focus();fields[0].select();
  return dialog;
}
