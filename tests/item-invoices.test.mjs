import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CompanyStore} from '../lib/companies.mjs';

function setupCompany() {
  const dir = mkdtempSync(join(tmpdir(), 'bookr-item-inv-'));
  const file = join(dir, 'book.sqlite');
  const store = new CompanyStore({defaultFile: file});
  const book = store.book('default');

  // Configure company state and GSTIN
  store.update('default', {
    revision: 1,
    state: 'Gujarat',
    gstin: '24AAACC1234D1Z5',
    gst_registration_type: 'Regular'
  });

  // Setup Ledgers
  const customerGJ = book.saveCustomer({
    name: 'Ahmedabad Retailer',
    state: 'Gujarat',
    gstin: '24BBBCD5678E1Z9',
    gst_registration_type: 'Regular'
  });

  const customerMH = book.saveCustomer({
    name: 'Mumbai Tech Hub',
    state: 'Maharashtra',
    gstin: '27CCCCE9012F1Z3',
    gst_registration_type: 'Regular'
  });

  const supplierGJ = book.saveSupplier({
    name: 'Surat Hardware Dist',
    state: 'Gujarat',
    gstin: '24DDDDF3456G1Z7',
    gst_registration_type: 'Regular'
  });

  // Setup Inventory
  const inv = book.inventory;
  const nos = inv.getUnitBySymbol('Nos');
  const wh = inv.getDefaultGodown();
  const group = inv.getStockGroupByName('Primary');

  const laptop = inv.createStockItem({
    name: 'Business Laptop Pro',
    unit_id: nos.id,
    stock_group_id: group.id,
    hsn_sac: '84713010',
    gst_rate: 18,
    taxability: 'Taxable',
    opening_qty: 10,
    opening_rate: 4000000, // Rs 40,000.00
    opening_value: 40000000,
    godown_id: wh.id
  });

  const manual = inv.createStockItem({
    name: 'User Guide Book',
    unit_id: nos.id,
    stock_group_id: group.id,
    hsn_sac: '49011010',
    gst_rate: 0,
    taxability: 'Exempt',
    opening_qty: 50,
    opening_rate: 20000, // Rs 200.00
    opening_value: 1000000,
    godown_id: wh.id
  });

  return {dir, store, book, inv, customerGJ, customerMH, supplierGJ, laptop, manual, wh};
}

test('Intra-state Sales Item Invoice creates dual postings (Ledgers + Stock Movement) and customer bill', () => {
  const {dir, store, book, inv, customerGJ, laptop, wh} = setupCompany();
  try {
    const voucher = book.saveVoucher({
      type: 'sale',
      date: '2026-05-10',
      customer_id: customerGJ.id,
      account_id: 2, // Sales A/c
      amount: 11800000, // Rs 1,18,000.00 (100k + 18k tax)
      narration: 'Sold 2 Laptops with 18% GST',
      details: {
        invoice_mode: 'item',
        item_lines: [
          {
            item_id: laptop.id,
            item_name: laptop.name,
            godown_id: wh.id,
            godown_name: wh.name,
            quantity: 2,
            rate: 5000000, // Rs 50,000.00
            amount: 10000000, // Rs 100,000.00
            hsn_sac: '84713010',
            gst_rate: 18,
            cgst_amount: 900000,
            sgst_amount: 900000,
            igst_amount: 0,
            total_amount: 11800000
          }
        ],
        gst: {
          supply_type: 'intra_state',
          company_state: 'Gujarat',
          party_state: 'Gujarat',
          taxable_amount: 10000000,
          cgst_amount: 900000,
          sgst_amount: 900000,
          igst_amount: 0,
          total_tax: 1800000,
          total_amount: 11800000
        }
      }
    });

    assert.equal(voucher.amount, 11800000);
    assert.equal(voucher.type, 'sale');

    // 1. Postings check: Customer Dr 11800000, Sales Cr 10000000, Output CGST Cr 900000, Output SGST Cr 900000
    const loaded = book.voucher(voucher.id);
    assert.ok(loaded.postings);
    const custPost = loaded.postings.find(p => p.ledger_id === customerGJ.id);
    assert.equal(custPost.side, 'debit');
    assert.equal(custPost.amount, 11800000);

    const salesPost = loaded.postings.find(p => p.ledger_id === 2);
    assert.equal(salesPost.side, 'credit');
    assert.equal(salesPost.amount, 10000000);

    const cgstPost = loaded.postings.find(p => p.name === 'Output CGST');
    assert.ok(cgstPost);
    assert.equal(cgstPost.side, 'credit');
    assert.equal(cgstPost.amount, 900000);

    const sgstPost = loaded.postings.find(p => p.name === 'Output SGST');
    assert.ok(sgstPost);
    assert.equal(sgstPost.side, 'credit');
    assert.equal(sgstPost.amount, 900000);

    // 2. Stock Movement check: outward 2 units
    const movements = inv.listMovements(laptop.id).filter(m => m.voucher_type === 'sale');
    assert.equal(movements.length, 1);
    assert.equal(movements[0].direction, 'outward');
    assert.equal(movements[0].quantity, 2);
    assert.equal(movements[0].rate, 5000000);
    assert.equal(movements[0].value, 10000000);
    assert.equal(movements[0].voucher_id, voucher.id);

    // 3. Outstanding Bill check
    const pending = book.outstanding().find(b => b.reference === voucher.bill.reference);
    assert.ok(pending);
    assert.equal(pending.pending, 11800000);
  } finally {
    try { store?.close(); } catch {}
    rmSync(dir, {recursive: true, force: true});
  }
});

