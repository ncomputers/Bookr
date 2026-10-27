import {openFormDialog} from './confirmation-dialog.js';

export function checkedGeographyCatalog(value){
 const names=rows=>Array.isArray(rows)&&rows.every(name=>typeof name==='string'&&name.trim()===name&&name.length>0&&name.length<=120&&!/[\u0000-\u001f\u007f]/.test(name))&&new Set(rows.map(name=>name.toLocaleLowerCase())).size===rows.length;
 if(!value||!names(value.countries)||!value.states||Array.isArray(value.states)||typeof value.states!=='object'||Object.entries(value.states).some(([country,states])=>!value.countries.includes(country)||!names(states)))throw new Error('Unable to refresh address suggestions.');
 return value;
}

// Creation and refresh are separate phases: once a POST succeeds, retry reads
// the published catalog and never sends another creation request.
export function showGeographyNameDialog({kind,country,api,onCreated,onCancel}){
 const body=document.createElement('div'),label=document.createElement('label'),input=document.createElement('input'),help=document.createElement('p');
 input.id='geography-name';input.type='text';input.maxLength=120;input.autocomplete='off';label.htmlFor=input.id;label.textContent=kind==='country'?'Country name':'State or region name';
 help.textContent=kind==='country'?'Create an address suggestion. Company details are saved separately.':'Country: '+country+'. Company details are saved separately.';body.append(label,input,help);
 let published=null,completed=null,controller;
 controller=openFormDialog({id:'geography-dialog',title:kind==='country'?'Create country':'Create state or region',body,fields:()=>[input],initialFocus:input,acceptLabel:'Create',cancelLabel:'Cancel',onAccept:async()=>{
  let catalog;
  if(!published){
   const result=await api('/api/geography/'+(kind==='country'?'countries':'states'),{method:'POST',body:JSON.stringify({name:input.value,...(kind==='state'?{country}:{})})});
   published={name:typeof result?.name==='string'?result.name:input.value.trim()};input.value=published.name;input.disabled=true;controller.acceptButton.textContent='Refresh  Ctrl+A';
   try{catalog=checkedGeographyCatalog(result.catalog);}catch{throw new Error('The address suggestion was saved. Refresh its saved details.');}
  }else catalog=checkedGeographyCatalog(await api('/api/geography'));
  const values=kind==='country'?catalog.countries:catalog.states[country];
  if(!values?.includes(published.name))throw new Error('The address suggestion was saved. Refresh its saved details.');
  completed={name:published.name,catalog};return true;
 },onClose:accepted=>{if(accepted&&completed)onCreated(completed);else onCancel?.();}});
 return controller;
}
