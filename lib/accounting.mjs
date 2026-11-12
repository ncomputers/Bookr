import { DatabaseSync } from 'node:sqlite';
import {DEFAULT_COMPANY_CURRENCY,supportsCompanyDenominations} from '../public/company-currency.js';
import { expandAccountingSchema,initializeLedgerGroupSchema,initializeOpeningSchema,initializeGstLedgerSchema,initializeInventorySchema } from './schema.mjs';
import { Inventory } from './inventory.mjs';
import { financialReports } from './financial-reports.mjs';
import {OPENING_DATE,OPENING_LIMIT,openingApplies,crossesOpeningDate,withOpening,openingSummary} from './opening-balances.mjs';
import {initializePartyOpeningSchema,openingBills,writeOpeningBills} from './party-openings.mjs';
import {initializeBillTermsSchema,normalizeBillTerms,withBillTerms,writeBillTerms} from './bill-terms.mjs';
import {initializeGeneralJournalSchema,isGeneralJournal,generalJournalEntries,saveGeneralJournal} from './general-journal.mjs';
import {BookError} from './errors.mjs';
import {LEGACY_COMPANY_DATES} from './company-calendar.mjs';
import {normalizeGstin,normalizeRegistrationType,stateNameFromGstin,determineSupplyType,calculateLineGst} from './gst.mjs';
import {initialFinancialYearTo,monthPeriods} from '../public/calendar-values.js';
import {normalizeCurrentPeriod} from './company-period.mjs';
import {ledgerGroups} from '../public/ledger-groups.js';
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
  if(input.original_invoice!==undefined){
    assert(input.original_invoice && typeof input.original_invoice==='object' && !Array.isArray(input.original_invoice),'Enter valid original invoice details.');
    const number=textField(input.original_invoice.number,120,'Original invoice number');
    const date=textField(input.original_invoice.date,10,'Original invoice date');
    assert(!date || validDate(date),'Enter a valid original invoice date.');
    result.original_invoice={number,date};
  }
  if(input.lines!==undefined){
    assert(Array.isArray(input.lines) && input.lines.length>0 && input.lines.length<=100, 'Enter between 1 and 100 voucher lines.');
    result.lines = input.lines.map(line => {
      assert(line && typeof line==='object' && !Array.isArray(line), 'Enter valid line details.');
      assert(Number.isSafeInteger(line.ledger_id) && line.ledger_id>0, 'Choose a valid ledger for each line.');
      assert(Number.isSafeInteger(line.amount) && line.amount>0 && line.amount<=100000000000, 'Enter a positive amount with at most two decimal places.');
      return {
        ledger_id: line.ledger_id,
        amount: line.amount,
        ...(line.description ? {description: textField(line.description, 200, 'Line description')} : {}),
        ...(line.hsn_sac ? {hsn_sac: textField(line.hsn_sac, 20, 'Line HSN/SAC')} : {}),
        ...(line.gst_rate !== undefined ? {gst_rate: line.gst_rate} : {}),
        ...(line.cgst_amount !== undefined ? {cgst_amount: line.cgst_amount} : {}),
        ...(line.sgst_amount !== undefined ? {sgst_amount: line.sgst_amount} : {}),
        ...(line.igst_amount !== undefined ? {igst_amount: line.igst_amount} : {}),
        ...(line.total_amount !== undefined ? {total_amount: line.total_amount} : {})
      };
    });
  }
  if(input.gst!==undefined){
    result.gst = input.gst;
  }
  if (input.invoice_mode !== undefined) {
    result.invoice_mode = String(input.invoice_mode);
  }
  if (input.item_lines !== undefined) {
    assert(Array.isArray(input.item_lines) && input.item_lines.length > 0 && input.item_lines.length <= 100, 'Enter between 1 and 100 item lines.');
    result.item_lines = input.item_lines.map(line => {
      assert(line && typeof line === 'object' && !Array.isArray(line), 'Enter valid item line details.');
      assert(Number.isSafeInteger(line.item_id) && line.item_id > 0, 'Choose a valid stock item.');
      assert(typeof line.quantity === 'number' && Number.isFinite(line.quantity) && line.quantity > 0, 'Enter a positive item quantity.');
      assert(Number.isSafeInteger(line.rate) && line.rate >= 0, 'Enter a valid item rate.');
      assert(Number.isSafeInteger(line.amount) && line.amount > 0 && line.amount <= 100000000000, 'Enter a positive item amount.');
      return {
        item_id: line.item_id,
        quantity: line.quantity,
        rate: line.rate,
        amount: line.amount,
        ...(line.item_name ? {item_name: textField(line.item_name, 120, 'Item name')} : {}),
        ...(line.part_number ? {part_number: textField(line.part_number, 120, 'Part number')} : {}),
        ...(line.godown_id ? {godown_id: Number(line.godown_id)} : {}),
        ...(line.godown_name ? {godown_name: textField(line.godown_name, 120, 'Godown name')} : {}),
        ...(line.unit_id ? {unit_id: Number(line.unit_id)} : {}),
        ...(line.unit_symbol ? {unit_symbol: textField(line.unit_symbol, 20, 'Unit symbol')} : {}),
        ...(line.decimal_places !== undefined ? {decimal_places: Number(line.decimal_places)} : {}),
        ...(line.hsn_sac ? {hsn_sac: textField(line.hsn_sac, 20, 'HSN/SAC')} : {}),
        ...(line.gst_rate !== undefined ? {gst_rate: Number(line.gst_rate)} : {}),
        ...(line.cgst_amount !== undefined ? {cgst_amount: Number(line.cgst_amount)} : {}),
        ...(line.sgst_amount !== undefined ? {sgst_amount: Number(line.sgst_amount)} : {}),
        ...(line.igst_amount !== undefined ? {igst_amount: Number(line.igst_amount)} : {}),
        ...(line.total_amount !== undefined ? {total_amount: Number(line.total_amount)} : {}),
        ...(line.description ? {description: textField(line.description, 200, 'Line description')} : {})
      };
    });
  }
  if(input.cost_allocations!==undefined){
    assert(Array.isArray(input.cost_allocations) && input.cost_allocations.length>0 && input.cost_allocations.length<=100, 'Enter valid cost allocations.');
    result.cost_allocations = input.cost_allocations.map(ca => {
      assert(ca && typeof ca==='object' && !Array.isArray(ca), 'Enter valid cost allocation details.');
      assert(Number.isSafeInteger(ca.ledger_id) && ca.ledger_id>0, 'Choose a valid ledger for cost allocation.');
      assert(Number.isSafeInteger(ca.category_id) && ca.category_id>0, 'Choose a valid category for cost allocation.');
      assert(Array.isArray(ca.allocations) && ca.allocations.length>0 && ca.allocations.length<=100, 'Enter valid centre allocations.');
      return {
        ledger_id: ca.ledger_id,
        category_id: ca.category_id,
        ...(ca.category_name ? {category_name: textField(ca.category_name, 120, 'Category name')} : {}),
        allocations: ca.allocations.map(a => {
          assert(a && typeof a==='object' && !Array.isArray(a), 'Enter valid centre allocation.');
          assert(Number.isSafeInteger(a.centre_id) && a.centre_id>0, 'Choose a valid cost centre.');
          assert(Number.isSafeInteger(a.amount) && a.amount>0 && a.amount<=100000000000, 'Enter a positive cost centre amount.');
          return {
            centre_id: a.centre_id,
            amount: a.amount,
            ...(a.centre_name ? {centre_name: textField(a.centre_name, 120, 'Cost centre name')} : {})
          };
        })
      };
    });
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
  const bankDate=input.bank_date?textField(input.bank_date,10,'Bank date'):null;
  if(bankDate)assert(validDate(bankDate),'Enter a valid bank date.');
  const result={account_id:account.id,transaction_type:transactionType,amount,instrument_number:instrumentNumber,instrument_date:instrumentDate,bank_name:bankName,cheque_range:chequeRange};
  if(bankDate)result.bank_date=bankDate;
  return result;
}
const denominations=['2000','1000','500','200','100','50','20','10','5','2','1'];
const postingGroups=ledgerGroups.filter(group=>group.kind!=='general');
function groupForLedger(input,kind,previous){
  const supplied=Object.hasOwn(input,'group_id')||Object.hasOwn(input,'group_name');
  if(!supplied&&previous?.group_name){
    const saved=ledgerGroups.find(group=>group.name===previous.group_name && (group.group_id??null)===(previous.group_id??null));
    if(saved)return saved;
  }
  const selected=supplied
    ? ledgerGroups.find(group=>{
        const matchName = input.group_name === undefined || group.name === input.group_name;
        const matchId = input.group_id === undefined || (group.group_id ?? null) === (input.group_id ?? null);
        return matchName && matchId;
      })
    : postingGroups.find(group=>group.kind===kind);
  assert(selected,'Choose a listed ledger group.');
  assert(selected.kind===kind,'The ledger role must match its selected group.');
  return selected;
}
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
  return {...values,...contraAliases(values),...(general?{journal_mode:'general'}:row.type==='journal'?{debit_ledger_id:row.account_id,debit_ledger_name:row.account_name,credit_ledger_id:row.customer_id,credit_ledger_name:row.customer_name,debit_amount:row.amount,credit_amount:row.amount}:{}),...(settlement?{ledger_id:row.customer_id,ledger_name:row.customer_name,ledger_kind:party_kind}:{}),...((row.type==='purchase' || row.type==='debit_note' || (row.type==='journal' && !general) || (payment && party_kind==='supplier'))?{supplier_id:row.customer_id,supplier_name:row.customer_name}:{})};
}