test('Inter-state Sales Item Invoice posts IGST and outward stock movement', () => {
  const {dir, store, book, inv, customerMH, laptop, wh} = setupCompany();
  try {
    const voucher = book.saveVoucher({
      type: 'sale',
      date: '2026-05-12',
      customer_id: customerMH.id,
      account_id: 2, // Sales A/c
      amount: 5900000, // Rs 59,000.00
      details: {
        invoice_mode: 'item',
        item_lines: [
          {
            item_id: laptop.id,
            item_name: laptop.name,
            godown_id: wh.id,
            quantity: 1,
            rate: 5000000,
            amount: 5000000,
            hsn_sac: '84713010',
            gst_rate: 18,
            cgst_amount: 0,
            sgst_amount: 0,
            igst_amount: 900000,
            total_amount: 5900000
          }
        ],
        gst: {
          supply_type: 'inter_state',
          company_state: 'Gujarat',
          party_state: 'Maharashtra',
          taxable_amount: 5000000,
          cgst_amount: 0,
          sgst_amount: 0,
          igst_amount: 900000,
          total_tax: 900000,
          total_amount: 5900000
        }
      }
    });

    const loaded = book.voucher(voucher.id);
    const igstPost = loaded.postings.find(p => p.name === 'Output IGST');
    assert.ok(igstPost);
    assert.equal(igstPost.side, 'credit');
    assert.equal(igstPost.amount, 900000);

    const movements = inv.listMovements(laptop.id).filter(m => m.voucher_type === 'sale');
    assert.equal(movements.length, 1);
    assert.equal(movements[0].direction, 'outward');
    assert.equal(movements[0].quantity, 1);
  } finally {
    try { store?.close(); } catch {}
    rmSync(dir, {recursive: true, force: true});
  }
});

test('Purchases Item Invoice creates Input tax postings and inward stock movements', () => {
  const {dir, store, book, inv, supplierGJ, laptop, wh} = setupCompany();
  try {
    const purchaseLedger = book.ledgers().find(l => l.kind === 'purchase');
    const voucher = book.saveVoucher({
      type: 'purchase',
      date: '2026-05-15',
      supplier_id: supplierGJ.id,
      account_id: purchaseLedger.id,
      amount: 23600000, // Rs 2,36,000.00
      details: {
        invoice_mode: 'item',
        item_lines: [
          {
            item_id: laptop.id,
            item_name: laptop.name,
            godown_id: wh.id,
            quantity: 5,
            rate: 4000000, // Rs 40,000.00
            amount: 20000000, // Rs 200,000.00
            hsn_sac: '84713010',
            gst_rate: 18,
            cgst_amount: 1800000,
            sgst_amount: 1800000,
            igst_amount: 0,
            total_amount: 23600000
          }
        ],
        gst: {
          supply_type: 'intra_state',
          company_state: 'Gujarat',
          party_state: 'Gujarat',
          taxable_amount: 20000000,
          cgst_amount: 1800000,
          sgst_amount: 1800000,
          igst_amount: 0,
          total_tax: 3600000,
          total_amount: 23600000
        }
      }
    });

    const loaded = book.voucher(voucher.id);
    const suppPost = loaded.postings.find(p => p.ledger_id === supplierGJ.id);
    assert.equal(suppPost.side, 'credit');
    assert.equal(suppPost.amount, 23600000);

    const purPost = loaded.postings.find(p => p.ledger_id === purchaseLedger.id);
    assert.equal(purPost.side, 'debit');
    assert.equal(purPost.amount, 20000000);

    const cgstPost = loaded.postings.find(p => p.name === 'Input CGST');
    assert.ok(cgstPost);
    assert.equal(cgstPost.side, 'debit');
    assert.equal(cgstPost.amount, 1800000);

    // Inward stock movement
    const movements = inv.listMovements(laptop.id).filter(m => m.voucher_type === 'purchase');
    assert.equal(movements.length, 1);
    assert.equal(movements[0].direction, 'inward');
    assert.equal(movements[0].quantity, 5);
    assert.equal(movements[0].rate, 4000000);
    assert.equal(movements[0].value, 20000000);
  } finally {
    try { store?.close(); } catch {}
    rmSync(dir, {recursive: true, force: true});
  }
});

