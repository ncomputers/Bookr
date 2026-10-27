import {openFormDialog} from './confirmation-dialog.js';
import {readCompanyView,writeCompanyView,describeCompanyCurrency,companyFeatureStatus} from './company-view-model.js';

function yesNo(id,label,value){
 const row=document.createElement('div');row.className='company-view-row';const caption=document.createElement('label');caption.htmlFor=id;caption.textContent=label;const select=document.createElement('select');select.id=id;
 for(const [key,text]of [['yes','Yes'],['no','No']]){const option=document.createElement('option');option.value=key;option.textContent=text;select.append(option);}select.value=value?'yes':'no';row.append(caption,select);return {row,select};
}
export function createCompanyDisplayView({main,target,getName,getCurrency,onFeatures,storage=localStorage}){
 const events=new AbortController(),section=document.createElement('section');section.id='company-currency-details';section.className='company-currency-details';section.setAttribute('aria-label','Fixed currency format');main.querySelector('.company-currency').after(section);
 let preferences=readCompanyView(storage,target),overlay=null;
 function describe(){
  section.replaceChildren();const heading=document.createElement('h2');heading.textContent='Fixed currency format in Bookr';section.append(heading);
  try{const current=describeCompanyCurrency(getCurrency()),list=document.createElement('dl');for(const [key,label]of [['symbol','Symbol'],['name','Formal name'],['decimals','Decimal places'],['grouping','Digit grouping'],['position','Symbol position'],['spacing','Symbol spacing'],['example','Example']]){const term=document.createElement('dt'),description=document.createElement('dd');term.textContent=label;description.id='company-format-'+key;description.textContent=String(current[key]);list.append(term,description);}section.append(list);}
  catch{const message=document.createElement('p');message.textContent='Complete both currency labels to show the fixed format.';section.append(message);}
 }
 function sync(){for(const key of ['telephone','mobile','fax','email','website'])main.querySelector('.company-field-'+key).hidden=!preferences.show_contacts;section.hidden=!preferences.show_currency_details;describe();}
 for(const id of ['company-base-currency-symbol','company-currency-formal-name'])main.querySelector('#'+id).addEventListener('input',describe,{signal:events.signal});
 function configure(){
  const body=document.createElement('div'),scope=document.createElement('p');scope.className='company-view-scope';scope.textContent='Display preferences for '+getName()+' on this browser. These options do not change company data.';
  const contacts=yesNo('company-view-contacts','Show contact fields',preferences.show_contacts),currency=yesNo('company-view-currency','Show fixed currency description',preferences.show_currency_details),limits=document.createElement('p');limits.className='company-view-scope';limits.textContent='Access control, encryption and edit log are unavailable. Currency precision and amount-in-words settings are not configurable.';body.append(scope,contacts.row,currency.row,limits);
  overlay=openFormDialog({id:'company-view-dialog',title:'Company display options',body,fields:()=>[contacts.select,currency.select],acceptLabel:'Apply',onAccept:()=>{preferences=writeCompanyView(storage,target,{show_contacts:contacts.select.value==='yes',show_currency_details:currency.select.value==='yes'});sync();return true;},onClose:()=>{overlay=null;if(document.activeElement===main)main.querySelector('#company-name')?.focus({preventScroll:true});}});return overlay;
 }
 const commands=document.createElement('nav');commands.className='company-view-actions';commands.setAttribute('aria-label','Company setup');for(const[id,text,action]of [['company-configure','F12: Display options',configure],['company-show-features','F11: Feature status',onFeatures]]){const button=document.createElement('button');button.type='button';button.id=id;button.textContent=text;button.addEventListener('click',action,{signal:events.signal});commands.append(button);}main.querySelector('#company-form').append(commands);
 sync();return {sync,configure,dispose(){events.abort();overlay?.close();section.remove();commands.remove();}};
}

export function openCompanyFeatures({name='Bookr'}={}){
 const body=document.createElement('div'),scope=document.createElement('p');scope.className='company-view-scope';scope.textContent='Feature status for '+name+'. This screen describes Bookr capabilities; it does not enable company settings.';
 const more=yesNo('company-feature-more','Show more status details',false),all=yesNo('company-feature-all','Show all status details',false),lists=document.createElement('div');lists.className='company-feature-columns';body.append(scope,more.row,all.row,lists);
 function render(){
  all.row.hidden=more.select.value!=='yes';if(all.row.hidden)all.select.value='no';const level=all.select.value==='yes'?2:more.select.value==='yes'?1:0;lists.replaceChildren();
  for(const [status,title]of [['available','Available in Bookr'],['unavailable','Unavailable']]){const section=document.createElement('section'),heading=document.createElement('h3'),list=document.createElement('ul');heading.textContent=title;section.append(heading,list);for(const row of companyFeatureStatus().filter(row=>row.status===status&&row.level<=level)){const item=document.createElement('li'),label=document.createElement('span'),value=document.createElement('strong');item.dataset.featureKey=row.key;item.dataset.featureStatus=row.status;label.textContent=row.label;value.textContent=status==='available'?'Available':'Unavailable';item.append(label,value);if(level>0){const detail=document.createElement('p');detail.textContent=row.detail;item.append(detail);}list.append(item);}lists.append(section);}
 }
 more.select.onchange=render;all.select.onchange=render;render();return openFormDialog({id:'company-features-dialog',title:'Bookr feature status',body,fields:()=>[more.select,all.select],acceptLabel:null,cancelLabel:'Close'});
}
