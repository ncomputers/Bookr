import {formatBalance} from './entry-values.js';
import {ledgerGroups as groups,supportedLedgerGroups} from './ledger-groups.js';

export function createChartWorkspace({
  main,hint,setScreen,getView,getBook,refreshBook,renderGateway,escapeHtml,
  openLedger,createLedger,api,openGroup,openCostCategory,openCostCentre
}) {
  let busy=false,flat=false,filter='all',query='',rows=[],index=0,selectedId=null;
  const roleGroup=kind=>supportedLedgerGroups.find(group=>group.kind===kind);
  const group=value=>groups.find(item=>item.value===value)??roleGroup(value);
  const groupForLedger=ledger=>groups.find(item=>item.name===ledger.group_name && (item.group_id??null)===(ledger.group_id??null))??roleGroup(ledger.kind);

  function command(id,label,action){
    const button=document.createElement('button');
    button.type='button';
    button.id=id;
    button.textContent=label;
    button.onclick=action;
    document.querySelector('.command-strip').insertBefore(button,hint);
  }

  async function run(action){
    if(busy)return;
    busy=true;
    try{await refreshBook();await action();}
    catch(error){hint.textContent=error.message;}
    finally{busy=false;}
  }

  function highlight(next=index,focus=false){
    if(!rows.length)return;
    index=(next+rows.length)%rows.length;
    selectedId=rows[index].id;
    main.querySelectorAll('[data-chart-row]').forEach((row,i)=>{
      row.classList.toggle('selected',i===index);
      if(i===index){
        row.scrollIntoView({block:'nearest'});
        if(focus)row.querySelector('button')?.focus({preventScroll:true});
      }
    });
  }

  function renderMasters(){
    setScreen('Chart of Accounts','chart-masters','Ledgers · Enter: open · Esc: Gateway');
    main.innerHTML=`<section class="master-menu">
      <div class="gateway-menu-title">Chart of Accounts</div>
      <div class="master-menu-content">
        <h2 class="menu-heading">ACCOUNTING MASTERS</h2>
        <button id="chart-open-groups">Groups</button>
        <button id="chart-open-ledgers" class="selected">Ledgers</button>
        <button id="chart-open-cost-categories">Cost Categories</button>
        <button id="chart-open-cost-centres">Cost Centres</button>
      </div>
    </section>`;
    main.querySelector('#chart-open-groups').onclick=()=>run(renderGroupsList);
    main.querySelector('#chart-open-ledgers').onclick=openList;
    main.querySelector('#chart-open-cost-categories').onclick=()=>run(renderCategoriesList);
    main.querySelector('#chart-open-cost-centres').onclick=()=>run(renderCentresList);
    main.querySelector('#chart-open-ledgers').focus();
  }

  const open=()=>run(renderMasters),openList=()=>run(renderList);

  function returnToList(id=null,clearQuery=false){
    if(id){
      selectedId=id;
      const ledger=getBook().ledgers.find(item=>item.id===id);
      if(ledger&&filter!=='all'&&filter!==groupForLedger(ledger)?.value)filter='all';
      if(clearQuery)query='';
    }
    return openList();
  }

  function alter(id=rows[index]?.id){
    if(!id||busy)return;
    const v=getView();
    if(v==='chart-ledgers'){
      const ledger=getBook().ledgers.find(item=>item.id===id);
      openLedger(ledger,{onSaved:saved=>returnToList(saved.id,true),onCancel:()=>returnToList(id),lockKind:false});
    } else if(v==='chart-groups' && openGroup){
      const grp=rows[index];
      openGroup(grp);
    } else if(v==='chart-cost-categories' && openCostCategory){
      const cat=rows[index];
      openCostCategory(cat);
    } else if(v==='chart-cost-centres' && openCostCentre){
      const centre=rows[index];
      openCostCentre(centre);
    }
  }

  function create(){
    const v=getView();
    if(v==='chart-ledgers'){
      const selected=filter==='all'?roleGroup('customer'):group(filter);
      createLedger(selected?.value??roleGroup('customer').value,{onSaved:saved=>returnToList(saved.id,true),onCancel:()=>returnToList(),lockKind:false});
    }
  }

  // --- LEDGERS CHART ---
  function renderList(){
    const all=getBook().ledgers.filter(ledger=>groupForLedger(ledger));
    const visible=all.filter(ledger=>(filter==='all'||groupForLedger(ledger)?.value===filter)&&`${ledger.name} ${ledger.alias}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    rows=[];
    function ledgerRow(ledger){
      const i=rows.push(ledger)-1;
      return `<tr data-chart-row="${i}">${flat?`<td>${i+1}</td>`:''}<td><button type="button" data-chart-ledger="${ledger.id}">${escapeHtml(ledger.name)}</button></td>${flat?`<td>${escapeHtml(groupForLedger(ledger)?.name??'')}</td><td class="amount">${ledger.opening_balance?formatBalance(ledger.opening_balance):''}</td>`:''}</tr>`;
    }
    let contents;
    if(flat){
      contents=`<table class="chart-table chart-flat"><thead><tr><th>Sl. No.</th><th>Name of Ledger</th><th>Under</th><th>Opening Balance</th></tr></thead><tbody>${visible.sort((a,b)=>a.name.localeCompare(b.name)).map(ledgerRow).join('')}</tbody></table>`;
    } else {
      let parent='';
      contents='<table class="chart-table chart-grouped"><tbody>';
      for(const item of groups){
        if(item.parent&&parent!==item.parent){
          parent=item.parent;
          contents+=`<tr class="chart-parent"><th>${escapeHtml(parent)}</th></tr>`;
        }
        contents+=`<tr class="chart-group"><th>${escapeHtml(item.name)}</th></tr>`;
        contents+=visible.filter(ledger=>groupForLedger(ledger)?.value===item.value).sort((a,b)=>a.name.localeCompare(b.name)).map(ledgerRow).join('');
      }
      contents+='</tbody></table>';
    }
    setScreen('Chart of Accounts','chart-ledgers','↑ ↓ Enter: alter · letters: cycle names · F5: switch view · Esc: back');
    main.innerHTML=`<section class="chart-report"><div class="chart-report-heading"><strong>List of Ledgers</strong><label for="chart-search">Search <input id="chart-search" value="${escapeHtml(query)}" autocomplete="off"></label></div>${flat?`<div class="chart-under-group">Under Group &nbsp;: &nbsp;<strong id="chart-filter-caption">${filter==='all'?'All Items':escapeHtml(group(filter)?.name??'All Items')}</strong></div>`:''}<div class="chart-scroll">${contents}${rows.length?'':'<p class="empty-report">No ledgers match.</p>'}</div><div class="chart-count"><strong>${rows.length} Ledger(s)</strong><span>${groups.length} visible group labels · unsupported voucher roles remain unavailable</span></div></section>`;
    main.querySelectorAll('[data-chart-row]').forEach((row,i)=>{
      const button=row.querySelector('button');
      button.onclick=()=>alter(rows[i].id);
      button.onfocus=()=>highlight(i);
    });
    main.querySelector('#chart-search').addEventListener('input',event=>{
      const position=event.target.selectionStart;
      query=event.target.value;
      renderList();
      const search=main.querySelector('#chart-search');
      search.focus();
      search.setSelectionRange(position,position);
    });
    command('chart-view',flat?'F5: Group View':'F5: Ledger View',toggle);
    command('chart-create','Create Master',create);
    if(flat)command('chart-filter','F4: Group',showFilter);
    const rail=document.querySelector('.function-rail'),button=document.createElement('button');
    button.type='button';
    button.dataset.salesRail='';
    button.textContent=flat?'F5: Group View':'F5: Ledger View';
    button.onclick=toggle;
    rail.insertBefore(button,rail.querySelector('.rail-space'));
    index=Math.max(0,rows.findIndex(row=>row.id===selectedId));
    highlight();
    main.focus();
  }

  // --- GROUPS CHART ---
  async function renderGroupsList(){
    const allGroups = api ? await api('/api/groups') : [];
    rows = [];
    const q = query.trim().toLowerCase();
    const visible = allGroups.filter(g => `${g.name} ${g.alias||''}`.toLowerCase().includes(q));

    function groupRow(g){
      const i=rows.push(g)-1;
      const indent = g.parent_name ? '&nbsp;&nbsp;&nbsp;&nbsp;' : '';
      return `<tr data-chart-row="${i}"><td>${indent}<button type="button" data-chart-group-id="${g.id}">${escapeHtml(g.name)}${g.alias?` <small>(${escapeHtml(g.alias)})</small>`:''}</button></td><td>${escapeHtml(g.parent_name || 'Primary')}</td><td>${escapeHtml(g.nature || '')}</td><td>${g.is_builtin ? 'Yes' : 'No'}</td></tr>`;
    }

    const contents = `<table class="chart-table chart-flat">
      <thead><tr><th>Name of Group</th><th>Under</th><th>Nature</th><th>Built-in</th></tr></thead>
      <tbody>${visible.map(groupRow).join('')}</tbody>
    </table>`;

    setScreen('Chart of Accounts','chart-groups','↑ ↓ Enter: alter/view · Esc: back');
    main.innerHTML=`<section class="chart-report">
      <div class="chart-report-heading"><strong>List of Groups</strong><label for="chart-search">Search <input id="chart-search" value="${escapeHtml(query)}" autocomplete="off"></label></div>
      <div class="chart-scroll">${contents}${rows.length?'':'<p class="empty-report">No groups match.</p>'}</div>
      <div class="chart-count"><strong>${rows.length} Group(s)</strong><span>Accounting hierarchy</span></div>
    </section>`;

    main.querySelectorAll('[data-chart-row]').forEach((row,i)=>{
      const button=row.querySelector('button');
      button.onclick=()=>alter(rows[i].id);
      button.onfocus=()=>highlight(i);
    });
    main.querySelector('#chart-search').addEventListener('input',event=>{
      const pos=event.target.selectionStart;
      query=event.target.value;
      renderGroupsList();
      const s=main.querySelector('#chart-search');
      s.focus();
      s.setSelectionRange(pos,pos);
    });
    index=0;
    highlight();
    main.focus();
  }

  // --- COST CATEGORIES CHART ---
  async function renderCategoriesList(){
    const categories = api ? await api('/api/cost-categories') : [];
    rows = [];
    const q = query.trim().toLowerCase();
    const visible = categories.filter(c => `${c.name} ${c.alias||''}`.toLowerCase().includes(q));

    function catRow(c){
      const i=rows.push(c)-1;
      return `<tr data-chart-row="${i}"><td><button type="button" data-chart-cat-id="${c.id}">${escapeHtml(c.name)}${c.alias?` <small>(${escapeHtml(c.alias)})</small>`:''}</button></td><td>${c.allocate_revenue ? 'Yes' : 'No'}</td><td>${c.allocate_non_revenue ? 'Yes' : 'No'}</td></tr>`;
    }

    const contents = `<table class="chart-table chart-flat">
      <thead><tr><th>Name of Cost Category</th><th>Allocate Revenue</th><th>Allocate Non-Revenue</th></tr></thead>
      <tbody>${visible.map(catRow).join('')}</tbody>
    </table>`;

    setScreen('Chart of Accounts','chart-cost-categories','↑ ↓ Enter: alter/view · Esc: back');
    main.innerHTML=`<section class="chart-report">
      <div class="chart-report-heading"><strong>List of Cost Categories</strong><label for="chart-search">Search <input id="chart-search" value="${escapeHtml(query)}" autocomplete="off"></label></div>
      <div class="chart-scroll">${contents}${rows.length?'':'<p class="empty-report">No cost categories match.</p>'}</div>
      <div class="chart-count"><strong>${rows.length} Cost Category(ies)</strong></div>
    </section>`;

    main.querySelectorAll('[data-chart-row]').forEach((row,i)=>{
      const button=row.querySelector('button');
      button.onclick=()=>alter(rows[i].id);
      button.onfocus=()=>highlight(i);
    });
    main.querySelector('#chart-search').addEventListener('input',event=>{
      const pos=event.target.selectionStart;
      query=event.target.value;
      renderCategoriesList();
      const s=main.querySelector('#chart-search');
      s.focus();
      s.setSelectionRange(pos,pos);
    });
    index=0;
    highlight();
    main.focus();
  }

  // --- COST CENTRES CHART ---
  async function renderCentresList(){
    const [categories, centres] = api ? await Promise.all([api('/api/cost-categories'), api('/api/cost-centres')]) : [[], []];
    rows = [];
    const q = query.trim().toLowerCase();
    const visible = centres.filter(c => `${c.name} ${c.alias||''} ${c.category_name||''}`.toLowerCase().includes(q));

    let contents = '<table class="chart-table chart-grouped"><tbody>';
    for(const cat of categories){
      const catCentres = visible.filter(c => c.category_id === cat.id);
      contents += `<tr class="chart-parent"><th>${escapeHtml(cat.name)}</th></tr>`;
      for(const c of catCentres){
        const i=rows.push(c)-1;
        const indent = c.parent_name ? '&nbsp;&nbsp;&nbsp;&nbsp;' : '';
        contents += `<tr data-chart-row="${i}"><td>${indent}<button type="button" data-chart-centre-id="${c.id}">${escapeHtml(c.name)}${c.alias?` <small>(${escapeHtml(c.alias)})</small>`:''}</button></td></tr>`;
      }
    }
    contents += '</tbody></table>';

    setScreen('Chart of Accounts','chart-cost-centres','↑ ↓ Enter: alter/view · Esc: back');
    main.innerHTML=`<section class="chart-report">
      <div class="chart-report-heading"><strong>List of Cost Centres</strong><label for="chart-search">Search <input id="chart-search" value="${escapeHtml(query)}" autocomplete="off"></label></div>
      <div class="chart-scroll">${contents}${rows.length?'':'<p class="empty-report">No cost centres match.</p>'}</div>
      <div class="chart-count"><strong>${rows.length} Cost Centre(s)</strong></div>
    </section>`;

    main.querySelectorAll('[data-chart-row]').forEach((row,i)=>{
      const button=row.querySelector('button');
      button.onclick=()=>alter(rows[i].id);
      button.onfocus=()=>highlight(i);
    });
    main.querySelector('#chart-search').addEventListener('input',event=>{
      const pos=event.target.selectionStart;
      query=event.target.value;
      renderCentresList();
      const s=main.querySelector('#chart-search');
      s.focus();
      s.setSelectionRange(pos,pos);
    });
    index=0;
    highlight();
    main.focus();
  }

  function toggle(){flat=!flat;filter='all';run(renderList);}

  function showFilter(){
    if(busy||!flat||document.querySelector('dialog'))return;
    const dialog=document.createElement('dialog');
    dialog.id='chart-group-dialog';
    dialog.className='native-entry-dialog voucher-type-dialog';
    dialog.setAttribute('aria-labelledby','chart-group-heading');
    dialog.innerHTML='<form><h2 id="chart-group-heading">Under Group</h2><input id="chart-group-search" autocomplete="off" aria-label="Name of Group"><div class="selection-heading">List of Groups</div><div id="chart-group-options" role="listbox"></div><div class="details-commands"><button type="button" id="chart-cancel-group">Back <small>Esc</small></button><button type="submit">Accept <small>Enter</small></button></div></form>';
    document.body.append(dialog);
    const search=dialog.querySelector('input'),options=dialog.querySelector('#chart-group-options');
    let choices=[],selected=0;
    const error=document.createElement('div');
    error.className='details-error';
    error.id='chart-group-error';
    error.setAttribute('role','alert');
    options.after(error);

    function draw(){
      choices=[{value:'all',name:'All Items'},...groups.filter(item=>item.name.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()))];
      options.innerHTML=choices.map((item,i)=>`<button type="button" role="option" class="${i===selected?'selected':''}" data-chart-group="${escapeHtml(item.value)}">${escapeHtml(item.name)}</button>`).join('');
      options.querySelectorAll('button').forEach((button,i)=>button.onclick=()=>{selected=i;accept();});
    }

    function close(){dialog.close();dialog.remove();main.focus();}
    function accept(){
      if(selected===0&&search.value.trim()&&search.value.trim().toLocaleLowerCase()!=='all items'){
        error.textContent='Select a matching group with the arrow keys, or clear the search for All Items.';
        return;
      }
      filter=choices[selected].value;
      close();
      run(renderList);
    }

    search.oninput=()=>{selected=0;error.textContent='';draw();};
    dialog.querySelector('form').onsubmit=event=>{event.preventDefault();accept();};
    dialog.querySelector('#chart-cancel-group').onclick=close;
    dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    search.onkeydown=event=>{
      if(['ArrowDown','ArrowUp'].includes(event.key)){
        event.preventDefault();
        event.stopPropagation();
        selected=Math.max(0,Math.min(choices.length-1,selected+(event.key==='ArrowDown'?1:-1)));
        draw();
      }
    };
    draw();
    selected=Math.max(0,choices.findIndex(item=>item.value===filter));
    draw();
    dialog.showModal();
    search.focus();
  }

  function goBack(){
    if(['chart-ledgers','chart-groups','chart-cost-categories','chart-cost-centres'].includes(getView())){
      run(renderMasters);
    } else {
      renderGateway(2);
    }
  }

  function onKey(event){
    const v=getView();
    if(!['chart-ledgers','chart-masters','chart-groups','chart-cost-categories','chart-cost-centres'].includes(v))return false;
    if(busy){event.preventDefault();return true;}
    if(event.ctrlKey||event.altKey||event.metaKey)return false;

    if(v==='chart-masters'){
      if(!main.contains(event.target)) return false;
      const buttons=Array.from(main.querySelectorAll('.master-menu-content button'));
      const activeBtn=document.activeElement;
      const currIdx=buttons.indexOf(activeBtn);
      if(['ArrowDown','ArrowUp'].includes(event.key)){
        event.preventDefault();
        const nextIdx=(currIdx+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;
        buttons.forEach((b,i)=>b.classList.toggle('selected',i===nextIdx));
        buttons[nextIdx].focus();
        return true;
      }
      if(event.key==='Enter'){
        event.preventDefault();
        if(activeBtn&&activeBtn.onclick)activeBtn.onclick();
        else openList();
        return true;
      }
      return false;
    }

    if(event.key==='F5'&&v==='chart-ledgers'){event.preventDefault();toggle();return true;}
    if(event.key==='F4'&&v==='chart-ledgers'&&flat){event.preventDefault();showFilter();return true;}
    if(event.target.id==='chart-search'&&!['ArrowDown','ArrowUp','Enter'].includes(event.key))return false;

    if(['ArrowDown','ArrowUp','Enter'].includes(event.key)&&main.contains(event.target)){
      event.preventDefault();
      if(event.key==='Enter')alter();
      else highlight(index+(event.key==='ArrowDown'?1:-1),true);
      return true;
    }
    if(['Home','End'].includes(event.key)&&main.contains(event.target)){
      event.preventDefault();
      highlight(event.key==='Home'?0:rows.length-1,true);
      return true;
    }
    if(event.key.length===1&&/^[a-z0-9]$/i.test(event.key)&&main.contains(event.target)){
      const next=rows.map((_,offset)=>(index+offset+1)%rows.length).find(i=>rows[i].name.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()));
      if(next!==undefined)highlight(next,true);
      event.preventDefault();
      return true;
    }
    return false;
  }

  return {open,goBack,onKey,isSaving:()=>busy};
}
