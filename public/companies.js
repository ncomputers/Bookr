import {entryDate,parseEntryDate} from './entry-values.js';
import {handleMultilineEntry} from './multiline-entry.js';
import {initialFinancialYearTo} from './calendar-values.js';
import {companyList,companyName} from './company-list.js';
import {applyCompanyProfile,companyMetadataFields} from './company-profile-binding.js';
import {confirmSequence} from './confirmation-sequence.js';
import {createTextListPicker} from './text-list-picker.js';
import {indiaStateSuggestions} from './india-states.js';
import {nextCompanyAddressField} from './text-choice-model.js';
import {companyCurrency} from './company-currency.js';

export function createCompanyWorkspace({main,hint,api,setScreen,getView,getBook,getCapabilities=()=>getBook()?.capabilities??{},renderGateway,escapeHtml,askDialog,isBusy,isDirty,activeId,onSelect,getLoadedIds,onShut,onEdited}){
  let busy=false,switching=false,rows=[],index=0,initial='',dates=null,editingProfile=null,pendingSelection=null,publishedEdit=null,menuOrigin='gateway',commitYear=null,readCalendar=null,statePicker=null,approveCalendar=null;
  const views=['company-menu','companies','company-create','company-alter'];
  const contacts=[['telephone','Telephone'],['mobile','Mobile'],['fax','Fax'],['email','E-mail'],['website','Website']];
  const value=id=>main.querySelector('#'+id).value;
  const currencyIds={currency_symbol:'company-base-currency-symbol',currency_name:'company-currency-formal-name'};
  const currencyEnabled=()=>getCapabilities().company_currency_labels===true;
  const values=()=>({...Object.fromEntries(companyMetadataFields.map(key=>[key,value('company-'+key.replaceAll('_','-'))])),...(currencyEnabled()?Object.fromEntries(Object.entries(currencyIds).map(([key,id])=>[key,value(id)])):{})});
  const draft=()=>({...values(),financial_year_from:value('company-financial-year'),books_from:value('company-books-from')});
  const dirty=()=>!pendingSelection && !publishedEdit && ['company-create','company-alter'].includes(getView()) && JSON.stringify(draft())!==initial;
  function command(id,label,action){const button=document.createElement('button');button.id=id;button.type='button';button.textContent=label;button.onclick=action;document.querySelector('.command-strip').insertBefore(button,hint);}
  function guard(action){if(isBusy() || document.querySelector('dialog'))return;if(isDirty())askDialog('Discard unsaved changes and open Company?',action,'Discard');else action();}
  async function run(action){if(busy || switching)return;busy=true;try{await action();}catch(error){const box=main.querySelector('#company-error');if(box)box.textContent=error.message;else hint.textContent=error.message;}finally{busy=false;}}
  async function select(id){
    if(busy || switching)return;
    await run(async()=>{
      if(main.dataset.mode==='edit'){
        if(!getLoadedIds().includes(id))throw new Error('Choose a loaded company to edit.');
        const profile=await api('/api/companies/'+id);let calendarEditable=false;
        if(getBook()?.capabilities?.company_calendar_alteration===true){
          try{const policy=await api('/api/companies/'+id+'/calendar-editability');calendarEditable=policy.company_id===profile.id&&policy.revision===profile.revision&&policy.editable===true;}catch{}
        }
        dates=profile;renderForm(profile,calendarEditable);
      }else{await (main.dataset.mode==='shut'?onShut(id):onSelect(id));switching=true;}
    });
  }
  function menu(){
    setScreen('Company','company-menu','↑ ↓ Enter: open · Esc: Gateway');
    const canAlter=menuOrigin==='gateway' && getBook()?.capabilities?.company_alter===true;
    main.innerHTML=`<section class="master-menu company-menu"><div class="gateway-menu-title">Company</div><div class="master-menu-content"><h2 class="menu-heading">COMPANY</h2><button id="company-create-menu" class="selected">Create Company</button><button id="company-alter-menu" ${canAlter?'':'disabled'}>Alter Company</button><button id="company-select-menu">Select Company</button><button id="company-shut-menu" ${getLoadedIds().length?'':'disabled'}>Shut Company</button><p>${escapeHtml(getBook()?.company ?? 'Select a company to open its books.')}</p>${!canAlter?'<small>Company alteration is available from Gateway with a supported server.</small>':''}</div></section>`;
    index=0;main.querySelector('#company-create-menu').onclick=openCreate;main.querySelector('#company-alter-menu').onclick=openAlter;main.querySelector('#company-select-menu').onclick=()=>openSelector('select');main.querySelector('#company-shut-menu').onclick=()=>openSelector('shut');
    const buttons=[...main.querySelectorAll('.company-menu button:not(:disabled)')];buttons.forEach((button,i)=>button.onfocus=()=>{index=i;buttons.forEach((item,n)=>item.classList.toggle('selected',n===i));});buttons[0].focus();
  }
  const rememberOrigin=()=>{if(!views.includes(getView()))menuOrigin=getView();};
  const openMenu=()=>guard(()=>{rememberOrigin();menu();});
  const openSelector=(selectionMode='change')=>guard(()=>run(()=>loadSelector(selectionMode)));
  async function loadSelector(selectionMode,{preferredId=activeId(),prefill=false}={}){
    rememberOrigin();
    const data=await api('/api/companies'),all=data.companies;dates=all.find(row=>row.id==='default');
    const name=selectionMode==='edit'?'Choose company to edit':selectionMode==='shut'?'Shut Company':selectionMode==='select'?'Select Company':'Change Company';
    setScreen(name,'companies','Type to filter · ↑ ↓ Enter: '+(selectionMode==='shut'?'shut':'select')+' · Alt+F3: all companies · Esc: Company');main.dataset.mode=selectionMode;
    const canAlter=menuOrigin==='gateway'&&getBook()?.capabilities?.company_alter===true;
    main.innerHTML=`<section class="company-selector"><label for="company-search">${name}</label><input id="company-search" aria-label="Name of Company" autocomplete="off" aria-controls="company-options"><div class="selection-heading">${selectionMode==='edit'?'Loaded companies':selectionMode==='select'?'List of Companies':'List of Loaded Companies'}</div><nav class="company-selection-actions" aria-label="Company actions">${selectionMode==='change'?`<button type="button" id="selector-create-company">Create Company</button><button type="button" id="selector-alter-company" ${canAlter?'':'disabled'}>Alter Company</button>`:''}${selectionMode!=='select'?'<button type="button" id="select-all-companies">Select Company</button>':''}${selectionMode==='change'?`<button type="button" id="selector-shut-company" ${getLoadedIds().length?'':'disabled'}>Shut Company</button>`:''}</nav><div id="company-options" role="listbox" aria-label="Companies"></div><p id="company-error" class="company-error" role="alert"></p></section>`;
    const search=main.querySelector('#company-search');search.value=prefill?companyName(all,preferredId):'';search.addEventListener('input',()=>filter(all,search.value,rows[index]?.id));filter(all,search.value,preferredId);
    main.querySelector('#select-all-companies')?.addEventListener('click',()=>openSelector('select'));
    main.querySelector('#selector-create-company')?.addEventListener('click',openCreate);main.querySelector('#selector-alter-company')?.addEventListener('click',openAlter);main.querySelector('#selector-shut-company')?.addEventListener('click',()=>openSelector('shut'));
    command('create-company','Create Company  Alt+C',openCreate);search.focus();
  }
  function filter(all,query,preferredId=activeId()){
    ({rows,index}=companyList({companies:all,loadedIds:getLoadedIds(),mode:main.dataset.mode,query,preferredId}));
    const list=main.querySelector('#company-options');
    list.innerHTML=rows.length?rows.map((row,i)=>`<button type="button" role="option" data-company-id="${row.id}" data-company-index="${i}" aria-selected="false"><strong>${escapeHtml(row.name)}</strong><small>${entryDate(row.financial_year_from)} to ${entryDate(row.financial_year_to)}${row.id===activeId()?' · Current':''}</small></button>`).join(''):'<p>No matching company.</p>';
    list.querySelectorAll('button').forEach((button,i)=>{button.onclick=()=>select(rows[i].id);button.onfocus=()=>highlight(i);});highlight(index);
  }
  function highlight(next){if(!rows.length)return;index=(next+rows.length)%rows.length;main.querySelectorAll('[data-company-id]').forEach((button,i)=>{button.classList.toggle('selected',i===index);button.setAttribute('aria-selected',String(i===index));if(i===index)button.scrollIntoView({block:'nearest'});});}
  const openCreate=()=>guard(()=>run(async()=>{
    rememberOrigin();
    const data=await api('/api/companies');dates=data.companies.find(row=>row.id==='default');
    renderForm();
  }));
  const openAlter=()=>{
    if(menuOrigin!=='gateway' || getBook()?.capabilities?.company_alter!==true){hint.textContent='Return to Gateway on the latest server to alter company details.';return;}
    return openSelector('edit');
  };
  function renderForm(profile=null,calendarEditable=false){
    pendingSelection=null;publishedEdit=null;
    editingProfile=profile;
    setScreen(profile?'Company Alteration':'Company Creation',profile?'company-alter':'company-create','Enter: next field · Address: blank line to finish · Ctrl+A: save · Esc: back');
    const field=(key,label,value='',limit=120)=>`<div class="company-field company-field-${key}"><label for="company-${key.replaceAll('_','-')}">${label}</label><span>:</span>${key==='mobile'?'<div class="company-mobile"><span id="company-mobile-prefix" aria-label="Country calling code"></span>':''}<input id="company-${key.replaceAll('_','-')}" maxlength="${limit}" value="${escapeHtml(value)}">${key==='mobile'?'</div>':''}</div>`;
    main.innerHTML=`<form id="company-form" novalidate autocomplete="off"><div class="company-create-columns"><section>${field('name','Company Name',profile?.name ?? '')}${field('mailing_name','Mailing Name',profile?.mailing_name ?? '')}<div class="company-field company-address"><label for="company-address">Address</label><span>:</span><textarea id="company-address" maxlength="1000" rows="4">${escapeHtml(profile?.address ?? '')}</textarea></div>${field('state','State',profile?.state ?? 'Not Applicable')}${field('country','Country',profile?.country ?? 'India')}${field('pincode','Pincode',profile?.pincode ?? '',20)}${contacts.map(([key,label])=>field(key,label,profile?.[key]??'')).join('')}</section><section class="company-year"><div class="company-field"><label for="company-financial-year">Financial year beginning from</label><span>:</span><input id="company-financial-year" value="${entryDate(dates.financial_year_from)}" readonly tabindex="-1"></div><div class="company-field"><label for="company-books-from">Books beginning from</label><span>:</span><input id="company-books-from" value="${entryDate(dates.books_from)}" readonly tabindex="-1"></div></section></div><section class="company-currency" aria-label="Base currency"><div class="company-field"><span>Base Currency symbol</span><span>:</span><strong id="company-base-currency-symbol">₹</strong></div><div class="company-field"><span>Formal name</span><span>:</span><strong id="company-currency-formal-name">INR</strong></div></section><p id="company-error" class="company-error" role="alert"></p></form>`;
    const currency=companyCurrency(profile??{});
    for(const[key,id]of Object.entries(currencyIds)){const node=main.querySelector('#'+id),input=document.createElement('input');input.id=id;input.value=currency[key];input.maxLength=key==='currency_symbol'?12:120;input.readOnly=!currencyEnabled()||Boolean(profile)&&!calendarEditable;input.setAttribute('aria-label',key==='currency_symbol'?'Base currency symbol':'Currency formal name');if(input.readOnly)input.tabIndex=-1;node.replaceWith(input);}
    const name=main.querySelector('#company-name'),mail=main.querySelector('#company-mailing-name');let previous='';
    const year=main.querySelector('#company-financial-year'),books=main.querySelector('#company-books-from');
    for(const field of [year,books]){field.readOnly=Boolean(profile)&&!calendarEditable;field.tabIndex=field.readOnly?-1:0;}
    let acceptedYear=dates.financial_year_from,approved=JSON.stringify({financial_year_from:dates.financial_year_from,books_from:dates.books_from,financial_year_to:dates.financial_year_to}),lastDateField=year;
    for(const field of [year,books])field.addEventListener('input',()=>{lastDateField=field;field.removeAttribute('aria-invalid');main.querySelector('#company-error').textContent='';});
    const calendarError=(field,error)=>{field.setAttribute('aria-invalid','true');main.querySelector('#company-error').textContent=error.message;field.focus();};
    commitYear=()=>{
      let from,to;try{from=parseEntryDate(year.value);to=initialFinancialYearTo(from);}catch(error){calendarError(year,error);throw error;}
      if((!profile||calendarEditable) && from!==acceptedYear)books.value=entryDate(from);
      acceptedYear=from;year.value=entryDate(from);year.removeAttribute('aria-invalid');return {from,to};
    };
    readCalendar=()=>{
      const {from,to}=commitYear();let booksFrom;
      try{booksFrom=parseEntryDate(books.value);if(booksFrom<from || booksFrom>to)throw new Error('Choose a books-beginning date within the initial financial year.');}
      catch(error){calendarError(books,error);throw error;}
      books.value=entryDate(booksFrom);books.removeAttribute('aria-invalid');return {financial_year_from:from,books_from:booksFrom,financial_year_to:to};
    };
    approveCalendar=(done,field=lastDateField)=>{
      const candidate=JSON.stringify(readCalendar());
      if(!profile||!calendarEditable||candidate===approved)return true;
      confirmSequence({askDialog,messages:['Review these company start dates?','Apply the reviewed start dates?'],focus:()=>field.focus({preventScroll:true}),onAccepted:()=>{approved=candidate;done();}});return false;
    };
    year.addEventListener('change',()=>{if(!profile||calendarEditable){try{commitYear();}catch{}}});
    const country=main.querySelector('#company-country'),prefix=main.querySelector('#company-mobile-prefix');
    const updatePrefix=()=>{prefix.textContent=country.value.trim().toLocaleLowerCase()==='india'?'+91':'';};country.addEventListener('input',updatePrefix);updatePrefix();
    name.addEventListener('input',()=>{if(!editingProfile && (!mail.value || mail.value===previous))mail.value=name.value;previous=name.value;name.removeAttribute('aria-invalid');main.querySelector('#company-error').textContent='';});
    if(profile)syncEditedProfile(profile);
    main.querySelector('form').onsubmit=event=>{event.preventDefault();save();};command('accept-company','A: Accept  Ctrl+A',save);
    statePicker=createTextListPicker({host:main,input:main.querySelector('#company-state'),id:'company-state',title:'State suggestions',values:indiaStateSuggestions,alwaysVisible:['Not Applicable'],enabled:()=>country.value.trim().toLocaleLowerCase()==='india',acceptControl:document.querySelector('#accept-company'),onAccepted:()=>main.querySelector('#company-'+nextCompanyAddressField({state:value('company-state'),country:country.value})).focus(),onAcceptAll:save});
    country.addEventListener('input',()=>statePicker?.sync());initial=JSON.stringify(draft());name.focus();name.select();
  }
  function syncEditedProfile(profile){
    editingProfile=profile;dates=profile;
    syncFormProfile(profile);
  }
  function syncFormProfile(profile){
    let heading=document.querySelector('.screen-company');
    if(!heading){heading=document.createElement('span');heading.className='screen-company';document.querySelector('.screen-title h1').after(heading);}
    applyCompanyProfile({form:main.querySelector('#company-form'),heading,profile:{...profile,...companyCurrency(profile)},currencyControls:Object.entries(currencyIds).map(([key,id])=>({key,control:main.querySelector('#'+id)}))});
  }
  async function save(){
    if(busy || switching || !['company-create','company-alter'].includes(getView()) || document.querySelector('dialog'))return;
    if(publishedEdit){await run(finishEdit);return;}
    if(pendingSelection){
      busy=true;const accept=document.querySelector('#accept-company');accept.disabled=true;
      try{await onSelect(pendingSelection.id);switching=true;}
      catch(failure){main.querySelector('#company-error').textContent='Company saved as '+pendingSelection.name+'. Unable to open: '+failure.message;}
      finally{busy=false;if(!switching)accept.disabled=false;}return;
    }
    if(statePicker&&!statePicker.commitForSave())return;
    const input=values(),error=main.querySelector('#company-error');error.textContent='';
    if(!input.name.trim()){error.textContent='Enter a company name.';main.querySelector('#company-name').setAttribute('aria-invalid','true');main.querySelector('#company-name').focus();return;}
    try{Object.assign(input,readCalendar());}catch(failure){error.textContent=failure.message;return;}
    if(!approveCalendar(()=>save()))return;
    busy=true;const fields=[...main.querySelectorAll('input,textarea')];fields.forEach(field=>field.disabled=true);document.querySelector('#accept-company').disabled=true;
    try{const profile=await api(editingProfile?'/api/companies/'+editingProfile.id:'/api/companies',{method:editingProfile?'PUT':'POST',body:JSON.stringify({...input,...(editingProfile?{revision:editingProfile.revision}:{})})});
      initial=JSON.stringify(draft());
      if(editingProfile){syncEditedProfile(profile);initial=JSON.stringify(draft());publishedEdit=profile;await finishEdit();}
      else{pendingSelection=profile;syncFormProfile(profile);initial=JSON.stringify(draft());try{await onSelect(profile.id);switching=true;}catch(failure){throw new Error('Company saved as '+profile.name+'. Select it from Company to open its books. '+failure.message);}}}
    catch(failure){error.textContent=failure.message;if(!pendingSelection)fields.forEach(field=>field.disabled=false);const accept=document.querySelector('#accept-company');accept.disabled=false;if(pendingSelection)accept.textContent='Open Company  Ctrl+A';accept.focus();}
    finally{busy=false;}
  }
  async function finishEdit(){
    const saved=publishedEdit,accept=document.querySelector('#accept-company');accept.disabled=true;
    try{await onEdited();await loadSelector('edit',{preferredId:saved.id,prefill:true});publishedEdit=null;}
    catch(failure){main.querySelector('#company-error').textContent='Company saved as '+saved.name+'. Unable to refresh the list: '+failure.message;accept.textContent='Refresh  Ctrl+A';accept.disabled=false;accept.focus();}
  }
  function back(){
    if(busy || switching)return;
    if(['company-create','company-alter'].includes(getView())){
      const leave=editingProfile?()=>run(()=>loadSelector('edit',{preferredId:editingProfile.id,prefill:true})):menu;
      if(dirty())askDialog('Discard unsaved company changes?',leave,'Discard');else leave();
    }else if(getView()==='companies')menu();else renderGateway();
  }
  function onKey(event){
    if(event.key==='F3' && !event.metaKey && !(event.ctrlKey&&event.altKey)){event.preventDefault();openSelector(event.ctrlKey?'shut':event.altKey?'select':'change');return true;}
    if(event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase()==='k'){event.preventDefault();openMenu();return true;}
    if(!views.includes(getView()))return false;
    if(busy || switching){event.preventDefault();return true;}
    if(statePicker?.onKey(event))return true;
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
      if(event.target.id==='company-financial-year' && !event.target.readOnly){try{commitYear();}catch{event.preventDefault();return true;}}
      if(event.target.id==='company-books-from' && !event.target.readOnly){try{readCalendar();}catch{event.preventDefault();return true;}}
      const fields=[...main.querySelectorAll('#company-form input,#company-form textarea')].filter(field=>!field.disabled && !field.readOnly && field.getClientRects().length),i=fields.indexOf(document.activeElement);
      const next=()=>{if(i<fields.length-1)fields[i+1].focus();else askDialog('Accept this company?',save);};
      if(['company-financial-year','company-books-from'].includes(event.target.id)&&!event.target.readOnly){event.preventDefault();try{if(approveCalendar(next,event.target))next();}catch{}return true;}
      if(handleMultilineEntry(event,next))return true;
      event.preventDefault();next();return true;
    }
    return false;
  }
  return {openMenu,openSelector,openCreate,onKey,back,dirty,dispose(){statePicker?.destroy();statePicker=null;},isSaving:()=>busy || switching};
}
