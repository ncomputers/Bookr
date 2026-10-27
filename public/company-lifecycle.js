import {createCompanySession,reopenWorkingDate} from './company-session.js';
import {createWorkingDateContext} from './working-date.js';

// This tab owns only its selection and working context. Opening or shutting a
// company never changes the server's catalog, accounting rows or other tabs.
export function createCompanyLifecycle({storage,api,reload,beforeSelect=null}){
  let catalog=[],capabilities={};
  const session=()=>createCompanySession({storage,catalogIds:catalog.map(row=>row.id)});
  async function refreshCatalog(){
    const result=await api('/api/companies');
    catalog=[...result.companies].sort((a,b)=>a.name.localeCompare(b.name,'en',{sensitivity:'base'}));
    return catalog;
  }
  return {
    refreshCatalog,
    async initialize(){
      await refreshCatalog();capabilities=(await api('/api/capabilities')).capabilities;
      return session().read();
    },
    read:()=>session().read(),
    capabilities:()=>({...capabilities}),
    async loadedSummaries(){
      return Promise.all(session().read().loadedIds.map(id=>api('/api/companies/'+id+'/summary')));
    },
    async select(id){
      await refreshCatalog();if(beforeSelect)await beforeSelect(id);const current=session(),fresh=!current.read().loadedIds.includes(id);
      let options={};
      if(fresh){
        const summary=await api('/api/companies/'+id+'/summary'),calendar=summary.calendar;
        const context=createWorkingDateContext({companyId:id,booksFrom:calendar.books_from,period:{from:calendar.financial_year_from,to:calendar.financial_year_to},storage});
        const saved=context.current(),period=context.period();
        if(saved.revision===Number.MAX_SAFE_INTEGER)throw new Error('The company working context cannot be reopened.');
        options={freshContext:{date:reopenWorkingDate({booksFrom:calendar.books_from,lastEntry:summary.last_voucher_date,period}),revision:saved.revision+1,period}};
      }
      const next=current.select(id,options);reload();return next;
    },
    shut(id){const next=session().shut(id);reload();return next;}
  };
}
