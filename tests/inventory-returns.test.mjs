import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CompanyStore} from '../lib/companies.mjs';

function setupCompany() {
  const dir = mkdtempSync(join(tmpdir(), 'bookr-inv-returns-'));
  const file = join(dir, 'book.sqlite');
  const store = new CompanyStore({defaultFile: file});

  store.update('default', {
    revision: 1,
    state: 'Gujarat',
    gstin: '24AAACC1234D1Z5',
    gst_registration_type: 'Regular'
  });

  const book = store.book('default');
  const customer = book.saveCustomer({
    name: 'Kiran Electronics',
    state: 'Gujarat',
    gstin: '24BBBCD5678E1Z9',
    gst_registration_type: 'Regular'
  });

  const supplier = book.saveSupplier({
    name: 'National Suppliers',
    state: 'Gujarat',
    gstin: '24DDDDF3456G1Z7',
    gst_registration_type: 'Regular'
  });

  const inv = book.inventory;
  const nos = inv.getUnitBySymbol('Nos');
  const wh = inv.getDefaultGodown();
  const group = inv.getStockGroupByName('Primary');

  const printer = inv.createStockItem({
    name: 'Laser Printer Pro',
    unit_id: nos.id,
    stock_group_id: group.id,
    hsn_sac: '84433210',
    gst_rate: 18,
    taxability: 'Taxable',
    opening_qty: 10,
    opening_rate: 1500000, // Rs 15,000.00
    opening_value: 15000000,
    godown_id: wh.id
  });

  return {dir, store, book, inv, customer, supplier, printer, wh};
}

test('Credit Note on Item Invoice records Sales Return (inward stock movement) and reverses Output GST', () => {
  const {dir, store, book, inv, customer, printer, wh} = setupCompany();
  try {
    // 1. Initial Sale of 3 Printers
    const sale = book.saveVoucher({
      type: 'sale',
      date: '2026-06-01',
      customer_id: customer.id,
      account_id: 2, // Sales
      amount: 5310000, // 45,000 + 8,100 GST
      details: {
        invoice_mode: 'item',
        item_lines: [
          {
            item_id: printer.id,
            item_name: printer.name,
            godown_id: wh.id,
            quantity: 3,
            rate: 1500000,
            amount: 4500000,
            hsn_sac: '84433210',
            gst_rate: 18,
            cgst_amount: 405000,
            sgst_amount: 405000,
            igst_amount: 0,
            total_amount: 5310000
          }
        ],
        gst: {
          supply_type: 'intra_state',
          company_state: 'Gujarat',
          party_state: 'Gujarat',
          taxable_amount: 4500000,
          cgst_amount: 405000,
          sgst_amount: 405000,
          igst_amount: 0,
          total_tax: 810000,
          total_amount: 5310000
        }
      }
    });

    // 2. Customer returns 1 Printer via Credit Note
    const creditNote = book.saveVoucher({
      type: 'credit_note',
      date: '2026-06-05',
      customer_id: customer.id,
      account_id: 2, // Sales
      amount: 1770000, // 15,000 + 2,700 GST
      narration: 'Return of 1 defective printer',
      details: {
        invoice_mode: 'item',
        original_invoice: {number: String(sale.number), date: sale.date},
        item_lines: [
          {
            item_id: printer.id,
            item_name: printer.name,
            godown_id: wh.id,
            quantity: 1,
            rate: 1500000,
            amount: 1500000,
            hsn_sac: '84433210',
            gst_rate: 18,
            cgst_amount: 135000,
            sgst_amount: 135000,
            igst_amount: 0,
            total_amount: 1770000
          }
        ],
        gst: {
          supply_type: 'intra_state',
          company_state: 'Gujarat',
          party_state: 'Gujarat',
          taxable_amount: 1500000,
          cgst_amount: 135000,
          sgst_amount: 135000,
          igst_amount: 0,
          total_tax: 270000,
          total_amount: 1770000
        }
      }
    });

    // Verify postings: Customer Cr 1770000, Sales Dr 1500000, Output CGST Dr 135000, Output SGST Dr 135000
    const loadedCN = book.voucher(creditNote.id);
    const custPost = loadedCN.postings.find(p => p.ledger_id === customer.id);
    assert.equal(custPost.side, 'credit');
    assert.equal(custPost.amount, 1770000);

    const salesPost = loadedCN.postings.find(p => p.ledger_id === 2);
    assert.equal(salesPost.side, 'debit');
    assert.equal(salesPost.amount, 1500000);

    const cgstPost = loadedCN.postings.find(p => p.name === 'Output CGST');
    assert.ok(cgstPost);
    assert.equal(cgstPost.side, 'debit');
    assert.equal(cgstPost.amount, 135000);

    // Verify Stock Movement: Sales Return is INWARD (goods back in godown)
    const cnMovements = inv.listMovements(printer.id).filter(m => m.voucher_id === creditNote.id);
    assert.equal(cnMovements.length, 1);
    assert.equal(cnMovements[0].direction, 'inward');
    assert.equal(cnMovements[0].quantity, 1);
    assert.equal(cnMovements[0].rate, 1500000);
    assert.equal(cnMovements[0].value, 1500000);
  } finally {
    try { store?.close(); } catch {}
    rmSync(dir, {recursive: true, force: true});
  }
});

