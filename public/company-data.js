// Original Bookr portable backup UI. Saving a restore always creates a new
// company; the source file and existing companies are never import targets.
export function createCompanyDataWorkspace({main,hint,api,setScreen,getBook,getView,refreshBook,renderGateway,escapeHtml,askDialog,isBusy,isDirty,activeId,onSelect}){
  const views=['company-data-menu','company-backup','company-restore'],limit=25*1024*1024;
  let busy=false,switching=false,index=0,bundle=null,fileName='';
  const supported=()=>getBook()?.capabilities?.company_backup===true;
  const error=message=>{const box=main.querySelector('#company-data-error');if(box)box.textContent=message;else hint.textContent=message;};
  const dirty=()=>getView()==='company-restore'&&Boolean(fileName||main.querySelector('#restore-company-name')?.value);
  function setBusy(value){busy=value;if(value)main.setAttribute('aria-busy','true');else main.removeAttribute('aria-busy');main.querySelectorAll('[data-data-control]').forEach(control=>control.disabled=value);}
  async function run(action){if(busy||switching)return;setBusy(true);try{await refreshBook();await action();}catch(failure){error(failure.message);}finally{setBusy(false);}}
  function panel(title,contents){return `<section class="company-data-panel"><h2>${title}</h2>${contents}<p id="company-data-error" class="company-error" role="alert"></p></section>`;}
  function menu(){
    setScreen('Company Data','company-data-menu','↑ ↓ Enter: open · Esc: Gateway');index=0;
    main.innerHTML=`<section id="company-data-menu" class="master-menu company-menu"><div class="gateway-menu-title">Company Data</div><div class="master-menu-content"><h2 class="menu-heading">COMPANY DATA</h2><button type="button" id="backup-company" class="selected" data-data-action="0">Backup Company</button><button type="button" id="restore-company" data-data-action="1">Restore as New Company</button><p>${escapeHtml(getBook().company)}</p><p id="company-data-error" class="company-error" role="alert"></p></div></section>`;
    main.querySelector('#backup-company').onclick=()=>run(openBackup);main.querySelector('#restore-company').onclick=openRestore;
    for(const [i,button]of [...main.querySelectorAll('[data-data-action]')].entries())button.onfocus=()=>highlight(i);
    main.querySelector('#backup-company').focus();
  }
  function highlight(next){index=(next+2)%2;main.querySelectorAll('[data-data-action]').forEach((button,i)=>button.classList.toggle('selected',i===index));}
  function openMenu(){
    if(!supported()||isBusy()||document.querySelector('dialog'))return;
    const open=()=>run(menu);if(isDirty())askDialog('Discard unsaved changes and open Company Data?',open,'Discard');else open();
  }
  async function openBackup(){
    const profile=await api('/api/companies/'+activeId);
    setScreen('Company Backup','company-backup','Enter: download backup · Esc: Company Data');
    main.innerHTML=panel('Backup Company',`<div id="company-backup"><dl><dt>Company</dt><dd id="backup-company-name">${escapeHtml(profile.name)}</dd><dt>Includes</dt><dd>All dates: company details, ledgers, vouchers and bill allocations.</dd><dt>File</dt><dd>Bookr backup (.json)</dd></dl><div class="company-data-actions"><button type="button" id="company-data-back" data-data-control>Back <small>Esc</small></button><button type="button" id="download-company-backup" data-data-control>Download Backup</button></div></div>`);
    main.querySelector('#company-data-back').onclick=back;main.querySelector('#download-company-backup').onclick=()=>run(download);main.querySelector('#download-company-backup').focus();
  }
  async function download(){
    error('');const saved=await api('/api/companies/'+activeId+'/backup');
    const slug=saved.company.name.normalize('NFKD').replace(/[^a-z0-9_-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,60)||'company';
    const link=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(saved)],{type:'application/json'}));
    link.href=url;link.download='Bookr-'+slug+'-'+saved.created_at.slice(0,10)+'.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    main.querySelector('#backup-company-name').textContent=saved.company.name;hint.textContent='Downloaded backup for '+saved.company.name+'.';
  }
  function openRestore(){
    if(busy||switching)return;bundle=null;fileName='';
    setScreen('Restore Company','company-restore','Choose backup and new name · Ctrl+A: restore · Esc: back');
    main.innerHTML=panel('Restore as New Company',`<form id="company-restore-form" novalidate autocomplete="off"><label for="restore-company-file">Bookr backup file</label><input id="restore-company-file" type="file" accept=".json,application/json" data-data-control><p id="restore-file-name" class="company-data-file-name"></p><dl><dt>Source company</dt><dd id="restore-source-company">Choose a backup file</dd></dl><label for="restore-company-name">New company name</label><input id="restore-company-name" maxlength="120" data-data-control><p>The backup is restored into a new company.</p><div class="company-data-actions"><button type="button" id="company-data-back" data-data-control>Back <small>Esc</small></button><button type="submit" id="restore-company-accept" data-data-control>Restore <small>Ctrl+A</small></button></div></form>`);
    main.querySelector('#restore-company-file').onchange=loadFile;main.querySelector('#company-data-back').onclick=back;
    main.querySelector('form').onsubmit=event=>{event.preventDefault();confirmRestore();};main.querySelector('#restore-company-file').focus();
  }
  async function loadFile(){
    if(busy||switching)return;bundle=null;const file=main.querySelector('#restore-company-file').files[0];fileName=file?.name??'';
    main.querySelector('#restore-file-name').textContent=fileName;main.querySelector('#restore-source-company').textContent='Choose a backup file';error('');if(!file)return;
    setBusy(true);
    try{
      if(file.size>limit)throw new Error('Choose a Bookr backup file no larger than 25 MB.');
      let parsed;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer()));}catch{throw new Error('Choose a valid UTF-8 Bookr backup file.');}
      if(!parsed||parsed.format!=='bookr.company'||parsed.version!==1||typeof parsed.company?.name!=='string'||!parsed.company.name.trim()||parsed.company.name.length>120)throw new Error('Choose a supported Bookr backup file.');
      bundle=parsed;main.querySelector('#restore-source-company').textContent=parsed.company.name;
    }catch(failure){error(failure.message);}finally{setBusy(false);}
    main.querySelector(bundle?'#restore-company-name':'#restore-company-file').focus();
  }
  function confirmRestore(){
    if(busy||switching||getView()!=='company-restore'||document.querySelector('dialog'))return;error('');
    if(!bundle){error('Choose a valid Bookr backup file.');main.querySelector('#restore-company-file').focus();return;}
    const field=main.querySelector('#restore-company-name'),name=field.value.trim();
    if(!name){error('Enter a new company name.');field.focus();return;}
    askDialog('Restore this backup as a new company?',()=>run(async()=>{
      const restored=await api('/api/companies/restore',{method:'POST',body:JSON.stringify({name,bundle})});
      try{onSelect(restored.id);switching=true;}catch{throw new Error('Company restored as '+restored.name+'. Select it from Company to open its books.');}
    }),'Restore');
  }
  function back(){
    if(busy||switching||document.querySelector('dialog'))return;
    const leave=()=>getView()==='company-data-menu'?renderGateway():menu();
    if(dirty())askDialog('Discard unsaved restore selection?',leave,'Discard');else leave();
  }
  function onKey(event){
    if(event.altKey&&!event.ctrlKey&&!event.metaKey&&event.key.toLowerCase()==='y'&&supported()){event.preventDefault();openMenu();return true;}
    if(!views.includes(getView()))return false;if(busy||switching){event.preventDefault();return true;}
    if(event.ctrlKey&&!event.altKey&&!event.metaKey&&event.key.toLowerCase()==='a'&&getView()==='company-restore'){event.preventDefault();confirmRestore();return true;}
    if(event.ctrlKey||event.altKey||event.metaKey)return false;
    if(event.key==='Escape'){event.preventDefault();back();return true;}
    if(getView()==='company-data-menu'&&['ArrowDown','ArrowUp','Home','End','Enter'].includes(event.key)){
      event.preventDefault();const buttons=[...main.querySelectorAll('[data-data-action]')];if(event.key==='Enter')buttons[index].click();else{highlight(event.key==='Home'?0:event.key==='End'?1:index+(event.key==='ArrowDown'?1:-1));buttons[index].focus();}return true;
    }
    if(getView()==='company-restore'&&event.key==='Enter'&&event.target.id==='restore-company-name'){event.preventDefault();confirmRestore();return true;}
    return false;
  }
  return {openMenu,onKey,back,dirty,isSaving:()=>busy||switching};
}
