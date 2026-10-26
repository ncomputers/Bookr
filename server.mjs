import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { BookError } from './lib/accounting.mjs';
import {CompanyStore} from './lib/companies.mjs';
import {currentPeriodHeader,normalizeCurrentPeriod} from './lib/company-period.mjs';

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
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml' };
const send = (res, status, value) => { res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' }); res.end(JSON.stringify(value)); };
const body = async req => {
  let text = '';
  for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 16384) throw new BookError('Request is too large.', 413); }
  try { return JSON.parse(text); } catch { throw new BookError('Invalid JSON request.'); }
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
      const requestPeriod=currentPeriodHeader(req.headers['x-bookr-period']);
      if(req.method==='GET' && url.pathname==='/api/companies')return send(res,200,{companies:companies.list(),default_company_id:'default'});
      if(req.method==='POST' && url.pathname==='/api/companies')return send(res,201,companies.create(await body(req)));
      const companyMatch=url.pathname.match(/^\/api\/companies\/([^/]+)$/);
      if(req.method==='GET' && companyMatch)return send(res,200,companies.profile(companyMatch[1]));
      if(req.method==='PUT' && companyMatch)return send(res,200,companies.update(companyMatch[1],await body(req)));
      const companyId=req.headers['x-bookr-company'];
      const book=companies.book(companyId===undefined?'default':companyId);
      if (req.method === 'GET' && url.pathname === '/api/state') return send(res,200,{...book.state(),capabilities:{general_journal:true,company_alter:true,cash_purchases:true,current_period:true},...(previewLabel?{preview:{label:previewLabel}}:{})});
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
      if(req.method==='PUT' && ledgerMatch)return send(res,200,book.saveLedger(await body(req),Number(ledgerMatch[1])));
      if(req.method==='POST' && url.pathname==='/api/ledgers')return send(res,201,book.saveLedger(await body(req)));
      const customerMatch = url.pathname.match(/^\/api\/customers\/(\d+)$/);
      if (req.method === 'GET' && customerMatch) return send(res,200,book.customer(customerMatch[1]));
      if (req.method === 'PUT' && customerMatch) return send(res,200,book.saveCustomer(await body(req),Number(customerMatch[1])));
      const supplierMatch=url.pathname.match(/^\/api\/suppliers\/(\d+)$/);
      if(req.method==='GET' && supplierMatch)return send(res,200,book.supplier(supplierMatch[1]));
      if(req.method==='PUT' && supplierMatch)return send(res,200,book.saveSupplier(await body(req),Number(supplierMatch[1])));
      if(req.method==='POST' && url.pathname==='/api/suppliers')return send(res,201,book.saveSupplier(await body(req)));
      const bankMatch=url.pathname.match(/^\/api\/banks\/(\d+)$/);
      if(req.method==='GET' && bankMatch)return send(res,200,book.bank(bankMatch[1]));
      if(req.method==='PUT' && bankMatch)return send(res,200,book.saveBank(await body(req),Number(bankMatch[1])));
      if(req.method==='POST' && url.pathname==='/api/banks')return send(res,201,book.saveBank(await body(req)));
      const voucherMatch = url.pathname.match(/^\/api\/vouchers\/(\d+)$/);
      if (req.method === 'GET' && voucherMatch) return send(res,200,book.voucher(voucherMatch[1]));
      if (req.method === 'POST' && url.pathname === '/api/customers') return send(res,201,book.createCustomer(await body(req)));
      if (req.method === 'POST' && url.pathname === '/api/vouchers') return send(res,201,book.saveVoucher(await body(req),null,{currentPeriod:requestPeriod}));
      if (req.method === 'PUT' && voucherMatch) return send(res,200,book.saveVoucher(await body(req),Number(voucherMatch[1]),{currentPeriod:requestPeriod}));
      throw new BookError('Route not found.',404);
    }
    if (req.method !== 'GET') throw new BookError('Method not supported.',405);
    const publicRoot = resolve(root,'public');
    const path = resolve(publicRoot,'.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(publicRoot + sep)) throw new BookError('Not found.',404);
    const content = await readFile(path).catch(() => { throw new BookError('Not found.',404); });
    res.writeHead(200, { 'Content-Type':types[extname(path)] || 'application/octet-stream', 'Cache-Control':'no-cache' }); res.end(content);
  } catch (error) { send(res,error instanceof BookError ? error.status : 500,{ error:error instanceof BookError ? error.message : 'Unable to complete this request.' }); }
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
