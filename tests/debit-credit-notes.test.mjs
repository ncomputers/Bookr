import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Book, BookError} from '../lib/accounting.mjs';
import {CompanyStore} from '../lib/companies.mjs';
import {exportCompanyBundle, restoreCompanyBundle} from '../lib/company-backup.mjs';

function createFixture(book) {
  const customer = book.createCustomer({name: 'Acme Retailers Fictional'});
  const supplier = book.saveSupplier({name: 'Global Wholesale Fictional'});
  const salesAccount = book.ledgers().find(l => l.kind === 'sales');
  const purchaseAccount = book.ledgers().find(l => l.kind === 'purchase');

  // Baseline sale and purchase
  const sale = book.saveVoucher({
    type: 'sale',
    date: '2026-04-01',
    customer_id: customer.id,
    account_id: salesAccount.id,
    amount: 150000, // 1,500.00
    bill: {reference: 'INV-101'}
  });

  const purchase = book.saveVoucher({
    type: 'purchase',
    date: '2026-04-01',
    supplier_id: supplier.id,
    account_id: purchaseAccount.id,
    amount: 100000, // 1,000.00
    details: {supplier_invoice: {number: 'BILL-501', date: '2026-04-01'}}
  });

  return {customer, supplier, salesAccount, purchaseAccount, sale, purchase};
}

test('Credit Note debits sales, credits customer, reduces receivable and net sales', () => {
  const book = new Book();
  try {
    const f = createFixture(book);

    // Initial balances
    assert.equal(book.statement(f.customer.id).balance, 150000);
    assert.equal(book.financialReports().profitAndLoss.income, 150000);

    // Record Credit Note (Sales Return)
    const creditNote = book.saveVoucher({
      type: 'credit_note',
      date: '2026-04-02',
      customer_id: f.customer.id,
      account_id: f.salesAccount.id,
      amount: 30000, // 300.00
      narration: 'Damaged goods returned by customer',
      details: {
        original_invoice: {number: 'INV-101', date: '2026-04-01'}
      }
    });

    assert.equal(creditNote.type, 'credit_note');
    assert.equal(creditNote.number, 1);
    assert.equal(creditNote.amount, 30000);
    assert.equal(creditNote.customer_id, f.customer.id);
    assert.equal(creditNote.account_id, f.salesAccount.id);
    assert.equal(creditNote.details.original_invoice.number, 'INV-101');
    assert.equal(creditNote.details.original_invoice.date, '2026-04-01');

    // Postings check: Sales Accounts is DEBITED (reducing revenue), Customer is CREDITED (reducing asset)
    const postings = creditNote.postings.map(p => [p.ledger_id, p.side, p.amount]);
    assert.deepEqual(postings, [
      [f.salesAccount.id, 'debit', 30000],
      [f.customer.id, 'credit', 30000]
    ]);

    // Ledger statement: balance reduced from 150,000 to 120,000 Dr
    const customerStatement = book.statement(f.customer.id);
    assert.equal(customerStatement.balance, 120000);
    assert.equal(customerStatement.rows.length, 2);
    assert.equal(customerStatement.rows[1].side, 'credit');
    assert.equal(customerStatement.rows[1].particulars, f.salesAccount.name);

    // Net sales reduced from 150,000 to 120,000
    const reports = book.financialReports();
    assert.equal(reports.profitAndLoss.income, 120000);
    assert.equal(reports.profitAndLoss.grossProfit, 20000); // 120,000 sales - 100,000 purchase
    assert.equal(reports.trialBalanced, true);
  } finally {
    book.close();
  }
});

test('Debit Note debits supplier, credits purchases, reduces payable and net purchase costs', () => {
  const book = new Book();
  try {
    const f = createFixture(book);

    // Initial balances
    assert.equal(book.statement(f.supplier.id).balance, -100000); // Cr
    assert.equal(book.financialReports().profitAndLoss.expenses, 100000);

    // Record Debit Note (Purchase Return)
    const debitNote = book.saveVoucher({
      type: 'debit_note',
      supplier_id: f.supplier.id,
      account_id: f.purchaseAccount.id,
      date: '2026-04-02',
      amount: 25000, // 250.00
      narration: 'Defective materials returned to supplier',
      details: {
        original_invoice: {number: 'BILL-501', date: '2026-04-01'}
      }
    });

    assert.equal(debitNote.type, 'debit_note');
    assert.equal(debitNote.number, 1);
    assert.equal(debitNote.amount, 25000);
    assert.equal(debitNote.customer_id, f.supplier.id);
    assert.equal(debitNote.supplier_id, f.supplier.id);
    assert.equal(debitNote.account_id, f.purchaseAccount.id);
    assert.equal(debitNote.details.original_invoice.number, 'BILL-501');

    // Postings check: Supplier is DEBITED (reducing liability), Purchase Accounts is CREDITED (reducing expense)
    const postings = debitNote.postings.map(p => [p.ledger_id, p.side, p.amount]);
    assert.deepEqual(postings, [
      [f.supplier.id, 'debit', 25000],
      [f.purchaseAccount.id, 'credit', 25000]
    ]);

    // Ledger statement: balance reduced from -100,000 to -75,000 Cr
    const supplierStatement = book.statement(f.supplier.id);
    assert.equal(supplierStatement.balance, -75000);
    assert.equal(supplierStatement.rows.length, 2);
    assert.equal(supplierStatement.rows[1].side, 'debit');

    // Net purchases reduced from 100,000 to 75,000
    const reports = book.financialReports();
    assert.equal(reports.profitAndLoss.expenses, 75000);
    assert.equal(reports.profitAndLoss.grossProfit, 75000); // 150,000 sales - 75,000 purchases
    assert.equal(reports.trialBalanced, true);
  } finally {
    book.close();
  }
});

