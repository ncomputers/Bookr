import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { BookError } from './lib/accounting.mjs';
import {CompanyStore} from './lib/companies.mjs';
import {currentPeriodHeader,normalizeCurrentPeriod} from './lib/company-period.mjs';
import {exportCompanyBundle,restoreCompanyBundle} from './lib/company-backup.mjs';
import {CurrencyError,normalizeCurrencyPatch} from './public/company-currency.js';
import {requireCurrencyAwareness} from './lib/company-currency-protocol.mjs';
import {MobileCodeError} from './public/company-mobile-code.js';
import {GeographyStore,GeographyError} from './lib/company-geography.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4315);
const tailscaleIp = process.env.BOOKR_TAILSCALE_IP || '';
if (tailscaleIp) {
  const parts = tailscaleIp.split('.').map(Number);
  if (isIP(tailscaleIp) !== 4 || parts[0] !== 100 || parts[1] < 64 || parts[1] > 127) throw new Error('Use this laptop’s Tailscale IPv4 address for Bookr.');
}
const addresses = ['127.0.0.1', ...(tailscaleIp ? [tailscaleIp] : [])];
const allowedHosts = new Set([...addresses, 'localhost'].map(address => `${address}:${port}`));
const allowedOrigins = new Set([...allowedHosts].map(host => `http://${host}`));
const dbPath = resolve(process.env.BOOKR_DB || resolve(root, 'storage/book.sqlite'));
const previewLabel=String(process.env.BOOKR_PREVIEW_LABEL || '').trim().slice(0,24);
await mkdir(dirname(dbPath), { recursive: true });
const companies = new CompanyStore({defaultFile:dbPath});
const geography=new GeographyStore(dbPath+'.locations.json');
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml' };
const capabilities=Object.freeze({general_journal:true,company_alter:true,cash_purchases:true,current_period:true,company_backup:true,company_calendar_alteration:true,company_currency_labels:true,company_backup_v2:true,company_mobile_calling_code:true,company_backup_v3:true,company_geography_masters:true});
const send = (res, status, value) => { res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' }); res.end(JSON.stringify(value)); };
const body = async (req,limit=16384) => {
  if(Number(req.headers['content-length'])>limit){req.resume();throw new BookError('Request is too large.',413);}
  const chunks=[];let bytes=0;
  for await (const chunk of req.iterator({destroyOnReturn:false})) {
    const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);bytes+=buffer.length;
    if(bytes>limit){req.resume();throw new BookError('Request is too large.',413);}
    chunks.push(buffer);
  }
  try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes))); }
  catch { throw new BookError('Invalid UTF-8 JSON request.'); }
};
const handler = async (req, res) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'");
  const host = req.headers.host;
  if (!allowedHosts.has(host)) return send(res, 403, { error:'Host not allowed.' });
  try {
    const url = new URL(req.url, `http://${host}`);
    if (url.pathname.startsWith('/api/')) {
      if (!['GET','POST','PUT'].includes(req.method)) throw new BookError('Method not supported.',405);
      if (req.method !== 'GET') {
        if (req.headers.origin && !allowedOrigins.has(req.headers.origin)) throw new BookError('Origin not allowed.',403);
        if (!String(req.headers['content-type']).startsWith('application/json')) throw new BookError('JSON content type required.',415);
      }
      if(url.pathname==='/api/capabilities'){
        if(req.method!=='GET')throw new BookError('Method not supported.',405);
        if(url.search)throw new BookError('Capabilities do not accept query overrides.');
        return send(res,200,{capabilities});
      }
      if(['/api/geography','/api/geography/countries','/api/geography/states'].includes(url.pathname)){
        if(url.search)throw new BookError('Address suggestions do not accept query overrides.');
        if(url.pathname==='/api/geography'){if(req.method!=='GET')throw new BookError('Method not supported.',405);return send(res,200,geography.list());}
        if(req.method!=='POST')throw new BookError('Method not supported.',405);
        const input=await body(req);return send(res,201,url.pathname.endsWith('/countries')?geography.createCountry(input):geography.createState(input));
      }
      const calendarPolicyMatch=url.pathname.match(/^\/api\/companies\/([^/]+)\/calendar-editability$/);
      if(calendarPolicyMatch){
        if(req.method!=='GET')throw new BookError('Method not supported.',405);
        if(url.search)throw new BookError('Company date eligibility does not accept query overrides.');
        requireCurrencyAwareness(req.headers,companies.profile(calendarPolicyMatch[1]));return send(res,200,companies.calendarEditability(calendarPolicyMatch[1]));
      }
      const summaryMatch=url.pathname.match(/^\/api\/companies\/([^/]+)\/summary$/);
      if(summaryMatch){
        if(req.method!=='GET')throw new BookError('Method not supported.',405);
        if(url.search)throw new BookError('Company summary does not accept query overrides.');
        requireCurrencyAwareness(req.headers,companies.profile(summaryMatch[1]));return send(res,200,companies.summary(summaryMatch[1]));
      }
      const requestPeriod=currentPeriodHeader(req.headers['x-bookr-period']);
      const backupMatch=url.pathname.match(/^\/api\/companies\/([^/]+)\/backup$/);
      if(req.method==='GET'&&backupMatch){
        if(url.search)throw new BookError('Company backup does not accept query overrides.');
        requireCurrencyAwareness(req.headers,companies.profile(backupMatch[1]));return send(res,200,exportCompanyBundle(companies,backupMatch[1]));
      }
      if(req.method==='POST'&&url.pathname==='/api/companies/restore'){
        if(url.search)throw new BookError('Company restore does not accept query overrides.');
        const input=await body(req,25*1024*1024+4096);
        if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==2||!Object.hasOwn(input,'name')||!Object.hasOwn(input,'bundle'))throw new BookError('Restore requires only a new company name and a portable bundle.');
        if(input.bundle?.version>=2)requireCurrencyAwareness(req.headers,input.bundle.company);
        return send(res,201,restoreCompanyBundle(companies,input.bundle,{name:input.name}));
      }
      if(req.method==='GET' && url.pathname==='/api/companies')return send(res,200,{companies:companies.list(),default_company_id:'default'});
      if(req.method==='POST' && url.pathname==='/api/companies'){const input=await body(req);requireCurrencyAwareness(req.headers,normalizeCurrencyPatch(Object.fromEntries(['currency_symbol','currency_name'].filter(key=>Object.hasOwn(input??{},key)).map(key=>[key,input[key]]))));return send(res,201,companies.create(input));}
      const companyMatch=url.pathname.match(/^\/api\/companies\/([^/]+)$/);
      if(req.method==='GET' && companyMatch){const profile=companies.profile(companyMatch[1]);requireCurrencyAwareness(req.headers,profile);return send(res,200,profile);}
      if(req.method==='PUT' && companyMatch){const input=await body(req),previous=companies.profile(companyMatch[1]);requireCurrencyAwareness(req.headers,previous);requireCurrencyAwareness(req.headers,normalizeCurrencyPatch(Object.fromEntries(['currency_symbol','currency_name'].filter(key=>Object.hasOwn(input??{},key)).map(key=>[key,input[key]])),previous));return send(res,200,companies.update(companyMatch[1],input));}
      const companyId=req.headers['x-bookr-company']??'default';
      requireCurrencyAwareness(req.headers,companies.profile(companyId));
      const book=companies.book(companyId);
      const write=async(action,{voucher=false}={})=>{const input=await body(req),monetary=voucher||Boolean(input&&typeof input==='object'&&(Object.hasOwn(input,'opening_balance')||Object.hasOwn(input,'opening_bills')));return companies.writeBook(companyId,req.headers,input,action,{monetary});};
      if (req.method === 'GET' && url.pathname === '/api/state') return send(res,200,{...book.state(),capabilities,...(previewLabel?{preview:{label:previewLabel}}:{})});
      if(req.method==='GET' && url.pathname==='/api/outstanding'){
        const allowed=['direction','as_of','ledger'];
        if([...url.searchParams.keys()].some(key=>!allowed.includes(key)) || allowed.some(key=>url.searchParams.getAll(key).length>1))throw new BookError('Choose each outstanding filter once: direction, as_of and ledger.');
        const ledger=url.searchParams.get('ledger');
        if(ledger!==null && !/^[1-9]\d*$/.test(ledger))throw new BookError('Choose a valid outstanding party ledger.');
        return send(res,200,book.outstandingReport({direction:url.searchParams.get('direction') ?? 'receivable',as_of:url.searchParams.get('as_of'),ledger_id:ledger===null?null:Number(ledger)}));
      }
      if (req.method === 'GET' && url.pathname === '/api/day-book') return send(res,200,book.dayBook({from:url.searchParams.get('from'),to:url.searchParams.get('to'),type:url.searchParams.get('type') ?? 'all'}));
      if (req.method === 'GET' && url.pathname === '/api/receipt-bills') return send(res,200,book.receiptBills(url.searchParams.get('customer'),url.searchParams.get('receipt') ?? 0));
      if (req.method === 'GET' && url.pathname === '/api/payment-bills') return send(res,200,book.paymentBills(url.searchParams.get('supplier'),url.searchParams.get('payment') ?? 0));
      if (req.method === 'GET' && url.pathname === '/api/trial-balance') return send(res,200,book.trialBalance({from:url.searchParams.get('from'),to:url.searchParams.get('to')}));
      if (req.method === 'GET' && url.pathname === '/api/financial-reports') return send(res,200,book.financialReports({from:url.searchParams.get('from'),to:url.searchParams.get('to')}));
      if (req.method === 'GET' && url.pathname === '/api/statement') return send(res,200,book.statement(url.searchParams.get('ledger'),{from:url.searchParams.get('from'),to:url.searchParams.get('to')}));
      if (req.method === 'GET' && url.pathname === '/api/monthly-summary') {
        const allowed=['ledger','from','to'];
        if([...url.searchParams.keys()].some(key=>!allowed.includes(key))||allowed.some(key=>url.searchParams.getAll(key).length>1))throw new BookError('Choose one ledger and an optional complete From/To period for Monthly Summary.');
        const hasFrom=url.searchParams.has('from'),hasTo=url.searchParams.has('to');
        if(hasFrom!==hasTo)throw new BookError('Enter both From and To dates for Monthly Summary.');
        const period=hasFrom?normalizeCurrentPeriod({from:url.searchParams.get('from'),to:url.searchParams.get('to')}):requestPeriod;
        return send(res,200,book.monthlySummary(url.searchParams.get('ledger'),period));
      }
      const ledgerMatch=url.pathname.match(/^\/api\/ledgers\/(\d+)$/);
      if(req.method==='GET' && ledgerMatch)return send(res,200,book.masterLedger(ledgerMatch[1]));
      if(req.method==='PUT' && ledgerMatch)return send(res,200,await write((fresh,input)=>fresh.saveLedger(input,Number(ledgerMatch[1]))));
      if(req.method==='POST' && url.pathname==='/api/ledgers')return send(res,201,await write((fresh,input)=>fresh.saveLedger(input)));
      const customerMatch = url.pathname.match(/^\/api\/customers\/(\d+)$/);
      if (req.method === 'GET' && customerMatch) return send(res,200,book.customer(customerMatch[1]));
      if (req.method === 'PUT' && customerMatch) return send(res,200,await write((fresh,input)=>fresh.saveCustomer(input,Number(customerMatch[1]))));
      const supplierMatch=url.pathname.match(/^\/api\/suppliers\/(\d+)$/);
      if(req.method==='GET' && supplierMatch)return send(res,200,book.supplier(supplierMatch[1]));
      if(req.method==='PUT' && supplierMatch)return send(res,200,await write((fresh,input)=>fresh.saveSupplier(input,Number(supplierMatch[1]))));
      if(req.method==='POST' && url.pathname==='/api/suppliers')return send(res,201,await write((fresh,input)=>fresh.saveSupplier(input)));
      const bankMatch=url.pathname.match(/^\/api\/banks\/(\d+)$/);
      if(req.method==='GET' && bankMatch)return send(res,200,book.bank(bankMatch[1]));
      if(req.method==='PUT' && bankMatch)return send(res,200,await write((fresh,input)=>fresh.saveBank(input,Number(bankMatch[1]))));
      if(req.method==='POST' && url.pathname==='/api/banks')return send(res,201,await write((fresh,input)=>fresh.saveBank(input)));
      const voucherMatch = url.pathname.match(/^\/api\/vouchers\/(\d+)$/);
      if (req.method === 'GET' && voucherMatch) return send(res,200,book.voucher(voucherMatch[1]));
      if (req.method === 'POST' && url.pathname === '/api/customers') return send(res,201,await write((fresh,input)=>fresh.createCustomer(input)));
      if (req.method === 'POST' && url.pathname === '/api/vouchers') return send(res,201,await write((fresh,input)=>fresh.saveVoucher(input,null,{currentPeriod:requestPeriod}),{voucher:true}));
      if (req.method === 'PUT' && voucherMatch) return send(res,200,await write((fresh,input)=>fresh.saveVoucher(input,Number(voucherMatch[1]),{currentPeriod:requestPeriod}),{voucher:true}));
      throw new BookError('Route not found.',404);
    }
    if (req.method !== 'GET') throw new BookError('Method not supported.',405);
    const publicRoot = resolve(root,'public');
    const path = resolve(publicRoot,'.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(publicRoot + sep)) throw new BookError('Not found.',404);
    const content = await readFile(path).catch(() => { throw new BookError('Not found.',404); });
    res.writeHead(200, { 'Content-Type':types[extname(path)] || 'application/octet-stream', 'Cache-Control':'no-cache' }); res.end(content);
  } catch (error) { const known=error instanceof BookError||error instanceof CurrencyError||error instanceof MobileCodeError||error instanceof GeographyError;send(res,known?error.status:500,{error:known?error.message:'Unable to complete this request.'}); }
};
const servers = addresses.map(address => {
  const server = http.createServer(handler);
  server.listen(port,address,() => console.log(`Bookr running at http://${address}:${port}`));
  return server;
});
const shutdown = () => {
  let pending = servers.length;
  for (const server of servers) server.close(() => { if (--pending === 0) { companies.close(); process.exit(0); } });
};
process.on('SIGINT',shutdown); process.on('SIGTERM',shutdown);