export class Book {
  constructor(path = ':memory:',{companyName='Bookr Demo Fictional',companyState='Not Applicable',companyGstin='',booksFrom=null,financialYearTo=null,financialYearFrom=null,enforceCompanyPeriod=booksFrom!==null}={}) {
    assert(typeof companyName==='string' && companyName.trim().length>0 && companyName.length<=120,'Enter a valid company name.');
    this.companyName=companyName.trim();this.companyState=companyState;this.companyGstin=companyGstin;this.currency=DEFAULT_COMPANY_CURRENCY;
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
        kind TEXT NOT NULL CHECK(kind IN ('customer','supplier','cash','bank','sales','purchase','expense','income','capital','general')), alias TEXT NOT NULL DEFAULT '',
        revision INTEGER NOT NULL DEFAULT 1,group_id INTEGER,group_name TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS vouchers(
        id INTEGER PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('sale','receipt','purchase','payment','contra','journal','credit_note','debit_note')),
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
    initializeLedgerGroupSchema(this.db);
    initializeGstLedgerSchema(this.db);
    initializeInventorySchema(this.db);
    this.inventory = new Inventory(this.db);
    for(const group of postingGroups)this.db.prepare('UPDATE ledgers SET group_id=?,group_name=? WHERE kind=? AND (group_id IS NULL OR group_name=\'\')').run(group.group_id,group.name,group.kind);
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
    for(const group of postingGroups)this.db.prepare('UPDATE ledgers SET group_id=?,group_name=? WHERE kind=? AND (group_id IS NULL OR group_name=\'\')').run(group.group_id,group.name,group.kind);
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
  deleteLedger(id) {
    return this.transaction(() => {
      const numericId = Number(id);
      assert(Number.isSafeInteger(numericId) && numericId > 0, 'Choose a valid ledger.');
      const ledger = this.db.prepare('SELECT * FROM ledgers WHERE id=?').get(numericId);
      assert(ledger, 'Ledger not found.', 404);
      assert(numericId !== 1 && ledger.name !== 'Cash', 'Built-in ledgers cannot be deleted.', 400);

      const inPostings = this.db.prepare('SELECT 1 FROM postings WHERE ledger_id=? LIMIT 1').get(numericId);
      assert(!inPostings, 'Cannot delete ledger with existing transactions.', 400);

      const inVouchers = this.db.prepare('SELECT 1 FROM vouchers WHERE customer_id=? OR account_id=? LIMIT 1').get(numericId, numericId);
      assert(!inVouchers, 'Cannot delete ledger with existing transactions.', 400);

      const inBills = this.db.prepare('SELECT 1 FROM bills b JOIN vouchers v ON v.id=b.sale_id WHERE v.customer_id=? LIMIT 1').get(numericId);
      assert(!inBills, 'Cannot delete ledger with existing transactions.', 400);

      this.db.prepare('DELETE FROM ledger_openings WHERE ledger_id=?').run(numericId);
      this.db.prepare('DELETE FROM opening_bills WHERE ledger_id=?').run(numericId);
      this.db.prepare('DELETE FROM bank_accounts WHERE ledger_id=?').run(numericId);
      this.db.prepare('DELETE FROM ledgers WHERE id=?').run(numericId);
      return {deleted: true, id: numericId, name: ledger.name};
    });
  }
  saveLedger(input,id=null) {
    assert(input && typeof input==='object' && !Array.isArray(input),'Enter ledger details.');
    const previous=id===null?null:this.masterLedger(id);
    const requested=input.group_name?ledgerGroups.find(group=>group.name===input.group_name && (group.group_id??null)===(input.group_id??null)):null;
    const kind=previous?.kind ?? input.kind ?? requested?.kind;
    assert(['customer','supplier','bank','cash','sales','purchase','expense','income','capital','general'].includes(kind),'Choose a supported ledger group.');
    assert(!previous || input.kind===undefined || input.kind===kind,'A saved ledger must keep its group.');
    groupForLedger(input,kind,previous);
    if(kind==='customer')return this.saveCustomer(input,id);
    if(kind==='supplier')return this.saveSupplier(input,id);
    if(kind==='bank')return this.saveBank(input,id);
    return this.saveAccount(input,id,kind);
  }
  saveAccount(input,id=null,kind=input?.kind) {
    assert(['cash','sales','purchase','expense','income','capital','general'].includes(kind),'Choose a supported account ledger group.');
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
      const group=groupForLedger(input,kind,previous);
      const bank=kind==='bank'?bankLedgerDetails(input.bank,previous?.bank,this.companyName):null;
      assert(!previous || input.revision === previous.revision,
        'This ledger changed after you opened it. Reopen it before saving.', 409);
      assert(input.opening_date===undefined || input.opening_date===this.openingDate,`Opening balances must use this company's books date, ${this.openingDate}.`);
      const opening=input.opening_balance===undefined?(previous?.opening_balance ?? 0):input.opening_balance;
      assert(Number.isSafeInteger(opening) && Math.abs(opening)<=OPENING_LIMIT,'Enter an opening balance in whole paise within the supported limit.');
      const party=['customer','supplier'].includes(kind);
      const isBalanceSheet = group && (group.nature === 'Assets' || group.nature === 'Liabilities');
      assert(opening===0 || ['cash','capital','bank','customer','supplier'].includes(kind) || isBalanceSheet,'Opening balances currently support balance sheet ledgers.');
      assert(party || input.opening_bills===undefined || (Array.isArray(input.opening_bills) && input.opening_bills.length===0),'Opening bill references require a customer or supplier ledger.');
      const bills=input.opening_bills===undefined?(opening===0?[]:previous?.opening_bills ?? []):input.opening_bills;
      if(opening!==0 && previous){
        const earlier=this.db.prepare('SELECT 1 FROM postings p JOIN vouchers v ON v.id=p.voucher_id WHERE p.ledger_id=? AND v.date<? LIMIT 1').get(previous.id,this.openingDate);
        assert(!earlier,`This opening-balance version cannot combine a nonzero opening with vouchers before ${this.openingDate} in the same ledger.`);
      }
      assert(!this.db.prepare('SELECT id FROM ledgers WHERE name=? COLLATE NOCASE AND id<>?').get(name, previous?.id ?? 0),
        'A ledger with this name already exists.');
      const indirect=['expense','income'].includes(kind);
      let gstin='',gstRegType='Unregistered',taxType='',taxRate=0;
      if(['customer','supplier'].includes(kind)){
        if(input.gstin!==undefined)gstin=normalizeGstin(input.gstin);
        else gstin=previous?.gstin??'';
        if(input.gst_registration_type!==undefined)gstRegType=normalizeRegistrationType(input.gst_registration_type,Boolean(gstin));
        else gstRegType=previous?.gst_registration_type??normalizeRegistrationType('',Boolean(gstin));
      }
      if(group?.name==='Duties & Taxes'||input.tax_type!==undefined||input.tax_rate!==undefined){
        taxType=(input.tax_type??previous?.tax_type??'').trim();
        taxRate=Number(input.tax_rate??previous?.tax_rate??0);
        assert(Number.isFinite(taxRate)&&taxRate>=0&&taxRate<=100,'Tax rate must be between 0 and 100.');
      }else{
        taxType=previous?.tax_type??'';
        taxRate=previous?.tax_rate??0;
      }
      const defaultPartyState=(stateNameFromGstin(gstin)||(indirect?'':'Not Applicable'));
      const mailingName = input.mailing_name ?? (indirect?(previous?.mailing_name ?? ''):((!previous?.mailing_name || previous.mailing_name === previous.name) ? name : previous.mailing_name));
      const stateToUse = input.state !== undefined ? input.state : (previous?.state ?? defaultPartyState);
      const mailing = [textField(mailingName,120,'Mailing name'),textField(input.address,1000,'Address',previous?.address),
        textField(stateToUse,120,'State',previous?.state ?? defaultPartyState),textField(input.country,120,'Country',previous?.country ?? (indirect?'':'India')),textField(input.pincode,20,'Pincode',previous?.pincode)];
      if (previous) {
        this.db.prepare('UPDATE ledgers SET name=?,alias=?,mailing_name=?,address=?,state=?,country=?,pincode=?,group_id=?,group_name=?,gstin=?,gst_registration_type=?,tax_type=?,tax_rate=?,revision=revision+1 WHERE id=?').run(name, alias,...mailing,group.group_id,group.name,gstin,gstRegType,taxType,taxRate,previous.id);
        if(bank)this.db.prepare('INSERT INTO bank_accounts(ledger_id,details) VALUES(?,?) ON CONFLICT(ledger_id) DO UPDATE SET details=excluded.details').run(previous.id,JSON.stringify(bank));
        this.#writeOpening(previous.id,opening);
        if(party)writeOpeningBills(this.db,previous.id,bills,opening,kind,assert,this.openingDate);
        return this.ledger(previous.id,kind);
      }
      const result = this.db.prepare('INSERT INTO ledgers(name,kind,alias,mailing_name,address,state,country,pincode,group_id,group_name,gstin,gst_registration_type,tax_type,tax_rate) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(name,kind,alias,...mailing,group.group_id,group.name,gstin,gstRegType,taxType,taxRate);
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
      const details = JSON.parse(row.details);
      return { ...voucherAliases(row),...(row.type==='journal' && isGeneralJournal(row.details)?{entries:generalJournalEntries(this.db,row.id)}:{}),...(details.lines?{lines:details.lines}:{}),...(details.item_lines?{item_lines:details.item_lines}:{}),bill:this.billForSale(row.id), allocations:this.allocations(row.id), details, postings: this.db.prepare(`SELECT p.*,l.name,l.name AS ledger_name FROM postings p JOIN ledgers l ON l.id=p.ledger_id
        WHERE voucher_id=? ORDER BY side DESC`).all(row.id) };
    });
  }
  postings(voucherId) {
    return this.db.prepare('SELECT p.*, l.name AS ledger_name FROM postings p JOIN ledgers l ON l.id=p.ledger_id WHERE voucher_id=? ORDER BY side DESC').all(Number(voucherId));
  }
  ensureTaxLedger(taxName, taxType) {
    let row = this.db.prepare('SELECT id FROM ledgers WHERE name=? COLLATE NOCASE').get(taxName);
    if (!row) {
      const group = ledgerGroups.find(g => g.name === 'Duties & Taxes');
      const result = this.db.prepare(`
        INSERT INTO ledgers(name, kind, alias, mailing_name, address, state, country, pincode, group_id, group_name, gstin, gst_registration_type, tax_type, tax_rate)
        VALUES(?, 'general', '', '', '', 'Not Applicable', 'India', '', ?, 'Duties & Taxes', '', 'Unregistered', ?, 0)
      `).run(taxName, group?.group_id ?? 20, taxType);
      return Number(result.lastInsertRowid);
    }
    return row.id;
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
  saveVoucher(input, id = null, {currentPeriod=null} = {}) {
    const selectedPeriod=currentPeriod===null?null:normalizeCurrentPeriod(currentPeriod);
    return this.transaction(() => {
      assert(input && typeof input === 'object' && !Array.isArray(input), 'Enter voucher details.');
      assert(supportsCompanyDenominations(this.currency)||input.details?.bank?.denominations==null,'Cash denominations currently support only the default currency labels.');
      if(selectedPeriod){
        assert(validDate(input.date)&&input.date>=selectedPeriod.from&&input.date<=selectedPeriod.to,'Voucher date must be within the selected current period: '+selectedPeriod.from+' to '+selectedPeriod.to+'.');
        if(this.companyPeriod)assert(input.date>=this.companyPeriod.from,'Voucher date must be on or after this company\'s books beginning, '+this.companyPeriod.from+'.');
      }else if(this.companyPeriod)assert(validDate(input.date) && input.date>=this.companyPeriod.from && input.date<=this.companyPeriod.to,'Voucher date must be within this company\'s supported books period: '+this.companyPeriod.from+' to '+this.companyPeriod.to+'.');
      const previous = id === null ? null : this.voucher(id);
      const type = previous?.type ?? input.type;
      if(type==='journal'){
        const general=previous?isGeneralJournal(previous.details):input.entries!==undefined;
        if(general)return saveGeneralJournal({db:this.db,input,previous,check:assert,ledger:id=>this.ledger(id),isDate:validDate,checkOpening:(...ledgers)=>this.#checkOpeningVoucherDate(input.date,...ledgers),readVoucher:id=>this.voucher(id)});
        assert(!Object.hasOwn(input,'entries'),'A saved Journal must keep its entry mode.');return this.#saveJournal(input,previous);
      }
      assert(['sale','receipt','purchase','payment','contra','credit_note','debit_note'].includes(type),'Choose Sales, Receipt, Purchase, Payment, Contra, Credit Note or Debit Note.');
      const payable=type==='purchase' || type==='payment' || type==='debit_note',invoice=type==='sale' || type==='purchase' || type==='credit_note' || type==='debit_note',contra=type==='contra';
      assert(!previous || (Number.isSafeInteger(input.revision) && input.revision === previous.revision), 'This voucher changed after you opened it. Reopen it before saving.', 409);
      assert(!previous || input.type===undefined || input.type===previous.type,'A saved voucher must keep its voucher type.');
      if(contra)assert(!Object.hasOwn(input,'bill') && !Object.hasOwn(input,'allocations') && input.sale_id==null,'Contra vouchers cannot contain bills or settlement allocations.');
      let reference;
      const date = input.date;
      assert(validDate(date), 'Enter a valid date.');
      const itemLinesInput = input.item_lines ?? input.details?.item_lines;
      let itemLines = null;
      let lines = input.lines ?? input.details?.lines;
      if (itemLinesInput !== undefined) {
        assert(invoice, 'Item lines are supported only for Sales, Purchase, Credit Notes and Debit Notes.');
        assert(Array.isArray(itemLinesInput) && itemLinesInput.length > 0 && itemLinesInput.length <= 100, 'Enter between 1 and 100 item lines.');
        itemLines = [];
        const defaultGodown = this.inventory.getDefaultGodown();
        const fallbackLedgerId = payable
          ? (this.db.prepare("SELECT id FROM ledgers WHERE kind='purchase' LIMIT 1").get()?.id)
          : (this.db.prepare("SELECT id FROM ledgers WHERE kind='sales' LIMIT 1").get()?.id);
        for (const il of itemLinesInput) {
          assert(il && typeof il === 'object' && !Array.isArray(il), 'Enter valid item line details.');
          const stockItem = this.inventory.getStockItem(il.item_id);
          assert(stockItem, `Stock item #${il.item_id} not found.`);
          const qty = Number(il.quantity);
          assert(Number.isFinite(qty) && qty > 0, 'Enter a positive item quantity.');
          const rate = Math.round(Number(il.rate) || 0);
          assert(Number.isSafeInteger(rate) && rate >= 0, 'Enter a valid rate.');
          const lineAmt = Math.round(qty * rate);
          if (il.amount !== undefined) {
            assert(il.amount === lineAmt, 'Item line amount must equal quantity multiplied by rate.');
          }
          const godownId = il.godown_id ? Number(il.godown_id) : (stockItem.godown_id || defaultGodown?.id || null);
          if (godownId) assert(this.inventory.getGodown(godownId), `Godown #${godownId} not found.`);
          const hsn = (il.hsn_sac !== undefined && il.hsn_sac !== null ? String(il.hsn_sac).trim() : stockItem.hsn_sac) || '';
          const gstRate = (il.gst_rate !== undefined && il.gst_rate !== null ? Number(il.gst_rate) : stockItem.gst_rate) || 0;
          const ledgerId = il.ledger_id ? Number(il.ledger_id) : (input.account_id ? Number(input.account_id) : fallbackLedgerId);
          itemLines.push({
            item_id: stockItem.id,
            item_name: stockItem.name,
            part_number: stockItem.part_number,
            godown_id: godownId,
            quantity: qty,
            rate: rate,
            unit_symbol: stockItem.unit_symbol,
            decimal_places: stockItem.decimal_places,
            amount: lineAmt,
            hsn_sac: hsn,
            gst_rate: gstRate,
            ledger_id: ledgerId,
            description: il.description ?? ''
          });
        }
        if (lines === undefined) {
          lines = itemLines.map(il => ({
            ledger_id: il.ledger_id,
            amount: il.amount,
            hsn_sac: il.hsn_sac,
            gst_rate: il.gst_rate,
            description: il.description || il.item_name
          }));
        }
      }
      let calculatedAmount = input.amount;
      let linesTotal = 0;
      if (lines !== undefined) {
        assert(invoice, 'Multi-line entries are supported only for Sales, Purchase, Credit Notes and Debit Notes.');
        assert(Array.isArray(lines) && lines.length > 0 && lines.length <= 100, 'Enter between 1 and 100 voucher lines.');
        for (const line of lines) {
          assert(line && typeof line === 'object' && !Array.isArray(line), 'Enter valid line details.');
          assert(Number.isSafeInteger(line.ledger_id) && line.ledger_id > 0, 'Choose a valid ledger for each line.');
          assert(Number.isSafeInteger(line.amount) && line.amount > 0 && line.amount <= 100000000000, 'Enter a positive amount with at most two decimal places.');
          if (line.hsn_sac !== undefined && line.hsn_sac !== null) {
            assert(typeof line.hsn_sac === 'string' && line.hsn_sac.trim().length <= 20, 'HSN/SAC must be at most 20 characters.');
          }
          if (line.gst_rate !== undefined && line.gst_rate !== null) {
            assert(typeof line.gst_rate === 'number' && Number.isFinite(line.gst_rate) && line.gst_rate >= 0 && line.gst_rate <= 100, 'GST rate must be a percentage between 0 and 100.');
          }
          linesTotal += line.amount;
          assert(linesTotal <= 100000000000, 'Voucher total is too large.');
        }
        calculatedAmount = linesTotal;
      }
      if(type==='payment')assert(input.ledger_id===undefined || input.supplier_id===undefined || Number(input.ledger_id)===Number(input.supplier_id),'Choose one payment ledger; ledger_id and supplier_id conflict.');
      if(type==='receipt')assert(input.ledger_id===undefined || input.customer_id===undefined || Number(input.ledger_id)===Number(input.customer_id),'Choose one receipt ledger; ledger_id and customer_id conflict.');
      const customer = contra?this.ledger(input.source_id):type==='payment'?this.ledger(input.ledger_id ?? input.supplier_id):type==='receipt'?this.ledger(input.ledger_id ?? input.customer_id):(['sale','credit_note'].includes(type))?this.ledger(input.customer_id):this.ledger(input.supplier_id);
      let hasGst = false, gstSummary = null, enrichedLines = null;
      let cgstTotal = 0, sgstTotal = 0, igstTotal = 0, totalTax = 0, isInterState = false;
      if (invoice && lines !== undefined) {
        hasGst = lines.some(line => line.gst_rate && line.gst_rate > 0);
        if (hasGst) {
          const companyState = this.companyState || (this.companyGstin ? stateNameFromGstin(this.companyGstin) : '') || 'Not Applicable';
          const partyState = customer.state || (customer.gstin ? stateNameFromGstin(customer.gstin) : '') || (input.details?.party?.state ?? 'Not Applicable');
          const supplyType = determineSupplyType(companyState, partyState);
          isInterState = supplyType === 'inter_state';
          enrichedLines = [];
          for (const line of lines) {
            const lineGst = calculateLineGst(line.amount, line.gst_rate ?? 0, !isInterState);
            cgstTotal += lineGst.cgst_amount;
            sgstTotal += lineGst.sgst_amount;
            igstTotal += lineGst.igst_amount;
            totalTax += lineGst.total_tax;
            enrichedLines.push({
              ledger_id: line.ledger_id,
              amount: line.amount,
              hsn_sac: line.hsn_sac ?? '',
              gst_rate: line.gst_rate ?? 0,
              cgst_amount: lineGst.cgst_amount,
              sgst_amount: lineGst.sgst_amount,
              igst_amount: lineGst.igst_amount,
              total_amount: lineGst.total_amount,
              ...(line.description !== undefined ? { description: line.description } : {})
            });
          }
          calculatedAmount = linesTotal + totalTax;
          gstSummary = {
            supply_type: supplyType,
            company_state: companyState,
            party_state: partyState,
            taxable_amount: linesTotal,
            cgst_amount: cgstTotal,
            sgst_amount: sgstTotal,
            igst_amount: igstTotal,
            total_tax: totalTax,
            total_amount: calculatedAmount
          };
          if (input.amount !== undefined) {
            assert(input.amount === calculatedAmount || input.amount === linesTotal, 'Voucher amount must equal lines total plus tax.');
          }
        } else if (input.amount !== undefined) {
          assert(input.amount === linesTotal, 'Voucher amount must equal the total of all lines.');
        }
      }
      const amount = calculatedAmount;
      assert(Number.isSafeInteger(amount) && amount > 0 && amount <= 100000000000, 'Enter a positive amount with at most two decimal places.');
      if(type==='sale' || type==='credit_note')assert(['customer','cash'].includes(customer.kind),`Choose a customer or Cash ledger for ${type==='credit_note'?'Credit Note':'Sales'}.`);
      if(type==='purchase' || type==='debit_note')assert(['supplier','cash'].includes(customer.kind),`Choose a supplier or Cash ledger for ${type==='debit_note'?'Debit Note':'Purchases'}.`);
      const cashInvoice=invoice && customer.kind==='cash',cashLabel=type==='purchase'?'Cash Purchases':type==='debit_note'?'Cash Debit Notes':type==='credit_note'?'Cash Credit Notes':'Cash Sales';
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
      const defaultAccountId = lines ? (lines.find(l => {
        try { return this.ledger(l.ledger_id).kind === (payable ? 'purchase' : 'sales'); } catch { return false; }
      })?.ledger_id ?? lines[0].ledger_id) : undefined;
      const selectedAccountId = contra ? input.destination_id : (input.account_id ?? defaultAccountId);
      const account = this.ledger(selectedAccountId, invoice ? (payable ? 'purchase' : 'sales') : undefined);
      this.#checkOpeningVoucherDate(date,customer,account);
      if (lines) {
        for (const line of lines) {
          const lineLedger = this.ledger(line.ledger_id);
          assert(['sales','purchase','expense','income','general'].includes(lineLedger.kind), 'Choose a valid particulars ledger for each line.');
          this.#checkOpeningVoucherDate(date, lineLedger);
        }
      }
      const bankTransfer=contra && customer.kind==='bank' && account.kind==='bank';
      if(contra)assert(['cash','bank'].includes(customer.kind) && ['cash','bank'].includes(account.kind) && customer.id!==account.id && (customer.kind!==account.kind || bankTransfer),'Choose different cash/bank accounts with at least one bank for this Contra.');
      else assert(invoice || ['cash','bank'].includes(account.kind),'Choose a cash or bank account for this settlement.');
      const narration = clean(input.narration, 1000);
      if (input.details !== undefined) {
        assert(input.details && typeof input.details === 'object' && !Array.isArray(input.details), 'Enter valid voucher details.');
      }
      const rawDetails = { ...(previous?.details ?? {}), ...(input.details ?? {}) };
      if (lines !== undefined) rawDetails.lines = enrichedLines ?? lines;
      if (itemLines !== null) rawDetails.item_lines = itemLines;
      if (gstSummary) rawDetails.gst = gstSummary;
      if (input.cost_allocations !== undefined) rawDetails.cost_allocations = input.cost_allocations;
      const entryDetails=voucherDetails(rawDetails);
      if (entryDetails.cost_allocations) {
        for (const ca of entryDetails.cost_allocations) {
          let ledgerAmount;
          if (lines) {
            ledgerAmount = lines.filter(l => l.ledger_id === ca.ledger_id).reduce((sum, l) => sum + l.amount, 0);
          } else {
            assert(ca.ledger_id === account.id || ca.ledger_id === customer.id, 'Cost allocations must belong to a voucher ledger.');
            ledgerAmount = amount;
          }
          const allocTotal = ca.allocations.reduce((sum, a) => sum + a.amount, 0);
          if (allocTotal !== ledgerAmount) {
            throw new BookError('Mismatch between total Cost Centre Allocation and Ledger Amount');
          }
        }
      }
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
        const defaultRef = (payable ? (entryDetails.supplier_invoice?.number || entryDetails.original_invoice?.number) : entryDetails.original_invoice?.number) || String(number);
        this.db.prepare(`INSERT INTO bills(sale_id,reference,amount) VALUES(?,?,?)
          ON CONFLICT(sale_id) DO UPDATE SET reference=excluded.reference,amount=excluded.amount`)
          .run(voucherId,reference ?? previous?.bill?.reference ?? defaultRef,amount);
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
      const partyDebit = type === 'sale' || type === 'payment' || type === 'debit_note';
      const insert = this.db.prepare('INSERT INTO postings(voucher_id,ledger_id,side,amount) VALUES(?,?,?,?)');
      insert.run(voucherId, customer.id, partyDebit ? 'debit' : 'credit', amount);
      if (lines) {
        const consolidated = new Map();
        for (const line of lines) {
          assert(line.ledger_id !== customer.id, 'The party ledger cannot be used as an invoice particulars line.');
          consolidated.set(line.ledger_id, (consolidated.get(line.ledger_id) ?? 0) + line.amount);
        }
        if (hasGst) {
          const isOutward = type === 'sale' || type === 'credit_note';
          const taxPrefix = isOutward ? 'Output ' : 'Input ';
          if (isInterState) {
            if (igstTotal > 0) {
              const igstId = this.ensureTaxLedger(taxPrefix + 'IGST', 'IGST');
              consolidated.set(igstId, (consolidated.get(igstId) ?? 0) + igstTotal);
            }
          } else {
            if (cgstTotal > 0) {
              const cgstId = this.ensureTaxLedger(taxPrefix + 'CGST', 'CGST');
              consolidated.set(cgstId, (consolidated.get(cgstId) ?? 0) + cgstTotal);
            }
            if (sgstTotal > 0) {
              const sgstId = this.ensureTaxLedger(taxPrefix + 'SGST', 'SGST');
              consolidated.set(sgstId, (consolidated.get(sgstId) ?? 0) + sgstTotal);
            }
          }
        }
        for (const [ledgerId, lineAmount] of consolidated) {
          insert.run(voucherId, ledgerId, partyDebit ? 'credit' : 'debit', lineAmount);
        }
        const totals = this.db.prepare(`SELECT SUM(CASE WHEN side='debit' THEN amount ELSE -amount END) AS balance,COUNT(*) AS count FROM postings WHERE voucher_id=?`).get(voucherId);
        assert(totals.balance === 0 && totals.count === (consolidated.size + 1), 'Voucher must contain balanced accounting entries.');
      } else {
        insert.run(voucherId, account.id, partyDebit ? 'credit' : 'debit', amount);
        const totals = this.db.prepare(`SELECT SUM(CASE WHEN side='debit' THEN amount ELSE -amount END) AS balance,COUNT(*) AS count FROM postings WHERE voucher_id=?`).get(voucherId);
        assert(totals.balance === 0 && totals.count === 2, 'Voucher must contain balanced accounting entries.');
      }
      if (itemLines !== null) {
        if (previous) {
          this.inventory.deleteVoucherMovements(voucherId);
        }
        const direction = (type === 'sale' || type === 'debit_note') ? 'outward' : 'inward';
        for (const il of itemLines) {
          if (il.godown_id) {
            this.inventory.recordMovement({
              item_id: il.item_id,
              godown_id: il.godown_id,
              voucher_id: voucherId,
              voucher_type: type,
              date: date,
              direction: direction,
              quantity: il.quantity,
              rate: il.rate,
              value: il.amount
            });
          }
        }
      }
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
    assert(['all','sale','receipt','purchase','payment','contra','journal','credit_note','debit_note'].includes(type),'Choose All Items, Sales, Receipt, Purchase, Payment, Contra, Journal, Credit Note or Debit Note.');
    const rows=this.db.prepare(`SELECT v.id,v.type,v.number,v.date,v.customer_id,v.account_id,v.amount,l.name AS customer_name,l.kind AS party_kind,a.name AS account_name,v.details AS mode_details
      FROM vouchers v JOIN ledgers l ON l.id=v.customer_id JOIN ledgers a ON a.id=v.account_id
      WHERE (? IS NULL OR v.date>=?) AND (? IS NULL OR v.date<=?) AND (?='all' OR v.type=?)
      ORDER BY v.date,v.type,v.number,v.id`).all(from,from,to,to,type,type).map(({mode_details,...row})=>{
        const general=row.type==='journal' && isGeneralJournal(mode_details);
        return {...voucherAliases(row,general),...(general?{particulars:'Multiple Accounts'}:{})};
      });
    return {filter:{from,to,type},rows,totals:{debit:rows.filter(v=>['sale','payment','debit_note'].includes(v.type)).reduce((sum,v)=>sum+v.amount,0),credit:rows.filter(v=>['receipt','purchase','contra','journal','credit_note'].includes(v.type)).reduce((sum,v)=>sum+v.amount,0)}};
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
  monthlySummary(ledgerId,period=null) {
    const selectedPeriod=period===null?null:normalizeCurrentPeriod(period);
    return this.#readSnapshot(()=>this.#monthlySummary(ledgerId,selectedPeriod));
  }
  #monthlySummary(ledgerId,selectedPeriod){
    const initialPeriod={from:this.calendar.financial_year_from,to:this.calendar.financial_year_to},fiscalPeriod=selectedPeriod??initialPeriod;
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
    return {ledger:statement.ledger,fiscal_period:initialPeriod,period:fiscalPeriod,last_voucher_date:lastVoucherDate,opening:statement.opening,rows,
      totals:{debit:rows.reduce((sum,row)=>sum+row.debit,0),credit:rows.reduce((sum,row)=>sum+row.credit,0),closing}};
  }
  trialBalance(period={}) {
    return this.#readSnapshot(()=>this.#trialBalance(period));
  }
  #trialBalance(period){
    const {from,to}=reportPeriod(period);
    const active=this.calendarConfigured || openingApplies(to,this.openingDate),openings=new Map(active?this.db.prepare('SELECT ledger_id,amount FROM ledger_openings').all().map(row=>[row.ledger_id,row.amount]):[]);
    this.#checkOpeningPeriod({from,to},openings.size>0);
    const rows=this.db.prepare(`SELECT l.id,l.name,l.kind,l.group_id,l.group_name,
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
  gstSummary(period = {}) {
    return this.#readSnapshot(() => {
      const {from = null, to = null} = reportPeriod(period);
      const rows = this.db.prepare(`
        SELECT v.id, v.type, v.number, v.date, v.amount, v.details,
               c.name AS party_name, c.gstin AS party_gstin, c.state AS party_state, c.kind AS party_kind
        FROM vouchers v
        JOIN ledgers c ON c.id = v.customer_id
        WHERE v.type IN ('sale', 'credit_note', 'purchase', 'debit_note')
          AND (? IS NULL OR v.date >= ?)
          AND (? IS NULL OR v.date <= ?)
        ORDER BY v.date, v.id
      `).all(from, from, to, to);

      const emptyBucket = () => ({
        taxable_amount: 0,
        cgst_amount: 0,
        sgst_amount: 0,
        igst_amount: 0,
        total_tax: 0,
        total_value: 0,
        count: 0
      });

      const addBucket = (bucket, taxable, cgst, sgst, igst, totalTax, totalVal, mult = 1) => {
        bucket.taxable_amount += taxable * mult;
        bucket.cgst_amount += cgst * mult;
        bucket.sgst_amount += sgst * mult;
        bucket.igst_amount += igst * mult;
        bucket.total_tax += totalTax * mult;
        bucket.total_value += totalVal * mult;
        bucket.count += mult >= 0 ? 1 : 0;
      };

      const outward = {
        b2b: emptyBucket(),
        b2c: emptyBucket(),
        intra_state: emptyBucket(),
        inter_state: emptyBucket(),
        total: emptyBucket()
      };

      const inward = emptyBucket();
      const rateMap = new Map();
      const hsnMap = new Map();

      for (const row of rows) {
        const details = JSON.parse(row.details || '{}');
        const gst = details.gst;
        const lines = details.lines ?? [];
        const isReturn = row.type === 'credit_note' || row.type === 'debit_note';
        const mult = isReturn ? -1 : 1;

        const taxable = gst?.taxable_amount ?? (lines.reduce((s, l) => s + l.amount, 0) || row.amount);
        const cgst = gst?.cgst_amount ?? 0;
        const sgst = gst?.sgst_amount ?? 0;
        const igst = gst?.igst_amount ?? 0;
        const totalTax = gst?.total_tax ?? (cgst + sgst + igst);
        const totalVal = gst?.total_amount ?? (taxable + totalTax);
        const supplyType = gst?.supply_type ?? 'intra_state';
        const isB2B = Boolean(row.party_gstin && row.party_gstin.trim());

        if (row.type === 'sale' || row.type === 'credit_note') {
          addBucket(outward.total, taxable, cgst, sgst, igst, totalTax, totalVal, mult);
          if (isB2B) {
            addBucket(outward.b2b, taxable, cgst, sgst, igst, totalTax, totalVal, mult);
          } else {
            addBucket(outward.b2c, taxable, cgst, sgst, igst, totalTax, totalVal, mult);
          }
          if (supplyType === 'intra_state') {
            addBucket(outward.intra_state, taxable, cgst, sgst, igst, totalTax, totalVal, mult);
          } else {
            addBucket(outward.inter_state, taxable, cgst, sgst, igst, totalTax, totalVal, mult);
          }

          for (const line of lines) {
            const lineTaxable = line.amount ?? 0;
            const lineRate = line.gst_rate ?? 0;
            const lineCgst = line.cgst_amount ?? 0;
            const lineSgst = line.sgst_amount ?? 0;
            const lineIgst = line.igst_amount ?? 0;
            const lineTax = lineCgst + lineSgst + lineIgst;

            const rateEntry = rateMap.get(lineRate) ?? {
              rate: lineRate,
              taxable_amount: 0,
              cgst_amount: 0,
              sgst_amount: 0,
              igst_amount: 0,
              total_tax: 0
            };
            rateEntry.taxable_amount += lineTaxable * mult;
            rateEntry.cgst_amount += lineCgst * mult;
            rateEntry.sgst_amount += lineSgst * mult;
            rateEntry.igst_amount += lineIgst * mult;
            rateEntry.total_tax += lineTax * mult;
            rateMap.set(lineRate, rateEntry);

            const hsn = (line.hsn_sac || 'Other').trim();
            const hsnEntry = hsnMap.get(hsn) ?? {
              hsn_sac: hsn,
              taxable_amount: 0,
              cgst_amount: 0,
              sgst_amount: 0,
              igst_amount: 0,
              total_tax: 0
            };
            hsnEntry.taxable_amount += lineTaxable * mult;
            hsnEntry.cgst_amount += lineCgst * mult;
            hsnEntry.sgst_amount += lineSgst * mult;
            hsnEntry.igst_amount += lineIgst * mult;
            hsnEntry.total_tax += lineTax * mult;
            hsnMap.set(hsn, hsnEntry);
          }
        } else if (row.type === 'purchase' || row.type === 'debit_note') {
          addBucket(inward, taxable, cgst, sgst, igst, totalTax, totalVal, mult);
        }
      }

      const netCgst = outward.total.cgst_amount - inward.cgst_amount;
      const netSgst = outward.total.sgst_amount - inward.sgst_amount;
      const netIgst = outward.total.igst_amount - inward.igst_amount;
      const totalNetTax = netCgst + netSgst + netIgst;

      return {
        period: {from, to},
        outward_supplies: outward,
        inward_supplies: inward,
        rate_wise: [...rateMap.values()].sort((a, b) => a.rate - b.rate),
        hsn_wise: [...hsnMap.values()].sort((a, b) => a.hsn_sac.localeCompare(b.hsn_sac)),
        net_tax_payable: {
          output_cgst: outward.total.cgst_amount,
          input_cgst: inward.cgst_amount,
          net_cgst: netCgst,
          output_sgst: outward.total.sgst_amount,
          input_sgst: inward.sgst_amount,
          net_sgst: netSgst,
          output_igst: outward.total.igst_amount,
          input_igst: inward.igst_amount,
          net_igst: netIgst,
          total_net_tax: totalNetTax
        }
      };
    });
  }
  stockSummary(period = {}) {
    return this.#readSnapshot(() => {
      const {from = null, to = null} = reportPeriod(period);
      return this.inventory.stockSummary({from, to});
    });
  }
  bankReconciliation(ledgerId, { asOfDate = null, includeReconciled = false } = {}) {
    return this.#readSnapshot(() => {
      assert(Number.isSafeInteger(ledgerId) && ledgerId > 0, 'Choose a valid ledger.');
      const bank = this.ledger(ledgerId);
      assert(bank && bank.kind === 'bank', 'Bank reconciliation requires a Bank Account ledger.');
      const asOf = asOfDate ? textField(asOfDate, 10, 'As of date') : (this.activeWorkingDate || this.financialYearTo || '2027-03-31');
      assert(validDate(asOf), 'Enter a valid as of date.');

      const bookBalance = this.statement(ledgerId, { to: asOf }).balance;

      const rows = [];
      let unreflectedDebit = 0;
      let unreflectedCredit = 0;

      const vouchers = this.db.prepare(`
        SELECT v.*,
               c.name AS customer_name, c.kind AS customer_kind,
               a.name AS account_name, a.kind AS account_kind
        FROM vouchers v
        JOIN ledgers c ON v.customer_id = c.id
        JOIN ledgers a ON v.account_id = a.id
        WHERE v.date <= ?
          AND (v.account_id = ? OR v.customer_id = ?)
        ORDER BY v.date ASC, v.number ASC, v.id ASC
      `).all(asOf, ledgerId, ledgerId);

      for (const v of vouchers) {
        const details = JSON.parse(v.details || '{}');
        let debit = 0, credit = 0, particulars = '', vchType = '', txnType = 'Cheque', instNo = '', instDate = v.date, bankDate = null, side = 'bank';

        if (v.type === 'receipt' && v.account_id === ledgerId) {
          debit = v.amount;
          particulars = v.customer_name;
          vchType = 'Receipt';
          const b = details.bank || {};
          txnType = b.transaction_type || 'Cheque/DD';
          instNo = b.instrument_number || '';
          instDate = b.instrument_date || v.date;
          bankDate = b.bank_date || null;
        } else if (v.type === 'payment' && v.account_id === ledgerId) {
          credit = v.amount;
          particulars = v.customer_name;
          vchType = 'Payment';
          const b = details.bank || {};
          txnType = b.transaction_type || 'Cheque';
          instNo = b.instrument_number || '';
          instDate = b.instrument_date || v.date;
          bankDate = b.bank_date || null;
        } else if (v.type === 'contra') {
          const isDeposit = v.account_id === ledgerId && v.customer_kind === 'cash';
          const isWithdrawal = v.customer_id === ledgerId && v.account_kind === 'cash';
          const isTransferDest = v.account_id === ledgerId && v.customer_kind === 'bank';
          const isTransferSrc = v.customer_id === ledgerId && v.account_kind === 'bank';

          if (isDeposit) {
            debit = v.amount;
            particulars = v.customer_name;
            vchType = 'Contra';
            const b = details.bank || {};
            txnType = b.transaction_type || 'Cash';
            instNo = b.instrument_number || '';
            instDate = b.instrument_date || v.date;
            bankDate = b.bank_date || null;
          } else if (isWithdrawal) {
            credit = v.amount;
            particulars = v.account_name;
            vchType = 'Contra';
            const b = details.bank || {};
            txnType = b.transaction_type || 'Cheque';
            instNo = b.instrument_number || '';
            instDate = b.instrument_date || v.date;
            bankDate = b.bank_date || null;
          } else if (isTransferDest) {
            debit = v.amount;
            particulars = v.customer_name;
            vchType = 'Contra';
            const b = details.bank || {};
            txnType = b.transaction_type || 'Cheque/DD';
            instNo = b.instrument_number || '';
            instDate = b.instrument_date || v.date;
            bankDate = b.bank_date || null;
            side = 'bank';
          } else if (isTransferSrc) {
            credit = v.amount;
            particulars = v.account_name;
            vchType = 'Contra';
            const b = details.source_bank || details.bank || {};
            txnType = b.transaction_type || 'Cheque';
            instNo = b.instrument_number || '';
            instDate = b.instrument_date || v.date;
            bankDate = b.bank_date || null;
            side = 'source_bank';
          }
        }

        if (debit === 0 && credit === 0) continue;

        const isReconciled = Boolean(bankDate && bankDate <= asOf);
        if (!isReconciled) {
          unreflectedDebit += debit;
          unreflectedCredit += credit;
        }

        if (includeReconciled || !isReconciled) {
          rows.push({
            voucher_id: v.id,
            date: v.date,
            particulars,
            voucher_type: vchType,
            raw_voucher_type: v.type,
            voucher_number: v.number,
            transaction_type: txnType,
            instrument_number: instNo,
            instrument_date: instDate,
            bank_date: bankDate,
            debit,
            credit,
            side
          });
        }
      }

      const balanceAsPerBank = bookBalance - unreflectedDebit + unreflectedCredit;

      return {
        ledger: { id: bank.id, name: bank.name, bank: bank.bank },
        as_of_date: asOf,
        include_reconciled: Boolean(includeReconciled),
        balance_as_per_company_books: bookBalance,
        amounts_not_reflected: {
          debit: unreflectedDebit,
          credit: unreflectedCredit
        },
        balance_as_per_bank: balanceAsPerBank,
        rows
      };
    });
  }
  reconcileBankVouchers(ledgerId, items = []) {
    assert(Number.isSafeInteger(ledgerId) && ledgerId > 0, 'Choose a valid ledger.');
    assert(Array.isArray(items), 'Provide a list of voucher reconciliations.');
    const bank = this.ledger(ledgerId);
    assert(bank && bank.kind === 'bank', 'Bank reconciliation requires a Bank Account ledger.');

    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const item of items) {
        assert(item && typeof item === 'object' && !Array.isArray(item), 'Invalid reconciliation item.');
        const voucherId = Number(item.voucher_id);
        assert(Number.isSafeInteger(voucherId) && voucherId > 0, 'Choose a valid voucher.');
        const v = this.db.prepare('SELECT * FROM vouchers WHERE id = ?').get(voucherId);
        assert(v, 'Voucher not found.');

        let bankDate = null;
        if (item.bank_date !== undefined && item.bank_date !== null && item.bank_date !== '') {
          bankDate = textField(item.bank_date, 10, 'Bank date');
          assert(validDate(bankDate), 'Enter a valid bank date.');
          assert(bankDate >= v.date, 'Bank date cannot be earlier than voucher date.');
        }

        const details = JSON.parse(v.details || '{}');
        const side = item.side || (v.type === 'contra' && v.customer_id === ledgerId && details.source_bank ? 'source_bank' : 'bank');

        if (side === 'source_bank') {
          if (!details.source_bank) details.source_bank = {};
          if (bankDate) details.source_bank.bank_date = bankDate;
          else delete details.source_bank.bank_date;
        } else {
          if (!details.bank) details.bank = {};
          if (bankDate) details.bank.bank_date = bankDate;
          else delete details.bank.bank_date;
        }

        this.db.prepare('UPDATE vouchers SET details = ?, revision = revision + 1 WHERE id = ?')
          .run(JSON.stringify(details), voucherId);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return this.bankReconciliation(ledgerId);
  }
  voucherRegisterSummary(voucherType, { fiscalYear = null } = {}) {
    return this.#readSnapshot(() => {
      const rawType = (voucherType || '').toLowerCase().trim();
      const type = rawType === 'sales' ? 'sale' : rawType;

      const startYear = 2026;
      const endYear = startYear + 1;
      const monthConfigs = [
        { month: 4, year: startYear, name: 'April' },
        { month: 5, year: startYear, name: 'May' },
        { month: 6, year: startYear, name: 'June' },
        { month: 7, year: startYear, name: 'July' },
        { month: 8, year: startYear, name: 'August' },
        { month: 9, year: startYear, name: 'September' },
        { month: 10, year: startYear, name: 'October' },
        { month: 11, year: startYear, name: 'November' },
        { month: 12, year: startYear, name: 'December' },
        { month: 1, year: endYear, name: 'January' },
        { month: 2, year: endYear, name: 'February' },
        { month: 3, year: endYear, name: 'March' }
      ];

      let cumulativeBalance = 0;
      let totalDebit = 0;
      let totalCredit = 0;
      let totalVouchers = 0;

      const months = [];
      for (const m of monthConfigs) {
        const monthStr = String(m.month).padStart(2, '0');
        const from = `${m.year}-${monthStr}-01`;
        const lastDay = new Date(Date.UTC(m.year, m.month, 0)).getUTCDate();
        const to = `${m.year}-${monthStr}-${String(lastDay).padStart(2, '0')}`;

        const vchs = this.db.prepare('SELECT * FROM vouchers WHERE type = ? AND date >= ? AND date <= ? ORDER BY date, number').all(type, from, to);
        const count = vchs.length;
        let debit = 0;
        let credit = 0;

        for (const v of vchs) {
          if (type === 'sale') {
            credit += v.amount;
          } else if (type === 'purchase') {
            debit += v.amount;
          } else if (type === 'journal') {
            debit += v.amount;
            credit += v.amount;
          } else if (type === 'receipt') {
            debit += v.amount;
          } else if (type === 'payment') {
            credit += v.amount;
          } else if (type === 'contra') {
            credit += v.amount;
          } else if (type === 'credit_note') {
            debit += v.amount;
          } else if (type === 'debit_note') {
            credit += v.amount;
          }
        }

        if (type === 'sale') {
          cumulativeBalance += (credit - debit);
        } else if (type === 'purchase') {
          cumulativeBalance += (debit - credit);
        } else {
          cumulativeBalance += (debit - credit);
        }

        totalDebit += debit;
        totalCredit += credit;
        totalVouchers += count;

        months.push({
          month_index: m.month,
          year: m.year,
          month_name: m.name,
          from,
          to,
          debit,
          credit,
          closing_balance: cumulativeBalance,
          voucher_count: count
        });
      }

      return {
        register_type: rawType,
        voucher_type: type,
        months,
        totals: {
          debit: totalDebit,
          credit: totalCredit,
          voucher_count: totalVouchers,
          closing_balance: cumulativeBalance
        }
      };
    });
  }
  voucherRegisterMonth(voucherType, year, month, { columnar = false } = {}) {
    return this.#readSnapshot(() => {
      const rawType = (voucherType || '').toLowerCase().trim();
      const type = rawType === 'sales' ? 'sale' : rawType;
      const y = Number(year);
      const m = Number(month);
      const monthStr = String(m).padStart(2, '0');
      const from = `${y}-${monthStr}-01`;
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const to = `${y}-${monthStr}-${String(lastDay).padStart(2, '0')}`;

      const vchs = this.db.prepare(`
        SELECT v.*,
               c.name AS customer_name, c.kind AS customer_kind,
               a.name AS account_name, a.kind AS account_kind
        FROM vouchers v
        JOIN ledgers c ON v.customer_id = c.id
        JOIN ledgers a ON v.account_id = a.id
        WHERE v.type = ? AND v.date >= ? AND v.date <= ?
        ORDER BY v.date ASC, v.number ASC, v.id ASC
      `).all(type, from, to);

      const accountsSet = new Set();
      const rows = [];
      let totalDebit = 0;
      let totalCredit = 0;
      let totalAmount = 0;

      for (const v of vchs) {
        let particulars = '';
        let debit = 0;
        let credit = 0;
        let vchTypeLabel = '';

        if (type === 'sale') {
          particulars = v.customer_name;
          debit = v.amount;
          vchTypeLabel = 'Sales';
          accountsSet.add(v.account_name);
        } else if (type === 'purchase') {
          particulars = v.customer_name;
          credit = v.amount;
          vchTypeLabel = 'Purchase';
          accountsSet.add(v.account_name);
        } else if (type === 'payment') {
          particulars = v.customer_name;
          debit = v.amount;
          vchTypeLabel = 'Payment';
          accountsSet.add(v.account_name);
        } else if (type === 'receipt') {
          particulars = v.customer_name;
          credit = v.amount;
          vchTypeLabel = 'Receipt';
          accountsSet.add(v.account_name);
        } else if (type === 'credit_note') {
          particulars = v.customer_name;
          credit = v.amount;
          vchTypeLabel = 'Credit Note';
          accountsSet.add(v.account_name);
        } else if (type === 'debit_note') {
          particulars = v.customer_name;
          debit = v.amount;
          vchTypeLabel = 'Debit Note';
          accountsSet.add(v.account_name);
        } else if (type === 'contra') {
          particulars = v.customer_name;
          debit = v.amount;
          vchTypeLabel = 'Contra';
          accountsSet.add(v.account_name);
        } else if (type === 'journal') {
          particulars = v.account_name || '(as per details)';
          debit = v.amount;
          credit = v.amount;
          vchTypeLabel = 'Journal';
        } else {
          particulars = v.customer_name;
          debit = v.amount;
          vchTypeLabel = v.type.charAt(0).toUpperCase() + v.type.slice(1);
        }

        totalDebit += debit;
        totalCredit += credit;
        totalAmount += v.amount;

        const row = {
          voucher_id: v.id,
          date: v.date,
          particulars,
          voucher_type: vchTypeLabel,
          raw_voucher_type: v.type,
          voucher_number: v.number,
          debit,
          credit,
          amount: v.amount,
          account_name: v.account_name
        };

        if (columnar) {
          row.columns = {
            'Gross Total': v.amount,
            [v.account_name]: v.amount
          };
        }

        rows.push(row);
      }

      const res = {
        register_type: rawType,
        voucher_type: type,
        year: y,
        month: m,
        from,
        to,
        rows,
        total_debit: totalDebit,
        total_credit: totalCredit,
        total_amount: totalAmount,
        total_vouchers: rows.length
      };

      if (columnar) {
        res.column_headers = ['Gross Total', ...Array.from(accountsSet)];
      }

      return res;
    });
  }
  inventoryMasters() {
    return this.#readSnapshot(() => ({
      units: this.inventory.listUnits(),
      godowns: this.inventory.listGodowns(),
      stock_groups: this.inventory.listStockGroups(),
      stock_items: this.inventory.listStockItems()
    }));
  }
  statistics() {
    return this.#readSnapshot(() => {
      const voucherCounts = {
        contra: 0,
        payment: 0,
        receipt: 0,
        journal: 0,
        sales: 0,
        purchase: 0,
        credit_note: 0,
        debit_note: 0,
        total: 0
      };

      const rows = this.db.prepare('SELECT type, COUNT(*) as count FROM vouchers GROUP BY type').all();
      for (const r of rows) {
        const key = r.type === 'sale' ? 'sales' : r.type;
        if (Object.hasOwn(voucherCounts, key)) {
          voucherCounts[key] = r.count;
          voucherCounts.total += r.count;
        }
      }

      return {
        voucher_types: [
          { type: 'contra', name: 'Contra', count: voucherCounts.contra },
          { type: 'payment', name: 'Payment', count: voucherCounts.payment },
          { type: 'receipt', name: 'Receipt', count: voucherCounts.receipt },
          { type: 'journal', name: 'Journal', count: voucherCounts.journal },
          { type: 'sales', name: 'Sales', count: voucherCounts.sales },
          { type: 'purchase', name: 'Purchase', count: voucherCounts.purchase },
          { type: 'credit_note', name: 'Credit Note', count: voucherCounts.credit_note },
          { type: 'debit_note', name: 'Debit Note', count: voucherCounts.debit_note }
        ],
        voucher_total: voucherCounts.total
      };
    });
  }
  ratioAnalysis(period = {}) {
    return this.#readSnapshot(() => {
      const reports = this.financialReports(period);
      const bs = reports.balanceSheet;
      const pl = reports.profitAndLoss;

      const currentAssetsGroup = bs.groups.find(g => g.key === 'current-assets');
      const currentLiabilitiesGroup = bs.groups.find(g => g.key === 'current-liabilities');
      const currentAssets = currentAssetsGroup?.amount ?? 0;
      const currentLiabilities = currentLiabilitiesGroup?.amount ?? 0;
      const workingCapital = currentAssets - currentLiabilities;

      const cashInHand = currentAssetsGroup?.groups?.find(g => g.key === 'cash')?.amount ?? 0;
      const bankAccounts = currentAssetsGroup?.groups?.find(g => g.key === 'banks')?.amount ?? 0;

      const loansLiability = bs.groups.find(g => g.key === 'loans-liability');
      const bankOdLedgers = loansLiability?.ledgers?.filter(l => ['Bank OD A/c', 'Bank OCC A/c'].includes(l.group_name)) ?? [];
      const bankOd = bankOdLedgers.reduce((sum, l) => sum + l.amount, 0);

      const debtors = currentAssetsGroup?.groups?.find(g => g.key === 'debtors')?.amount ?? 0;
      const creditors = currentLiabilitiesGroup?.groups?.find(g => g.key === 'creditors')?.amount ?? 0;

      const sales = pl.groups.find(g => g.key === 'sales')?.amount ?? 0;
      const purchases = pl.groups.find(g => g.key === 'purchases')?.amount ?? 0;
      let stockInHand = currentAssetsGroup?.groups?.find(g => g.key === 'stock-in-hand')?.amount ?? 0;
      try {
        const stockSummary = this.inventory.stockSummary(period);
        if (stockSummary?.totals?.closing_value) stockInHand = stockSummary.totals.closing_value;
      } catch {}

      const netProfit = pl.profit;
      const grossProfit = pl.grossProfit;
      const capitalAccount = bs.groups.find(g => g.key === 'capital')?.amount ?? 0;
      const totalLoans = loansLiability?.amount ?? 0;
      const totalEquity = capitalAccount + bs.profit.closing;

      const wkgCapitalTurnover = workingCapital > 0 ? Number((sales / workingCapital).toFixed(2)) : null;
      const inventoryTurnover = stockInHand > 0 ? Number((sales / stockInHand).toFixed(2)) : null;

      const currentRatio = currentLiabilities > 0 ? Number((currentAssets / currentLiabilities).toFixed(2)) : null;
      const quickRatio = currentLiabilities > 0 ? Number(((currentAssets - stockInHand) / currentLiabilities).toFixed(2)) : null;
      const debtEquityRatio = totalEquity > 0 && totalLoans > 0 ? Number((totalLoans / totalEquity).toFixed(2)) : null;
      const grossProfitPct = sales > 0 ? Number(((grossProfit / sales) * 100).toFixed(2)) : null;
      const netProfitPct = sales > 0 ? Number(((netProfit / sales) * 100).toFixed(2)) : null;
      const costPct = sales > 0 ? Number(((purchases / sales) * 100).toFixed(2)) : null;

      const { from, to } = reportPeriod(period);
      let days = 365;
      if (from && to) {
        const dFrom = new Date(from + 'T00:00:00Z');
        const dTo = new Date(to + 'T00:00:00Z');
        const diffDays = Math.round((dTo - dFrom) / (1000 * 60 * 60 * 24)) + 1;
        if (diffDays > 0) days = diffDays;
      }
      const recvTurnoverDays = sales > 0 ? Number(((debtors / sales) * days).toFixed(2)) : null;
      const returnOnInvestmentPct = totalEquity > 0 ? Number(((bs.profit.closing / totalEquity) * 100).toFixed(2)) : null;
      const returnOnWkgCapitalPct = workingCapital > 0 ? Number(((netProfit / workingCapital) * 100).toFixed(2)) : null;

      return {
        period: reports.period,
        groups: {
          working_capital: workingCapital,
          cash_in_hand: cashInHand,
          bank_accounts: bankAccounts,
          bank_od_ac: bankOd,
          sundry_debtors: debtors,
          sundry_creditors: creditors,
          sales_accounts: sales,
          purchase_accounts: purchases,
          stock_in_hand: stockInHand,
          nett_profit: netProfit,
          wkg_capital_turnover: wkgCapitalTurnover,
          inventory_turnover: inventoryTurnover
        },
        ratios: {
          current_ratio: currentRatio,
          quick_ratio: quickRatio,
          debt_equity_ratio: debtEquityRatio,
          gross_profit_pct: grossProfitPct,
          nett_profit_pct: netProfitPct,
          cost_pct: costPct,
          recv_turnover_days: recvTurnoverDays,
          return_on_investment_pct: returnOnInvestmentPct,
          return_on_wkg_capital_pct: returnOnWkgCapitalPct
        }
      };
    });
  }
  cashBankSummary(period = {}) {
    return this.#readSnapshot(() => {
      const trial = this.trialBalance(period);
      const cashGroup = { key: 'cash', name: 'Cash-in-Hand', ledgers: [], debit: 0, credit: 0 };
      const bankGroup = { key: 'bank', name: 'Bank Accounts', ledgers: [], debit: 0, credit: 0 };
      const bankOdGroup = { key: 'bank_od', name: 'Bank OD A/c', ledgers: [], debit: 0, credit: 0 };

      for (const row of trial.rows) {
        let targetGroup = null;
        if (row.kind === 'cash' || row.group_name === 'Cash-in-Hand') targetGroup = cashGroup;
        else if (row.kind === 'bank' || row.group_name === 'Bank Accounts') targetGroup = bankGroup;
        else if (['Bank OD A/c', 'Bank OCC A/c'].includes(row.group_name)) targetGroup = bankOdGroup;

        if (targetGroup) {
          const debit = row.balance > 0 ? row.balance : 0;
          const credit = row.balance < 0 ? -row.balance : 0;
          targetGroup.ledgers.push({
            id: row.id,
            name: row.name,
            debit,
            credit,
            balance: row.balance
          });
          targetGroup.debit += debit;
          targetGroup.credit += credit;
        }
      }

      const groups = [cashGroup, bankGroup];
      if (bankOdGroup.ledgers.length > 0) groups.push(bankOdGroup);

      const totalDebit = groups.reduce((sum, g) => sum + g.debit, 0);
      const totalCredit = groups.reduce((sum, g) => sum + g.credit, 0);

      return {
        period: trial.period,
        groups,
        totals: {
          debit: totalDebit,
          credit: totalCredit,
          closing: totalDebit - totalCredit
        }
      };
    });
  }
  cashFlow({ period = {}, month = null } = {}) {
    return this.#readSnapshot(() => {
      const initialPeriod = { from: this.calendar.financial_year_from, to: this.calendar.financial_year_to };
      const fiscalPeriod = period?.from && period?.to ? normalizeCurrentPeriod(period) : initialPeriod;

      const cashBankRows = this.db.prepare(`
        SELECT id, kind, group_name FROM ledgers 
        WHERE kind IN ('cash', 'bank') 
           OR group_name IN ('Cash-in-Hand', 'Bank Accounts', 'Bank OD A/c', 'Bank OCC A/c')
      `).all();
      const cashBankIds = new Set(cashBankRows.map(r => r.id));

      const allPostings = this.db.prepare(`
        SELECT p.voucher_id, p.ledger_id, p.side, p.amount, l.name as ledger_name, l.group_name, l.kind, v.date, v.type
        FROM postings p 
        JOIN ledgers l ON l.id = p.ledger_id
        JOIN vouchers v ON v.id = p.voucher_id
        WHERE v.date >= ? AND v.date <= ?
        ORDER BY v.date, v.id
      `).all(fiscalPeriod.from, fiscalPeriod.to);

      const postingsByVoucher = new Map();
      for (const p of allPostings) {
        if (!postingsByVoucher.has(p.voucher_id)) postingsByVoucher.set(p.voucher_id, []);
        postingsByVoucher.get(p.voucher_id).push(p);
      }

      const primaryGroup = (groupName, kind) => {
        if (['Sundry Debtors'].includes(groupName) || kind === 'customer') return 'Current Assets';
        if (['Sundry Creditors'].includes(groupName) || kind === 'supplier') return 'Current Liabilities';
        if (['Reserves & Surplus', 'Retained Earnings'].includes(groupName) || kind === 'capital') return 'Capital Account';
        if (['Expenses (Direct)', 'Direct Expenses'].includes(groupName)) return 'Direct Expenses';
        if (['Expenses (Indirect)', 'Indirect Expenses'].includes(groupName) || kind === 'expense') return 'Indirect Expenses';
        if (['Income (Direct)', 'Direct Incomes'].includes(groupName)) return 'Direct Incomes';
        if (['Income (Indirect)', 'Indirect Incomes'].includes(groupName) || kind === 'income') return 'Indirect Incomes';
        if (kind === 'sales' || groupName === 'Sales Accounts') return 'Sales Accounts';
        if (kind === 'purchase' || groupName === 'Purchase Accounts') return 'Purchase Accounts';
        return groupName || 'Current Liabilities';
      };

      const months = monthPeriods(fiscalPeriod).map(({ month: mKey, from: mFrom, to: mTo }) => {
        let inflow = 0;
        let outflow = 0;

        for (const [voucherId, vPostings] of postingsByVoucher.entries()) {
          const vDate = vPostings[0].date;
          if (vDate < mFrom || vDate > mTo) continue;

          let cashDebits = 0;
          let cashCredits = 0;

          for (const p of vPostings) {
            if (cashBankIds.has(p.ledger_id)) {
              if (p.side === 'debit') cashDebits += p.amount;
              else cashCredits += p.amount;
            }
          }

          if (cashDebits > cashCredits) {
            inflow += (cashDebits - cashCredits);
          } else if (cashCredits > cashDebits) {
            outflow += (cashCredits - cashDebits);
          }
        }

        return {
          month: mKey,
          from: mFrom,
          to: mTo,
          inflow,
          outflow,
          nett_flow: inflow - outflow
        };
      });

      const totalInflow = months.reduce((sum, m) => sum + m.inflow, 0);
      const totalOutflow = months.reduce((sum, m) => sum + m.outflow, 0);

      let drilldown = null;
      if (month) {
        const targetMonth = months.find(m => m.month === month || m.month.endsWith('-' + String(month).padStart(2, '0')));
        const rangeFrom = targetMonth ? targetMonth.from : fiscalPeriod.from;
        const rangeTo = targetMonth ? targetMonth.to : fiscalPeriod.to;

        const inflowGroupsMap = new Map();
        const outflowGroupsMap = new Map();

        for (const [voucherId, vPostings] of postingsByVoucher.entries()) {
          const vDate = vPostings[0].date;
          if (vDate < rangeFrom || vDate > rangeTo) continue;

          let cashDebits = 0;
          let cashCredits = 0;
          const nonCashDebits = [];
          const nonCashCredits = [];

          for (const p of vPostings) {
            if (cashBankIds.has(p.ledger_id)) {
              if (p.side === 'debit') cashDebits += p.amount;
              else cashCredits += p.amount;
            } else {
              if (p.side === 'debit') nonCashDebits.push(p);
              else nonCashCredits.push(p);
            }
          }

          if (cashDebits > cashCredits) {
            const netCashIn = cashDebits - cashCredits;
            const totalCreditSum = nonCashCredits.reduce((s, p) => s + p.amount, 0) || 1;
            for (const p of nonCashCredits) {
              const allocated = Math.round((p.amount / totalCreditSum) * netCashIn);
              const gName = primaryGroup(p.group_name, p.kind);
              if (!inflowGroupsMap.has(gName)) inflowGroupsMap.set(gName, { group_name: gName, amount: 0, ledgers: new Map() });
              const g = inflowGroupsMap.get(gName);
              g.amount += allocated;
              g.ledgers.set(p.ledger_name, (g.ledgers.get(p.ledger_name) || 0) + allocated);
            }
          } else if (cashCredits > cashDebits) {
            const netCashOut = cashCredits - cashDebits;
            const totalDebitSum = nonCashDebits.reduce((s, p) => s + p.amount, 0) || 1;
            for (const p of nonCashDebits) {
              const allocated = Math.round((p.amount / totalDebitSum) * netCashOut);
              const gName = primaryGroup(p.group_name, p.kind);
              if (!outflowGroupsMap.has(gName)) outflowGroupsMap.set(gName, { group_name: gName, amount: 0, ledgers: new Map() });
              const g = outflowGroupsMap.get(gName);
              g.amount += allocated;
              g.ledgers.set(p.ledger_name, (g.ledgers.get(p.ledger_name) || 0) + allocated);
            }
          }
        }

        const mapToArray = (map) => Array.from(map.values()).map(g => ({
          group_name: g.group_name,
          amount: g.amount,
          ledgers: Array.from(g.ledgers.entries()).map(([name, amount]) => ({ name, amount }))
        })).sort((a, b) => b.amount - a.amount);

        const inflowGroups = mapToArray(inflowGroupsMap);
        const outflowGroups = mapToArray(outflowGroupsMap);
        const drillInflow = inflowGroups.reduce((s, g) => s + g.amount, 0);
        const drillOutflow = outflowGroups.reduce((s, g) => s + g.amount, 0);

        drilldown = {
          month: targetMonth?.month ?? month,
          period: { from: rangeFrom, to: rangeTo },
          inflow_groups: inflowGroups,
          outflow_groups: outflowGroups,
          totals: {
            inflow: drillInflow,
            outflow: drillOutflow,
            nett_inflow: drillInflow - drillOutflow
          }
        };
      }

      return {
        fiscal_period: initialPeriod,
        period: fiscalPeriod,
        months,
        totals: {
          inflow: totalInflow,
          outflow: totalOutflow,
          nett_flow: totalInflow - totalOutflow
        },
        drilldown
      };
    });
  }
  state() {
    return this.#readSnapshot(()=>this.#state());
  }
  #state(){
    const totals = this.db.prepare(`SELECT COALESCE(SUM(CASE WHEN side='debit' THEN amount ELSE 0 END),0) AS debit,
      COALESCE(SUM(CASE WHEN side='credit' THEN amount ELSE 0 END),0) AS credit FROM postings`).get();
    const unbalanced = this.db.prepare(`SELECT voucher_id FROM postings GROUP BY voucher_id HAVING SUM(CASE WHEN side='debit' THEN amount ELSE -amount END)<>0`).all();
    return {
      company: this.companyName,...this.currency,calendar:{...this.calendar},ledgers: this.ledgers(),opening_balances:openingSummary(this.db,true,this.openingDate),
      vouchers: this.db.prepare(`SELECT v.*,l.name AS customer_name,l.kind AS party_kind,a.name AS account_name FROM vouchers v JOIN ledgers l ON l.id=v.customer_id JOIN ledgers a ON a.id=v.account_id ORDER BY v.date,v.id`).all().map(row => {
        const details = JSON.parse(row.details);
        return {
          ...voucherAliases(row),
          ...(row.type==='journal' && isGeneralJournal(row.details)?{entries:generalJournalEntries(this.db,row.id)}:{}),
          ...(details.lines?{lines:details.lines}:{}),
          ...(details.item_lines?{item_lines:details.item_lines}:{}),
          bill:this.billForSale(row.id),
          allocations:this.allocations(row.id),
          details,
          postings: this.db.prepare(`SELECT p.*,l.name FROM postings p JOIN ledgers l ON l.id=p.ledger_id WHERE voucher_id=? ORDER BY side DESC`).all(row.id)
        };
      }),
      inventory: this.inventoryMasters(),
      outstanding: this.outstanding(),payables:this.payables(),totals: { ...totals, balanced: totals.debit === totals.credit && unbalanced.length === 0 }
    };
  }
}
