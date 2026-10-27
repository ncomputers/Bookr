// Bind a saved profile without replacing controls, dates or controller state.
export const companyMetadataFields=Object.freeze(['name','mailing_name','address','state','country','pincode','telephone','mobile','fax','email','website']);

export function applyCompanyProfile({form,heading,profile,currencyControls=[]}){
 for(const key of companyMetadataFields)form.querySelector('#company-'+key.replaceAll('_','-')).value=profile[key];
 form.dataset.companyId=profile.id;form.dataset.companyRevision=String(profile.revision);
 heading.textContent=profile.name;
 for(const {control,key}of currencyControls)control.value=profile[key];
 form.querySelector('#company-country').dispatchEvent(new Event('input'));
}
