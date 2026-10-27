// Catalog projection never adds typed or saved text to the available options.
// Raw draft preservation and metadata validation remain separate from selection.
export function filterCatalogRows(rows,query,label=row=>row.value??row.name??row){
 const needle=(query??'').trim().toLocaleLowerCase();
 return rows.filter(row=>!needle||String(label(row)).toLocaleLowerCase().includes(needle));
}

export function buildTextChoices({values,opening='',query=null}){
 const catalog=[...new Set(values)].map(value=>({value,typed:false}));
 const rows=filterCatalogRows(catalog,query,row=>row.value);
 const preferred=query===null?rows.findIndex(row=>row.value===opening):-1;
 return {rows,index:rows.length?Math.max(0,preferred):-1};
}

export function moveHighlight({index,delta,count}){
 return count?Math.max(0,Math.min(count-1,index+delta)):-1;
}

export function chooseDraftValue({entered,open,row,wholeForm=false}){
 if(wholeForm)return entered;
 return open&&row?row.value:entered;
}

export function nextCompanyAddressField({state,country}){
 const substantive=value=>value.trim()&&value.trim().toLocaleLowerCase()!=='not applicable';
 return substantive(state)&&substantive(country)?'pincode':'country';
}

export function escapeTextChoice({open,entered}){
 return !open?'delegate':entered?'clear':'close-and-back';
}
