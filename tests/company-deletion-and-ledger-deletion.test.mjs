import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Book, BookError} from '../lib/accounting.mjs';
import {CompanyStore} from '../lib/companies.mjs';

test('CompanyStore.delete(id) permanently purges company and its file while leaving others intact', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookr-company-delete-'));
  const defaultFile = join(dir, 'default.sqlite');
  let store = null;
  try {
    store = new CompanyStore({defaultFile});
    const compA = store.create({name: 'Delete Company Alpha'});
    const compB = store.create({name: 'Keep Company Beta'});

    const fileA = store.fileFor(compA.id);
    const fileB = store.fileFor(compB.id);
    assert.ok(existsSync(fileA));
    assert.ok(existsSync(fileB));

    // Delete company Alpha
    const result = store.delete(compA.id);
    assert.deepEqual(result, {deleted: true, id: compA.id});

    // Alpha file should be gone from disk
    assert.ok(!existsSync(fileA));
    assert.ok(existsSync(fileB));

    // Profile lookup for Alpha should fail with 404
    assert.throws(() => store.profile(compA.id), err => err instanceof BookError && err.status === 404);

    // List should only contain default and Beta
    const remaining = store.list().map(c => c.name);
    assert.ok(!remaining.includes('Delete Company Alpha'));
    assert.ok(remaining.includes('Keep Company Beta'));

    // Cannot delete nonexistent company
    assert.throws(() => store.delete('0'.repeat(32)), err => err instanceof BookError && err.status === 404);
  } finally {
    try { store?.close(); } catch {}
    try { rmSync(dir, {recursive: true, force: true}); } catch {}
  }
});

test('Cash is protected from deletion as a built-in ledger', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookr-builtin-master-'));
  const file = join(dir, 'book.sqlite');
  let book = null;
  try {
    book = new Book(file);
    const ledgers = book.ledgers();
    const cash = ledgers.find(l => l.name === 'Cash');
    assert.ok(cash, 'Cash must exist as built-in ledger');

    // Cannot delete Cash (id 1)
    assert.throws(
      () => book.deleteLedger(cash.id),
      err => err instanceof BookError && /built-in/i.test(err.message)
    );
  } finally {
    try { book?.close(); } catch {}
    try { rmSync(dir, {recursive: true, force: true}); } catch {}
  }
});

test('Ledger deletion via deleteLedger works for unused ledgers and blocks ledgers with transactions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookr-ledger-delete-'));
  const file = join(dir, 'book.sqlite');
  let book = null;
  try {
    book = new Book(file);
    
    // Create an unused ledger under Sundry Debtors
    const unused = book.saveLedger({name: 'Unused Customer', kind: 'customer', group_name: 'Sundry Debtors', group_id: 27});
    assert.ok(unused.id);
    assert.ok(book.ledgers().some(l => l.id === unused.id));

    // Delete unused ledger
    const delResult = book.deleteLedger(unused.id);
    assert.deepEqual(delResult, {deleted: true, id: unused.id, name: 'Unused Customer'});
    assert.ok(!book.ledgers().some(l => l.id === unused.id));

    // Create a ledger with a voucher transaction
    const active = book.saveLedger({name: 'Active Customer', kind: 'customer', group_name: 'Sundry Debtors', group_id: 27});
    book.saveVoucher({
      type: 'sale',
      date: '2026-04-01',
      customer_id: active.id,
      account_id: 2,
      amount: 50000
    });

    // Attempting to delete active ledger should throw BookError
    assert.throws(
      () => book.deleteLedger(active.id),
      err => err instanceof BookError && /existing transactions|cannot delete/i.test(err.message)
    );
  } finally {
    try { book?.close(); } catch {}
    try { rmSync(dir, {recursive: true, force: true}); } catch {}
  }
});

test('Non-legacy group ledgers (Fixed Assets, Investments, Loans) accept opening balances and report correctly in Balance Sheet', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookr-extended-groups-'));
  const file = join(dir, 'book.sqlite');
  let book = null;
  try {
    book = new Book(file);

    // Create Fixed Asset with debit opening balance (50,000 paise = Rs 500)
    const machinery = book.saveLedger({
      name: 'Plant & Machinery',
      kind: 'general',
      group_name: 'Fixed Assets',
      group_id: 7,
      opening_balance: 50000
    });
    assert.equal(machinery.opening_balance, 50000);

    // Create Secured Loan with credit opening balance (-50,000 paise)
    const loan = book.saveLedger({
      name: 'HDFC Term Loan',
      kind: 'general',
      group_name: 'Secured Loans',
      group_id: 24,
      opening_balance: -50000
    });
    assert.equal(loan.opening_balance, -50000);

    // Check financial reports: Balance sheet should have Fixed Assets and Loans
    const reports = book.financialReports();
    assert.ok(reports.balanceSheet);
    
    // Check asset side includes Fixed Assets
    const fixedAssetsGroup = reports.balanceSheet.groups.find(g => g.name === 'Fixed Assets' || g.key === 'fixed-assets');
    assert.ok(fixedAssetsGroup, 'Fixed Assets group must appear in Balance Sheet');
    assert.equal(fixedAssetsGroup.amount, 50000);

    // Check liability side includes Loans
    const loansGroup = reports.balanceSheet.groups.find(g => g.name === 'Loans (Liability)' || g.key === 'loans-liability' || g.name === 'Secured Loans');
    assert.ok(loansGroup, 'Loans group must appear in Balance Sheet');
    assert.equal(Math.abs(loansGroup.amount), 50000);

    // Balance Sheet should be balanced
    assert.equal(reports.balanceSheet.totals.balanced, true);
  } finally {
    try { book?.close(); } catch {}
    try { rmSync(dir, {recursive: true, force: true}); } catch {}
  }
});
