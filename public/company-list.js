export function companyName(companies,id){
  return companies.find(company=>company.id===id)?.name ?? '';
}

export function companyList({companies,loadedIds,mode,query='',preferredId=null}){
  const loaded=new Set(loadedIds),search=query.trim().toLocaleLowerCase();
  const rows=companies.filter(company=>(mode==='select'||loaded.has(company.id))&&company.name.toLocaleLowerCase().includes(search))
    .sort((a,b)=>a.name.localeCompare(b.name,'en',{sensitivity:'base'}));
  const index=rows.length?Math.max(0,rows.findIndex(company=>company.id===preferredId)):-1;
  return {rows,index,selectedId:rows[index]?.id ?? null};
}
