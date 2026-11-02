import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Book } from '../lib/accounting.mjs';

test('Intra-state Credit Note reverses Sales and Output CGST/SGST with original invoice reference', () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'bookr-gst-cn-intra-'));
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
    const salesAccount = book.ledger(2);

    const creditNote = book.saveVoucher({
      type: 'credit_note',
      date: '2025-05-15',
      customer_id: customer.id,
      account_id: salesAccount.id,
      lines: [
        {
          ledger_id: salesAccount.id,
          amount: 50000, // 500.00 return
          hsn_sac: '8471',
          gst_rate: 18
        }
      ],
      details: {
        original_invoice: {
          number: 'INV-101',
          date: '2025-05-10'
        }
      }
    });

    // 500.00 + 9% CGST (45.00) + 9% SGST (45.00) = 590.00 (59000 paise)
    assert.equal(creditNote.amount, 59000);
    assert.equal(creditNote.details.gst.supply_type, 'intra_state');
    assert.equal(creditNote.details.gst.cgst_amount, 4500);
    assert.equal(creditNote.details.gst.sgst_amount, 4500);
    assert.equal(creditNote.details.original_invoice.number, 'INV-101');

    const postings = book.postings(creditNote.id);
    assert.equal(postings.length, 4);

    const customerCredit = postings.find(p => p.ledger_id === customer.id);
    assert.equal(customerCredit.side, 'credit');
    assert.equal(customerCredit.amount, 59000);

    const salesDebit = postings.find(p => p.ledger_id === salesAccount.id);
    assert.equal(salesDebit.side, 'debit');
    assert.equal(salesDebit.amount, 50000);

    const cgstDebit = postings.find(p => p.ledger_name === 'Output CGST');
    assert.equal(cgstDebit.side, 'debit');
    assert.equal(cgstDebit.amount, 4500);

    const sgstDebit = postings.find(p => p.ledger_name === 'Output SGST');
    assert.equal(sgstDebit.side, 'debit');
    assert.equal(sgstDebit.amount, 4500);
  } finally {
    book.close();
    rmSync(dir, {recursive: true, force: true});
  }
});

test('Inter-state Credit Note reverses Sales and Output IGST', () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'bookr-gst-cn-inter-'));
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

    const creditNote = book.saveVoucher({
      type: 'credit_note',
      date: '2025-05-18',
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

    // 1000.00 + 18% IGST (180.00) = 1180.00 (118000 paise)
    assert.equal(creditNote.amount, 118000);
    assert.equal(creditNote.details.gst.supply_type, 'inter_state');
    assert.equal(creditNote.details.gst.igst_amount, 18000);

    const postings = book.postings(creditNote.id);
    assert.equal(postings.length, 3);

    const igstDebit = postings.find(p => p.ledger_name === 'Output IGST');
    assert.equal(igstDebit.side, 'debit');
    assert.equal(igstDebit.amount, 18000);
  } finally {
    book.close();
    rmSync(dir, {recursive: true, force: true});
  }
});

test('Intra-state Debit Note reverses Purchases and Input CGST/SGST', () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'bookr-gst-dn-intra-'));
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

    const debitNote = book.saveVoucher({
      type: 'debit_note',
      date: '2025-05-20',
      supplier_id: supplier.id,
      account_id: purchaseLedger.id,
      lines: [
        {
          ledger_id: purchaseLedger.id,
          amount: 200000, // 2000.00 return
          hsn_sac: '9983',
          gst_rate: 12
        }
      ],
      details: {
        original_invoice: {
          number: 'SUPP-INV-88',
          date: '2025-05-15'
        }
      }
    });

    // 2000.00 + 6% Input CGST (120.00) + 6% Input SGST (120.00) = 2240.00 (224000 paise)
    assert.equal(debitNote.amount, 224000);
    assert.equal(debitNote.details.gst.supply_type, 'intra_state');
    assert.equal(debitNote.details.gst.cgst_amount, 12000);
    assert.equal(debitNote.details.gst.sgst_amount, 12000);

    const postings = book.postings(debitNote.id);
    assert.equal(postings.length, 4);

    const supplierDebit = postings.find(p => p.ledger_id === supplier.id);
    assert.equal(supplierDebit.side, 'debit');
    assert.equal(supplierDebit.amount, 224000);

    const purchaseCredit = postings.find(p => p.ledger_id === purchaseLedger.id);
    assert.equal(purchaseCredit.side, 'credit');
    assert.equal(purchaseCredit.amount, 200000);

    const inputCgst = postings.find(p => p.ledger_name === 'Input CGST');
    assert.equal(inputCgst.side, 'credit');
    assert.equal(inputCgst.amount, 12000);

    const inputSgst = postings.find(p => p.ledger_name === 'Input SGST');
    assert.equal(inputSgst.side, 'credit');
    assert.equal(inputSgst.amount, 12000);
  } finally {
    book.close();
    rmSync(dir, {recursive: true, force: true});
  }
});
