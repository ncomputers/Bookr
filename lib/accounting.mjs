import { DatabaseSync } from 'node:sqlite';
import { expandAccountingSchema,initializeOpeningSchema } from './schema.mjs';
import { financialReports } from './financial-reports.mjs';
import {OPENING_DATE,OPENING_LIMIT,openingApplies,crossesOpeningDate,withOpening,openingSummary} from './opening-balances.mjs';
import {initializePartyOpeningSchema,openingBills,writeOpeningBills} from './party-openings.mjs';
import {initializeBillTermsSchema,normalizeBillTerms,withBillTerms,writeBillTerms} from './bill-terms.mjs';
import {initializeGeneralJournalSchema,isGeneralJournal,generalJournalEntries,saveGeneralJournal} from './general-journal.mjs';
import {BookError} from './errors.mjs';
import {LEGACY_COMPANY_DATES} from './company-calendar.mjs';
import {initialFinancialYearTo,monthPeriods} from '../public/calendar-values.js';
export {BookError} from './errors.mjs';

const assert = (condition, message, status) => { if (!condition) throw new BookError(message, status); };
const clean = (value, max = 120) => String(value ?? '').trim().slice(0, max);
const validDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(value+'T12:00:00Z');
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0,10) === value;
};
const textField = (value,limit,label,fallback='') => {
  value ??= fallback;
  assert(typeof value === 'string' && value.length <= limit, `${label} must be text with at most ${limit} characters.`);
  return value.trim();
};
function reportPeriod(period = {}) {
  assert(period && typeof period==='object' && !Array.isArray(period),'Enter a valid report period.');
  const {from=null,to=null}=period;
  assert((from===null || validDate(from)) && (to===null || validDate(to)),'Enter valid From and To dates.');
  assert(!from || !to || from<=to,'From date must not be after To date.');
  return {from,to};
}
function voucherDetails(input) {
  assert(input && typeof input === 'object' && !Array.isArray(input), 'Enter valid voucher details.');
  const result = {};
  for (const [section,fields] of Object.entries({dispatch:{delivery_note:200,document_no:120,through:120,destination:120,carrier:120,bill_of_lading:120,bill_date:10,vehicle:80},party:{mailing_name:120,address:1000,state:120,country:120}})) {
    const values = input[section] ?? {};
    assert(values && typeof values === 'object' && !Array.isArray(values), 'Enter valid '+section+' details.');
    result[section] = Object.fromEntries(Object.entries(fields).map(([key,limit]) => [key,textField(values[key],limit,key.replaceAll('_',' '))]));
  }
  assert(!result.dispatch.bill_date || validDate(result.dispatch.bill_date),'Enter a valid bill of lading date.');
  if(input.supplier_invoice!==undefined){
    assert(input.supplier_invoice && typeof input.supplier_invoice==='object' && !Array.isArray(input.supplier_invoice),'Enter valid supplier invoice details.');
    const number=textField(input.supplier_invoice.number,120,'Supplier invoice number');
    const date=textField(input.supplier_invoice.date,10,'Supplier invoice date');
    assert(!date || validDate(date),'Enter a valid supplier invoice date.');
    result.supplier_invoice={number,date};
  }
  return result;
}
function bankLedgerDetails(input,previous=null,companyName='Bookr Demo Fictional') {
  if(input===undefined)input={};
  assert(input && typeof input==='object' && !Array.isArray(input),'Enter valid bank ledger details.');
  const fields={account_holder:120,account_number:80,ifs_code:40,swift_code:40,bank_name:120,branch:120};
  const defaults={account_holder:companyName,bank_name:'Not Applicable'};
  return Object.fromEntries(Object.entries(fields).map(([key,limit])=>[key,textField(input[key],limit,key.replaceAll('_',' '),previous?.[key] ?? defaults[key] ?? '')]));
}
function bankVoucherDetails(input,account,type,amount,transactionType=type==='payment'?'Cheque':'Cheque/DD') {
  assert(input && typeof input==='object' && !Array.isArray(input),'Review the bank allocation before saving this bank voucher.');
  assert(Number.isSafeInteger(input.account_id) && input.account_id===account.id,'Bank allocation must match the selected bank account.');
  assert(Number.isSafeInteger(input.amount) && input.amount===amount,'The bank allocation must equal the full voucher amount.');
  assert(input.transaction_type===transactionType,`Choose ${transactionType}; other bank transaction types are outside this version.`);
  const instrumentNumber=textField(input.instrument_number,120,'Instrument number');
  const instrumentDate=textField(input.instrument_date,10,'Instrument date');
  assert(validDate(instrumentDate),'Enter a valid instrument date.');
  const bankName=textField(input.bank_name,120,'Bank name','Not Applicable');
  const chequeRange=textField(input.cheque_range,120,'Cheque range',type==='payment'?'Not Applicable':'');
  assert(chequeRange==='' || chequeRange==='Not Applicable','Cheque ranges are outside this version; choose Not Applicable.');
  return {account_id:account.id,transaction_type:transactionType,amount,instrument_number:instrumentNumber,instrument_date:instrumentDate,bank_name:bankName,cheque_range:chequeRange};
}
const denominations=['2000','1000','500','200','100','50','20','10','5','2','1'];
function cashDenominations(input,amount) {
  if(input===undefined || input===null)return null;
  assert(input && typeof input==='object' && !Array.isArray(input),'Enter valid cash denominations.');
  const values=input.counts;
  assert(values && typeof values==='object' && !Array.isArray(values),'Enter valid denomination counts.');
  assert(Object.keys(values).every(key=>denominations.includes(key)),'Choose only the supported cash denominations.');
  const counts={};let total=0n;
  for(const denomination of denominations){
    const count=Object.hasOwn(values,denomination)?values[denomination]:0;
    assert(Number.isSafeInteger(count) && count>=0,'Denomination counts must be nonnegative whole numbers.');
    counts[denomination]=count;total+=BigInt(denomination)*100n*BigInt(count);
  }
  const others=Object.hasOwn(input,'others')?input.others:0;
  assert(Number.isSafeInteger(others) && others>=0,'Other cash must be a nonnegative amount in paise.');
  total+=BigInt(others);
  assert(total<=BigInt(Number.MAX_SAFE_INTEGER),'The denomination total is too large.');
  return {counts,others,total:Number(total),difference:amount-Number(total)};
}
const contraAliases=row=>row.type==='contra'?{source_id:row.customer_id,source_name:row.customer_name,destination_id:row.account_id,destination_name:row.account_name}:{};
function voucherAliases(row,general=row.type==='journal' && isGeneralJournal(row.details)) {
  const {party_kind,...values}=row,payment=row.type==='payment',settlement=payment || row.type==='receipt';
  return {...values,...contraAliases(values),...(general?{journal_mode:'general'}:row.type==='journal'?{debit_ledger_id:row.account_id,debit_ledger_name:row.account_name,credit_ledger_id:row.customer_id,credit_ledger_name:row.customer_name,debit_amount:row.amount,credit_amount:row.amount}:{}),...(settlement?{ledger_id:row.customer_id,ledger_name:row.customer_name,ledger_kind:party_kind}:{}),...((row.type==='purchase' || (row.type==='journal' && !general) || (payment && party_kind==='supplier'))?{supplier_id:row.customer_id,supplier_name:row.customer_name}:{})};
}

