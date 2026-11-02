import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Book } from '../lib/accounting.mjs';

test('GST Summary report accurately aggregates outward, inward, rate-wise, HSN and net tax payable', () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'bookr-gst-summary-'));
  const book = new Book(join(dir, 'test.sqlite'), {
    companyName: 'Maharashtra Traders Ltd',
    companyState: 'Maharashtra',
    companyGstin: '27AAPFU0939F1ZV'
  });
  try {
    const b2bCustomer = book.createCustomer({
      name: 'Pune Tech Ltd',
      gstin: '27ABCDE1234F1Z5',
      state: 'Maharashtra'
    });
    const b2cCustomer = book.createCustomer({
      name: 'Walk-in Retail Buyer',
      state: 'Maharashtra'
    });
    const interStateCustomer = book.createCustomer({
      name: 'Bengaluru Solutions',
      gstin: '29ABCDE1234F1Z5',
      state: 'Karnataka'
    });
    const supplier = book.saveSupplier({
      name: 'Mumbai Wholesaler',
      gstin: '27XYZAB5678C1Z2',
      state: 'Maharashtra'
    });

    const salesAccount = book.ledger(2);
    const purchaseLedger = book.ledgers().find(l => l.kind === 'purchase');

    // 1. Intra-state B2B Sale: 1000.00 @ 18% (CGST 90, SGST 90)
    book.saveVoucher({
      type: 'sale',
      date: '2025-05-02',
      customer_id: b2bCustomer.id,
      account_id: salesAccount.id,
      lines: [{ledger_id: salesAccount.id, amount: 100000, hsn_sac: '8471', gst_rate: 18}]
    });

    // 2. Inter-state B2B Sale: 2000.00 @ 18% (IGST 360)
    book.saveVoucher({
      type: 'sale',
      date: '2025-05-05',
      customer_id: interStateCustomer.id,
      account_id: salesAccount.id,
      lines: [{ledger_id: salesAccount.id, amount: 200000, hsn_sac: '8471', gst_rate: 18}]
    });

    // 3. Intra-state B2C Sale: 500.00 @ 12% (CGST 30, SGST 30)
    book.saveVoucher({
      type: 'sale',
      date: '2025-05-08',
      customer_id: b2cCustomer.id,
      account_id: salesAccount.id,
      lines: [{ledger_id: salesAccount.id, amount: 50000, hsn_sac: '8517', gst_rate: 12}]
    });

    // 4. Sales Return (Credit Note): 200.00 @ 18% (CGST 18, SGST 18)
    book.saveVoucher({
      type: 'credit_note',
      date: '2025-05-12',
      customer_id: b2bCustomer.id,
      account_id: salesAccount.id,
      lines: [{ledger_id: salesAccount.id, amount: 20000, hsn_sac: '8471', gst_rate: 18}]
    });

    // 5. Inward Supply (Purchase): 1500.00 @ 18% (Input CGST 135, Input SGST 135)
    book.saveVoucher({
      type: 'purchase',
      date: '2025-05-15',
      supplier_id: supplier.id,
      account_id: purchaseLedger.id,
      lines: [{ledger_id: purchaseLedger.id, amount: 150000, hsn_sac: '8471', gst_rate: 18}]
    });

    // 6. Purchase Return (Debit Note): 300.00 @ 18% (Input CGST 27, Input SGST 27)
    book.saveVoucher({
      type: 'debit_note',
      date: '2025-05-18',
      supplier_id: supplier.id,
      account_id: purchaseLedger.id,
      lines: [{ledger_id: purchaseLedger.id, amount: 30000, hsn_sac: '8471', gst_rate: 18}]
    });

    const summary = book.gstSummary({from: '2025-05-01', to: '2025-05-31'});

    // Outward Supplies verification
    // Total Outward Taxable: 1000 + 2000 + 500 - 200 = 3300.00 (330000 paise)
    assert.equal(summary.outward_supplies.total.taxable_amount, 330000);
    // CGST: 90 + 30 - 18 = 102.00 (10200 paise)
    assert.equal(summary.outward_supplies.total.cgst_amount, 10200);
    // SGST: 90 + 30 - 18 = 102.00 (10200 paise)
    assert.equal(summary.outward_supplies.total.sgst_amount, 10200);
    // IGST: 360.00 (36000 paise)
    assert.equal(summary.outward_supplies.total.igst_amount, 36000);
    assert.equal(summary.outward_supplies.total.total_tax, 56400);

    // B2B: (1000 + 2000 - 200) = 2800.00 (280000 paise)
    assert.equal(summary.outward_supplies.b2b.taxable_amount, 280000);
    assert.equal(summary.outward_supplies.b2b.cgst_amount, 7200); // 90 - 18 = 72.00
    assert.equal(summary.outward_supplies.b2b.sgst_amount, 7200);
    assert.equal(summary.outward_supplies.b2b.igst_amount, 36000);

    // B2C: 500.00 (50000 paise)
    assert.equal(summary.outward_supplies.b2c.taxable_amount, 50000);
    assert.equal(summary.outward_supplies.b2c.cgst_amount, 3000);
    assert.equal(summary.outward_supplies.b2c.sgst_amount, 3000);

    // Inward Supplies verification
    // Inward Taxable: 1500 - 300 = 1200.00 (120000 paise)
    assert.equal(summary.inward_supplies.taxable_amount, 120000);
    // Input CGST: 135 - 27 = 108.00 (10800 paise)
    assert.equal(summary.inward_supplies.cgst_amount, 10800);
    assert.equal(summary.inward_supplies.sgst_amount, 10800);
    assert.equal(summary.inward_supplies.total_tax, 21600);

    // Net Tax Payable
    // Net CGST: Output CGST (10200) - Input CGST (10800) = -600 paise
    assert.equal(summary.net_tax_payable.output_cgst, 10200);
    assert.equal(summary.net_tax_payable.input_cgst, 10800);
    assert.equal(summary.net_tax_payable.net_cgst, -600);

    // Net SGST: Output SGST (10200) - Input SGST (10800) = -600 paise
    assert.equal(summary.net_tax_payable.output_sgst, 10200);
    assert.equal(summary.net_tax_payable.input_sgst, 10800);
    assert.equal(summary.net_tax_payable.net_sgst, -600);

    // Net IGST: Output IGST (36000) - Input IGST (0) = 36000 paise
    assert.equal(summary.net_tax_payable.output_igst, 36000);
    assert.equal(summary.net_tax_payable.input_igst, 0);
    assert.equal(summary.net_tax_payable.net_igst, 36000);

    // Total Net Payable: -600 + -600 + 36000 = 34800 paise
    assert.equal(summary.net_tax_payable.total_net_tax, 34800);

    // Rate-wise summary
    const rate18 = summary.rate_wise.find(r => r.rate === 18);
    assert.ok(rate18);
    // 18% Outward net: (1000 + 2000 - 200) = 2800.00
    assert.equal(rate18.taxable_amount, 280000);

    const rate12 = summary.rate_wise.find(r => r.rate === 12);
    assert.ok(rate12);
    assert.equal(rate12.taxable_amount, 50000);

    // HSN summary
    const hsn8471 = summary.hsn_wise.find(h => h.hsn_sac === '8471');
    assert.ok(hsn8471);
    assert.equal(hsn8471.taxable_amount, 280000);

    const hsn8517 = summary.hsn_wise.find(h => h.hsn_sac === '8517');
    assert.ok(hsn8517);
    assert.equal(hsn8517.taxable_amount, 50000);
  } finally {
    book.close();
    rmSync(dir, {recursive: true, force: true});
  }
});
