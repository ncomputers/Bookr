import {readFileSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {compactCountrySuggestions} from '../public/company-country-catalog.js';
import {indiaStateSuggestions} from '../public/india-states.js';

export class GeographyError extends Error{constructor(message,status=400){super(message);this.name='GeographyError';this.status=status;}}
const check=(value,message,status)=>{if(!value)throw new GeographyError(message,status);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const same=(a,b)=>a.toLocaleLowerCase()===b.toLocaleLowerCase();
const keys=(value,expected)=>object(value)&&Object.keys(value).length===expected.length&&expected.every(key=>Object.hasOwn(value,key));
function name(value,canonical=false){check(typeof value==='string'&&!/[\u0000-\u001f\u007f]/.test(value),'Enter a single-line name.');const trimmed=value.trim();check(trimmed.length>0&&trimmed.length<=120&&(!canonical||trimmed===value),'Enter a name from 1 to 120 characters without outer spaces.');return trimmed;}
const builtins=()=>({countries:[...compactCountrySuggestions],states:Object.assign(Object.create(null),{India:[...indiaStateSuggestions],UK:['Not Applicable','England','Northern Ireland','Scotland','Wales']})});
function countryKey(catalog,value){const requested=name(value);return catalog.countries.find(country=>same(country,requested)||country==='UK'&&same(requested,'United Kingdom'));}
function addCountry(catalog,value){check(!countryKey(catalog,value),'This country already exists.',409);catalog.countries.push(value);catalog.states[value]=['Not Applicable'];}
function addState(catalog,country,value){const key=countryKey(catalog,country);check(key,'Create or choose an existing country first.');const states=catalog.states[key]??(catalog.states[key]=['Not Applicable']);check(!states.some(state=>same(state,value)),'This state or region already exists.',409);states.push(value);return key;}

// Original application-wide address suggestions, separate from company books.
// Reads never initialize a file; synchronous mutation rereads before replacing.
export class GeographyStore{
 constructor(file){this.file=file;}
 read(){
  let raw;try{raw=readFileSync(this.file,'utf8');}catch(error){if(error.code==='ENOENT')return {version:1,countries:[],states:[]};throw error;}
  try{const data=JSON.parse(raw);check(keys(data,['version','countries','states'])&&data.version===1&&Array.isArray(data.countries)&&Array.isArray(data.states),'Unsupported address catalog.');const catalog=builtins();for(const country of data.countries)addCountry(catalog,name(country,true));for(const state of data.states){check(keys(state,['country','name']),'Unsupported address catalog.');const value=name(state.name,true),country=name(state.country,true),key=countryKey(catalog,country);check(key===country,'Unsupported address catalog country.');addState(catalog,country,value);}return data;}catch{throw new GeographyError('The stored address catalog is invalid. It has not been changed.');}
 }
 project(data){const catalog=builtins();for(const country of data.countries)addCountry(catalog,country);for(const state of data.states)addState(catalog,state.country,state.name);return catalog;}
 list(){return this.project(this.read());}
 save(data){const temporary=this.file+'.'+randomUUID()+'.tmp';let created=false;try{writeFileSync(temporary,JSON.stringify(data,null,2)+'\n',{flag:'wx'});created=true;renameSync(temporary,this.file);created=false;}finally{if(created)unlinkSync(temporary);}}
 createCountry(input){check(keys(input,['name']),'Choose only a country name.');const value=name(input.name),data=this.read(),catalog=this.project(data);addCountry(catalog,value);data.countries.push(value);this.save(data);return {name:value,catalog};}
 createState(input){check(keys(input,['country','name']),'Choose a country and a state name.');const value=name(input.name),data=this.read(),catalog=this.project(data),country=addState(catalog,input.country,value);data.states.push({country,name:value});this.save(data);return {country,name:value,catalog};}
}
