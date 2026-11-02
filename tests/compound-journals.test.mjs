import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Book, BookError} from '../lib/accounting.mjs';
import {CompanyStore} from '../lib/companies.mjs';
import {exportCompanyBundle, restoreCompanyBundle} from '../lib/company-backup.mjs';

import {CostCentresStore} from '../lib/cost-centres.mjs';

function fixture(book) {
  return {
    cash: book.ledger(1),
    sales: book.ledger(2),
    purchase: book.ledgers().find(row => row.kind === 'purchase'),
    customerA: book.createCustomer({name: 'Compound Customer Alpha'}),
    customerB: book.createCustomer({name: 'Compound Customer Beta'}),
    supplierA: book.saveSupplier({name: 'Compound Landlord North'}),
    supplierB: book.saveSupplier({name: 'Compound Landlord South'}),
    bank: book.saveBank({name: 'Compound Operating Bank'}),
    rent: book.saveLedger({kind: 'expense', name: 'Compound Office Rent'}),
    badDebts: book.saveLedger({kind: 'expense', name: 'Compound Bad Debts'}),
    discount: book.saveLedger({kind: 'expense', name: 'Compound Discount Allowed'}),
    bankCharges: book.saveLedger({kind: 'expense', name: 'Compound Bank Charges'}),
    capital: book.saveLedger({kind: 'capital', name: 'Compound Owner Capital'})
  };
}

const row = (ledger, side, amount) => ({ledger_id: ledger.id, side, amount});

test('Party-to-party transfer in Compound Journal adjusts customer balances and maintains double-entry balance', () => {
  const book = new Book();
  try {
    const f = fixture(book);
    // Give customer A an initial balance via sale
    book.saveVoucher({
      type: 'sale',
      date: '2026-04-01',
      customer_id: f.customerA.id,
      account_id: f.sales.id,
      amount: 150000
    });
    assert.equal(book.statement(f.customerA.id).balance, 150000);

    const voucher = book.saveVoucher({
      type: 'journal',
      date: '2026-04-05',
      entries: [
        row(f.customerB, 'debit', 50000),
        row(f.customerA, 'credit', 50000)
      ],
      narration: 'Transfer balance from Alpha to Beta'
    });

    assert.equal(voucher.type, 'journal');
    assert.equal(voucher.amount, 50000);
    assert.equal(voucher.details.journal_mode, 'general');
    assert.equal(voucher.postings.length, 2);

    // Customer A balance: 150000 - 50000 credit = 100000 Dr
    assert.equal(book.statement(f.customerA.id).balance, 100000);
    // Customer B balance: 0 + 50000 debit = 50000 Dr
    assert.equal(book.statement(f.customerB.id).balance, 50000);

    const trial = book.trialBalance();
    assert.equal(trial.totals.balanced, true);
    assert.equal(trial.totals.debit, trial.totals.credit);
  } finally {
    book.close();
  }
});

test('Multi-party supplier split expense in Compound Journal credits multiple suppliers and debits expense', () => {
  const book = new Book();
  try {
    const f = fixture(book);
    const voucher = book.saveVoucher({
      type: 'journal',
      date: '2026-04-06',
      entries: [
        row(f.rent, 'debit', 30000),
        row(f.supplierA, 'credit', 18000),
        row(f.supplierB, 'credit', 12000)
      ],
      narration: 'Rent expense allocated to North and South landlords'
    });

    assert.equal(voucher.amount, 30000);
    assert.equal(voucher.entries.length, 3);
    assert.equal(book.statement(f.rent.id).balance, 30000);
    assert.equal(book.statement(f.supplierA.id).balance, -18000);
    assert.equal(book.statement(f.supplierB.id).balance, -12000);

    const reports = book.financialReports();
    assert.equal(reports.profitAndLoss.indirectExpenses, 30000);
    assert.equal(reports.balanceSheet.totals.balanced, true);
  } finally {
    book.close();
  }
});

test('Debtor adjustment with Bad Debts and Discount in Compound Journal credits customer', () => {
  const book = new Book();
  try {
    const f = fixture(book);
    book.saveVoucher({
      type: 'sale',
      date: '2026-04-01',
      customer_id: f.customerA.id,
      account_id: f.sales.id,
      amount: 150000
    });

    const voucher = book.saveVoucher({
      type: 'journal',
      date: '2026-04-07',
      entries: [
        row(f.badDebts, 'debit', 20000),
        row(f.discount, 'debit', 10000),
        row(f.customerA, 'credit', 30000)
      ],
      narration: 'Bad debts and discount adjustment for Customer Alpha'
    });

    assert.equal(voucher.amount, 30000);
    assert.equal(book.statement(f.customerA.id).balance, 120000);
    assert.equal(book.statement(f.badDebts.id).balance, 20000);
    assert.equal(book.statement(f.discount.id).balance, 10000);

    const trial = book.trialBalance();
    assert.equal(trial.totals.balanced, true);
  } finally {
    book.close();
  }
});

