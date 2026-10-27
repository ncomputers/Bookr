import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {mkdirSync,existsSync,writeFileSync,unlinkSync,realpathSync} from 'node:fs';
import {resolve,dirname,basename,extname,relative,isAbsolute} from 'node:path';
import {Book,BookError} from './accounting.mjs';
import {LEGACY_COMPANY_DATES,normalizeCompanyCalendar} from './company-calendar.mjs';
import {emptyCalendarBook} from './company-calendar-policy.mjs';
import {companyCurrency,normalizeCurrencyPatch} from '../public/company-currency.js';
import {requireCurrencyAwareness,requireCurrencyContext} from './company-currency-protocol.mjs';
import {companyMobileCallingCode,normalizeMobileCallingCode} from '../public/company-mobile-code.js';

export const companyDates=LEGACY_COMPANY_DATES;
const companyContacts=Object.freeze({telephone:'',mobile:'',fax:'',email:'',website:''});
const companyFields=Object.freeze({name:120,mailing_name:120,address:1000,state:120,country:120,pincode:20,telephone:120,mobile:120,fax:120,email:120,website:120,currency_symbol:12,currency_name:120,mobile_calling_code:8});
const check=(condition,message,status=400)=>{if(!condition)throw new BookError(message,status);};
function storedProfile(row){
  const details=JSON.parse(row.details);
  check(details&&typeof details==='object'&&!Array.isArray(details)&&!Object.hasOwn(details,'id')&&!Object.hasOwn(details,'revision'),'Unsupported stored company settings; this company has not been changed.');
  return {id:row.id,...companyContacts,...details,...companyCurrency(details),mobile_calling_code:companyMobileCallingCode(details),revision:row.revision};
}
function supportedProfile(profile){check(Object.keys(profile).every(key=>key==='id'||key==='revision'||Object.hasOwn(companyFields,key)||Object.hasOwn(companyDates,key)),'Unsupported stored company settings; this company has not been changed.');normalizeCompanyCalendar(Object.fromEntries(Object.keys(companyDates).map(key=>[key,profile[key]])));}
function bookConfiguration(profile,id){
 const calendar=normalizeCompanyCalendar(Object.fromEntries(Object.keys(companyDates).map(key=>[key,profile[key]])));
 return {companyName:profile.name,currency:companyCurrency(profile),calendar:Object.freeze(calendar),calendarConfigured:true,openingDate:calendar.books_from,companyPeriod:id==='default'?null:{from:calendar.books_from,to:calendar.financial_year_to}};
}
function bindBook(book,profile,id){
 book.companyName=profile.name;book.currency=companyCurrency(profile);
 if(Object.keys(companyDates).some(key=>book.calendar[key]!==profile[key]))Object.assign(book,bookConfiguration(profile,id));
 return book;
}
function metadata(input){
  check(input && typeof input==='object' && !Array.isArray(input),'Enter company details.');
  const fields=companyFields;
  check(Object.keys(input).every(key=>Object.hasOwn(fields,key) || Object.hasOwn(companyDates,key)),'Choose only company identity, mailing details and the supported book dates.');
  const result={};
  for(const [key,limit] of Object.entries(fields)){
    if(key.startsWith('currency_')||key==='mobile_calling_code')continue;
    const fallback=key==='mailing_name'?result.name:key==='country'?'India':key==='state'?'Not Applicable':'';
    const value=input[key]===undefined?fallback:input[key];
    check(typeof value==='string' && value.length<=limit,'Enter valid '+key.replaceAll('_',' ')+'.');result[key]=value.trim();
  }
  check(result.name.length>0,'Enter a company name.');
  const calendar=normalizeCompanyCalendar(Object.fromEntries(Object.keys(companyDates).filter(key=>Object.hasOwn(input,key)).map(key=>[key,input[key]])));
  return {...result,...calendar,...normalizeCurrencyPatch(Object.fromEntries(['currency_symbol','currency_name'].filter(key=>Object.hasOwn(input,key)).map(key=>[key,input[key]]))),mobile_calling_code:Object.hasOwn(input,'mobile_calling_code')?normalizeMobileCallingCode(input.mobile_calling_code):''};
}

