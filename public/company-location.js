import {createTextListPicker} from './text-list-picker.js';
import {nextCompanyAddressField} from './text-choice-model.js';
import {companyLocationPolicy,compactCountrySuggestions,beginCountrySelection,searchCountrySelection,escapeCountrySelection,locationMetadata} from './company-location-model.js';
import {checkedGeographyCatalog,showGeographyNameDialog} from './geography-dialog.js';

// Mailing selection uses existing State/Country metadata. Its nested search is
// a separate control and never participates in the company payload.
export function createCompanyLocationPicker({host,stateInput,countryInput,acceptControl,onAccepted,onAcceptAll,onError,api,getCapabilities=()=>({})}){
 const events=new AbortController(),label=host.querySelector('label[for="'+stateInput.id+'"]');
 const query=document.createElement('input');query.id='company-country-query';query.type='text';query.maxLength=120;query.autocomplete='off';query.setAttribute('aria-label','Search countries');
 let draft=null,regionPicker=null,countryPicker=null,policyKey='',destroyed=false,catalog=null,nameDialog=null;
 const supportsMasters=()=>typeof api==='function'&&getCapabilities().company_geography_masters===true;
 const pending=()=>draft?.mode==='country';
 function policy(){
  const base=companyLocationPolicy(countryInput.value),requested=countryInput.value.trim().toLocaleLowerCase(),key=catalog?.countries.find(name=>name.toLocaleLowerCase()===requested||name==='UK'&&requested==='united kingdom');
  return {...base,suggestions:catalog?.states[key]??base.suggestions};
 }
 function syncRegion(){
  const current=policy(),key=JSON.stringify([current,supportsMasters()]);label.textContent=current.label;
  if(regionPicker&&key===policyKey){regionPicker.sync();return;}
  const reopen=regionPicker?.isOpen()&&document.activeElement===stateInput&&!pending();regionPicker?.destroy();policyKey=key;
  regionPicker=createTextListPicker({host,input:stateInput,id:'company-state',title:current.label==='Region'?'List of Regions':'List of States',values:current.suggestions,enabled:()=>current.suggestions.length>1||supportsMasters(),acceptControl,actions:[{id:'company-change-country',label:'Change Country',onSelect:openCountry},...(supportsMasters()?[{id:'company-new-state',label:'New State',onSelect:()=>createMaster('state')}]:[])],onAccepted:()=>onAccepted(nextCompanyAddressField({state:stateInput.value,country:countryInput.value})),onAcceptAll});
  if(reopen)regionPicker.open();
 }
 function showRegion(next){
  draft=null;countryPicker.close();query.value='';onError('');stateInput.value=next.state;countryInput.value=next.country;syncRegion();stateInput.focus({preventScroll:true});regionPicker.open();
 }
 function back(){if(!pending())return;showRegion(escapeCountrySelection(searchCountrySelection(draft,'')));}
 function openCountry(){
  draft=beginCountrySelection({country:countryInput.value,state:stateInput.value});stateInput.value=draft.state;query.value='';regionPicker.close();countryPicker.open();query.focus({preventScroll:true});
 }
 function buildCountryPicker(){
  countryPicker?.destroy();countryPicker=createTextListPicker({host,input:query,id:'company-country-query',title:'List of Countries',values:catalog?.countries??compactCountrySuggestions,acceptControl,inlineInput:true,retainOutsideFocus:true,enabled:()=>pending()&&!stateInput.disabled&&!stateInput.readOnly,actions:[{id:'company-country-back',label:'Back',onSelect:back},...(supportsMasters()?[{id:'company-new-country',label:'New Country',onSelect:()=>createMaster('country')}]:[])],onEmptyEscape:back,onAccepted:()=>{
   if(!(catalog?.countries??compactCountrySuggestions).includes(query.value))return;
   showRegion({...draft,mode:'region',state:'',country:query.value,query:''});
  }});
 }
 function applyCatalog(value){
  const next=checkedGeographyCatalog(value),wasOpen=pending()&&countryPicker.isOpen(),wasFocused=document.activeElement===query,text=query.value;catalog=next;buildCountryPicker();query.value=text;syncRegion();if(wasOpen){countryPicker.open();query.dispatchEvent(new Event('input',{bubbles:true}));if(wasFocused)query.focus({preventScroll:true});}
 }
 function createMaster(kind){
  if(!supportsMasters()||destroyed)return;
  const country=countryInput.value,key=catalog?.countries.find(name=>name.toLocaleLowerCase()===country.trim().toLocaleLowerCase()||name==='UK'&&country.trim().toLocaleLowerCase()==='united kingdom')??country;
  nameDialog=showGeographyNameDialog({kind,country:key,api,onCreated:result=>{nameDialog=null;if(destroyed)return;applyCatalog(result.catalog);if(kind==='country')showRegion({mode:'region',state:'',country:result.name,query:''});else{stateInput.value=result.name;onError('');stateInput.focus({preventScroll:true});regionPicker.open();}},onCancel:()=>{nameDialog=null;if(destroyed)return;if(pending()){countryPicker.open();query.focus({preventScroll:true});}else{stateInput.focus({preventScroll:true});regionPicker.open();}}});
 }
 function sync(){
  if(destroyed)return;
  // A direct Country edit is the existing web convention. It supersedes a
  // pending nested search without restoring an older accepted Country.
  if(pending()){draft=null;countryPicker.close();query.value='';onError('');}
  query.disabled=stateInput.disabled;query.readOnly=stateInput.readOnly;syncRegion();countryPicker.sync();
 }
 function commitForSave(){
  if(pending()){try{locationMetadata(searchCountrySelection(draft,query.value));}catch(error){onError(error.message);query.focus({preventScroll:true});}return false;}
  return regionPicker.commitForSave();
 }
 countryInput.addEventListener('input',sync,{signal:events.signal});countryInput.addEventListener('change',sync,{signal:events.signal});
 query.addEventListener('input',()=>{if(pending())draft=searchCountrySelection(draft,query.value);},{signal:events.signal});
 const observer=new MutationObserver(()=>{query.disabled=stateInput.disabled;query.readOnly=stateInput.readOnly;countryPicker.sync();});observer.observe(stateInput,{attributes:true,attributeFilter:['disabled','readonly']});
 buildCountryPicker();sync();
 if(supportsMasters())api('/api/geography').then(value=>{if(!destroyed)applyCatalog(value);}).catch(error=>{if(!destroyed)onError(error.message);});
 return {isPending:pending,isOpen:()=>regionPicker.isOpen()||countryPicker.isOpen(),commitForSave,sync,onKey(event){if(pending()&&event.key==='Tab'&&event.shiftKey){event.preventDefault();event.stopPropagation();back();return true;}if(pending()&&event.ctrlKey&&!event.altKey&&!event.metaKey&&event.key.toLowerCase()==='a'){event.preventDefault();event.stopPropagation();commitForSave();return true;}const handled=pending()?countryPicker.onKey(event):regionPicker.onKey(event);if(pending())draft=searchCountrySelection(draft,query.value);return handled;},destroy(){if(destroyed)return;destroyed=true;events.abort();observer.disconnect();nameDialog?.close();countryPicker.destroy();regionPicker.destroy();draft=null;}};
}
