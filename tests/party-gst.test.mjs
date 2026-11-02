import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Book} from '../lib/accounting.mjs';
import {CompanyStore} from '../lib/companies.mjs';
import {exportCompanyBundle, restoreCompanyBundle} from '../lib/company-backup.mjs';

test('Party ledgers store and validate GSTIN, registration type and state', () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'bookr-party-gst-'));
  const book = new Book(join(dir, 'test.sqlite'), {companyName: 'Party GST Test Co'});
  try {
    // 1. Customer with GSTIN and state
    const customer = book.createCustomer({
      name: 'Alpha Traders',
      gstin: '08ABCDE1234F1Z5',
      state: 'Rajasthan'
    });
    assert.equal(customer.name, 'Alpha Traders');
    assert.equal(customer.gstin, '08ABCDE1234F1Z5');
    assert.equal(customer.gst_registration_type, 'Regular');
    assert.equal(customer.state, 'Rajasthan');

    // 2. Customer with GSTIN but omitted state -> auto-populates from GSTIN state code
    const autoStateCustomer = book.createCustomer({
      name: 'Beta Enterprises',
      gstin: '27AABCT3518Q1ZV'
    });
    assert.equal(autoStateCustomer.state, 'Maharashtra');
    assert.equal(autoStateCustomer.gstin, '27AABCT3518Q1ZV');
    assert.equal(autoStateCustomer.gst_registration_type, 'Regular');

    // 3. Unregistered Customer without GSTIN
    const unregistered = book.createCustomer({
      name: 'Cash Walk-in Retail',
      state: 'Rajasthan'
    });
    assert.equal(unregistered.gstin, '');
    assert.equal(unregistered.gst_registration_type, 'Unregistered');
    assert.equal(unregistered.state, 'Rajasthan');

    // 4. Supplier with Composition registration
    const supplier = book.saveSupplier({
      name: 'Gamma Suppliers',
      gstin: '08XYZAB1234C1Z9',
      gst_registration_type: 'Composition',
      state: 'Rajasthan'
    });
    assert.equal(supplier.name, 'Gamma Suppliers');
    assert.equal(supplier.gstin, '08XYZAB1234C1Z9');
    assert.equal(supplier.gst_registration_type, 'Composition');

    // 5. Updating party GSTIN
    const updatedCustomer = book.saveCustomer({
      name: 'Alpha Traders',
      revision: customer.revision,
      gstin: '08ABCDE1234F2Z4',
      state: 'Rajasthan'
    }, customer.id);
    assert.equal(updatedCustomer.gstin, '08ABCDE1234F2Z4');

    // 6. Invalid GSTIN rejection
    assert.throws(() => {
      book.createCustomer({
        name: 'Invalid GST Party',
        gstin: 'INVALID_12345'
      });
    }, /Enter a valid 15-character GSTIN/);
  } finally {
    book.close();
    rmSync(dir, {recursive: true, force: true});
  }
});

test('Tax ledgers under Duties & Taxes store tax_type and tax_rate', () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'bookr-tax-ledgers-'));
  const book = new Book(join(dir, 'test.sqlite'), {companyName: 'Tax Ledger Test Co'});
  try {
    const cgst = book.saveAccount({
      name: 'Output CGST',
      group_name: 'Duties & Taxes',
      tax_type: 'CGST',
      tax_rate: 9
    }, null, 'general');
    assert.equal(cgst.name, 'Output CGST');
    assert.equal(cgst.tax_type, 'CGST');
    assert.equal(cgst.tax_rate, 9);

    const sgst = book.saveAccount({
      name: 'Output SGST',
      group_name: 'Duties & Taxes',
      tax_type: 'SGST',
      tax_rate: 9
    }, null, 'general');
    assert.equal(sgst.tax_type, 'SGST');
    assert.equal(sgst.tax_rate, 9);

    const igst = book.saveAccount({
      name: 'Output IGST',
      group_name: 'Duties & Taxes',
      tax_type: 'IGST',
      tax_rate: 18
    }, null, 'general');
    assert.equal(igst.tax_type, 'IGST');
    assert.equal(igst.tax_rate, 18);

    // Reading back
    const retrieved = book.ledger(cgst.id);
    assert.equal(retrieved.tax_type, 'CGST');
    assert.equal(retrieved.tax_rate, 9);
  } finally {
    book.close();
    rmSync(dir, {recursive: true, force: true});
  }
});

test('Party GST and Tax Ledgers survive portable backup export and restore', () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'bookr-party-backup-'));
  const store = new CompanyStore({defaultFile: join(dir, 'default.sqlite')});
  try {
    const book = store.book('default');
    const customer = book.createCustomer({
      name: 'Export GST Customer',
      gstin: '08ABCDE1234F1Z5',
      state: 'Rajasthan'
    });
    const taxLedger = book.saveAccount({
      name: 'Output CGST',
      group_name: 'Duties & Taxes',
      tax_type: 'CGST',
      tax_rate: 9
    }, null, 'general');

    const bundle = exportCompanyBundle(store, 'default');
    const restored = restoreCompanyBundle(store, bundle, {name: 'Restored GST Book'});
    const restoredBook = store.book(restored.id);

    const restoredCustomer = restoredBook.ledger(customer.id);
    assert.equal(restoredCustomer.gstin, '08ABCDE1234F1Z5');
    assert.equal(restoredCustomer.gst_registration_type, 'Regular');
    assert.equal(restoredCustomer.state, 'Rajasthan');

    const restoredTaxLedger = restoredBook.ledger(taxLedger.id);
    assert.equal(restoredTaxLedger.tax_type, 'CGST');
    assert.equal(restoredTaxLedger.tax_rate, 9);
  } finally {
    store.close();
    rmSync(dir, {recursive: true, force: true});
  }
});
