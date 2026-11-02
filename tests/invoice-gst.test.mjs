import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Book } from '../lib/accounting.mjs';
import { CompanyStore } from '../lib/companies.mjs';
import { exportCompanyBundle, restoreCompanyBundle } from '../lib/company-backup.mjs';

test('Intra-state Sales invoice calculates CGST and SGST and creates balanced postings', () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'bookr-gst-sale-intra-'));
  const book = new Book(join(dir, 'test.sqlite'), {
    companyName: 'Maharashtra Traders Ltd',
    companyState: 'Maharashtra',
    companyGstin: '27AAPFU0939F1ZV'
  });
  try {
    const customer = book.createCustomer({
      name: 'Pune Retailer',
      gstin: '27ABCDE1234F1Z5',
      state: 'Maharashtra'
    });
    const salesAccount = book.ledger(2); // Demo Sales

    const voucher = book.saveVoucher({
      type: 'sale',
      date: '2025-05-10',
      customer_id: customer.id,
      account_id: salesAccount.id,
      lines: [
        {
          ledger_id: salesAccount.id,
          amount: 100000, // 1000.00
          hsn_sac: '8471',
          gst_rate: 18
        }
      ]
    });

    // 1000.00 + 9% CGST (90.00) + 9% SGST (90.00) = 1180.00 (118000 paise)
    assert.equal(voucher.amount, 118000);
    assert.equal(voucher.details.gst.supply_type, 'intra_state');
    assert.equal(voucher.details.gst.taxable_amount, 100000);
    assert.equal(voucher.details.gst.cgst_amount, 9000);
    assert.equal(voucher.details.gst.sgst_amount, 9000);
    assert.equal(voucher.details.gst.igst_amount, 0);
    assert.equal(voucher.details.gst.total_tax, 18000);

    // Verify postings
    const postings = book.postings(voucher.id);
    assert.equal(postings.length, 4); // Customer (debit), Sales (credit), Output CGST (credit), Output SGST (credit)

    const customerDebit = postings.find(p => p.ledger_id === customer.id);
    assert.equal(customerDebit.side, 'debit');
    assert.equal(customerDebit.amount, 118000);

    const salesCredit = postings.find(p => p.ledger_id === salesAccount.id);
    assert.equal(salesCredit.side, 'credit');
    assert.equal(salesCredit.amount, 100000);

    const cgstCredit = postings.find(p => p.ledger_name === 'Output CGST');
    assert.equal(cgstCredit.side, 'credit');
    assert.equal(cgstCredit.amount, 9000);

    const sgstCredit = postings.find(p => p.ledger_name === 'Output SGST');
    assert.equal(sgstCredit.side, 'credit');
    assert.equal(sgstCredit.amount, 9000);

    // Bill created for full amount
    const bill = book.billForSale(voucher.id);
    assert.equal(bill.amount, 118000);
  } finally {
    book.close();
    rmSync(dir, {recursive: true, force: true});
  }
});

test('Inter-state Sales invoice calculates IGST and creates balanced postings', () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'bookr-gst-sale-inter-'));
  const book = new Book(join(dir, 'test.sqlite'), {
    companyName: 'Maharashtra Traders Ltd',
    companyState: 'Maharashtra',
    companyGstin: '27AAPFU0939F1ZV'
  });
  try {
    const customer = book.createCustomer({
      name: 'Bengaluru Tech',
      gstin: '29ABCDE1234F1Z5',
      state: 'Karnataka'
    });
    const salesAccount = book.ledger(2);

    const voucher = book.saveVoucher({
      type: 'sale',
      date: '2025-05-12',
      customer_id: customer.id,
      account_id: salesAccount.id,
      lines: [
        {
          ledger_id: salesAccount.id,
          amount: 200000, // 2000.00
          hsn_sac: '8471',
          gst_rate: 18
        }
      ]
    });

    // 2000.00 + 18% IGST (360.00) = 2360.00 (236000 paise)
    assert.equal(voucher.amount, 236000);
    assert.equal(voucher.details.gst.supply_type, 'inter_state');
    assert.equal(voucher.details.gst.taxable_amount, 200000);
    assert.equal(voucher.details.gst.cgst_amount, 0);
    assert.equal(voucher.details.gst.sgst_amount, 0);
    assert.equal(voucher.details.gst.igst_amount, 36000);
    assert.equal(voucher.details.gst.total_tax, 36000);

    const postings = book.postings(voucher.id);
    assert.equal(postings.length, 3); // Customer (debit), Sales (credit), Output IGST (credit)

    const igstCredit = postings.find(p => p.ledger_name === 'Output IGST');
    assert.equal(igstCredit.side, 'credit');
    assert.equal(igstCredit.amount, 36000);
  } finally {
    book.close();
    rmSync(dir, {recursive: true, force: true});
  }
});

