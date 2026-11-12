import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CompanyStore} from '../lib/companies.mjs';
import {exportCompanyBundle, restoreCompanyBundle} from '../lib/company-backup.mjs';

test('Full round-trip portable backup export and restore preserves inventory masters, item invoices and stock movements', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookr-inv-backup-'));
  const file = join(dir, 'book.sqlite');
  let store;
  try {
    store = new CompanyStore({defaultFile: file});
    store.update('default', {
      revision: 1,
      name: 'Rapid Corp Fictional',
      state: 'Gujarat',
      gstin: '24AAACC1234D1Z5',
      gst_registration_type: 'Regular'
    });

    const book = store.book('default');
    const inv = book.inventory;

    // 1. Create custom Units, Godowns, Groups, and Items
    const boxes = inv.createUnit({symbol: 'Box', formal_name: 'Boxes', decimal_places: 0, uqc: 'BOX-BOX'});
    const warehouse = inv.createGodown({name: 'South Depot', address: 'Plot 99, GIDC'});
    const group = inv.createStockGroup({name: 'Network Equipment'});

    const router = inv.createStockItem({
      name: 'Gigabit Switch 24P',
      part_number: 'SW-24G',
      stock_group_id: group.id,
      unit_id: boxes.id,
      hsn_sac: '85176290',
      gst_rate: 18,
      taxability: 'Taxable',
      opening_qty: 10,
      opening_rate: 800000, // Rs 8,000.00
      opening_value: 8000000, // Rs 80,000.00
      godown_id: warehouse.id
    });

    const customer = book.saveCustomer({
      name: 'Surat Office Network',
      state: 'Gujarat',
      gstin: '24BBBCD5678E1Z9',
      gst_registration_type: 'Regular'
    });

    // 2. Sales Item Invoice: 3 switches
    const sale = book.saveVoucher({
      type: 'sale',
      date: '2026-06-10',
      customer_id: customer.id,
      account_id: 2,
      amount: 3540000, // 30,000 + 5,400 GST (10,000 each)
      narration: 'Sold 3 Gigabit switches',
      details: {
        invoice_mode: 'item',
        item_lines: [{
          item_id: router.id,
          item_name: router.name,
          godown_id: warehouse.id,
          godown_name: warehouse.name,
          quantity: 3,
          rate: 1000000,
          amount: 3000000,
          hsn_sac: '85176290',
          gst_rate: 18,
          cgst_amount: 270000,
          sgst_amount: 270000,
          igst_amount: 0,
          total_amount: 3540000
        }],
        gst: {
          supply_type: 'intra_state',
          company_state: 'Gujarat',
          party_state: 'Gujarat',
          taxable_amount: 3000000,
          cgst_amount: 270000,
          sgst_amount: 270000,
          igst_amount: 0,
          total_tax: 540000,
          total_amount: 3540000
        }
      }
    });

    const originalSummary = book.stockSummary();
    assert.equal(originalSummary.items.length, 1);
    assert.equal(originalSummary.items[0].closing_qty, 7);

    // 3. Export portable bundle
    const bundle = exportCompanyBundle(store, 'default');
    assert.equal(bundle.format, 'bookr.company');
    assert.ok(bundle.tables.units.some(u => u.symbol === 'Box'));
    assert.ok(bundle.tables.godowns.some(g => g.name === 'South Depot'));
    assert.ok(bundle.tables.stock_groups.some(sg => sg.name === 'Network Equipment'));
    assert.ok(bundle.tables.stock_items.some(si => si.name === 'Gigabit Switch 24P'));
    assert.ok(bundle.tables.stock_movements.length >= 2); // opening + sale

    // 4. Restore as new company
    const restored = restoreCompanyBundle(store, bundle, {name: 'Rapid Restored Copy'});
    const restoredBook = store.book(restored.id);
    const restoredInv = restoredBook.inventory;

    // 5. Verify restored masters & state
    const restoredMasters = restoredBook.inventoryMasters();
    assert.ok(restoredMasters.units.some(u => u.symbol === 'Box'));
    assert.ok(restoredMasters.godowns.some(g => g.name === 'South Depot'));
    assert.ok(restoredMasters.stock_groups.some(sg => sg.name === 'Network Equipment'));

    const restoredRouter = restoredMasters.stock_items.find(si => si.name === 'Gigabit Switch 24P');
    assert.ok(restoredRouter);
    assert.equal(restoredRouter.opening_qty, 10);
    assert.equal(restoredRouter.opening_rate, 800000);

    // 6. Verify restored stock summary matches exactly
    const restoredSummary = restoredBook.stockSummary();
    assert.deepEqual(restoredSummary, originalSummary);

    // 7. Verify restored voucher details and postings
    const restoredVouchers = restoredBook.dayBook({type: 'sale'}).rows;
    assert.equal(restoredVouchers.length, 1);
    assert.equal(restoredVouchers[0].amount, 3540000);
    const loadedVoucher = restoredBook.voucher(restoredVouchers[0].id);
    assert.equal(loadedVoucher.item_lines.length, 1);
    assert.equal(loadedVoucher.item_lines[0].quantity, 3);
  } finally {
    try { store?.close(); } catch {}
    rmSync(dir, {recursive: true, force: true});
  }
});
