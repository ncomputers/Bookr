import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Book, BookError} from '../lib/accounting.mjs';
import {CompanyStore} from '../lib/companies.mjs';
import {exportCompanyBundle, restoreCompanyBundle} from '../lib/company-backup.mjs';

function createMultiLineFixture(book) {
  const customer = book.createCustomer({name: 'Enterprise Client Fictional'});
  const supplier = book.saveSupplier({name: 'Industrial Vendor Fictional'});
  const salesAccount = book.ledgers().find(l => l.kind === 'sales');
  const purchaseAccount = book.ledgers().find(l => l.kind === 'purchase');
  const freight = book.saveAccount({name: 'Freight & Cartage Fictional', kind: 'income'});
  const roundOff = book.saveAccount({name: 'Round Off Fictional', kind: 'income'});
  const packing = book.saveAccount({name: 'Packing Charges Fictional', kind: 'expense'});

  return {customer, supplier, salesAccount, purchaseAccount, freight, roundOff, packing};
}

test('Multi-line Sales invoice posts balanced entries across multiple particulars ledgers', () => {
  const book = new Book();
  try {
    const f = createMultiLineFixture(book);

    const sale = book.saveVoucher({
      type: 'sale',
      date: '2026-04-01',
      customer_id: f.customer.id,
      lines: [
        {ledger_id: f.salesAccount.id, amount: 100000},
        {ledger_id: f.freight.id, amount: 5000},
        {ledger_id: f.roundOff.id, amount: 25}
      ],
      bill: {reference: 'INV-MULTI-01'},
      narration: 'Multi-line sales invoice test'
    });

    assert.equal(sale.amount, 105025);
    assert.equal(sale.customer_id, f.customer.id);
    assert.equal(sale.account_id, f.salesAccount.id);

    // Verify 4 postings: 1 customer debit, 3 ledger credits
    const debit = sale.postings.filter(p => p.side === 'debit');
    const credit = sale.postings.filter(p => p.side === 'credit');

    assert.equal(debit.length, 1);
    assert.equal(debit[0].ledger_id, f.customer.id);
    assert.equal(debit[0].amount, 105025);

    assert.equal(credit.length, 3);
    const creditMap = new Map(credit.map(p => [p.ledger_id, p.amount]));
    assert.equal(creditMap.get(f.salesAccount.id), 100000);
    assert.equal(creditMap.get(f.freight.id), 5000);
    assert.equal(creditMap.get(f.roundOff.id), 25);

    // Customer balance: exactly 105,025 Dr
    assert.equal(book.statement(f.customer.id).balance, 105025);

    // Bill generated for the full 105,025 paise
    assert.equal(sale.bill.reference, 'INV-MULTI-01');
    assert.equal(sale.bill.amount, 105025);

    // Financial reports
    const reports = book.financialReports();
    assert.equal(reports.profitAndLoss.income, 100000);
    assert.equal(reports.profitAndLoss.indirectIncome, 5025);
    assert.equal(reports.trialBalanced, true);
  } finally {
    book.close();
  }
});

test('Multi-line Purchase invoice credits supplier and debits multiple purchase/expense lines', () => {
  const book = new Book();
  try {
    const f = createMultiLineFixture(book);

    const purchase = book.saveVoucher({
      type: 'purchase',
      date: '2026-04-01',
      supplier_id: f.supplier.id,
      lines: [
        {ledger_id: f.purchaseAccount.id, amount: 80000},
        {ledger_id: f.packing.id, amount: 4000}
      ],
      details: {supplier_invoice: {number: 'SUP-MULTI-01', date: '2026-04-01'}},
      narration: 'Multi-line purchase test'
    });

    assert.equal(purchase.amount, 84000);
    assert.equal(purchase.supplier_id, f.supplier.id);

    // Postings: supplier credit 84000, 2 ledger debits
    const credit = purchase.postings.filter(p => p.side === 'credit');
    const debit = purchase.postings.filter(p => p.side === 'debit');

    assert.equal(credit.length, 1);
    assert.equal(credit[0].ledger_id, f.supplier.id);
    assert.equal(credit[0].amount, 84000);

    assert.equal(debit.length, 2);
    const debitMap = new Map(debit.map(p => [p.ledger_id, p.amount]));
    assert.equal(debitMap.get(f.purchaseAccount.id), 80000);
    assert.equal(debitMap.get(f.packing.id), 4000);

    // Supplier balance: -84,000 Cr
    assert.equal(book.statement(f.supplier.id).balance, -84000);

    // Reports
    const reports = book.financialReports();
    assert.equal(reports.profitAndLoss.expenses, 80000);
    assert.equal(reports.profitAndLoss.indirectExpenses, 4000);
    assert.equal(reports.trialBalanced, true);
  } finally {
    book.close();
  }
});

test('Consolidation when the same ledger appears on multiple invoice lines', () => {
  const book = new Book();
  try {
    const f = createMultiLineFixture(book);

    const sale = book.saveVoucher({
      type: 'sale',
      date: '2026-04-01',
      customer_id: f.customer.id,
      lines: [
        {ledger_id: f.salesAccount.id, amount: 50000},
        {ledger_id: f.salesAccount.id, amount: 50000}
      ],
      bill: {reference: 'INV-SPLIT'}
    });

    assert.equal(sale.amount, 100000);
    // Because PRIMARY KEY(voucher_id, ledger_id), the 2 lines to salesAccount are consolidated to 1 posting
    assert.equal(sale.postings.length, 2);
    const salesPosting = sale.postings.find(p => p.ledger_id === f.salesAccount.id);
    assert.equal(salesPosting.amount, 100000);
    assert.equal(salesPosting.side, 'credit');
  } finally {
    book.close();
  }
});

test('Multi-line vouchers survive backup and restore', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookr-multiline-backup-'));
  const store = new CompanyStore({defaultFile: join(dir, 'book.sqlite')});
  try {
    const profile = store.create({
      name: 'MultiLine Backup Company',
      financial_year_from: '2026-04-01',
      books_from: '2026-04-01',
      financial_year_to: '2027-03-31'
    });
    const book = store.book(profile.id);
    const f = createMultiLineFixture(book);

    book.saveVoucher({
      type: 'sale',
      date: '2026-04-01',
      customer_id: f.customer.id,
      lines: [
        {ledger_id: f.salesAccount.id, amount: 100000},
        {ledger_id: f.freight.id, amount: 5000}
      ],
      bill: {reference: 'INV-BK-01'}
    });

    const reportsBefore = book.financialReports();
    const bundle = exportCompanyBundle(store, profile.id);

    const restored = restoreCompanyBundle(store, bundle, {name: 'Restored MultiLine Company'});
    const restoredBook = store.book(restored.id);
    assert.deepEqual(restoredBook.financialReports(), reportsBefore);
    assert.equal(restoredBook.db.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally {
    store.close();
    rmSync(dir, {recursive: true, force: true});
  }
});