export class Book {
  constructor(path = ':memory:',{companyName='Bookr Demo Fictional',booksFrom=null,financialYearTo=null,financialYearFrom=null,enforceCompanyPeriod=booksFrom!==null}={}) {
    assert(typeof companyName==='string' && companyName.trim().length>0 && companyName.length<=120,'Enter a valid company name.');
    this.companyName=companyName.trim();
    assert(typeof enforceCompanyPeriod==='boolean','Choose a valid company period policy.');
    assert((booksFrom===null && financialYearTo===null) || (validDate(booksFrom) && validDate(financialYearTo) && booksFrom<=financialYearTo),'Enter a valid company books period.');
    const fiscalFrom=financialYearFrom??booksFrom??LEGACY_COMPANY_DATES.financial_year_from;
    assert(validDate(fiscalFrom),'Enter a valid financial-year beginning date.');
    const fiscalTo=financialYearTo??initialFinancialYearTo(fiscalFrom),openingDate=booksFrom??fiscalFrom;
    assert(validDate(fiscalTo)&&fiscalFrom<=fiscalTo,'Enter a valid initial company financial year.');
    this.calendar=Object.freeze({financial_year_from:fiscalFrom,books_from:openingDate,financial_year_to:fiscalTo});
    this.calendarConfigured=financialYearFrom!==null;
    this.openingDate=openingDate;
    this.companyPeriod=enforceCompanyPeriod?{from:openingDate,to:fiscalTo}:null;
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS ledgers(
        id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        kind TEXT NOT NULL CHECK(kind IN ('customer','supplier','cash','bank','sales','purchase','expense','income','capital')), alias TEXT NOT NULL DEFAULT '',
        revision INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS vouchers(
        id INTEGER PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('sale','receipt','purchase','payment','contra','journal')),
        number INTEGER NOT NULL, date TEXT NOT NULL,
        customer_id INTEGER NOT NULL REFERENCES ledgers(id), account_id INTEGER NOT NULL REFERENCES ledgers(id),
        amount INTEGER NOT NULL CHECK(amount>0), narration TEXT NOT NULL DEFAULT '',
        sale_id INTEGER REFERENCES vouchers(id), revision INTEGER NOT NULL DEFAULT 1,
        UNIQUE(type,number)
      );
      CREATE TABLE IF NOT EXISTS postings(
        voucher_id INTEGER NOT NULL REFERENCES vouchers(id), ledger_id INTEGER NOT NULL REFERENCES ledgers(id),
        side TEXT NOT NULL CHECK(side IN ('debit','credit')), amount INTEGER NOT NULL CHECK(amount>0),
        PRIMARY KEY(voucher_id,ledger_id)
      );
      INSERT OR IGNORE INTO ledgers(id,name,kind) VALUES(1,'Cash','cash'),(2,'Demo Sales','sales');`);
    if (!this.db.prepare('PRAGMA table_info(ledgers)').all().some(column => column.name === 'revision')) {
      this.db.exec('ALTER TABLE ledgers ADD COLUMN revision INTEGER NOT NULL DEFAULT 1');
    }
    const columns = new Set(this.db.prepare('PRAGMA table_info(ledgers)').all().map(row => row.name));
    for (const [name,defaultValue] of Object.entries({mailing_name:'',address:'',state:'Not Applicable',country:'India',pincode:''})) {
      if (!columns.has(name)) this.db.exec(`ALTER TABLE ledgers ADD COLUMN ${name} TEXT NOT NULL DEFAULT '${defaultValue}'`);
    }
    if (!this.db.prepare('PRAGMA table_info(vouchers)').all().some(row => row.name === 'details')) {
      this.db.exec("ALTER TABLE vouchers ADD COLUMN details TEXT NOT NULL DEFAULT '{}'");
    }
    expandAccountingSchema(this.db);
    initializeGeneralJournalSchema(this.db);
    initializeOpeningSchema(this.db);
    this.db.exec(`CREATE TABLE IF NOT EXISTS bank_accounts(
      ledger_id INTEGER PRIMARY KEY REFERENCES ledgers(id),
      details TEXT NOT NULL DEFAULT '{}'
    );`);
    this.transaction(()=>{
      if(!this.db.prepare("SELECT id FROM ledgers WHERE kind='purchase'").get()){
        let name='Demo Purchases',suffix=1;
        while(this.db.prepare('SELECT id FROM ledgers WHERE name=? COLLATE NOCASE').get(name))name=`Demo Purchases ${++suffix}`;
        this.db.prepare("INSERT INTO ledgers(name,kind) VALUES(?,'purchase')").run(name);
      }
    });
    this.transaction(() => this.db.exec(`
      CREATE TABLE IF NOT EXISTS bills(
        id INTEGER PRIMARY KEY,
        sale_id INTEGER NOT NULL UNIQUE REFERENCES vouchers(id),
        reference TEXT NOT NULL CHECK(length(trim(reference))>0),
        amount INTEGER NOT NULL CHECK(amount>0)
      );
      INSERT OR IGNORE INTO bills(sale_id,reference,amount)
        SELECT v.id,CAST(v.number AS TEXT),v.amount FROM vouchers v
        JOIN ledgers party ON party.id=v.customer_id
        WHERE v.type IN ('sale','purchase','journal') AND NOT (v.type IN ('sale','purchase') AND party.kind='cash')
        AND NOT (v.type='journal' AND COALESCE(json_extract(v.details,'$.journal_mode'),'')='general');
      CREATE TABLE IF NOT EXISTS receipt_allocations(
        receipt_id INTEGER NOT NULL REFERENCES vouchers(id),
        bill_id INTEGER NOT NULL REFERENCES bills(id),
        amount INTEGER NOT NULL CHECK(amount>0),
        position INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(receipt_id,bill_id)
      );
      INSERT INTO receipt_allocations(receipt_id,bill_id,amount)
        SELECT r.id,b.id,r.amount FROM vouchers r JOIN bills b ON b.sale_id=r.sale_id
        WHERE r.type='receipt' AND NOT EXISTS(SELECT 1 FROM receipt_allocations a WHERE a.receipt_id=r.id);
    `));
    if (!this.db.prepare('PRAGMA table_info(receipt_allocations)').all().some(row=>row.name==='position')) {
      this.db.exec('ALTER TABLE receipt_allocations ADD COLUMN position INTEGER NOT NULL DEFAULT 0');
    }
    initializePartyOpeningSchema(this.db);
    initializeBillTermsSchema(this.db);
  }
  close() { this.db.close(); }
  transaction(action) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = action(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  #readSnapshot(action){
    // Reports use several reads. Keep their openings, postings and summaries in
    // one WAL snapshot; callers already in a read/write transaction retain it.
    if(this.db.isTransaction)return action();
    this.db.exec('BEGIN DEFERRED');
    try{const result=action();this.db.exec('COMMIT');return result;}
    catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  withBank(row) {
    row=withOpening(this.db,row,this.openingDate);
    if(['customer','supplier'].includes(row.kind))return {...row,opening_bills:openingBills(this.db,row.id)};
    if(['expense','income'].includes(row.kind))return {...row,ledger_type:'Not Applicable'};
    if(row.kind!=='bank')return row;
    const metadata=this.db.prepare('SELECT details FROM bank_accounts WHERE ledger_id=?').get(row.id);
    return {...row,bank:bankLedgerDetails(metadata?JSON.parse(metadata.details):{},null,this.companyName)};
  }
  ledgers() { return this.#readSnapshot(()=>this.db.prepare('SELECT * FROM ledgers ORDER BY kind,name').all().map(row=>this.withBank(row))); }
  ledger(id, kind) {
    return this.#readSnapshot(()=>{
      const row = this.db.prepare('SELECT * FROM ledgers WHERE id=?').get(Number(id));
      assert(row && (!kind || row.kind === kind), 'Choose a valid ' + (kind || '') + ' ledger.');
      return this.withBank(row);
    });
  }
  masterLedger(id) {
    return this.#readSnapshot(()=>{
      const row=this.db.prepare('SELECT * FROM ledgers WHERE id=?').get(Number(id));
      assert(row,'Ledger not found.',404);return this.withBank(row);
    });
  }
  saveLedger(input,id=null) {
    assert(input && typeof input==='object' && !Array.isArray(input),'Enter ledger details.');
    const previous=id===null?null:this.masterLedger(id),kind=previous?.kind ?? input.kind;
    assert(['customer','supplier','bank','cash','sales','purchase','expense','income','capital'].includes(kind),'Choose a supported ledger group.');
    assert(!previous || input.kind===undefined || input.kind===kind,'A saved ledger must keep its group.');
    if(kind==='customer')return this.saveCustomer(input,id);
    if(kind==='supplier')return this.saveSupplier(input,id);
    if(kind==='bank')return this.saveBank(input,id);
    return this.saveAccount(input,id,kind);
  }
  saveAccount(input,id=null,kind=input?.kind) {
    assert(['cash','sales','purchase','expense','income','capital'].includes(kind),'Choose a supported account ledger group.');
    if(['expense','income'].includes(kind))assert(input.ledger_type===undefined || input.ledger_type==='Not Applicable','Only Not Applicable expense and income ledgers are supported.');
    return this.saveParty(input,id,kind);
  }
  createCustomer(input) {
    return this.saveCustomer(input);
  }
  customer(id) {
    return this.#readSnapshot(()=>{
      const row = this.db.prepare("SELECT * FROM ledgers WHERE id=? AND kind='customer'").get(Number(id));
      assert(row, 'Customer ledger not found.', 404);
      return this.withBank(row);
    });
  }
  saveCustomer(input, id = null) {
    return this.saveParty(input,id,'customer');
  }
  supplier(id) {
    return this.#readSnapshot(()=>{
      const row=this.db.prepare("SELECT * FROM ledgers WHERE id=? AND kind='supplier'").get(Number(id));
      assert(row,'Supplier ledger not found.',404);return this.withBank(row);
    });
  }
  saveSupplier(input,id=null) { return this.saveParty(input,id,'supplier'); }
  bank(id) {
    return this.#readSnapshot(()=>{
      const row=this.db.prepare("SELECT * FROM ledgers WHERE id=? AND kind='bank'").get(Number(id));
      assert(row,'Bank ledger not found.',404);return this.withBank(row);
    });
  }
  saveBank(input,id=null) { return this.saveParty(input,id,'bank'); }
  saveParty(input,id,kind) {
    return this.transaction(() => {
      assert(input && typeof input === 'object' && !Array.isArray(input), `Enter ${kind} ledger details.`);
      assert(typeof input.name === 'string' && input.name.trim().length > 0, `Enter a ${kind} name.`);
      assert(input.alias === undefined || typeof input.alias === 'string', 'Enter a valid alias.');
      const name = input.name.trim(), alias = (input.alias ?? '').trim();
      assert(name.length <= 120 && alias.length <= 120, 'Name and alias must be 120 characters or fewer.');
      const previous = id === null ? null : (kind==='bank'?this.bank(id):kind==='supplier'?this.supplier(id):kind==='customer'?this.customer(id):this.masterLedger(id));
      assert(!previous || previous.kind===kind,'Ledger not found in this group.',404);
      const bank=kind==='bank'?bankLedgerDetails(input.bank,previous?.bank,this.companyName):null;
      assert(!previous || input.revision === previous.revision,
        'This ledger changed after you opened it. Reopen it before saving.', 409);
      assert(input.opening_date===undefined || input.opening_date===this.openingDate,`Opening balances must use this company's books date, ${this.openingDate}.`);
      const opening=input.opening_balance===undefined?(previous?.opening_balance ?? 0):input.opening_balance;
      assert(Number.isSafeInteger(opening) && Math.abs(opening)<=OPENING_LIMIT,'Enter an opening balance in whole paise within the supported limit.');
      const party=['customer','supplier'].includes(kind);
      assert(opening===0 || ['cash','capital','bank','customer','supplier'].includes(kind),'Opening balances currently support Cash, Bank, Capital, customer and supplier ledgers.');
      assert(party || input.opening_bills===undefined || (Array.isArray(input.opening_bills) && input.opening_bills.length===0),'Opening bill references require a customer or supplier ledger.');
      const bills=input.opening_bills===undefined?(opening===0?[]:previous?.opening_bills ?? []):input.opening_bills;
      if(opening!==0 && previous){
        const earlier=this.db.prepare('SELECT 1 FROM postings p JOIN vouchers v ON v.id=p.voucher_id WHERE p.ledger_id=? AND v.date<? LIMIT 1').get(previous.id,this.openingDate);
        assert(!earlier,`This opening-balance version cannot combine a nonzero opening with vouchers before ${this.openingDate} in the same ledger.`);
      }
      assert(!this.db.prepare('SELECT id FROM ledgers WHERE name=? COLLATE NOCASE AND id<>?').get(name, previous?.id ?? 0),
        'A ledger with this name already exists.');
      const indirect=['expense','income'].includes(kind);
      const mailingName = input.mailing_name ?? (indirect?(previous?.mailing_name ?? ''):((!previous?.mailing_name || previous.mailing_name === previous.name) ? name : previous.mailing_name));
      const mailing = [textField(mailingName,120,'Mailing name'),textField(input.address,1000,'Address',previous?.address),
        textField(input.state,120,'State',previous?.state ?? (indirect?'':'Not Applicable')),textField(input.country,120,'Country',previous?.country ?? (indirect?'':'India')),textField(input.pincode,20,'Pincode',previous?.pincode)];
      if (previous) {
        this.db.prepare('UPDATE ledgers SET name=?,alias=?,mailing_name=?,address=?,state=?,country=?,pincode=?,revision=revision+1 WHERE id=?').run(name, alias,...mailing,previous.id);
        if(bank)this.db.prepare('INSERT INTO bank_accounts(ledger_id,details) VALUES(?,?) ON CONFLICT(ledger_id) DO UPDATE SET details=excluded.details').run(previous.id,JSON.stringify(bank));
        this.#writeOpening(previous.id,opening);
        if(party)writeOpeningBills(this.db,previous.id,bills,opening,kind,assert,this.openingDate);
        return this.ledger(previous.id,kind);
      }
      const result = this.db.prepare('INSERT INTO ledgers(name,kind,alias,mailing_name,address,state,country,pincode) VALUES(?,?,?,?,?,?,?,?)').run(name,kind,alias,...mailing);
      if(bank)this.db.prepare('INSERT INTO bank_accounts(ledger_id,details) VALUES(?,?)').run(Number(result.lastInsertRowid),JSON.stringify(bank));
      this.#writeOpening(Number(result.lastInsertRowid),opening);
      if(party)writeOpeningBills(this.db,Number(result.lastInsertRowid),bills,opening,kind,assert,this.openingDate);
      return this.ledger(Number(result.lastInsertRowid),kind);
    });
  }
  #writeOpening(ledgerId,amount){
    if(amount===0)this.db.prepare('DELETE FROM ledger_openings WHERE ledger_id=?').run(ledgerId);
    else this.db.prepare('INSERT INTO ledger_openings(ledger_id,amount) VALUES(?,?) ON CONFLICT(ledger_id) DO UPDATE SET amount=excluded.amount').run(ledgerId,amount);
    try{openingSummary(this.db,true,this.openingDate);}catch(error){throw new BookError(error.message);}
  }
  #checkOpeningPeriod(period,hasOpening){
    if(this.calendarConfigured)return;
    assert(!hasOpening || !crossesOpeningDate(period,this.openingDate),`Reports with nonzero opening balances cannot cross ${this.openingDate} in this version. Choose a From date on or after ${this.openingDate}, leave From blank, or end the report before that date.`);
  }
  #checkOpeningVoucherDate(date,...ledgers){
    assert(date>=this.openingDate || ledgers.every(ledger=>!ledger.opening_balance),`Vouchers before ${this.openingDate} cannot use a ledger with a nonzero opening balance in this version.`);
  }
  voucher(id) {
    return this.#readSnapshot(()=>{
      const row = this.db.prepare(`SELECT v.*,l.name AS customer_name,l.kind AS party_kind,a.name AS account_name
        FROM vouchers v JOIN ledgers l ON l.id=v.customer_id JOIN ledgers a ON a.id=v.account_id WHERE v.id=?`).get(Number(id));
      assert(row, 'Voucher not found.', 404);
      return { ...voucherAliases(row),...(row.type==='journal' && isGeneralJournal(row.details)?{entries:generalJournalEntries(this.db,row.id)}:{}),bill:this.billForSale(row.id), allocations:this.allocations(row.id), details:JSON.parse(row.details), postings: this.db.prepare(`SELECT p.*,l.name FROM postings p JOIN ledgers l ON l.id=p.ledger_id
        WHERE voucher_id=? ORDER BY side DESC`).all(row.id) };
    });
  }
  billForSale(saleId) {
    return this.#readSnapshot(()=>{
      const row=this.db.prepare('SELECT * FROM bills WHERE sale_id=?').get(saleId);
      if(!row)return null;
      const voucher=this.db.prepare('SELECT date FROM vouchers WHERE id=?').get(saleId);
      return withBillTerms(this.db,row,'voucher',row.id,voucher.date);
    });
  }
  allocated(saleId, exclude = 0) {
    return this.db.prepare(`SELECT COALESCE(SUM(a.amount),0) AS value FROM receipt_allocations a
      JOIN bills b ON b.id=a.bill_id JOIN vouchers settlement ON settlement.id=a.receipt_id JOIN ledgers party ON party.id=settlement.customer_id
      WHERE b.sale_id=? AND a.receipt_id<>? AND ((settlement.type='receipt' AND party.kind='customer') OR (settlement.type='payment' AND party.kind='supplier'))`).get(saleId, exclude).value;
  }
  allocations(receiptId) {
    return this.#readSnapshot(()=>{
    const regular=this.db.prepare(`SELECT a.bill_id,a.amount,b.reference,b.sale_id,v.date,a.position FROM receipt_allocations a
      JOIN bills b ON b.id=a.bill_id JOIN vouchers v ON v.id=b.sale_id JOIN vouchers settlement ON settlement.id=a.receipt_id JOIN ledgers party ON party.id=settlement.customer_id
      WHERE a.receipt_id=? AND settlement.customer_id=v.customer_id AND ((settlement.type='receipt' AND party.kind='customer') OR (settlement.type='payment' AND party.kind='supplier')) ORDER BY a.position,b.id`).all(receiptId);
    const opening=this.db.prepare(`SELECT a.opening_bill_id,a.amount,b.reference,b.date,a.position FROM opening_bill_allocations a
      JOIN opening_bills b ON b.id=a.opening_bill_id JOIN vouchers settlement ON settlement.id=a.receipt_id JOIN ledgers party ON party.id=b.ledger_id
      WHERE a.receipt_id=? AND settlement.customer_id=b.ledger_id AND ((settlement.type='receipt' AND party.kind='customer') OR (settlement.type='payment' AND party.kind='supplier')) ORDER BY a.position,b.id`).all(receiptId).map(row=>({...row,source:'opening',sale_id:null}));
    return [...regular,...opening].sort((a,b)=>a.position-b.position).map(({position,...row})=>withBillTerms(this.db,row,row.opening_bill_id!==undefined?'opening':'voucher',row.opening_bill_id ?? row.bill_id,row.date));
    });
  }
  openingAllocated(openingBillId,exclude=0){
    return this.db.prepare(`SELECT COALESCE(SUM(a.amount),0) AS value FROM opening_bill_allocations a
      JOIN opening_bills b ON b.id=a.opening_bill_id JOIN vouchers v ON v.id=a.receipt_id JOIN ledgers l ON l.id=b.ledger_id
      WHERE b.id=? AND a.receipt_id<>? AND v.customer_id=b.ledger_id AND ((v.type='receipt' AND l.kind='customer') OR (v.type='payment' AND l.kind='supplier'))`).get(openingBillId,exclude).value;
  }
  billBalances(customerId=null,excludeReceiptId=0,direction='receivable',asOf=null) {
    return this.#readSnapshot(()=>{
    const type=direction==='payable'?'payment':'receipt',kind=direction==='payable'?'supplier':'customer';
    const regular=this.db.prepare(`SELECT s.id,s.number,b.id AS bill_id,b.reference,s.date,s.customer_id,l.name AS customer_name,b.amount AS original,
      COALESCE(SUM(r.amount),0) AS received,
      COALESCE(SUM(CASE WHEN r.receipt_id=? THEN r.amount ELSE 0 END),0) AS own_allocation
      FROM vouchers s JOIN bills b ON b.sale_id=s.id JOIN ledgers l ON l.id=s.customer_id
      LEFT JOIN receipt_allocations r ON r.bill_id=b.id AND EXISTS(SELECT 1 FROM vouchers settlement JOIN ledgers party ON party.id=settlement.customer_id WHERE settlement.id=r.receipt_id AND settlement.customer_id=s.customer_id AND settlement.type=? AND party.kind=? AND (? IS NULL OR settlement.date<=?))
      WHERE (s.type=? OR (?='payable' AND s.type='journal')) AND (? IS NULL OR s.customer_id=?) AND (? IS NULL OR s.date<=?) GROUP BY s.id ORDER BY s.date,s.id`)
      .all(excludeReceiptId,type,kind,asOf,asOf,direction==='payable'?'purchase':'sale',direction,customerId,customerId,asOf,asOf);
    const opening=this.db.prepare(`SELECT b.id AS opening_bill_id,b.reference,b.date,b.ledger_id AS customer_id,l.name AS customer_name,b.amount AS original,
      COALESCE(SUM(a.amount),0) AS received,COALESCE(SUM(CASE WHEN a.receipt_id=? THEN a.amount ELSE 0 END),0) AS own_allocation
      FROM opening_bills b JOIN ledgers l ON l.id=b.ledger_id
      LEFT JOIN opening_bill_allocations a ON a.opening_bill_id=b.id AND EXISTS(SELECT 1 FROM vouchers v WHERE v.id=a.receipt_id AND v.customer_id=b.ledger_id AND v.type=? AND (? IS NULL OR v.date<=?))
      WHERE l.kind=? AND (? IS NULL OR b.ledger_id=?) AND (? IS NULL OR ?>=?) GROUP BY b.id ORDER BY b.date,b.id`).all(excludeReceiptId,type,asOf,asOf,kind,customerId,customerId,asOf,asOf,this.openingDate)
      .map(row=>({...row,id:'opening:'+row.opening_bill_id,number:null,source:'opening',type:'opening',sale_id:null}));
    return [...regular,...opening].sort((a,b)=>a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id),undefined,{numeric:true})).map(row=>withBillTerms(this.db,{...row,pending:row.original-row.received,available:row.original-row.received+row.own_allocation},row.source==='opening'?'opening':'voucher',row.opening_bill_id ?? row.bill_id,row.date));
    });
  }
  receiptBills(customerId,excludeReceiptId=0) {
    return this.settlementBills(customerId,excludeReceiptId,'receipt');
  }
  paymentBills(supplierId,excludePaymentId=0) {
    return this.settlementBills(supplierId,excludePaymentId,'payment');
  }
  settlementBills(partyId,excludeId,type) {
    return this.#readSnapshot(()=>{
    const payable=type==='payment',customer=this.ledger(partyId,payable?'supplier':'customer');
    const excluded=Number(excludeId);
    assert(Number.isSafeInteger(excluded) && excluded>=0,'Choose a valid receipt to alter.');
    if(excluded){
      const receipt=this.db.prepare('SELECT type FROM vouchers WHERE id=?').get(excluded);
      assert(receipt,'Receipt not found.',404);
      assert(receipt.type===type,`Only a saved ${type} can release its previous allocations.`);
    }
    return {customer,...(payable?{supplier:customer,payment_id:excluded || null}:{receipt_id:excluded || null}),bills:this.billBalances(customer.id,excluded,payable?'payable':'receivable')};
    });
  }
  saveVoucher(input, id = null) {
    return this.transaction(() => {
      assert(input && typeof input === 'object' && !Array.isArray(input), 'Enter voucher details.');
      if(this.companyPeriod)assert(validDate(input.date) && input.date>=this.companyPeriod.from && input.date<=this.companyPeriod.to,'Voucher date must be within this company\'s supported books period: '+this.companyPeriod.from+' to '+this.companyPeriod.to+'.');
      const previous = id === null ? null : this.voucher(id);
      const type = previous?.type ?? input.type;
      if(type==='journal'){
        const general=previous?isGeneralJournal(previous.details):input.entries!==undefined;
        if(general)return saveGeneralJournal({db:this.db,input,previous,check:assert,ledger:id=>this.ledger(id),isDate:validDate,checkOpening:(...ledgers)=>this.#checkOpeningVoucherDate(input.date,...ledgers),readVoucher:id=>this.voucher(id)});
        assert(!Object.hasOwn(input,'entries'),'A saved Journal must keep its entry mode.');return this.#saveJournal(input,previous);
      }
      assert(['sale','receipt','purchase','payment','contra'].includes(type),'Choose Sales, Receipt, Purchase, Payment or Contra.');
      const payable=type==='purchase' || type==='payment',invoice=type==='sale' || type==='purchase',contra=type==='contra';
      assert(!previous || (Number.isSafeInteger(input.revision) && input.revision === previous.revision), 'This voucher changed after you opened it. Reopen it before saving.', 409);
      assert(!previous || input.type===undefined || input.type===previous.type,'A saved voucher must keep its voucher type.');
      if(contra)assert(!Object.hasOwn(input,'bill') && !Object.hasOwn(input,'allocations') && input.sale_id==null,'Contra vouchers cannot contain bills or settlement allocations.');
      let reference;
      const date = input.date;
      assert(validDate(date), 'Enter a valid date.');
      const amount = input.amount;
      assert(Number.isSafeInteger(amount) && amount > 0 && amount <= 100000000000, 'Enter a positive amount with at most two decimal places.');
      if(type==='payment')assert(input.ledger_id===undefined || input.supplier_id===undefined || Number(input.ledger_id)===Number(input.supplier_id),'Choose one payment ledger; ledger_id and supplier_id conflict.');
      if(type==='receipt')assert(input.ledger_id===undefined || input.customer_id===undefined || Number(input.ledger_id)===Number(input.customer_id),'Choose one receipt ledger; ledger_id and customer_id conflict.');
      const customer = contra?this.ledger(input.source_id):type==='payment'?this.ledger(input.ledger_id ?? input.supplier_id):type==='receipt'?this.ledger(input.ledger_id ?? input.customer_id):type==='sale'?this.ledger(input.customer_id):this.ledger(input.supplier_id);
      if(type==='sale')assert(['customer','cash'].includes(customer.kind),'Choose a customer or Cash ledger for Sales.');
      if(type==='purchase')assert(['supplier','cash'].includes(customer.kind),'Choose a supplier or Cash ledger for Purchases.');
      const cashInvoice=invoice && customer.kind==='cash',cashLabel=type==='purchase'?'Cash Purchases':'Cash Sales';
      if(cashInvoice){
        assert(input.bill==null && input.sale_id==null,`${cashLabel} cannot contain ${payable?'supplier':'customer'} bill references.`);
        assert(input.allocations===undefined || (Array.isArray(input.allocations) && input.allocations.length===0),`${cashLabel} cannot contain settlement allocations.`);
      }else if(invoice && input.bill!==undefined){
        assert(input.bill && typeof input.bill==='object' && !Array.isArray(input.bill),'Enter valid bill reference details.');
        reference=textField(input.bill.reference,120,'Bill reference');assert(reference.length>0,'Enter a bill reference name.');
      }
      const terms=invoice && !cashInvoice?normalizeBillTerms(input.bill?.terms,previous?.bill?.terms,date,assert):null;
      const expense=type==='payment' && customer.kind==='expense';
      const income=type==='receipt' && customer.kind==='income',capital=['receipt','payment'].includes(type) && customer.kind==='capital',direct=expense || income || capital;
      if(type==='payment'){
        assert(['supplier','expense','capital'].includes(customer.kind),'Choose a supplier, Indirect Expenses or Capital Account ledger for this payment.');
        assert(!(expense || capital) || input.supplier_id===undefined,'Use ledger_id for an expense or capital payment.');
      }
      if(type==='receipt'){
        assert(['customer','income','capital'].includes(customer.kind),'Choose a customer, Indirect Incomes or Capital Account ledger for this receipt.');
        assert(!(income || capital) || input.customer_id===undefined,'Use ledger_id for an income or capital receipt.');
      }
      if(direct){
        const directLabel=expense?'Expense payments':capital?(type==='payment'?'Capital payments':'Capital receipts'):'Income receipts';
        assert(input.bill==null && input.sale_id==null,`${directLabel} cannot contain a bill reference.`);
        assert(input.allocations===undefined || (Array.isArray(input.allocations) && input.allocations.length===0),`${directLabel} cannot contain settlement allocations.`);
      }
      const account = this.ledger(contra?input.destination_id:input.account_id,invoice?(payable?'purchase':'sales'):undefined);
      this.#checkOpeningVoucherDate(date,customer,account);
      const bankTransfer=contra && customer.kind==='bank' && account.kind==='bank';
      if(contra)assert(['cash','bank'].includes(customer.kind) && ['cash','bank'].includes(account.kind) && customer.id!==account.id && (customer.kind!==account.kind || bankTransfer),'Choose different cash/bank accounts with at least one bank for this Contra.');
      else assert(invoice || ['cash','bank'].includes(account.kind),'Choose a cash or bank account for this settlement.');
      const narration = clean(input.narration, 1000);
      const entryDetails=voucherDetails(input.details ?? previous?.details ?? {});
      const explicitBank=input.details && typeof input.details==='object' && Object.hasOwn(input.details,'bank');
      const explicitSourceBank=input.details && typeof input.details==='object' && Object.hasOwn(input.details,'source_bank');
      assert(!explicitSourceBank || bankTransfer,'A second bank allocation requires a bank-to-bank Contra.');
      if(contra){
        const changed=previous && (previous.customer_id!==customer.id || previous.account_id!==account.id || previous.amount!==amount);
        assert(!changed || explicitBank,'Review new bank details when changing the Contra accounts or amount.');
        const inputBank=explicitBank?input.details.bank:previous?.details.bank;
        if(bankTransfer){
          assert(!changed || explicitSourceBank,'Review both bank allocations when changing the transfer accounts or amount.');
          const sourceBank=explicitSourceBank?input.details.source_bank:previous?.details.source_bank;
          assert(inputBank?.denominations==null && sourceBank?.denominations==null,'Bank-to-bank transfers cannot contain cash denominations.');
          entryDetails.bank=bankVoucherDetails(inputBank,account,'receipt',amount);
          entryDetails.source_bank=bankVoucherDetails(sourceBank,customer,'payment',amount);
          assert(entryDetails.source_bank.cheque_range==='Not Applicable','Choose Not Applicable for the source bank cheque range.');
        }else{
          const deposit=account.kind==='bank',bankAccount=deposit?account:customer;
          entryDetails.bank=bankVoucherDetails(inputBank,bankAccount,deposit?'contra':'payment',amount,deposit?'Cash':'Cheque');
          if(deposit)entryDetails.bank.denominations=cashDenominations(inputBank.denominations,amount);
          else {
            assert(inputBank.denominations==null,'Cash denominations apply only to a cash deposit.');
            assert(entryDetails.bank.cheque_range==='Not Applicable','Choose Not Applicable for the withdrawal cheque range.');
          }
        }
      }else if(account.kind==='bank'){
        assert(!previous || previous.account_id===account.id || explicitBank,'Review a new bank allocation when changing the bank account.');
        const bank=explicitBank?input.details.bank:previous?.account_id===account.id?previous.details.bank:undefined;
        entryDetails.bank=bankVoucherDetails(bank,account,type,amount);
      }else{
        assert(!explicitBank || input.details.bank==null,'Bank allocations require a bank account.');
      }
      const details = JSON.stringify(entryDetails);
      let saleId = null, allocations = [];
      if (!invoice && !contra && !direct) {
        // Accept the earlier single-sale API as a compatibility input only.
        const rows = input.allocations!==undefined ? input.allocations : (input.sale_id ? [{bill_id:this.billForSale(Number(input.sale_id))?.id,amount}] : previous?.allocations);
        assert(Array.isArray(rows) && rows.length>0 && rows.length<=100,`Allocate this ${type} against at least one saved bill (up to 100).`);
        // The picker and save use the same calculation. Re-read while holding
        // BEGIN IMMEDIATE so another receipt cannot consume a stale balance.
        const billKey=row=>row.opening_bill_id!==undefined?'opening:'+row.opening_bill_id:'bill:'+row.bill_id;
        const available=new Map(this.settlementBills(customer.id,previous?.id ?? 0,type).bills.map(bill=>[billKey(bill),bill]));
        const seen = new Set();
        allocations = rows.map(row => {
          assert(row && typeof row==='object' && !Array.isArray(row) && ((row.bill_id!==undefined)!==(row.opening_bill_id!==undefined)),`Choose exactly one bill identity for each allocation.`);
          const opening=row.opening_bill_id!==undefined,key=billKey(row),identity=opening?row.opening_bill_id:row.bill_id;
          assert(Number.isSafeInteger(identity) && identity>0 && !seen.has(key),`Choose each saved bill once in this ${type}.`);
          seen.add(key);
          assert(Number.isSafeInteger(row.amount) && row.amount>0 && row.amount<=100000000000,'Enter a positive allocation amount in paise.');
          const bill = available.get(key);
          assert(bill,`Choose a saved bill for this ${payable?'supplier':'customer'}.`);
          assert(row.amount<=bill.available,`Amount exceeds the balance available on this bill. Advance ${payable?'payments':'receipts'} are outside this version.`);
          return opening?{opening_bill_id:bill.opening_bill_id,amount:row.amount,sale_id:null}:{bill_id:bill.bill_id,amount:row.amount,sale_id:bill.id};
        });
        assert(allocations.reduce((sum,row)=>sum+row.amount,0)===amount,`Bill allocations must equal the ${type} amount.`);
        saleId = allocations.length===1 ? allocations[0].sale_id : null;
      } else if (invoice && previous) {
        const paid = this.allocated(previous.id);
        assert(amount >= paid,`The ${payable?'purchase':'sale'} amount cannot be less than ${payable?'payments':'receipts'} already allocated to it.`);
        assert(!paid || previous.customer_id === customer.id,`A ${payable?'purchase with allocated payments must keep the same supplier':'sale with allocated receipts must keep the same customer'}.`);
      }
      let voucherId, number;
      if (previous) {
        voucherId = previous.id; number = previous.number;
        this.db.prepare(`UPDATE vouchers SET date=?,customer_id=?,account_id=?,amount=?,narration=?,sale_id=?,details=?,revision=revision+1 WHERE id=?`)
          .run(date, customer.id, account.id, amount, narration, saleId,details,voucherId);
        this.db.prepare('DELETE FROM postings WHERE voucher_id=?').run(voucherId);
      } else {
        number = this.db.prepare('SELECT COALESCE(MAX(number),0)+1 AS value FROM vouchers WHERE type=?').get(type).value;
        voucherId = Number(this.db.prepare(`INSERT INTO vouchers(type,number,date,customer_id,account_id,amount,narration,sale_id,details) VALUES(?,?,?,?,?,?,?,?,?)`)
          .run(type, number, date, customer.id, account.id, amount, narration, saleId,details).lastInsertRowid);
      }
      if (invoice && !cashInvoice) {
        this.db.prepare(`INSERT INTO bills(sale_id,reference,amount) VALUES(?,?,?)
          ON CONFLICT(sale_id) DO UPDATE SET reference=excluded.reference,amount=excluded.amount`)
          .run(voucherId,reference ?? previous?.bill?.reference ?? ((payable?entryDetails.supplier_invoice?.number:'') || String(number)),amount);
        writeBillTerms(this.db,'voucher',this.billForSale(voucherId).id,terms);
      } else if(cashInvoice){
        // Paid credit invoices were rejected above. The FK also prevents any
        // settlement from being orphaned; term metadata cascades with the bill.
        this.db.prepare('DELETE FROM bills WHERE sale_id=?').run(voucherId);
      } else if(!contra) {
        this.db.prepare('DELETE FROM receipt_allocations WHERE receipt_id=?').run(voucherId);
        this.db.prepare('DELETE FROM opening_bill_allocations WHERE receipt_id=?').run(voucherId);
        const allocate = this.db.prepare('INSERT INTO receipt_allocations(receipt_id,bill_id,amount,position) VALUES(?,?,?,?)');
        const allocateOpening=this.db.prepare('INSERT INTO opening_bill_allocations(receipt_id,opening_bill_id,amount,position) VALUES(?,?,?,?)');
        allocations.forEach((row,index)=>row.opening_bill_id!==undefined?allocateOpening.run(voucherId,row.opening_bill_id,row.amount,index):allocate.run(voucherId,row.bill_id,row.amount,index));
      }
      const partyDebit=type==='sale' || type==='payment';
      const debit = partyDebit ? customer.id : account.id;
      const credit = partyDebit ? account.id : customer.id;
      const insert = this.db.prepare('INSERT INTO postings(voucher_id,ledger_id,side,amount) VALUES(?,?,?,?)');
      insert.run(voucherId, debit, 'debit', amount); insert.run(voucherId, credit, 'credit', amount);
      const totals = this.db.prepare(`SELECT SUM(CASE WHEN side='debit' THEN amount ELSE -amount END) AS balance,COUNT(*) AS count FROM postings WHERE voucher_id=?`).get(voucherId);
      assert(totals.balance === 0 && totals.count === 2, 'Voucher must contain balanced accounting entries.');
      return this.voucher(voucherId);
    });
  }
  #saveJournal(input,previous) {
    // Called only inside saveVoucher's BEGIN IMMEDIATE transaction. This first
    // observed journal has one expense debit, one supplier credit and one New Ref.
    assert(!previous || (Number.isSafeInteger(input.revision) && input.revision===previous.revision),'This voucher changed after you opened it. Reopen it before saving.',409);
    assert(input.type===undefined || input.type==='journal','A saved voucher must keep its voucher type.');
    for(const field of ['amount','account_id','customer_id','supplier_id','ledger_id','source_id','destination_id','entries','allocations','sale_id'])assert(!Object.hasOwn(input,field),'Use the two Journal ledger and amount fields; other voucher inputs are outside this Journal version.');
    assert(validDate(input.date),'Enter a valid date.');
    assert(Number.isSafeInteger(input.debit_ledger_id) && Number.isSafeInteger(input.credit_ledger_id),'Choose both Journal ledgers.');
    const debit=this.ledger(input.debit_ledger_id,'expense'),credit=this.ledger(input.credit_ledger_id,'supplier');
    this.#checkOpeningVoucherDate(input.date,debit,credit);
    const amount=input.debit_amount;
    assert(Number.isSafeInteger(amount) && amount>0 && amount<=100000000000,'Enter a positive debit amount in paise.');
    assert(Number.isSafeInteger(input.credit_amount) && input.credit_amount===amount,'Journal debit and credit totals must be equal.');
    assert(input.details===undefined || (input.details && typeof input.details==='object' && !Array.isArray(input.details) && Object.keys(input.details).length===0),'Bank, tax and other Journal details are outside this version.');
    const narration=textField(input.narration,1000,'Narration');
    let reference=previous?.bill?.reference;
    if(input.bill!==undefined){
      assert(input.bill && typeof input.bill==='object' && !Array.isArray(input.bill) && Object.keys(input.bill).every(key=>['reference','method','terms','due_date'].includes(key)),'Enter one New Ref name and optional bill terms; other bill details are outside this Journal version.');
      assert(input.bill.method===undefined || input.bill.method==='New Ref','This Journal version supports one New Ref.');
      reference=textField(input.bill.reference,120,'Bill reference');assert(reference.length>0,'Enter a bill reference name.');
    }
    const terms=normalizeBillTerms(input.bill?.terms,previous?.bill?.terms,input.date,assert);
    if(previous){
      const allocated=this.allocated(previous.id);
      assert(amount>=allocated,'The Journal amount cannot be less than payments already allocated to it.');
      assert(!allocated || previous.customer_id===credit.id,'A Journal with allocated payments must keep the same supplier.');
    }
    const number=previous?.number ?? this.db.prepare("SELECT COALESCE(MAX(number),0)+1 AS value FROM vouchers WHERE type='journal'").get().value;
    let id=previous?.id;
    if(previous){
      this.db.prepare('UPDATE vouchers SET date=?,customer_id=?,account_id=?,amount=?,narration=?,revision=revision+1 WHERE id=?').run(input.date,credit.id,debit.id,amount,narration,id);
      this.db.prepare('DELETE FROM postings WHERE voucher_id=?').run(id);
    }else{
      id=Number(this.db.prepare("INSERT INTO vouchers(type,number,date,customer_id,account_id,amount,narration,details) VALUES('journal',?,?,?,?,?,?,'{}')").run(number,input.date,credit.id,debit.id,amount,narration).lastInsertRowid);
    }
    this.db.prepare('INSERT INTO bills(sale_id,reference,amount) VALUES(?,?,?) ON CONFLICT(sale_id) DO UPDATE SET reference=excluded.reference,amount=excluded.amount').run(id,reference ?? String(number),amount);
    writeBillTerms(this.db,'voucher',this.billForSale(id).id,terms);
    const insert=this.db.prepare('INSERT INTO postings(voucher_id,ledger_id,side,amount) VALUES(?,?,?,?)');
    insert.run(id,debit.id,'debit',amount);insert.run(id,credit.id,'credit',amount);
    const totals=this.db.prepare("SELECT COUNT(*) AS count,SUM(CASE WHEN side='debit' THEN amount ELSE -amount END) AS difference FROM postings WHERE voucher_id=?").get(id);
    assert(totals.count===2 && totals.difference===0,'Journal must contain two balanced accounting entries.');
    return this.voucher(id);
  }
  outstanding() {
    return this.billBalances().map(({own_allocation,available,...row})=>row);
  }
  payables() {
    return this.billBalances(null,0,'payable').map(({own_allocation,available,...row})=>({...row,supplier_id:row.customer_id,supplier_name:row.customer_name}));
  }
  outstandingReport(filter={}){
    return this.#readSnapshot(()=>{
      assert(filter && typeof filter==='object' && !Array.isArray(filter),'Enter a valid outstanding report filter.');
      assert(Object.keys(filter).every(key=>['direction','as_of','ledger_id'].includes(key)),'Choose only direction, as_of and ledger_id for this outstanding report.');
      const direction=filter.direction===undefined?'receivable':filter.direction,as_of=filter.as_of===undefined?null:filter.as_of,ledger_id=filter.ledger_id===undefined?null:filter.ledger_id;
      assert(['receivable','payable'].includes(direction),'Choose receivable or payable outstanding.');
      assert(as_of===null || validDate(as_of),'Enter a valid outstanding As Of date.');
      assert(ledger_id===null || (Number.isSafeInteger(ledger_id) && ledger_id>0),'Choose a valid outstanding party ledger.');
      if(ledger_id!==null)this.ledger(ledger_id,direction==='payable'?'supplier':'customer');
      const rows=this.billBalances(ledger_id,0,direction,as_of).filter(row=>row.pending!==0).map(({own_allocation,available,...row})=>direction==='payable'?{...row,supplier_id:row.customer_id,supplier_name:row.customer_name}:row);
      const totals={};
      for(const key of ['original','received','pending']){
        const value=rows.reduce((sum,row)=>sum+BigInt(row[key]),0n);
        assert(value<=BigInt(Number.MAX_SAFE_INTEGER) && value>=BigInt(Number.MIN_SAFE_INTEGER),'Outstanding totals exceed the supported exact-paise limit.');totals[key]=Number(value);
      }
      return {filter:{direction,as_of,ledger_id},rows,totals};
    });
  }
  dayBook(filter = {}) {
    const {from,to}=reportPeriod(filter),type=filter.type ?? 'all';
    assert(['all','sale','receipt','purchase','payment','contra','journal'].includes(type),'Choose All Items, Sales, Receipt, Purchase, Payment, Contra or Journal.');
    const rows=this.db.prepare(`SELECT v.id,v.type,v.number,v.date,v.customer_id,v.account_id,v.amount,l.name AS customer_name,l.kind AS party_kind,a.name AS account_name,v.details AS mode_details
      FROM vouchers v JOIN ledgers l ON l.id=v.customer_id JOIN ledgers a ON a.id=v.account_id
      WHERE (? IS NULL OR v.date>=?) AND (? IS NULL OR v.date<=?) AND (?='all' OR v.type=?)
      ORDER BY v.date,v.type,v.number,v.id`).all(from,from,to,to,type,type).map(({mode_details,...row})=>{
        const general=row.type==='journal' && isGeneralJournal(mode_details);
        return {...voucherAliases(row,general),...(general?{particulars:'Multiple Accounts'}:{})};
      });
    return {filter:{from,to,type},rows,totals:{debit:rows.filter(v=>['sale','payment'].includes(v.type)).reduce((sum,v)=>sum+v.amount,0),credit:rows.filter(v=>['receipt','purchase','contra','journal'].includes(v.type)).reduce((sum,v)=>sum+v.amount,0)}};
  }
  statement(ledgerId, period = {}) {
    return this.#readSnapshot(()=>this.#statement(ledgerId,period));
  }
  #statement(ledgerId,period){
    const {from,to}=reportPeriod(period);
    const ledger = this.ledger(ledgerId);
    // Managed master openings are scalar starting balances, not dated vouchers.
    // The books-date label does not switch them off in earlier report periods.
    const masterOpening=(this.calendarConfigured || openingApplies(to,this.openingDate))?ledger.opening_balance:0;
    this.#checkOpeningPeriod({from,to},masterOpening!==0);
    const rows = this.db.prepare(`SELECT v.id,v.type,v.number,v.date,v.narration,p.side,p.amount,
      CASE WHEN v.type='journal' AND json_extract(v.details,'$.journal_mode')='general'
      THEN CASE WHEN (SELECT COUNT(*) FROM postings all_lines WHERE all_lines.voucher_id=v.id)>2 THEN 'Multiple Accounts'
      ELSE (SELECT opposite.name FROM postings other JOIN ledgers opposite ON opposite.id=other.ledger_id WHERE other.voucher_id=v.id AND other.ledger_id<>p.ledger_id LIMIT 1) END
      WHEN v.customer_id=p.ledger_id THEN a.name ELSE c.name END AS particulars
      FROM postings p JOIN vouchers v ON v.id=p.voucher_id JOIN ledgers a ON a.id=v.account_id JOIN ledgers c ON c.id=v.customer_id
      WHERE p.ledger_id=? ORDER BY v.date,v.id`).all(ledger.id);
    const movement=row=>row.side==='debit'?row.amount:-row.amount;
    const opening=masterOpening+(from?rows.filter(row=>row.date<from).reduce((sum,row)=>sum+movement(row),0):0);
    let balance=opening;
    const selected=rows.filter(row=>(!from || row.date>=from) && (!to || row.date<=to));
    return {ledger,period:{from,to},opening,rows:selected.map(row=>{balance+=movement(row);return {...row,balance};}),balance};
  }
  monthlySummary(ledgerId) {
    return this.#readSnapshot(()=>this.#monthlySummary(ledgerId));
  }
  #monthlySummary(ledgerId){
    const fiscalPeriod={from:this.calendar.financial_year_from,to:this.calendar.financial_year_to};
    const statement=this.statement(ledgerId,fiscalPeriod);
    const lastVoucherDate=this.db.prepare('SELECT MAX(date) AS date FROM vouchers').get().date;
    const initialWorkingDate=this.calendarConfigured?this.calendar.books_from:null;
    const displayThrough=initialWorkingDate && (!lastVoucherDate || initialWorkingDate>lastVoucherDate)?initialWorkingDate:lastVoucherDate;
    let closing=statement.opening;
    const rows=monthPeriods(fiscalPeriod).map(({month,from,to})=>{
      const movements=statement.rows.filter(row=>row.date>=from && row.date<=to);
      const debit=movements.filter(row=>row.side==='debit').reduce((sum,row)=>sum+row.amount,0);
      const credit=movements.filter(row=>row.side==='credit').reduce((sum,row)=>sum+row.amount,0);
      const opening=closing;closing+=debit-credit;
      return {month,from,to,opening,debit,credit,closing,display_active:Boolean(displayThrough && from<=displayThrough)};
    });
    return {ledger:statement.ledger,fiscal_period:fiscalPeriod,period:fiscalPeriod,last_voucher_date:lastVoucherDate,opening:statement.opening,rows,
      totals:{debit:rows.reduce((sum,row)=>sum+row.debit,0),credit:rows.reduce((sum,row)=>sum+row.credit,0),closing}};
  }
  trialBalance(period={}) {
    return this.#readSnapshot(()=>this.#trialBalance(period));
  }
  #trialBalance(period){
    const {from,to}=reportPeriod(period);
    const active=this.calendarConfigured || openingApplies(to,this.openingDate),openings=new Map(active?this.db.prepare('SELECT ledger_id,amount FROM ledger_openings').all().map(row=>[row.ledger_id,row.amount]):[]);
    this.#checkOpeningPeriod({from,to},openings.size>0);
    const rows=this.db.prepare(`SELECT l.id,l.name,l.kind,
      COALESCE(SUM(CASE WHEN ? IS NOT NULL AND v.date<? THEN CASE WHEN p.side='debit' THEN p.amount ELSE -p.amount END ELSE 0 END),0) AS opening,
      COALESCE(SUM(CASE WHEN (? IS NULL OR v.date>=?) AND p.side='debit' THEN p.amount ELSE 0 END),0) AS debit,
      COALESCE(SUM(CASE WHEN (? IS NULL OR v.date>=?) AND p.side='credit' THEN p.amount ELSE 0 END),0) AS credit
      FROM ledgers l LEFT JOIN (postings p JOIN vouchers v ON v.id=p.voucher_id)
      ON p.ledger_id=l.id AND (? IS NULL OR v.date<=?) GROUP BY l.id ORDER BY l.name COLLATE NOCASE`)
      .all(from,from,from,from,from,from,to,to).map(row=>({...row,opening:row.opening+(openings.get(row.id) ?? 0),balance:row.opening+(openings.get(row.id) ?? 0)+row.debit-row.credit}));
    const totals=rows.reduce((sum,row)=>({debit:sum.debit+Math.max(row.balance,0),credit:sum.credit+Math.max(-row.balance,0)}),{debit:0,credit:0});
    return {period:{from,to},opening_balances:openingSummary(this.db,active,this.openingDate),rows,totals:{...totals,balanced:totals.debit===totals.credit}};
  }
  financialReports(period={}) {
    // Both reports reuse the same ledger balances and period movements.
    return financialReports(this.trialBalance(period));
  }
  state() {
    return this.#readSnapshot(()=>this.#state());
  }
  #state(){
    const totals = this.db.prepare(`SELECT COALESCE(SUM(CASE WHEN side='debit' THEN amount ELSE 0 END),0) AS debit,
      COALESCE(SUM(CASE WHEN side='credit' THEN amount ELSE 0 END),0) AS credit FROM postings`).get();
    const unbalanced = this.db.prepare(`SELECT voucher_id FROM postings GROUP BY voucher_id HAVING SUM(CASE WHEN side='debit' THEN amount ELSE -amount END)<>0`).all();
    return {
      company: this.companyName,calendar:{...this.calendar},ledgers: this.ledgers(),opening_balances:openingSummary(this.db,true,this.openingDate),
      vouchers: this.db.prepare(`SELECT v.*,l.name AS customer_name,l.kind AS party_kind,a.name AS account_name FROM vouchers v JOIN ledgers l ON l.id=v.customer_id JOIN ledgers a ON a.id=v.account_id ORDER BY v.date,v.id`).all().map(row => ({...voucherAliases(row),...(row.type==='journal' && isGeneralJournal(row.details)?{entries:generalJournalEntries(this.db,row.id)}:{}),bill:this.billForSale(row.id),allocations:this.allocations(row.id),details:JSON.parse(row.details)})),
      outstanding: this.outstanding(),payables:this.payables(),totals: { ...totals, balanced: totals.debit === totals.credit && unbalanced.length === 0 }
    };
  }
}