test('Bank and Party settlement with Bank Charges in Compound Journal', () => {
  const book = new Book();
  try {
    const f = fixture(book);
    book.saveVoucher({
      type: 'sale',
      date: '2026-04-01',
      customer_id: f.customerA.id,
      account_id: f.sales.id,
      amount: 150000
    });

    const voucher = book.saveVoucher({
      type: 'journal',
      date: '2026-04-08',
      entries: [
        row(f.bank, 'debit', 47500),
        row(f.bankCharges, 'debit', 2500),
        row(f.customerA, 'credit', 50000)
      ],
      narration: 'Receipt via bank with charges deduction'
    });

    assert.equal(voucher.amount, 50000);
    assert.equal(book.statement(f.bank.id).balance, 47500);
    assert.equal(book.statement(f.bankCharges.id).balance, 2500);
    assert.equal(book.statement(f.customerA.id).balance, 100000);

    assert.equal(book.trialBalance().totals.balanced, true);
  } finally {
    book.close();
  }
});

test('Compound Journal supports Cost Centre allocations on expense lines and enforces balance', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookr-cc-jrn-'));
  const ccStore = new CostCentresStore(join(dir, 'cost-centres.json'));
  const book = new Book();
  try {
    const f = fixture(book);
    const cat = ccStore.createCategory({name: 'Compound Branches', allocate_revenue: 1, allocate_non_revenue: 0});
    const c1 = ccStore.createCentre({name: 'Alpha Centre', category_id: cat.id});
    const c2 = ccStore.createCentre({name: 'Beta Centre', category_id: cat.id});

    // Mismatched cost allocation should throw native error
    assert.throws(() => book.saveVoucher({
      type: 'journal',
      date: '2026-04-09',
      entries: [
        row(f.rent, 'debit', 30000),
        row(f.supplierA, 'credit', 30000)
      ],
      details: {
        cost_allocations: [
          {
            ledger_id: f.rent.id,
            category_id: cat.id,
            allocations: [
              {centre_id: c1.id, amount: 20000} // Missing 10000
            ]
          }
        ]
      }
    }), error => error instanceof BookError && error.message.includes('Mismatch between total Cost Centre Allocation and Ledger Amount'));

    // Balanced allocation succeeds
    const voucher = book.saveVoucher({
      type: 'journal',
      date: '2026-04-09',
      entries: [
        row(f.rent, 'debit', 30000),
        row(f.supplierA, 'credit', 30000)
      ],
      details: {
        cost_allocations: [
          {
            ledger_id: f.rent.id,
            category_id: cat.id,
            allocations: [
              {centre_id: c1.id, amount: 18000},
              {centre_id: c2.id, amount: 12000}
            ]
          }
        ]
      }
    });

    assert.equal(voucher.amount, 30000);
    assert.deepEqual(voucher.details.cost_allocations[0].allocations, [
      {centre_id: c1.id, amount: 18000},
      {centre_id: c2.id, amount: 12000}
    ]);
  } finally {
    book.close();
    rmSync(dir, {recursive: true, force: true});
  }
});

test('Compound Journals survive whole-company backup and restore with full fidelity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookr-compound-backup-'));
  const store = new CompanyStore({defaultFile: join(dir, 'default.sqlite')});

  try {
    const profile = store.create({
      name: 'Compound Test Company',
      financial_year_from: '2026-04-01',
      books_from: '2026-04-01',
      financial_year_to: '2027-03-31'
    });
    const book1 = store.book(profile.id);

    const f = fixture(book1);
    book1.saveVoucher({
      type: 'journal',
      date: '2026-04-05',
      entries: [
        row(f.customerB, 'debit', 50000),
        row(f.customerA, 'credit', 50000)
      ],
      narration: 'Transfer balance from Alpha to Beta'
    });
    book1.saveVoucher({
      type: 'journal',
      date: '2026-04-06',
      entries: [
        row(f.rent, 'debit', 30000),
        row(f.supplierA, 'credit', 18000),
        row(f.supplierB, 'credit', 12000)
      ],
      narration: 'Rent expense split'
    });

    const bundle = exportCompanyBundle(store, profile.id);
    assert.equal(bundle.format, 'bookr.company');

    const restored = restoreCompanyBundle(store, bundle, {name: 'Restored Compound Company'});
    const book2 = store.book(restored.id);

    assert.deepEqual(book2.state().vouchers, book1.state().vouchers);
    assert.deepEqual(book2.trialBalance(), book1.trialBalance());
    assert.equal(book2.statement(f.customerA.id).balance, book1.statement(f.customerA.id).balance);
    assert.equal(book2.statement(f.customerB.id).balance, book1.statement(f.customerB.id).balance);
    assert.equal(book2.statement(f.supplierA.id).balance, book1.statement(f.supplierA.id).balance);
    assert.equal(book2.statement(f.supplierB.id).balance, book1.statement(f.supplierB.id).balance);
  } finally {
    store.close();
    rmSync(dir, {recursive: true, force: true});
  }
});