test('Intra-state Purchase invoice calculates Input CGST and Input SGST', () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'bookr-gst-purchase-intra-'));
  const book = new Book(join(dir, 'test.sqlite'), {
    companyName: 'Maharashtra Traders Ltd',
    companyState: 'Maharashtra',
    companyGstin: '27AAPFU0939F1ZV'
  });
  try {
    const supplier = book.saveSupplier({
      name: 'Mumbai Distributor',
      gstin: '27XYZAB5678C1Z2',
      state: 'Maharashtra'
    });
    const purchaseLedger = book.ledgers().find(l => l.kind === 'purchase');

    const voucher = book.saveVoucher({
      type: 'purchase',
      date: '2025-05-15',
      supplier_id: supplier.id,
      account_id: purchaseLedger.id,
      lines: [
        {
          ledger_id: purchaseLedger.id,
          amount: 500000, // 5000.00
          hsn_sac: '9983',
          gst_rate: 12
        }
      ]
    });

    // 5000.00 + 6% Input CGST (300.00) + 6% Input SGST (300.00) = 5600.00 (560000 paise)
    assert.equal(voucher.amount, 560000);
    assert.equal(voucher.details.gst.supply_type, 'intra_state');
    assert.equal(voucher.details.gst.cgst_amount, 30000);
    assert.equal(voucher.details.gst.sgst_amount, 30000);

    const postings = book.postings(voucher.id);
    assert.equal(postings.length, 4); // Supplier (credit), Purchase (debit), Input CGST (debit), Input SGST (debit)

    const supplierCredit = postings.find(p => p.ledger_id === supplier.id);
    assert.equal(supplierCredit.side, 'credit');
    assert.equal(supplierCredit.amount, 560000);

    const inputCgst = postings.find(p => p.ledger_name === 'Input CGST');
    assert.equal(inputCgst.side, 'debit');
    assert.equal(inputCgst.amount, 30000);

    const inputSgst = postings.find(p => p.ledger_name === 'Input SGST');
    assert.equal(inputSgst.side, 'debit');
    assert.equal(inputSgst.amount, 30000);
  } finally {
    book.close();
    rmSync(dir, {recursive: true, force: true});
  }
});

test('Multi-line invoice consolidates tax postings and handles zero-rated items', () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'bookr-gst-multiline-'));
  const book = new Book(join(dir, 'test.sqlite'), {
    companyName: 'Maharashtra Traders Ltd',
    companyState: 'Maharashtra',
    companyGstin: '27AAPFU0939F1ZV'
  });
  try {
    const customer = book.createCustomer({
      name: 'Nagpur Enterprises',
      gstin: '27ABCDE1234F1Z5',
      state: 'Maharashtra'
    });
    const salesAccount = book.ledger(2);

    const voucher = book.saveVoucher({
      type: 'sale',
      date: '2025-05-18',
      customer_id: customer.id,
      account_id: salesAccount.id,
      lines: [
        {
          ledger_id: salesAccount.id,
          amount: 100000, // 1000 @ 18% -> CGST 90, SGST 90
          hsn_sac: '8471',
          gst_rate: 18
        },
        {
          ledger_id: salesAccount.id,
          amount: 200000, // 2000 @ 12% -> CGST 120, SGST 120
          hsn_sac: '8517',
          gst_rate: 12
        },
        {
          ledger_id: salesAccount.id,
          amount: 50000, // 500 @ 0% -> CGST 0, SGST 0
          hsn_sac: '4901',
          gst_rate: 0
        }
      ]
    });

    // Taxable: 1000 + 2000 + 500 = 3500.00 (350000 paise)
    // CGST: 90 + 120 = 210.00 (21000 paise)
    // SGST: 90 + 120 = 210.00 (21000 paise)
    // Total: 3920.00 (392000 paise)
    assert.equal(voucher.amount, 392000);
    assert.equal(voucher.details.gst.taxable_amount, 350000);
    assert.equal(voucher.details.gst.cgst_amount, 21000);
    assert.equal(voucher.details.gst.sgst_amount, 21000);
    assert.equal(voucher.details.gst.total_tax, 42000);

    const postings = book.postings(voucher.id);
    // Consolidated: Customer (debit 392000), Sales (credit 350000), Output CGST (credit 21000), Output SGST (credit 21000)
    assert.equal(postings.length, 4);

    const salesPosting = postings.find(p => p.ledger_id === salesAccount.id);
    assert.equal(salesPosting.amount, 350000);
  } finally {
    book.close();
    rmSync(dir, {recursive: true, force: true});
  }
});

test('GST invoices survive portable backup export and restore', () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'bookr-gst-backup-'));
  const store = new CompanyStore({defaultFile: join(dir, 'default.sqlite')});
  try {
    const current = store.profile('default');
    store.update('default', {
      state: 'Maharashtra',
      gstin: '27AAPFU0939F1ZV',
      gst_registration_type: 'Regular',
      revision: current.revision
    });
    const book = store.book('default');
    const customer = book.createCustomer({
      name: 'Backup GST Customer',
      gstin: '27ABCDE1234F1Z5',
      state: 'Maharashtra'
    });
    const salesAccount = book.ledger(2);

    const voucher = book.saveVoucher({
      type: 'sale',
      date: '2026-05-20',
      customer_id: customer.id,
      account_id: salesAccount.id,
      lines: [
        {
          ledger_id: salesAccount.id,
          amount: 100000,
          hsn_sac: '8471',
          gst_rate: 18
        }
      ]
    });

    const bundle = exportCompanyBundle(store, 'default');
    const restored = restoreCompanyBundle(store, bundle, {name: 'Restored GST Invoices'});
    const restoredBook = store.book(restored.id);

    const restoredVoucher = restoredBook.voucher(voucher.id);
    assert.equal(restoredVoucher.amount, 118000);
    assert.equal(restoredVoucher.details.gst.total_tax, 18000);
    assert.equal(restoredVoucher.details.lines[0].hsn_sac, '8471');
    assert.equal(restoredVoucher.details.lines[0].gst_rate, 18);

    const restoredPostings = restoredBook.postings(restoredVoucher.id);
    assert.equal(restoredPostings.length, 4);
  } finally {
    store.close();
    rmSync(dir, {recursive: true, force: true});
  }
});
