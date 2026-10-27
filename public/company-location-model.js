import {indiaStateSuggestions} from './india-states.js';
import {compactCountrySuggestions} from './company-country-catalog.js';
export {compactCountrySuggestions} from './company-country-catalog.js';

const unspecified=Object.freeze(['Not Applicable']);
const ukRegions=Object.freeze(['Not Applicable','England','Northern Ireland','Scotland','Wales']);

// A mailing policy selects available suggestions; it does not validate or
// normalize existing custom geographic metadata.
export function companyLocationPolicy(country){
 const key=country.trim().toLocaleLowerCase();
 if(key==='uk'||key==='united kingdom')return {label:'Region',suggestions:ukRegions};
 return {label:'State',suggestions:key==='india'?indiaStateSuggestions:unspecified};
}

// The nested search is independent from both accepted Country and Region.
export function beginCountrySelection({country}){
 return {mode:'country',state:'',country,query:''};
}

export function searchCountrySelection(draft,query){
 return {...draft,query};
}

export function escapeCountrySelection(draft){
 return draft.query?{...draft,query:''}:{...draft,mode:'region',query:''};
}

export function acceptCountrySelection(draft,country){
 if(!compactCountrySuggestions.includes(country))throw new Error('Choose a matching country from the catalog.');
 return {...draft,mode:'region',state:'',country,query:''};
}

export function locationMetadata(draft){
 if(draft.mode==='country')throw new Error('Choose a country or go back before saving.');
 return {state:draft.state,country:draft.country};
}
