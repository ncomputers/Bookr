import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CompanyStore} from '../lib/companies.mjs';
import {exportCompanyBundle, restoreCompanyBundle} from '../lib/company-backup.mjs';
import {normalizeGstin, stateCodeFromGstin, stateNameFromGstin, normalizeRegistrationType, determineSupplyType, calculateLineGst} from '../lib/gst.mjs';

test('normalizeGstin validates 15-character Indian GSTINs correctly', () => {
  assert.equal(normalizeGstin(''), '');
  assert.equal(normalizeGstin(null), '');
  assert.equal(normalizeGstin(undefined), '');
  assert.equal(normalizeGstin('  08ABCDE1234F1Z5  '), '08ABCDE1234F1Z5');
  assert.equal(normalizeGstin('27aabct3518q1zv'), '27AABCT3518Q1ZV');

  assert.throws(() => normalizeGstin('08ABCDE1234F1Z'), /Enter a valid 15-character GSTIN/);
  assert.throws(() => normalizeGstin('08ABCDE1234F1Z55'), /Enter a valid 15-character GSTIN/);
  assert.throws(() => normalizeGstin('99ABCDE1234F1Z!'), /Enter a valid 15-character GSTIN/);
  assert.throws(() => normalizeGstin('XXABCDE1234F1Z5'), /Enter a valid 15-character GSTIN/);
});

test('stateCodeFromGstin and stateNameFromGstin resolve jurisdiction', () => {
  assert.equal(stateCodeFromGstin('08ABCDE1234F1Z5'), '08');
  assert.equal(stateNameFromGstin('08ABCDE1234F1Z5'), 'Rajasthan');
  assert.equal(stateCodeFromGstin('27AABCT3518Q1ZV'), '27');
  assert.equal(stateNameFromGstin('27AABCT3518Q1ZV'), 'Maharashtra');
  assert.equal(stateCodeFromGstin(''), null);
  assert.equal(stateNameFromGstin(''), null);
});

test('normalizeRegistrationType defaults correctly based on GSTIN presence', () => {
  assert.equal(normalizeRegistrationType('', false), 'Unregistered');
  assert.equal(normalizeRegistrationType('', true), 'Regular');
  assert.equal(normalizeRegistrationType('Composition', false), 'Composition');
  assert.equal(normalizeRegistrationType('regular', false), 'Regular');
  assert.equal(normalizeRegistrationType('Consumer', false), 'Consumer');
});

test('determineSupplyType distinguishes intra-state and inter-state supply', () => {
  assert.equal(determineSupplyType('Rajasthan', 'Rajasthan'), 'intra_state');
  assert.equal(determineSupplyType('Rajasthan', 'Maharashtra'), 'inter_state');
  assert.equal(determineSupplyType('', '', '08ABCDE1234F1Z5', '08ZZZZZ9999Z1Z1'), 'intra_state');
  assert.equal(determineSupplyType('', '', '08ABCDE1234F1Z5', '27AABCT3518Q1ZV'), 'inter_state');
});

test('calculateLineGst computes exact integer paise tax without floating point drift', () => {
  // 1,000.00 INR (100,000 paise) at 18% intra-state
  const intra = calculateLineGst(100000, 18, true);
  assert.equal(intra.taxableAmount, 100000);
  assert.equal(intra.cgst, 9000); // 90.00 INR
  assert.equal(intra.sgst, 9000); // 90.00 INR
  assert.equal(intra.igst, 0);
  assert.equal(intra.totalTax, 18000);
  assert.equal(intra.totalAmount, 118000);

  // 1,000.00 INR (100,000 paise) at 18% inter-state
  const inter = calculateLineGst(100000, 18, false);
  assert.equal(inter.taxableAmount, 100000);
  assert.equal(inter.cgst, 0);
  assert.equal(inter.sgst, 0);
  assert.equal(inter.igst, 18000); // 180.00 INR
  assert.equal(inter.totalTax, 18000);
  assert.equal(inter.totalAmount, 118000);

  // 100.55 INR (10,055 paise) at 5% intra-state (2.5% CGST + 2.5% SGST)
  // 10055 * 0.025 = 251.375 -> Math.round -> 251 paise each
  const oddIntra = calculateLineGst(10055, 5, true);
  assert.equal(oddIntra.cgst, 251);
  assert.equal(oddIntra.sgst, 251);
  assert.equal(oddIntra.totalTax, 502);
  assert.equal(oddIntra.totalAmount, 10557);

  // 0% tax rate
  const zero = calculateLineGst(50000, 0, true);
  assert.equal(zero.cgst, 0);
  assert.equal(zero.sgst, 0);
  assert.equal(zero.totalTax, 0);
  assert.equal(zero.totalAmount, 50000);
});

test('CompanyStore creates, updates and persists company GSTIN and registration type', () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'bookr-gst-test-'));
  const store = new CompanyStore({defaultFile: join(dir, 'default.sqlite')});
  try {
    const defaultProfile = store.profile('default');
    assert.equal(defaultProfile.gstin, '');
    assert.equal(defaultProfile.gst_registration_type, 'Unregistered');

    // Update default company with GSTIN
    const updated = store.update('default', {
      revision: defaultProfile.revision,
      gstin: '08ABCDE1234F1Z5',
      gst_registration_type: 'Regular',
      state: 'Rajasthan'
    });
    assert.equal(updated.gstin, '08ABCDE1234F1Z5');
    assert.equal(updated.gst_registration_type, 'Regular');

    // Create a new company with GSTIN
    const company = store.create({
      name: 'GST Registered Company',
      state: 'Maharashtra',
      gstin: '27AABCT3518Q1ZV',
      gst_registration_type: 'Regular'
    });
    assert.equal(company.gstin, '27AABCT3518Q1ZV');
    assert.equal(company.gst_registration_type, 'Regular');

    // Verify retrieval
    const retrieved = store.profile(company.id);
    assert.equal(retrieved.gstin, '27AABCT3518Q1ZV');
    assert.equal(retrieved.gst_registration_type, 'Regular');

    // Backup export and restore round-trip
    const bundle = exportCompanyBundle(store, company.id);
    assert.equal(bundle.company.gstin, '27AABCT3518Q1ZV');
    assert.equal(bundle.company.gst_registration_type, 'Regular');

    const restored = restoreCompanyBundle(store, bundle, {name: 'Restored GST Company'});
    assert.equal(restored.gstin, '27AABCT3518Q1ZV');
    assert.equal(restored.gst_registration_type, 'Regular');

    // Invalid GSTIN rejection
    assert.throws(() => {
      store.update(company.id, {
        revision: company.revision,
        gstin: 'INVALID_GSTIN_123'
      });
    }, /Enter a valid 15-character GSTIN/);
  } finally {
    store.close();
    rmSync(dir, {recursive: true, force: true});
  }
});
