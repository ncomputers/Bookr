import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {mkdirSync,existsSync,writeFileSync,unlinkSync,realpathSync} from 'node:fs';
import {resolve,dirname,basename,extname,relative,isAbsolute} from 'node:path';
import {Book,BookError} from './accounting.mjs';
import {LEGACY_COMPANY_DATES,normalizeCompanyCalendar} from './company-calendar.mjs';

export const companyDates=LEGACY_COMPANY_DATES;
const companyContacts=Object.freeze({telephone:'',mobile:'',fax:'',email:'',website:''});
const companyFields=Object.freeze({name:120,mailing_name:120,address:1000,state:120,country:120,pincode:20,telephone:120,mobile:120,fax:120,email:120,website:120});
const check=(condition,message,status=400)=>{if(!condition)throw new BookError(message,status);};
function storedProfile(row){
  const details=JSON.parse(row.details);
  check(details&&typeof details==='object'&&!Array.isArray(details)&&!Object.hasOwn(details,'id')&&!Object.hasOwn(details,'revision'),'Unsupported stored company settings; this company has not been changed.');
  return {id:row.id,...companyContacts,...details,revision:row.revision};
}
function metadata(input){
  check(input && typeof input==='object' && !Array.isArray(input),'Enter company details.');
  const fields=companyFields;
  check(Object.keys(input).every(key=>Object.hasOwn(fields,key) || Object.hasOwn(companyDates,key)),'Choose only company identity, mailing details and the supported book dates.');
  const result={};
  for(const [key,limit] of Object.entries(fields)){
    const fallback=key==='mailing_name'?result.name:key==='country'?'India':key==='state'?'Not Applicable':'';
    const value=input[key]===undefined?fallback:input[key];
    check(typeof value==='string' && value.length<=limit,'Enter valid '+key.replaceAll('_',' ')+'.');result[key]=value.trim();
  }
  check(result.name.length>0,'Enter a company name.');
  const calendar=normalizeCompanyCalendar(Object.fromEntries(Object.keys(companyDates).filter(key=>Object.hasOwn(input,key)).map(key=>[key,input[key]])));
  return {...result,...calendar};
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
      this.books.set('default',new Book(this.defaultFile,{companyName:initial.name,financialYearFrom:initial.financial_year_from,booksFrom:initial.books_from,financialYearTo:initial.financial_year_to,enforceCompanyPeriod:false}));
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
  book(id='default'){
    const profile=this.profile(id),file=this.fileFor(id);
    check(existsSync(file),'Company data is missing. The existing company has not been replaced.',404);
    if(!this.books.has(id))this.books.set(id,new Book(file,{companyName:profile.name,financialYearFrom:profile.financial_year_from,booksFrom:profile.books_from,financialYearTo:profile.financial_year_to,enforceCompanyPeriod:id!=='default'}));
    const book=this.books.get(id);book.companyName=profile.name;return book;
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
    this.catalog.exec('BEGIN IMMEDIATE');let saved;
    try{
      const previous=this.profile(id);
      check(Object.keys(previous).every(key=>key==='id'||key==='revision'||Object.hasOwn(companyFields,key)||Object.hasOwn(companyDates,key)),'Unsupported stored company settings; this company has not been changed.');
      check(input.revision===previous.revision && previous.revision<Number.MAX_SAFE_INTEGER,'This company changed after you opened it. Reopen it before saving.',409);
      check(Object.keys(companyDates).every(key=>!Object.hasOwn(input,key)||input[key]===previous[key]),'Company master dates are immutable in this creation-only calendar version.');
      const {revision,...patch}=input,values=metadata({...Object.fromEntries([...Object.keys(companyFields),...Object.keys(companyDates)].map(key=>[key,previous[key]])),...patch});
      check(!this.catalog.prepare('SELECT id FROM companies WHERE name=? COLLATE NOCASE AND id<>?').get(values.name,id),'A company with this name already exists.',409);
      this.catalog.prepare('UPDATE companies SET name=?,details=?,revision=revision+1 WHERE id=?').run(values.name,JSON.stringify(values),id);
      saved={id,...values,revision:previous.revision+1};this.catalog.exec('COMMIT');
    }catch(error){this.catalog.exec('ROLLBACK');throw error;}
    // Existing bank-holder text and all accounting tables stay untouched.
    const cached=this.books.get(id);if(cached)cached.companyName=saved.name;return saved;
  }
  close(){if(this.closed)return;this.closed=true;for(const book of this.books.values())book.close();this.books.clear();this.catalog.close();}
}
