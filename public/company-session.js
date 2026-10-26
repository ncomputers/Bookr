import {validCalendarDate} from './calendar-values.js';

const SESSION_KEY='bookr.company-session',LEGACY_KEY='bookr.company';
const check=(condition,message)=>{if(!condition)throw new Error(message);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const idValid=value=>value==='default'||typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
const fields=(value,names)=>object(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const none=()=>({loadedIds:[],activeId:null});
const validRevision=value=>Number.isSafeInteger(value)&&value>=0;
function storageValid(storage){check(storage&&['getItem','setItem','removeItem'].every(name=>typeof storage[name]==='function'),'Company session storage is unavailable.');}
function normalizePeriod(value){check(fields(value,['from','to'])&&validCalendarDate(value.from)&&validCalendarDate(value.to)&&value.from<=value.to,'Choose a valid ordered current period.');return {from:value.from,to:value.to};}
function normalizeFreshContext(value){
 check(fields(value,['date','revision','period'])&&validCalendarDate(value.date)&&validRevision(value.revision),'Choose a valid fresh company working context.');
 const period=normalizePeriod(value.period);check(value.date>=period.from&&value.date<=period.to,'The fresh working date must be within its retained period.');
 return {date:value.date,revision:value.revision,period};
}

// Synchronous browser storage has no multi-key transaction. Save prior bytes,
// commit in the caller's order, and roll back every changed key on failure.
// Persistent storage denial can also prevent rollback; never report success.
export function commitStorageWrites(storage,writes){
 storageValid(storage);check(Array.isArray(writes),'Choose valid session storage writes.');const keys=new Set();
 for(const row of writes){check(fields(row,['key','value'])&&typeof row.key==='string'&&row.key.length>0&&(row.value===null||typeof row.value==='string')&&!keys.has(row.key),'Choose each valid session storage key once.');keys.add(row.key);}
 const changes=writes.map(row=>{const previous=storage.getItem(row.key);check(previous===null||typeof previous==='string','Session storage returned an invalid value.');return {...row,previous};}).filter(row=>row.previous!==row.value);
 try{for(const row of changes){if(row.value===null)storage.removeItem(row.key);else storage.setItem(row.key,row.value);}}
 catch(cause){
  const rollbackErrors=[];for(const row of [...changes].reverse())try{if(row.previous===null)storage.removeItem(row.key);else storage.setItem(row.key,row.previous);}catch(error){rollbackErrors.push({key:row.key,message:error?.message??String(error)});}
  const failure=new Error(rollbackErrors.length?'Session storage commit failed and rollback could not finish.':'Session storage commit failed and was rolled back.',{cause});failure.name='CompanySessionStorageError';failure.rollbackErrors=rollbackErrors;throw failure;
 }
 return {changedKeys:changes.length};
}

// Loaded companies belong to this browser tab. Disk/company catalog rows are
// separate. Recreate this wrapper with a refreshed catalog order when needed.
export function createCompanySession({storage,catalogIds,initialId='default'}){
 storageValid(storage);check(Array.isArray(catalogIds)&&catalogIds.every(idValid)&&new Set(catalogIds).size===catalogIds.length,'Choose a valid ordered company catalog.');
 check(initialId===null||idValid(initialId),'Choose a valid initial company.');const catalog=[...catalogIds],available=new Set(catalog);
 const ordered=ids=>{const selected=new Set(ids);return catalog.filter(id=>selected.has(id));};
 function read(){
  try{
   const encoded=storage.getItem(SESSION_KEY);
   if(encoded!==null){
    const saved=JSON.parse(encoded);if(!fields(saved,['version','loadedIds','activeId'])||saved.version!==1||!Array.isArray(saved.loadedIds)||!saved.loadedIds.every(id=>idValid(id)&&available.has(id))||new Set(saved.loadedIds).size!==saved.loadedIds.length)return none();
    if(saved.loadedIds.length===0)return saved.activeId===null?none():none();
    if(!idValid(saved.activeId)||!saved.loadedIds.includes(saved.activeId))return none();
    return {loadedIds:ordered(saved.loadedIds),activeId:saved.activeId};
   }
   const legacy=storage.getItem(LEGACY_KEY);
   // Literal "null" is deliberate: removing the key would let older clients
   // silently reopen default through their missing-key fallback.
   if(legacy!==null)return idValid(legacy)&&available.has(legacy)?{loadedIds:[legacy],activeId:legacy}:none();
   return initialId!==null&&available.has(initialId)?{loadedIds:[initialId],activeId:initialId}:none();
  }catch{return none();}
 }
 function persist(next,extra=[]){
  commitStorageWrites(storage,[...extra,{key:LEGACY_KEY,value:next.activeId??'null'},{key:SESSION_KEY,value:JSON.stringify({version:1,loadedIds:next.loadedIds,activeId:next.activeId})}]);
  return {loadedIds:[...next.loadedIds],activeId:next.activeId};
 }
 return {read,choose(options={}){
  check(object(options)&&Object.keys(options).every(key=>key==='includeUnloaded')&&(options.includeUnloaded===undefined||typeof options.includeUnloaded==='boolean'),'Choose loaded companies or the disk catalog.');
  return options.includeUnloaded?[...catalog]:read().loadedIds;
 },select(id,options={}){
  check(idValid(id)&&available.has(id),'Choose an existing company from the catalog.');
  check(object(options)&&Object.keys(options).every(key=>key==='freshContext'),'Only a typed fresh working context can accompany selection.');
  const previous=read(),freshLoad=!previous.loadedIds.includes(id),hasFresh=Object.hasOwn(options,'freshContext');
  check(!hasFresh||freshLoad,'An already loaded company must not reset its working context.');
  const extra=hasFresh?[{key:'bookr.working-date.'+id,value:JSON.stringify(normalizeFreshContext(options.freshContext))}]:[];
  return {...persist({loadedIds:ordered([...previous.loadedIds,id]),activeId:id},extra),freshLoad};
 },shut(id=read().activeId){
  const previous=read();if(id===null)return previous;
  check(idValid(id)&&available.has(id),'Choose a valid company to shut.');check(previous.loadedIds.includes(id),'The company is not loaded.');
  const loadedIds=previous.loadedIds.filter(value=>value!==id),activeId=previous.activeId===id?(loadedIds[0]??null):previous.activeId;
  // Keep the closed company's date/period bytes. A future fresh select may
  // replace only its date context using a scoped summary and retained period.
  return persist({loadedIds,activeId});
 }};
}

// Original web reset model covering the observed empty/posted/clipped cases:
// seed from max(Books, LastEntry), then clip to the retained selected period.
// This does not recover a universal native algorithm or recompute its FY.
export function reopenWorkingDate({booksFrom,lastEntry=null,period}={}){
 check(validCalendarDate(booksFrom)&&(lastEntry===null||validCalendarDate(lastEntry)),'Choose valid Books and last-entry dates.');const selected=normalizePeriod(period),seed=lastEntry!==null&&lastEntry>booksFrom?lastEntry:booksFrom;
 return seed<selected.from?selected.from:seed>selected.to?selected.to:seed;
}