test('Multi-item invoice with mixed GST rates calculates and records all movements accurately', () => {
  const {dir, store, book, inv, customerGJ, laptop, manual, wh} = setupCompany();
  try {
    const voucher = book.saveVoucher({
      type: 'sale',
      date: '2026-05-18',
      customer_id: customerGJ.id,
      account_id: 2,
      amount: 12050000, // 100k (laptop) + 18k (tax) + 2.5k (manuals, 0% tax) = 120500.00
      details: {
        invoice_mode: 'item',
        item_lines: [
          {
            item_id: laptop.id,
            item_name: laptop.name,
            godown_id: wh.id,
            quantity: 2,
            rate: 5000000,
            amount: 10000000,
            hsn_sac: '84713010',
            gst_rate: 18,
            cgst_amount: 900000,
            sgst_amount: 900000,
            igst_amount: 0,
            total_amount: 11800000
          },
          {
            item_id: manual.id,
            item_name: manual.name,
            godown_id: wh.id,
            quantity: 10,
            rate: 25000, // Rs 250.00
            amount: 250000, // Rs 2,500.00
            hsn_sac: '49011010',
            gst_rate: 0,
            cgst_amount: 0,
            sgst_amount: 0,
            igst_amount: 0,
            total_amount: 250000
          }
        ],
        gst: {
          supply_type: 'intra_state',
          company_state: 'Gujarat',
          party_state: 'Gujarat',
          taxable_amount: 10250000,
          cgst_amount: 900000,
          sgst_amount: 900000,
          igst_amount: 0,
          total_tax: 1800000,
          total_amount: 12050000
        }
      }
    });

    assert.equal(voucher.amount, 12050000);

    // Verify movements for both items
    const laptopMov = inv.listMovements(laptop.id).filter(m => m.voucher_id === voucher.id);
    assert.equal(laptopMov.length, 1);
    assert.equal(laptopMov[0].quantity, 2);

    const manualMov = inv.listMovements(manual.id).filter(m => m.voucher_id === voucher.id);
    assert.equal(manualMov.length, 1);
    assert.equal(manualMov[0].quantity, 10);
  } finally {
    try { store?.close(); } catch {}
    rmSync(dir, {recursive: true, force: true});
  }
});

test('Cash Sales in Item mode posts CashDr/SalesCr without customer bill', () => {
  const {dir, store, book, inv, laptop, wh} = setupCompany();
  try {
    const cashLedger = book.ledgers().find(l => l.kind === 'cash');
    const voucher = book.saveVoucher({
      type: 'sale',
      date: '2026-05-20',
      customer_id: cashLedger.id,
      account_id: 2,
      amount: 5900000,
      details: {
        invoice_mode: 'item',
        item_lines: [
          {
            item_id: laptop.id,
            item_name: laptop.name,
            godown_id: wh.id,
            quantity: 1,
            rate: 5000000,
            amount: 5000000,
            hsn_sac: '84713010',
            gst_rate: 18,
            cgst_amount: 450000,
            sgst_amount: 450000,
            igst_amount: 0,
            total_amount: 5900000
          }
        ],
        gst: {
          supply_type: 'intra_state',
          company_state: 'Gujarat',
          party_state: 'Gujarat',
          taxable_amount: 5000000,
          cgst_amount: 450000,
          sgst_amount: 450000,
          igst_amount: 0,
          total_tax: 900000,
          total_amount: 5900000
        }
      }
    });

    const loaded = book.voucher(voucher.id);
    const cashPost = loaded.postings.find(p => p.ledger_id === cashLedger.id);
    assert.equal(cashPost.side, 'debit');
    assert.equal(cashPost.amount, 5900000);
    assert.equal(loaded.bill, null);

    const mov = inv.listMovements(laptop.id).filter(m => m.voucher_id === voucher.id);
    assert.equal(mov.length, 1);
    assert.equal(mov[0].quantity, 1);
    assert.equal(mov[0].direction, 'outward');
  } finally {
    try { store?.close(); } catch {}
    rmSync(dir, {recursive: true, force: true});
  }
});
