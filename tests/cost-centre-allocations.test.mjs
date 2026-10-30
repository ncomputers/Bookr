import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Book, BookError} from '../lib/accounting.mjs';
import {CostCentresStore} from '../lib/cost-centres.mjs';
import {CompanyStore} from '../lib/companies.mjs';
import {exportCompanyBundle, restoreCompanyBundle} from '../lib/company-backup.mjs';

function createCostCentreFixture(book, ccStore) {
  const customer = book.createCustomer({name: 'Client Alpha Fictional'});
  const salesAccount = book.ledgers().find(l => l.kind === 'sales');
  const cat = ccStore.createCategory({name: 'Departments', allocate_revenue: 1, allocate_non_revenue: 0});
  const centre1 = ccStore.createCentre({name: 'North Region', category_id: cat.id});
  const centre2 = ccStore.createCentre({name: 'South Region', category_id: cat.id});

  return {customer, salesAccount, cat, centre1, centre2};
}

test('Voucher saves valid cost centre allocations matching line amount exactly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookr-cc-vch-'));
  const ccFile = join(dir, 'cost-centres.json');
  const ccStore = new CostCentresStore(ccFile);
  const book = new Book();
  try {
    const f = createCostCentreFixture(book, ccStore);

    const sale = book.saveVoucher({
      type: 'sale',
      date: '2026-04-01',
      customer_id: f.customer.id,
      account_id: f.salesAccount.id,
      amount: 100000,
      details: {
        cost_allocations: [
          {
            ledger_id: f.salesAccount.id,
            category_id: f.cat.id,
            category_name: f.cat.name,
            allocations: [
              {centre_id: f.centre1.id, centre_name: f.centre1.name, amount: 60000},
              {centre_id: f.centre2.id, centre_name: f.centre2.name, amount: 40000}
            ]
          }
        ]
      }
    });

    assert.equal(sale.amount, 100000);
    assert.ok(sale.details.cost_allocations);
    assert.equal(sale.details.cost_allocations.length, 1);
    assert.equal(sale.details.cost_allocations[0].allocations.length, 2);
    assert.equal(sale.details.cost_allocations[0].allocations[0].amount, 60000);
    assert.equal(sale.details.cost_allocations[0].allocations[1].amount, 40000);
  } finally {
    book.close();
    rmSync(dir, {recursive: true, force: true});
  }
});

test('Mismatch between total Cost Centre Allocation and Ledger Amount throws native error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookr-cc-vch-err-'));
  const ccFile = join(dir, 'cost-centres.json');
  const ccStore = new CostCentresStore(ccFile);
  const book = new Book();
  try {
    const f = createCostCentreFixture(book, ccStore);

    // Line amount is 100000, but allocations sum to 90000 (mismatch!)
    assert.throws(() => book.saveVoucher({
      type: 'sale',
      date: '2026-04-01',
      customer_id: f.customer.id,
      account_id: f.salesAccount.id,
      amount: 100000,
      details: {
        cost_allocations: [
          {
            ledger_id: f.salesAccount.id,
            category_id: f.cat.id,
            allocations: [
              {centre_id: f.centre1.id, amount: 60000},
              {centre_id: f.centre2.id, amount: 30000} // sum = 90000 != 100000
            ]
          }
        ]
      }
    }), (err) => {
      assert.ok(err instanceof BookError);
      assert.equal(err.message, 'Mismatch between total Cost Centre Allocation and Ledger Amount');
      return true;
    });
  } finally {
    book.close();
    rmSync(dir, {recursive: true, force: true});
  }
});

test('Cost centre allocations survive backup and restore', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookr-cc-backup-'));
  const store = new CompanyStore({defaultFile: join(dir, 'book.sqlite')});
  try {
    const profile = store.create({
      name: 'CC Backup Company',
      financial_year_from: '2026-04-01',
      books_from: '2026-04-01',
      financial_year_to: '2027-03-31'
    });
    const book = store.book(profile.id);
    const customer = book.createCustomer({name: 'CC Backup Customer'});
    const salesAccount = book.ledgers().find(l => l.kind === 'sales');

    const sale = book.saveVoucher({
      type: 'sale',
      date: '2026-04-01',
      customer_id: customer.id,
      account_id: salesAccount.id,
      amount: 100000,
      details: {
        cost_allocations: [
          {
            ledger_id: salesAccount.id,
            category_id: 1,
            allocations: [
              {centre_id: 1, amount: 100000}
            ]
          }
        ]
      }
    });

    const bundle = exportCompanyBundle(store, profile.id);
    const restored = restoreCompanyBundle(store, bundle, {name: 'Restored CC Company'});
    const restoredBook = store.book(restored.id);
    const restoredSale = restoredBook.voucher(sale.id);

    assert.equal(restoredSale.amount, 100000);
    assert.deepEqual(restoredSale.details.cost_allocations, sale.details.cost_allocations);
  } finally {
    store.close();
    rmSync(dir, {recursive: true, force: true});
  }
});
