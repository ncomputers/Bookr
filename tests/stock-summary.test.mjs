import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CompanyStore} from '../lib/companies.mjs';
import {startOwnedTestServer, stopOwnedTestServer} from './owned-test-server.mjs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('Stock Summary accurately computes Opening, Inward, Outward, Closing and Moving Average Valuation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookr-stock-sum-'));
  const file = join(dir, 'book.sqlite');
  let store;
  try {
    store = new CompanyStore({defaultFile: file});
    const book = store.book('default');
    const inv = book.inventory;

    const nos = inv.getUnitBySymbol('Nos');
    const wh = inv.getDefaultGodown();
    const group = inv.getStockGroupByName('Primary');

    // 1. Item with Opening Stock: 10 units @ 1,000.00 = 10,000.00 (1,000,000 paise)
    const item = inv.createStockItem({
      name: 'Wireless Router 5G',
      unit_id: nos.id,
      stock_group_id: group.id,
      opening_qty: 10,
      opening_rate: 100000, // Rs 1,000.00
      opening_value: 1000000, // Rs 10,000.00
      godown_id: wh.id
    });

    const supplier = book.saveSupplier({name: 'Tech Distributor'});
    const customer = book.saveCustomer({name: 'Retail Client'});
    const purchaseLedger = book.ledgers().find(l => l.kind === 'purchase');

    // 2. Inward Purchase: 10 units @ 1,200.00 = 12,000.00 (1,200,000 paise) on 2026-05-01
    // Total inward stock now: 10 (opening) + 10 (purchase) = 20 units.
    // Total inward value: 10,000 + 12,000 = 22,000.00.
    // Moving Average Cost = 22,000 / 20 = Rs 1,100.00 (110,000 paise).
    book.saveVoucher({
      type: 'purchase',
      date: '2026-05-01',
      supplier_id: supplier.id,
      account_id: purchaseLedger.id,
      amount: 1200000,
      details: {
        invoice_mode: 'item',
        item_lines: [{
          item_id: item.id,
          godown_id: wh.id,
          quantity: 10,
          rate: 120000,
          amount: 1200000
        }]
      }
    });

    // 3. Outward Sale: 8 units on 2026-05-15
    // Closing Qty: 20 - 8 = 12 units.
    // Closing Value at Moving Avg Cost: 12 * 1,100.00 = Rs 13,200.00 (1,320,000 paise).
    book.saveVoucher({
      type: 'sale',
      date: '2026-05-15',
      customer_id: customer.id,
      account_id: 2,
      amount: 1200000, // Sold at higher rate
      details: {
        invoice_mode: 'item',
        item_lines: [{
          item_id: item.id,
          godown_id: wh.id,
          quantity: 8,
          rate: 150000,
          amount: 1200000
        }]
      }
    });

    const summary = book.stockSummary();
    assert.equal(summary.items.length, 1);
    const row = summary.items[0];

    assert.equal(row.item_name, 'Wireless Router 5G');
    assert.equal(row.opening_qty, 10);
    assert.equal(row.opening_value, 1000000);
    assert.equal(row.inward_qty, 10);
    assert.equal(row.inward_value, 1200000);
    assert.equal(row.outward_qty, 8);
    assert.equal(row.closing_qty, 12);
    assert.equal(row.average_rate, 110000); // Rs 1,100.00
    assert.equal(row.closing_value, 1320000); // 12 * 1100.00 = 13,200.00

    assert.equal(summary.totals.closing_qty, 12);
    assert.equal(summary.totals.closing_value, 1320000);
  } finally {
    try { store?.close(); } catch {}
    rmSync(dir, {recursive: true, force: true});
  }
});

test('HTTP GET /api/stock-summary returns full stock summary report', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookr-stock-http-'));
  const database = join(dir, 'book.sqlite');
  const port = 4388;
  const base = `http://127.0.0.1:${port}`;

  let server;
  try {
    server = await startOwnedTestServer({root, port, database});

    const res = await fetch(`${base}/api/stock-summary`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.items));
    assert.ok(data.totals);
    assert.ok(typeof data.totals.closing_value === 'number');
  } finally {
    if (server) await stopOwnedTestServer(server);
    rmSync(dir, {recursive: true, force: true});
  }
});
