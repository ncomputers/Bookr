import {entryDate,parseEntryDate} from './entry-values.js';
import {handleMultilineEntry} from './multiline-entry.js';

export function createCompanyWorkspace({main,hint,api,setScreen,getView,getBook,renderGateway,escapeHtml,askDialog,isBusy,isDirty,activeId,onSelect}){
  let busy=false,switching=false,rows=[],index=0,initial='',dates=null,editingProfile=null,menuOrigin='gateway';
  const views=['company-menu','companies','company-create','company-alter'];
  const contacts=[['telephone','Telephone'],['mobile','Mobile'],['fax','Fax'],['email','E-mail'],['website','Website']];
  const value=id=>main.querySelector('#'+id).value;
  const values=()=>Object.fromEntries(['name','mailing_name','address','state','country','pincode',...contacts.map(([key])=>key)].map(key=>[key,value('company-'+key.replaceAll('_','-'))]));
  const dirty=()=>['company-create','company-alter'].includes(getView()) && JSON.stringify(values())!==initial;
  function command(id,label,action){const button=document.createElement('button');button.id=id;button.type='button';button.textContent=label;button.onclick=action;document.querySelector('.command-strip').insertBefore(button,hint);}
  function guard(action){if(isBusy() || document.querySelector('dialog'))return;if(isDirty())askDialog('Discard unsaved changes and open Company?',action,'Discard');else action();}
  async function run(action){if(busy || switching)return;busy=true;try{await action();}catch(error){const box=main.querySelector('#company-error');if(box)box.textContent=error.message;else hint.textContent=error.message;}finally{busy=false;}}
  function select(id){if(busy || switching)return;switching=true;onSelect(id);}
  function menu(){
    setScreen('Company','company-menu','↑ ↓ Enter: open · Esc: Gateway');
    const canAlter=menuOrigin==='gateway' && getBook()?.capabilities?.company_alter===true;
    main.innerHTML=`<section class="master-menu company-menu"><div class="gateway-menu-title">Company</div><div class="master-menu-content"><h2 class="menu-heading">COMPANY</h2><button id="company-create-menu" class="selected">Create Company</button><button id="company-alter-menu" ${canAlter?'':'disabled'}>Alter Company</button><button id="company-select-menu">Select Company</button><p>${escapeHtml(getBook()?.company ?? 'Select a company to open its books.')}</p>${!canAlter?'<small>Company alteration is available from Gateway with a supported server.</small>':''}</div></section>`;
    index=0;main.querySelector('#company-create-menu').onclick=openCreate;main.querySelector('#company-alter-menu').onclick=openAlter;main.querySelector('#company-select-menu').onclick=openSelector;
    const buttons=[...main.querySelectorAll('.company-menu button:not(:disabled)')];buttons.forEach((button,i)=>button.onfocus=()=>{index=i;buttons.forEach((item,n)=>item.classList.toggle('selected',n===i));});buttons[0].focus();
  }
  const rememberOrigin=()=>{if(!views.includes(getView()))menuOrigin=getView();};
  const openMenu=()=>guard(()=>{rememberOrigin();menu();});
  const openSelector=()=>guard(()=>run(async()=>{
    rememberOrigin();
    const data=await api('/api/companies');rows=data.companies;dates=data.companies.find(row=>row.id==='default');
    setScreen('Select Company','companies','Type to filter · ↑ ↓ Enter: select · Alt+C: create · Esc: Company');
    main.innerHTML=`<section class="company-selector"><label for="company-search">Name of Company</label><input id="company-search" autocomplete="off" aria-controls="company-options"><div class="selection-heading">List of Companies</div><div id="company-options" role="listbox" aria-label="Companies"></div><p id="company-error" class="company-error" role="alert"></p></section>`;
    const search=main.querySelector('#company-search');search.addEventListener('input',()=>filter(data.companies,search.value));filter(data.companies,'');
    command('create-company','Create Company  Alt+C',openCreate);search.focus();
  }));
  function filter(all,query){
    rows=all.filter(row=>row.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));index=Math.max(0,rows.findIndex(row=>row.id===activeId));
    const list=main.querySelector('#company-options');
    list.innerHTML=rows.length?rows.map((row,i)=>`<button type="button" role="option" data-company-id="${row.id}" data-company-index="${i}" aria-selected="false"><strong>${escapeHtml(row.name)}</strong><small>${entryDate(row.financial_year_from)} to ${entryDate(row.financial_year_to)}${row.id===activeId?' · Current':''}</small></button>`).join(''):'<p>No matching company.</p>';
    list.querySelectorAll('button').forEach((button,i)=>{button.onclick=()=>select(rows[i].id);button.onfocus=()=>highlight(i);});highlight(index);
  }
  function highlight(next){if(!rows.length)return;index=(next+rows.length)%rows.length;main.querySelectorAll('[data-company-id]').forEach((button,i)=>{button.classList.toggle('selected',i===index);button.setAttribute('aria-selected',String(i===index));if(i===index)button.scrollIntoView({block:'nearest'});});}
  const openCreate=()=>guard(()=>run(async()=>{
    rememberOrigin();
    if(!dates){const data=await api('/api/companies');dates=data.companies.find(row=>row.id==='default');}
    renderForm();
  }));
  const openAlter=()=>guard(()=>run(async()=>{
    if(menuOrigin!=='gateway' || getBook()?.capabilities?.company_alter!==true){hint.textContent='Return to Gateway on the latest server to alter company details.';return;}
    const profile=await api('/api/companies/'+activeId);dates=profile;renderForm(profile);
  }));
  function renderForm(profile=null){
    editingProfile=profile;
    setScreen(profile?'Company Alteration':'Company Creation',profile?'company-alter':'company-create','Enter: next field · Address: blank line to finish · Ctrl+A: save · Esc: back');
    const field=(key,label,value='',limit=120)=>`<div class="company-field company-field-${key}"><label for="company-${key.replaceAll('_','-')}">${label}</label><span>:</span>${key==='mobile'?'<div class="company-mobile"><span id="company-mobile-prefix" aria-label="Country calling code"></span>':''}<input id="company-${key.replaceAll('_','-')}" maxlength="${limit}" value="${escapeHtml(value)}">${key==='mobile'?'</div>':''}</div>`;
    main.innerHTML=`<form id="company-form" novalidate autocomplete="off"><div class="company-create-columns"><section>${field('name','Company Name',profile?.name ?? '')}${field('mailing_name','Mailing Name',profile?.mailing_name ?? '')}<div class="company-field company-address"><label for="company-address">Address</label><span>:</span><textarea id="company-address" maxlength="1000" rows="4">${escapeHtml(profile?.address ?? '')}</textarea></div>${field('state','State',profile?.state ?? 'Not Applicable')}${field('country','Country',profile?.country ?? 'India')}${field('pincode','Pincode',profile?.pincode ?? '',20)}${contacts.map(([key,label])=>field(key,label,profile?.[key]??'')).join('')}</section><section class="company-year"><div class="company-field"><label for="company-financial-year">Financial year beginning from</label><span>:</span><input id="company-financial-year" value="${entryDate(dates.financial_year_from)}" readonly tabindex="-1"></div><div class="company-field"><label for="company-books-from">Books beginning from</label><span>:</span><input id="company-books-from" value="${entryDate(dates.books_from)}" readonly tabindex="-1"></div></section></div><section class="company-currency" aria-label="Base currency"><div class="company-field"><span>Base Currency symbol</span><span>:</span><strong id="company-base-currency-symbol">₹</strong></div><div class="company-field"><span>Formal name</span><span>:</span><strong id="company-currency-formal-name">INR</strong></div></section><p id="company-error" class="company-error" role="alert"></p></form>`;
    const name=main.querySelector('#company-name'),mail=main.querySelector('#company-mailing-name');let previous='';
    const country=main.querySelector('#company-country'),prefix=main.querySelector('#company-mobile-prefix');
    const updatePrefix=()=>{prefix.textContent=country.value.trim().toLocaleLowerCase()==='india'?'+91':'';};country.addEventListener('input',updatePrefix);updatePrefix();
    name.addEventListener('input',()=>{if(!editingProfile && (!mail.value || mail.value===previous))mail.value=name.value;previous=name.value;name.removeAttribute('aria-invalid');main.querySelector('#company-error').textContent='';});
    main.querySelector('form').onsubmit=event=>{event.preventDefault();save();};command('accept-company','A: Accept  Ctrl+A',save);initial=JSON.stringify(values());name.focus();name.select();
  }
  async function save(){
    if(busy || switching || !['company-create','company-alter'].includes(getView()) || document.querySelector('dialog'))return;
    const input=values(),error=main.querySelector('#company-error');error.textContent='';
    if(!input.name.trim()){error.textContent='Enter a company name.';main.querySelector('#company-name').setAttribute('aria-invalid','true');main.querySelector('#company-name').focus();return;}
    try{input.financial_year_from=parseEntryDate(value('company-financial-year'));input.books_from=parseEntryDate(value('company-books-from'));input.financial_year_to=dates.financial_year_to;}catch(failure){error.textContent=failure.message;return;}
    busy=true;const fields=[...main.querySelectorAll('input,textarea')];fields.forEach(field=>field.disabled=true);document.querySelector('#accept-company').disabled=true;
    try{const profile=await api(editingProfile?'/api/companies/'+editingProfile.id:'/api/companies',{method:editingProfile?'PUT':'POST',body:JSON.stringify({...input,...(editingProfile?{revision:editingProfile.revision}:{})})});switching=true;onSelect(profile.id);}
    catch(failure){error.textContent=failure.message;fields.forEach(field=>field.disabled=false);document.querySelector('#accept-company').disabled=false;}
    finally{busy=false;}
  }
  function back(){
    if(busy || switching)return;
    if(['company-create','company-alter'].includes(getView())){
      if(dirty())askDialog('Discard unsaved company changes?',menu,'Discard');else menu();
    }else if(getView()==='companies')menu();else if(getBook())renderGateway();else openSelector();
  }
  function onKey(event){
    if(event.key==='F3' && !event.ctrlKey && !event.metaKey){event.preventDefault();openSelector();return true;}
    if(event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase()==='k'){event.preventDefault();openMenu();return true;}
    if(!views.includes(getView()))return false;
    if(busy || switching){event.preventDefault();return true;}
    if(event.altKey && !event.ctrlKey && event.key.toLowerCase()==='c'){event.preventDefault();openCreate();return true;}
    if(event.ctrlKey && !event.altKey && event.key.toLowerCase()==='a' && ['company-create','company-alter'].includes(getView())){event.preventDefault();save();return true;}
    if(event.altKey || event.ctrlKey || event.metaKey)return false;
    if(event.key==='Escape'){
      event.preventDefault();const field=event.target;
      if(['company-create','company-alter'].includes(getView()) && field.matches('#company-form input:not([readonly])') && field.value){field.value='';field.removeAttribute('aria-invalid');main.querySelector('#company-error').textContent='';if(field.id==='company-country')field.dispatchEvent(new Event('input'));}
      else back();return true;
    }
    if(getView()==='company-menu' && event.key.toLowerCase()==='a' && !main.querySelector('#company-alter-menu').disabled){event.preventDefault();openAlter();return true;}
    if(getView()==='company-menu' && ['ArrowDown','ArrowUp','Enter'].includes(event.key)){
      event.preventDefault();const buttons=[...main.querySelectorAll('.company-menu button:not(:disabled)')];if(event.key==='Enter')buttons[index].click();else{index=(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons.forEach((button,i)=>button.classList.toggle('selected',i===index));buttons[index].focus();}return true;
    }
    if(getView()==='companies' && ['ArrowDown','ArrowUp','Home','End','Enter'].includes(event.key)){
      if(event.target.closest('button') && !event.target.hasAttribute('data-company-id'))return false;
      event.preventDefault();if(event.key==='Enter'){if(rows.length)select(rows[index].id);else main.querySelector('#company-error').textContent='Choose a matching company.';}else highlight(event.key==='Home'?0:event.key==='End'?rows.length-1:index+(event.key==='ArrowDown'?1:-1));return true;
    }
    if(['company-create','company-alter'].includes(getView()) && event.key==='Enter' && !event.target.closest('button')){
      const fields=[...main.querySelectorAll('#company-form input,#company-form textarea')].filter(field=>!field.disabled && !field.readOnly && field.getClientRects().length),i=fields.indexOf(document.activeElement);
      const next=()=>{if(i<fields.length-1)fields[i+1].focus();else askDialog('Accept this company?',save);};
      if(handleMultilineEntry(event,next))return true;
      event.preventDefault();next();return true;
    }
    return false;
  }
  return {openMenu,openSelector,onKey,back,dirty,isSaving:()=>busy || switching};
}