test('Debit Note on Item Invoice records Purchase Return (outward stock movement) and reverses Input GST', () => {
  const {dir, store, book, inv, supplier, printer, wh} = setupCompany();
  try {
    const purchaseLedger = book.ledgers().find(l => l.kind === 'purchase');

    // 1. Initial Purchase of 5 Printers
    const purchase = book.saveVoucher({
      type: 'purchase',
      date: '2026-06-10',
      supplier_id: supplier.id,
      account_id: purchaseLedger.id,
      amount: 7080000, // 60,000 + 10,800 GST (12,000 each)
      details: {
        invoice_mode: 'item',
        item_lines: [
          {
            item_id: printer.id,
            item_name: printer.name,
            godown_id: wh.id,
            quantity: 5,
            rate: 1200000, // Rs 12,000.00
            amount: 6000000,
            hsn_sac: '84433210',
            gst_rate: 18,
            cgst_amount: 540000,
            sgst_amount: 540000,
            igst_amount: 0,
            total_amount: 7080000
          }
        ],
        gst: {
          supply_type: 'intra_state',
          company_state: 'Gujarat',
          party_state: 'Gujarat',
          taxable_amount: 6000000,
          cgst_amount: 540000,
          sgst_amount: 540000,
          igst_amount: 0,
          total_tax: 1080000,
          total_amount: 7080000
        }
      }
    });

    // 2. Return 2 Printers to Supplier via Debit Note
    const debitNote = book.saveVoucher({
      type: 'debit_note',
      date: '2026-06-15',
      supplier_id: supplier.id,
      account_id: purchaseLedger.id,
      amount: 2832000, // 24,000 + 4,320 GST
      narration: 'Return 2 printers to supplier',
      details: {
        invoice_mode: 'item',
        supplier_invoice: {number: String(purchase.number), date: purchase.date},
        item_lines: [
          {
            item_id: printer.id,
            item_name: printer.name,
            godown_id: wh.id,
            quantity: 2,
            rate: 1200000,
            amount: 2400000,
            hsn_sac: '84433210',
            gst_rate: 18,
            cgst_amount: 216000,
            sgst_amount: 216000,
            igst_amount: 0,
            total_amount: 2832000
          }
        ],
        gst: {
          supply_type: 'intra_state',
          company_state: 'Gujarat',
          party_state: 'Gujarat',
          taxable_amount: 2400000,
          cgst_amount: 216000,
          sgst_amount: 216000,
          igst_amount: 0,
          total_tax: 432000,
          total_amount: 2832000
        }
      }
    });

    // Verify postings: Supplier Dr 2832000, Purchase Cr 2400000, Input CGST Cr 216000, Input SGST Cr 216000
    const loadedDN = book.voucher(debitNote.id);
    const suppPost = loadedDN.postings.find(p => p.ledger_id === supplier.id);
    assert.equal(suppPost.side, 'debit');
    assert.equal(suppPost.amount, 2832000);

    const purPost = loadedDN.postings.find(p => p.ledger_id === purchaseLedger.id);
    assert.equal(purPost.side, 'credit');
    assert.equal(purPost.amount, 2400000);

    const cgstPost = loadedDN.postings.find(p => p.name === 'Input CGST');
    assert.ok(cgstPost);
    assert.equal(cgstPost.side, 'credit');
    assert.equal(cgstPost.amount, 216000);

    // Verify Stock Movement: Purchase Return is OUTWARD (goods returned back to supplier)
    const dnMovements = inv.listMovements(printer.id).filter(m => m.voucher_id === debitNote.id);
    assert.equal(dnMovements.length, 1);
    assert.equal(dnMovements[0].direction, 'outward');
    assert.equal(dnMovements[0].quantity, 2);
    assert.equal(dnMovements[0].rate, 1200000);
    assert.equal(dnMovements[0].value, 2400000);
  } finally {
    try { store?.close(); } catch {}
    rmSync(dir, {recursive: true, force: true});
  }
});