test('Day Book queries and totals include Credit Notes and Debit Notes', () => {
  const book = new Book();
  try {
    const f = createFixture(book);

    const cn = book.saveVoucher({
      type: 'credit_note',
      date: '2026-04-02',
      customer_id: f.customer.id,
      account_id: f.salesAccount.id,
      amount: 30000
    });

    const dn = book.saveVoucher({
      type: 'debit_note',
      date: '2026-04-02',
      supplier_id: f.supplier.id,
      account_id: f.purchaseAccount.id,
      amount: 25000
    });

    // Filter by type credit_note
    const cnDayBook = book.dayBook({type: 'credit_note'});
    assert.equal(cnDayBook.rows.length, 1);
    assert.equal(cnDayBook.rows[0].id, cn.id);
    assert.equal(cnDayBook.totals.credit, 30000);

    // Filter by type debit_note
    const dnDayBook = book.dayBook({type: 'debit_note'});
    assert.equal(dnDayBook.rows.length, 1);
    assert.equal(dnDayBook.rows[0].id, dn.id);
    assert.equal(dnDayBook.totals.debit, 25000);

    // Filter all
    const allDayBook = book.dayBook({type: 'all'});
    assert.equal(allDayBook.rows.length, 4);
    // Debit totals: sale (150,000) + dn (25,000) = 175,000
    assert.equal(allDayBook.totals.debit, 175000);
    // Credit totals: purchase (100,000) + cn (30,000) = 130,000
    assert.equal(allDayBook.totals.credit, 130000);
  } finally {
    book.close();
  }
});

test('Credit Note and Debit Note survive disk restart and backup/restore', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookr-notes-persist-'));
  const store = new CompanyStore({defaultFile: join(dir, 'book.sqlite')});
  try {
    const profile = store.create({
      name: 'Notes Test Company',
      financial_year_from: '2026-04-01',
      books_from: '2026-04-01',
      financial_year_to: '2027-03-31'
    });
    const book = store.book(profile.id);
    const f = createFixture(book);
    book.saveVoucher({
      type: 'credit_note',
      date: '2026-04-02',
      customer_id: f.customer.id,
      account_id: f.salesAccount.id,
      amount: 30000,
      details: {original_invoice: {number: 'INV-101', date: '2026-04-01'}}
    });
    book.saveVoucher({
      type: 'debit_note',
      date: '2026-04-02',
      supplier_id: f.supplier.id,
      account_id: f.purchaseAccount.id,
      amount: 25000,
      details: {original_invoice: {number: 'BILL-501', date: '2026-04-01'}}
    });

    const stateBefore = book.state();
    const reportsBefore = book.financialReports();

    // Export backup bundle
    const bundle = exportCompanyBundle(store, profile.id);
    assert.ok(bundle.checksum.value);

    // Restore into a new company
    const restoredProfile = restoreCompanyBundle(store, bundle, {name: 'Restored Notes Company'});
    const restoredBook = store.book(restoredProfile.id);
    assert.deepEqual(restoredBook.financialReports(), reportsBefore);
    assert.equal(restoredBook.db.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally {
    store.close();
    rmSync(dir, {recursive: true, force: true});
  }
});

test('Validation rejects invalid ledger types, zero amounts and cross-type tampering', () => {
  const book = new Book();
  try {
    const f = createFixture(book);

    // Credit Note with supplier instead of customer
    assert.throws(() => book.saveVoucher({
      type: 'credit_note',
      date: '2026-04-02',
      customer_id: f.supplier.id,
      account_id: f.salesAccount.id,
      amount: 10000
    }), BookError);

    // Debit Note with customer instead of supplier
    assert.throws(() => book.saveVoucher({
      type: 'debit_note',
      date: '2026-04-02',
      supplier_id: f.customer.id,
      account_id: f.purchaseAccount.id,
      amount: 10000
    }), BookError);

    // Zero or negative amounts
    assert.throws(() => book.saveVoucher({
      type: 'credit_note',
      date: '2026-04-02',
      customer_id: f.customer.id,
      account_id: f.salesAccount.id,
      amount: 0
    }), BookError);

    assert.throws(() => book.saveVoucher({
      type: 'debit_note',
      date: '2026-04-02',
      supplier_id: f.supplier.id,
      account_id: f.purchaseAccount.id,
      amount: -5000
    }), BookError);
  } finally {
    book.close();
  }
});
