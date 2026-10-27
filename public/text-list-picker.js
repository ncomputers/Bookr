// Suggestions for an existing free-text field. Highlighting never changes the
// field; an explicit genuine choice commits it. Saving retains the raw draft.
import {buildTextChoices,moveHighlight,escapeTextChoice} from './text-choice-model.js';

export function createTextListPicker({host,input,id,title='List of Items',values,enabled=()=>true,onAccepted,onAcceptAll,acceptControl=null,formatOption=String,actions=[],onEmptyEscape,inlineInput=false,retainOutsideFocus=false}){
  const catalog=[...new Set(values.map(String))];
  const panel=document.createElement('aside');panel.id=id+'-picker';panel.className='list-picker text-list-picker';panel.hidden=true;panel.setAttribute('aria-label',title);
  const heading=document.createElement('h2');heading.id=id+'-heading';heading.textContent=title;
  const options=document.createElement('div');options.id=id+'-options';options.className='list-picker-options';options.setAttribute('role','listbox');options.setAttribute('aria-labelledby',heading.id);
  const footer=document.createElement('p');footer.className='list-picker-footer';footer.textContent='Enter / Tab: choose · Esc: clear / exit';panel.append(heading,options,footer);host.append(panel);
  if(inlineInput)heading.after(input);
  const actionButtons=actions.map(action=>{const button=document.createElement('button');button.type='button';button.id=action.id;button.textContent=action.label;return button;});
  if(actionButtons.length){const commands=document.createElement('nav');commands.className='list-picker-actions';commands.setAttribute('aria-label','List actions');commands.append(...actionButtons);footer.before(commands);footer.textContent+=' · Alt+↓: actions';}
  const attributes=['role','aria-autocomplete','aria-haspopup','aria-controls','aria-expanded','aria-activedescendant'],original=new Map(attributes.map(key=>[key,input.getAttribute(key)])),events=new AbortController();
  let rows=[],index=0,opening='',query=null,suppressFocus=false,destroyed=false;
  const isOpen=()=>!panel.hidden;
  const canUse=()=>!destroyed&&input.isConnected&&!input.disabled&&!input.readOnly&&enabled();
  const restoreAttributes=()=>{for(const[key,value]of original)if(value===null)input.removeAttribute(key);else input.setAttribute(key,value);};
  function paintHighlight(){
    input.removeAttribute('aria-activedescendant');
    for(const[i,button]of [...options.querySelectorAll('[role="option"]')].entries()){
      button.classList.toggle('selected',i===index);button.setAttribute('aria-selected',String(i===index));
      if(i===index){input.setAttribute('aria-activedescendant',button.id);button.scrollIntoView({block:'nearest'});}
    }
  }
  function highlight(next){index=moveHighlight({index,delta:next-index,count:rows.length});paintHighlight();}
  function filter(){
    ({rows,index}=buildTextChoices({values:catalog,opening,query}));
    options.replaceChildren();
    for(const[i,row]of rows.entries()){
      const button=document.createElement('button');button.type='button';button.id=id+'-option-'+i;button.dataset.value=row.value;button.textContent=formatOption(row.value);button.setAttribute('role','option');button.tabIndex=-1;
      button.addEventListener('pointerdown',event=>event.preventDefault(),{signal:events.signal});button.addEventListener('click',()=>{index=i;accept();},{signal:events.signal});options.append(button);
    }
    if(!rows.length){const empty=document.createElement('p');empty.className='list-picker-empty';empty.textContent='No matches';options.append(empty);}
    paintHighlight();
  }
  function show(){
    if(!canUse())return false;if(isOpen())return true;
    opening=input.value;query=null;panel.hidden=false;input.setAttribute('aria-expanded','true');filter();position();return true;
  }
  function position(){
    if(!isOpen()||inlineInput)return;
    const field=input.getBoundingClientRect(),area=host.getBoundingClientRect(),width=panel.getBoundingClientRect().width;
    if(field.right<=area.right-width){panel.style.top='';panel.style.bottom='';panel.style.height='';return;}
    // On narrow screens keep the input/query visible instead of covering it.
    const below=Math.max(0,Math.min(area.bottom,innerHeight)-field.bottom-4),above=Math.max(0,field.top-Math.max(area.top,0)-4),useAbove=below<120&&above>below,height=Math.min(320,useAbove?above:below);
    panel.style.bottom='auto';panel.style.height=height+'px';panel.style.top=(useAbove?field.top-area.top+host.scrollTop-height-4:field.bottom-area.top+host.scrollTop+4)+'px';
  }
  function close({focus=false}={}){
    panel.hidden=true;query=null;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');
    if(focus&&!input.disabled){suppressFocus=true;input.focus({preventScroll:true});suppressFocus=false;}
  }
  function accept({advance=true}={}){
    if(!canUse()||!isOpen()||index<0)return false;
    const value=rows[index].value,changed=input.value!==value;close();input.value=value;if(changed)input.dispatchEvent(new Event('change',{bubbles:true}));if(advance)onAccepted?.();return true;
  }
  function commitForSave(){
    // Preserving free-text metadata does not turn it into a catalog option.
    // Only Enter, Tab or an option click chooses a highlighted catalog value.
    if(isOpen())close();return true;
  }
  function sync(){
    if(!canUse()){close();restoreAttributes();return;}
    input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-haspopup','listbox');input.setAttribute('aria-controls',options.id);input.setAttribute('aria-expanded',String(isOpen()));
  }
  const listen=(target,type,action)=>target.addEventListener(type,action,{signal:events.signal});
  listen(input,'focus',()=>{if(!suppressFocus)show();});listen(input,'pointerdown',show);listen(input,'beforeinput',show);
  listen(input,'input',()=>{if(show()){query=input.value;filter();}});
  const outside=event=>{if(!retainOutsideFocus&&isOpen()&&event.target!==input&&!panel.contains(event.target)&&!acceptControl?.contains(event.target))close();};
  listen(document,'focusin',outside);listen(document,'pointerdown',outside);
  listen(window,'resize',position);listen(host,'scroll',position);
  const observer=new MutationObserver(sync);observer.observe(input,{attributes:true,attributeFilter:['disabled','readonly']});sync();
  actionButtons.forEach((button,i)=>{listen(button,'pointerdown',event=>event.preventDefault());listen(button,'click',()=>{if(canUse()){close();actions[i].onSelect();}});});
  function onKey(event){
    if(canUse()&&actionButtons.includes(event.target)){
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();input.focus({preventScroll:true});return true;}
      if(['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();event.stopPropagation();actionButtons[moveHighlight({index:actionButtons.indexOf(event.target),delta:event.key==='ArrowDown'?1:-1,count:actionButtons.length})].focus();return true;}
      return false;
    }
    if(canUse()&&event.target===input&&event.altKey&&!event.ctrlKey&&!event.metaKey&&event.key==='ArrowDown'&&actionButtons.length){event.preventDefault();event.stopPropagation();show();actionButtons[0].focus();return true;}
    if(!canUse()){sync();return false;}if(event.target!==input||event.altKey||event.metaKey)return false;
    if(event.ctrlKey){if(event.key.toLowerCase()!=='a'||!isOpen())return false;event.preventDefault();event.stopPropagation();if(commitForSave())onAcceptAll?.();return true;}
    if(event.key==='Escape'){
      const action=escapeTextChoice({open:isOpen(),entered:input.value});
      if(action==='delegate')return false;
      if(action==='close-and-back'){close();if(onEmptyEscape){event.preventDefault();event.stopPropagation();onEmptyEscape();return true;}return false;}
      event.preventDefault();event.stopPropagation();input.value='';query='';filter();return true;
    }
    if(event.key==='Tab'&&isOpen()){
      if(event.shiftKey){close();return false;}event.preventDefault();event.stopPropagation();accept();return true;
    }
    if(event.shiftKey&&['ArrowDown','ArrowUp'].includes(event.key))return false;
    if(['Enter','ArrowDown','ArrowUp'].includes(event.key)){
      event.preventDefault();event.stopPropagation();show();if(event.key==='Enter')accept();else highlight(index+(event.key==='ArrowDown'?1:-1));return true;
    }
    if(event.key.length===1&&!isOpen())show();return false;
  }
  return {isOpen,open:show,close,accept,commitForSave,onKey,sync,destroy(){if(destroyed)return;close();destroyed=true;events.abort();observer.disconnect();panel.remove();restoreAttributes();}};
}
