import {formatBalance} from './entry-values.js';
import {ledgerGroups as groups} from './ledger-groups.js';
export function createChartWorkspace({main,hint,setScreen,getView,getBook,refreshBook,renderGateway,escapeHtml,openLedger,createLedger}) {
  let busy=false,flat=false,filter='all',query='',rows=[],index=0,selectedId=null;
  const group=kind=>groups.find(group=>group.kind===kind);
  function command(id,label,action){const button=document.createElement('button');button.type='button';button.id=id;button.textContent=label;button.onclick=action;document.querySelector('.command-strip').insertBefore(button,hint);}
  async function run(action){if(busy)return;busy=true;try{await refreshBook();await action();}catch(error){hint.textContent=error.message;}finally{busy=false;}}
  function highlight(next=index,focus=false){if(!rows.length)return;index=(next+rows.length)%rows.length;selectedId=rows[index].id;main.querySelectorAll('[data-chart-row]').forEach((row,i)=>{row.classList.toggle('selected',i===index);if(i===index){row.scrollIntoView({block:'nearest'});if(focus)row.querySelector('button').focus({preventScroll:true});}});}
  function renderMasters(){setScreen('Chart of Accounts','chart-masters','Ledgers · Enter: open · Esc: Gateway');main.innerHTML='<section class="master-menu"><div class="gateway-menu-title">Chart of Accounts</div><div class="master-menu-content"><h2 class="menu-heading">ACCOUNTING MASTERS</h2><button id="chart-open-ledgers" class="selected">Ledgers</button></div></section>';main.querySelector('button').onclick=openList;main.querySelector('button').focus();}
  const open=()=>run(renderMasters);
  const openList=()=>run(renderList);
  function returnToList(id=null,clearQuery=false){if(id){selectedId=id;const ledger=getBook().ledgers.find(ledger=>ledger.id===id);if(ledger && filter!=='all' && filter!==ledger.kind)filter='all';if(clearQuery)query='';}return openList();}
  function alter(id=rows[index]?.id){if(!id || busy)return;const ledger=getBook().ledgers.find(ledger=>ledger.id===id);openLedger(ledger,{onSaved:saved=>returnToList(saved.id,true),onCancel:()=>returnToList(id),lockKind:false});}
  function create(){createLedger(filter==='all'?'customer':filter,{onSaved:saved=>returnToList(saved.id,true),onCancel:()=>returnToList(),lockKind:false});}
  function renderList(){
    const all=getBook().ledgers.filter(ledger=>group(ledger.kind)),visible=all.filter(ledger=>(filter==='all' || ledger.kind===filter) && `${ledger.name} ${ledger.alias}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    rows=[];
    function ledgerRow(ledger){const i=rows.push(ledger)-1;return `<tr data-chart-row="${i}">${flat?`<td>${i+1}</td>`:''}<td><button type="button" data-chart-ledger="${ledger.id}">${escapeHtml(ledger.name)}</button></td>${flat?`<td>${group(ledger.kind).name}</td><td class="amount">${ledger.opening_balance?formatBalance(ledger.opening_balance):''}</td>`:''}</tr>`;}
    let contents;
    if(flat)contents=`<table class="chart-table chart-flat"><thead><tr><th>Sl. No.</th><th>Name of Ledger</th><th>Under</th><th>Opening Balance</th></tr></thead><tbody>${visible.sort((a,b)=>a.name.localeCompare(b.name)).map(ledgerRow).join('')}</tbody></table>`;
    else{let nature='',parent='';contents='<table class="chart-table chart-grouped"><tbody>';for(const item of groups){if(item.nature!==nature){nature=item.nature;parent='';contents+=`<tr class="chart-nature"><th>${nature}</th></tr>`;}if(item.parent && parent!==item.parent){parent=item.parent;contents+=`<tr class="chart-parent"><th>${parent}</th></tr>`;}contents+=`<tr class="chart-group"><th>${item.name}</th></tr>`;contents+=visible.filter(ledger=>ledger.kind===item.kind).sort((a,b)=>a.name.localeCompare(b.name)).map(ledgerRow).join('');}contents+='</tbody></table>';}
    setScreen('Chart of Accounts','chart-ledgers','↑ ↓ Enter: alter · letters: cycle names · F5: switch view · Esc: back');
    main.innerHTML=`<section class="chart-report"><div class="chart-report-heading"><strong>List of Ledgers</strong><label for="chart-search">Search <input id="chart-search" value="${escapeHtml(query)}" autocomplete="off"></label></div>${flat?`<div class="chart-under-group">Under Group &nbsp;: &nbsp;<strong id="chart-filter-caption">${filter==='all'?'All Items':group(filter).name}</strong></div>`:''}<div class="chart-scroll">${contents}${rows.length?'':'<p class="empty-report">No ledgers match.</p>'}</div><div class="chart-count"><strong>${rows.length} Ledger(s)</strong><span>${groups.length} supported groups · Cash / Bank / Capital and bill-wise party openings</span></div></section>`;
    main.querySelectorAll('[data-chart-row]').forEach((row,i)=>{const button=row.querySelector('button');button.onclick=()=>alter(rows[i].id);button.onfocus=()=>highlight(i);});
    main.querySelector('#chart-search').addEventListener('input',event=>{const position=event.target.selectionStart;query=event.target.value;renderList();const search=main.querySelector('#chart-search');search.focus();search.setSelectionRange(position,position);});
    command('chart-view',flat?'F5: Group View':'F5: Ledger View',toggle);command('chart-create','Create Master',create);if(flat)command('chart-filter','F4: Group',showFilter);
    const rail=document.querySelector('.function-rail'),button=document.createElement('button');button.type='button';button.dataset.salesRail='';button.textContent=flat?'F5: Group View':'F5: Ledger View';button.onclick=toggle;rail.insertBefore(button,rail.querySelector('.rail-space'));
    index=Math.max(0,rows.findIndex(row=>row.id===selectedId));highlight();main.focus();
  }
  function toggle(){flat=!flat;filter='all';run(renderList);}
  function showFilter(){
    if(busy || !flat || document.querySelector('dialog'))return;
    const dialog=document.createElement('dialog');dialog.id='chart-group-dialog';dialog.className='native-entry-dialog voucher-type-dialog';dialog.setAttribute('aria-labelledby','chart-group-heading');
    dialog.innerHTML='<form><h2 id="chart-group-heading">Under Group</h2><input id="chart-group-search" autocomplete="off" aria-label="Name of Group"><div class="selection-heading">List of Groups</div><div id="chart-group-options" role="listbox"></div><div class="details-commands"><button type="button" id="chart-cancel-group">Back <small>Esc</small></button><button type="submit">Accept <small>Enter</small></button></div></form>';document.body.append(dialog);
    const search=dialog.querySelector('input'),options=dialog.querySelector('#chart-group-options');let choices=[],selected=0;
    const error=document.createElement('div');error.className='details-error';error.id='chart-group-error';error.setAttribute('role','alert');options.after(error);
    function draw(){choices=[{kind:'all',name:'All Items'},...groups.filter(group=>group.name.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()))];options.innerHTML=choices.map((group,i)=>`<button type="button" role="option" class="${i===selected?'selected':''}" data-chart-group="${group.kind}">${group.name}</button>`).join('');options.querySelectorAll('button').forEach((button,i)=>button.onclick=()=>{selected=i;accept();});}
    function close(){dialog.close();dialog.remove();main.focus();}
    function accept(){if(selected===0 && search.value.trim() && search.value.trim().toLocaleLowerCase()!=='all items'){error.textContent='Select a matching group with the arrow keys, or clear the search for All Items.';return;}filter=choices[selected].kind;close();run(renderList);}
    search.oninput=()=>{selected=0;error.textContent='';draw();};dialog.querySelector('form').onsubmit=event=>{event.preventDefault();accept();};dialog.querySelector('#chart-cancel-group').onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    search.onkeydown=event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();event.stopPropagation();selected=(selected+(event.key==='ArrowDown'?1:-1)+choices.length)%choices.length;draw();}};
    draw();selected=Math.max(0,choices.findIndex(choice=>choice.kind===filter));draw();dialog.showModal();search.focus();
  }
  function goBack(){if(getView()==='chart-ledgers')run(renderMasters);else renderGateway(2);}
  function onKey(event){
    if(!['chart-ledgers','chart-masters'].includes(getView()))return false;if(busy){event.preventDefault();return true;}if(event.ctrlKey || event.altKey || event.metaKey)return false;
    if(getView()==='chart-masters'){if(event.key==='Enter' && main.contains(event.target)){event.preventDefault();openList();return true;}return false;}
    if(event.key==='F5'){event.preventDefault();toggle();return true;}if(event.key==='F4' && flat){event.preventDefault();showFilter();return true;}
    if(event.target.id==='chart-search' && !['ArrowDown','ArrowUp','Enter'].includes(event.key))return false;
    if(['ArrowDown','ArrowUp','Enter'].includes(event.key) && main.contains(event.target)){event.preventDefault();if(event.key==='Enter')alter();else highlight(index+(event.key==='ArrowDown'?1:-1),true);return true;}
    if(['Home','End'].includes(event.key) && main.contains(event.target)){event.preventDefault();highlight(event.key==='Home'?0:rows.length-1,true);return true;}
    if(event.key.length===1 && /^[a-z0-9]$/i.test(event.key) && main.contains(event.target)){const next=rows.map((_,offset)=>(index+offset+1)%rows.length).find(i=>rows[i].name.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()));if(next!==undefined)highlight(next,true);event.preventDefault();return true;}return false;
  }
  return {open,goBack,onKey,isSaving:()=>busy};
}