// A request selects its own immutable company ID. There is no process-wide
// active-company pointer, so separate tabs/requests cannot switch each other.
export class CompanyStore{
  constructor({defaultFile}){
    check(typeof defaultFile==='string' && defaultFile.trim() && defaultFile!==':memory:','Choose a database file for the default company.');
    this.defaultFile=resolve(defaultFile);const stem=basename(this.defaultFile,extname(this.defaultFile));
    this.booksDirectory=resolve(dirname(this.defaultFile),stem+'.companies');
    this.catalogFile=resolve(dirname(this.defaultFile),stem+'.companies.sqlite');
    mkdirSync(dirname(this.defaultFile),{recursive:true});mkdirSync(this.booksDirectory,{recursive:true});
    this.books=new Map();this.closed=false;
    this.catalog=new DatabaseSync(this.catalogFile);
    try{
      this.catalog.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
        CREATE TABLE IF NOT EXISTS companies(id TEXT PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE,details TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1 CHECK(typeof(revision)='integer' AND revision>=1));
        CREATE TABLE IF NOT EXISTS catalog_binding(slot INTEGER PRIMARY KEY CHECK(slot=1),default_file TEXT NOT NULL);`);
      const resolved=existsSync(this.defaultFile)?realpathSync(this.defaultFile):resolve(realpathSync(dirname(this.defaultFile)),basename(this.defaultFile));
      const binding=process.platform==='win32'?resolved.toLowerCase():resolved;
      this.catalog.exec('BEGIN IMMEDIATE');
      try{
        const previous=this.catalog.prepare('SELECT default_file FROM catalog_binding WHERE slot=1').get();
        check(!previous || previous.default_file===binding,'This company catalog belongs to a different default database.',409);
        const knownDefault=this.catalog.prepare("SELECT id FROM companies WHERE id='default'").get();
        check(!knownDefault || existsSync(this.defaultFile),'Default company data is missing. Restore the existing database before reopening; an empty replacement has not been created.',404);
        if(!this.catalog.prepare('PRAGMA table_info(companies)').all().some(column=>column.name==='revision'))this.catalog.exec("ALTER TABLE companies ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK(typeof(revision)='integer' AND revision>=1)");
        this.catalog.prepare('INSERT OR IGNORE INTO catalog_binding(slot,default_file) VALUES(1,?)').run(binding);
        this.catalog.exec('COMMIT');
      }catch(error){this.catalog.exec('ROLLBACK');throw error;}
      const profile=metadata({name:'Bookr Demo Fictional'});
      this.catalog.prepare('INSERT OR IGNORE INTO companies(id,name,details) VALUES(?,?,?)').run('default',profile.name,JSON.stringify(profile));
      const initial=this.profile('default');
      this.books.set('default',bindBook(new Book(this.defaultFile,{companyName:initial.name,financialYearFrom:initial.financial_year_from,booksFrom:initial.books_from,financialYearTo:initial.financial_year_to,enforceCompanyPeriod:false}),initial,'default'));
    }catch(error){this.catalog.close();throw error;}
  }
  ensureOpen(){check(!this.closed,'Company storage is closed.',503);}
  validId(id){check(typeof id==='string' && (id==='default' || /^[a-f0-9]{32}$/.test(id)),'Choose a valid company ID.');return id;}
  fileFor(id){
    this.validId(id);if(id==='default')return this.defaultFile;
    const file=resolve(this.booksDirectory,id+'.sqlite'),part=relative(this.booksDirectory,file);
    check(part && !part.startsWith('..') && !isAbsolute(part),'Invalid company data path.');return file;
  }
  list(){this.ensureOpen();return this.catalog.prepare("SELECT id,details,revision FROM companies ORDER BY CASE WHEN id='default' THEN 0 ELSE 1 END,name COLLATE NOCASE").all().map(storedProfile);}
  profile(id='default'){
    this.ensureOpen();this.validId(id);const row=this.catalog.prepare('SELECT id,details,revision FROM companies WHERE id=?').get(id);
    check(row,'Company was not found. Select an existing company.',404);return storedProfile(row);
  }
  summary(id){
    this.ensureOpen();this.validId(id);const profile=this.profile(id),file=this.fileFor(id);
    check(existsSync(file),'Company data is missing. The existing company has not been replaced.',404);
    // A lifecycle preview must not open a Book, migrate its schema or reseed it.
    const snapshot=new DatabaseSync(file,{readOnly:true});
    try{
      return {profile,calendar:Object.fromEntries(Object.keys(companyDates).map(key=>[key,profile[key]])),last_voucher_date:snapshot.prepare('SELECT MAX(date) AS date FROM vouchers').get().date};
    }finally{snapshot.close();}
  }
  calendarEditability(id){
    this.ensureOpen();this.validId(id);const profile=this.profile(id);supportedProfile(profile);const file=this.fileFor(id);
    check(existsSync(file),'Company data is missing. The existing company has not been replaced.',404);
    const snapshot=new DatabaseSync(file,{readOnly:true});
    try{return {company_id:id,revision:profile.revision,editable:emptyCalendarBook(snapshot)};}finally{snapshot.close();}
  }
  book(id='default'){
    const profile=this.profile(id),file=this.fileFor(id);
    check(existsSync(file),'Company data is missing. The existing company has not been replaced.',404);
    if(!this.books.has(id))this.books.set(id,new Book(file,{companyName:profile.name,financialYearFrom:profile.financial_year_from,booksFrom:profile.books_from,financialYearTo:profile.financial_year_to,enforceCompanyPeriod:id!=='default'}));
    return bindBook(this.books.get(id),profile,id);
  }
  create(input,{initializeBook}={}){
    this.ensureOpen();check(initializeBook===undefined||typeof initializeBook==='function','Choose a valid internal company initializer.');
    check(initializeBook?.constructor.name!=='AsyncFunction','Company initialization must complete synchronously.');
    const profile=metadata(input),id=randomUUID().replaceAll('-',''),file=this.fileFor(id);let book,created=false;
    this.catalog.exec('BEGIN IMMEDIATE');
    try{
      check(!this.catalog.prepare('SELECT id FROM companies WHERE name=? COLLATE NOCASE').get(profile.name),'A company with this name already exists.',409);
      mkdirSync(this.booksDirectory,{recursive:true});writeFileSync(file,'',{flag:'wx'});created=true;
      book=new Book(file,{companyName:profile.name,financialYearFrom:profile.financial_year_from,booksFrom:profile.books_from,financialYearTo:profile.financial_year_to,enforceCompanyPeriod:true});
      bindBook(book,profile,id);
      if(initializeBook){const result=initializeBook(book);check(!result||typeof result.then!=='function','Company initialization must complete synchronously.');check(!book.db.isTransaction,'Company initialization left an unfinished transaction.');}
      this.catalog.prepare('INSERT INTO companies(id,name,details) VALUES(?,?,?)').run(id,profile.name,JSON.stringify(profile));
      this.catalog.exec('COMMIT');this.books.set(id,book);return {id,...profile,revision:1};
    }catch(error){
      this.catalog.exec('ROLLBACK');book?.close();
      if(created)for(const suffix of ['','-wal','-shm'])try{unlinkSync(file+suffix);}catch(cleanup){if(cleanup.code!=='ENOENT')throw error;}
      throw error;
    }
  }
  update(id,input){
    this.ensureOpen();this.validId(id);
    check(input && typeof input==='object' && !Array.isArray(input),'Enter company details.');
    check(Object.keys(input).every(key=>key==='revision' || Object.hasOwn(companyFields,key) || Object.hasOwn(companyDates,key)),'Choose only company identity, mailing details and the supported book dates.');
    check(Number.isSafeInteger(input.revision) && input.revision>0,'Reopen the company details before saving changes.',409);
    this.catalog.exec('BEGIN IMMEDIATE');let saved,locked=null,fileGuard=null,ownLock=false,configuration=null;
    try{
      const previous=this.profile(id);
      supportedProfile(previous);
      check(input.revision===previous.revision && previous.revision<Number.MAX_SAFE_INTEGER,'This company changed after you opened it. Reopen it before saving.',409);
      const {revision,...patch}=input,from=Object.hasOwn(input,'financial_year_from')?input.financial_year_from:previous.financial_year_from;
      const calendar=normalizeCompanyCalendar({financial_year_from:from,books_from:Object.hasOwn(input,'books_from')?input.books_from:from!==previous.financial_year_from?from:previous.books_from,...(Object.hasOwn(input,'financial_year_to')?{financial_year_to:input.financial_year_to}:{})});
      const values=metadata({...Object.fromEntries(Object.keys(companyFields).map(key=>[key,previous[key]])),...patch,...calendar});
      // A calling-code edit must not normalize an untouched legacy raw number.
      // Explicitly different mobile input retains the existing trim behavior.
      if(typeof previous.mobile==='string'&&(!Object.hasOwn(input,'mobile')||input.mobile===previous.mobile))values.mobile=previous.mobile;
      check(!this.catalog.prepare('SELECT id FROM companies WHERE name=? COLLATE NOCASE AND id<>?').get(values.name,id),'A company with this name already exists.',409);
      const changedCurrency=['currency_symbol','currency_name'].some(key=>values[key]!==previous[key]);
      if(changedCurrency||Object.keys(companyDates).some(key=>values[key]!==previous[key])){
        const file=this.fileFor(id),cached=this.books.get(id);check(existsSync(file),'Company data is missing. The existing company has not been replaced.',404);
        check(!cached?.db.isTransaction,'Finish the current book operation before changing company dates.',409);
        // A noncreating read handle pins the existing Windows file while the
        // cold writer connection opens. No Book constructor or migration runs.
        fileGuard=new DatabaseSync(file,{readOnly:true});locked=cached?.db??new DatabaseSync(file);ownLock=!cached;
        locked.exec('PRAGMA busy_timeout=3000');locked.exec('BEGIN IMMEDIATE');
        check(emptyCalendarBook(locked),changedCurrency?'Company currency labels can change only in empty financial books.':'Company dates can change only before financial entries or opening balances.');configuration=bookConfiguration(values,id);
      }
      this.catalog.prepare('UPDATE companies SET name=?,details=?,revision=revision+1 WHERE id=?').run(values.name,JSON.stringify(values),id);
      saved={id,...values,revision:previous.revision+1};this.catalog.exec('COMMIT');
    }catch(error){if(this.catalog.isTransaction)this.catalog.exec('ROLLBACK');throw error;}
    finally{if(locked?.isTransaction)locked.exec('ROLLBACK');if(ownLock)locked?.close();fileGuard?.close();}
    // Existing bank-holder text and all accounting tables stay untouched.
    const cached=this.books.get(id);if(cached){if(configuration)Object.assign(cached,configuration);else{cached.companyName=saved.name;cached.currency=companyCurrency(saved);}}return saved;
  }
  writeBook(id,headers,input,action,{monetary=false}={}){
    this.ensureOpen();this.validId(id);check(!this.catalog.isTransaction,'Finish the current company operation before saving.',409);
    // Same catalog→book writer order as empty-book profile changes. Keep the
    // fresh label check and synchronous accounting write inside this exclusion.
    this.catalog.exec('BEGIN IMMEDIATE');
    try{const profile=this.profile(id);requireCurrencyAwareness(headers,profile);if(monetary)requireCurrencyContext(headers,profile);const result=action(this.book(id),input);this.catalog.exec('COMMIT');return result;}
    catch(error){if(this.catalog.isTransaction)this.catalog.exec('ROLLBACK');throw error;}
  }
  close(){if(this.closed)return;this.closed=true;for(const book of this.books.values())book.close();this.books.clear();this.catalog.close();}
}
