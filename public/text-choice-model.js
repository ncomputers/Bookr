// Pure suggestions and observed input actions for an existing optional text
// field. Geographic validation and company confirmation belong to callers.
export function buildTextChoices({values,alwaysVisible=[],opening='',query=null,entered=query??opening}){
 const catalog=[...new Set(values)],pinned=new Set(alwaysVisible),all=catalog.map(value=>({value,typed:false}));
 if(opening&&!catalog.includes(opening)){
  const first=all.findIndex(row=>!pinned.has(row.value));
  all.splice(first<0?all.length:first,0,{value:opening,typed:false});
 }
 const needle=(query??'').trim().toLocaleLowerCase(),matches=needle?all.filter(row=>row.value.toLocaleLowerCase().includes(needle)):all;
 const rows=needle?[...all.filter(row=>pinned.has(row.value)),...matches.filter(row=>!pinned.has(row.value))]:all;
 if(needle&&!matches.length)rows.push({value:entered,typed:true});
 const substantive=rows.findIndex(row=>!pinned.has(row.value)&&catalog.includes(row.value)&&matches.some(match=>match.value===row.value));
 const preferred=query===null?rows.findIndex(row=>row.value===opening):needle?(substantive>=0?substantive:rows.findIndex(row=>row.typed||!pinned.has(row.value)&&matches.some(match=>match.value===row.value))):-1;
 return {rows,index:rows.length?Math.max(0,preferred):-1};
}

export function moveHighlight({index,delta,count}){
 return count?Math.max(0,Math.min(count-1,index+delta)):-1;
}

export function chooseDraftValue({entered,open,row,wholeForm=false}){
 return open&&row&&!(wholeForm&&!entered.trim())?row.value:entered;
}

export function nextCompanyAddressField({state,country}){
 const substantive=value=>value.trim()&&value.trim().toLocaleLowerCase()!=='not applicable';
 return substantive(state)&&substantive(country)?'pincode':'country';
}

export function escapeTextChoice({open,entered}){
 return !open?'delegate':entered?'clear':'close-and-back';
}
