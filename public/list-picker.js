// Keyboard-first list attached to an existing select. The select remains the
// committed form value; filtering/highlighting never silently changes it.
import {filterCatalogRows,moveHighlight,escapeTextChoice} from './text-choice-model.js';

export function createListPicker({host,select,id,title='List of Items',onAccepted,onAcceptAll,searchLabel='Search',acceptControl=null,itemLabel='group',extraValues=[]}){
  const panel=document.createElement('aside');panel.id=id+'-picker';panel.className='list-picker';panel.hidden=true;
  panel.setAttribute('aria-label',title);
  const heading=document.createElement('h2');heading.textContent=title;heading.id=id+'-heading';
  const search=document.createElement('input');search.id=id+'-search';search.type='text';search.autocomplete='off';search.spellcheck=false;search.setAttribute('aria-label',searchLabel);search.setAttribute('role','combobox');search.setAttribute('aria-autocomplete','list');
  const options=document.createElement('div');options.id=id+'-options';options.className='list-picker-options';options.setAttribute('role','listbox');options.setAttribute('aria-labelledby',heading.id);
  const error=document.createElement('p');error.id=id+'-error';error.className='list-picker-error';error.setAttribute('role','alert');
  const footer=document.createElement('p');footer.className='list-picker-footer';footer.textContent='Enter / Tab: select · Esc: clear / back';
  panel.append(heading,search,options,error,footer);host.append(panel);
  const extra=new Set(extraValues.map(String));let expanded=extra.has(select.value);
  const more=extra.size?document.createElement('button'):null;
  if(more){more.type='button';more.id=id+'-show-more';more.className='list-picker-more';heading.after(more);}
  for(const field of [select,search]){field.setAttribute('aria-controls',options.id);field.setAttribute('aria-expanded','false');field.setAttribute('aria-haspopup','listbox');}
  search.setAttribute('aria-describedby',error.id);
  let rows=[],index=0,suppressFocus=false;
  const all=()=>[...select.options].filter(option=>!option.disabled).map(option=>({value:option.value,name:option.textContent})).sort((a,b)=>a.name.localeCompare(b.name));
  const isOpen=()=>!panel.hidden;
  function highlight(next){
    index=moveHighlight({index:next,delta:0,count:rows.length});
    if(!rows.length){for(const field of [select,search])field.removeAttribute('aria-activedescendant');return;}
    for(const [i,button] of [...options.querySelectorAll('[role="option"]')].entries()){
      button.classList.toggle('selected',i===index);button.setAttribute('aria-selected',String(i===index));
      if(i===index){for(const field of [select,search])field.setAttribute('aria-activedescendant',button.id);button.scrollIntoView({block:'nearest'});}
    }
  }
  function filter(current=false){
    const query=search.value.trim();rows=filterCatalogRows(all().filter(row=>expanded || query || !extra.has(row.value)),query,row=>row.name);options.replaceChildren();error.textContent='';
    if(more){more.textContent=expanded?'Show Less':'Show More';more.setAttribute('aria-expanded',String(expanded));}
    for(const [i,row] of rows.entries()){
      const button=document.createElement('button');button.type='button';button.id=id+'-option-'+row.value;button.dataset.value=row.value;button.textContent=row.name;button.setAttribute('role','option');button.tabIndex=-1;
      button.addEventListener('pointerdown',event=>event.preventDefault());button.onclick=()=>{index=i;accept();};options.append(button);
    }
    if(!rows.length){const empty=document.createElement('p');empty.className='list-picker-empty';empty.textContent='No matches';options.append(empty);}
    index=current?Math.max(0,rows.findIndex(row=>row.value===select.value)):0;highlight(index);
  }
  function show(){
    if(select.disabled || isOpen())return;
    if(extra.has(select.value))expanded=true;
    panel.hidden=false;search.value='';for(const field of [select,search])field.setAttribute('aria-expanded','true');filter(true);
  }
  function close(restore=false){
    panel.hidden=true;search.value='';search.removeAttribute('aria-invalid');error.textContent='';for(const field of [select,search]){field.setAttribute('aria-expanded','false');field.removeAttribute('aria-activedescendant');}
    if(restore && !select.disabled){suppressFocus=true;select.focus({preventScroll:true});suppressFocus=false;}
  }
  function accept(){
    if(!isOpen() || select.disabled)return false;
    if(!rows.length){error.textContent='Select a matching '+itemLabel+'.';search.setAttribute('aria-invalid','true');search.focus();return false;}
    const value=rows[index].value,changed=select.value!==value;close();select.value=value;
    if(changed)select.dispatchEvent(new Event('change',{bubbles:true}));
    onAccepted?.();return true;
  }
  const focus=()=>{if(!suppressFocus)show();};
  const pointer=event=>{if(select.disabled)return;event.preventDefault();select.focus();show();};
  const change=()=>{if(isOpen())close();};
  const outside=event=>{if(isOpen() && event.target!==select && !panel.contains(event.target) && !acceptControl?.contains(event.target))close();};
  select.addEventListener('focus',focus);select.addEventListener('pointerdown',pointer);select.addEventListener('change',change);document.addEventListener('focusin',outside);
  search.addEventListener('input',()=>{search.removeAttribute('aria-invalid');filter();});
  if(more){more.addEventListener('pointerdown',event=>event.preventDefault());more.onclick=()=>{expanded=!expanded;filter(true);search.focus();};}
  function onKey(event){
    if(select.disabled || (event.target!==select && !panel.contains(event.target)))return false;
    if(event.altKey || event.metaKey)return false;
    if(event.target===more && ['Enter',' '].includes(event.key))return false;
    if(event.ctrlKey){
      if(event.key.toLowerCase()!=='a' || !isOpen())return false;
      event.stopPropagation();
      if(event.target===search){if(!rows.length)error.textContent='Select a matching '+itemLabel+'.';return true;}
      event.preventDefault();if(accept())onAcceptAll?.();return true;
    }
    if(event.key==='Escape' && isOpen()){
      event.preventDefault();event.stopPropagation();
      if(escapeTextChoice({open:true,entered:search.value})==='clear'){search.value='';search.removeAttribute('aria-invalid');filter();search.focus();}
      else close(true);return true;
    }
    if(event.key==='Tab' && isOpen()){
      if(event.shiftKey){close();return false;}
      event.preventDefault();event.stopPropagation();accept();return true;
    }
    if(event.target===search && event.shiftKey && ['ArrowDown','ArrowUp','Home','End'].includes(event.key))return false;
    if(['Enter','ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();event.stopPropagation();show();
      if(event.key==='Enter')accept();else highlight(event.key==='Home'?0:event.key==='End'?rows.length-1:index+(event.key==='ArrowDown'?1:-1));return true;
    }
    if(event.target===select && event.key.length===1){event.preventDefault();event.stopPropagation();show();search.value=event.key===' '?'':event.key;filter();search.focus();search.setSelectionRange(search.value.length,search.value.length);return true;}
    return false;
  }
  return {isOpen,accept,onKey,destroy(){close();panel.remove();select.removeEventListener('focus',focus);select.removeEventListener('pointerdown',pointer);select.removeEventListener('change',change);document.removeEventListener('focusin',outside);}};
}
