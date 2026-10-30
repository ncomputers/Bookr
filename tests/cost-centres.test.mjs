import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {BookError} from '../lib/errors.mjs';
import {PRIMARY_COST_CATEGORY, CostCentresStore} from '../lib/cost-centres.mjs';

test('primary cost category is initialized by default and immutable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookr-cc-init-'));
  const file = join(dir, 'test.cost-centres.json');
  try {
    const store = new CostCentresStore(file);
    const categories = store.listCategories();
    assert.equal(categories.length, 1);
    assert.deepEqual(categories[0], PRIMARY_COST_CATEGORY);

    // Cannot delete or alter primary cost category
    assert.throws(
      () => store.deleteCategory(1),
      e => e instanceof BookError && /cannot be deleted/i.test(e.message)
    );
    assert.throws(
      () => store.updateCategory(1, {name: 'Modified'}),
      e => e instanceof BookError && /cannot be renamed or modified/i.test(e.message)
    );
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('cost category CRUD, revision checking and duplicate prevention', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookr-cc-cat-'));
  const file = join(dir, 'test.cost-centres.json');
  try {
    const store = new CostCentresStore(file);
    const cat = store.createCategory({
      name: 'Branches',
      alias: 'BR',
      allocate_revenue: 1,
      allocate_non_revenue: 0
    });
    assert.equal(cat.name, 'Branches');
    assert.equal(cat.alias, 'BR');
    assert.equal(cat.allocate_revenue, 1);
    assert.equal(cat.allocate_non_revenue, 0);
    assert.equal(cat.is_builtin, 0);
    assert.equal(cat.revision, 1);

    // Duplicate rejection
    assert.throws(
      () => store.createCategory({name: 'branches'}),
      e => e instanceof BookError && /already exists/i.test(e.message)
    );

    // Stale revision rejection
    assert.throws(
      () => store.updateCategory(cat.id, {revision: 99, name: 'Branches East'}),
      e => e instanceof BookError && /stale/i.test(e.message)
    );

    // Successful update
    const updated = store.updateCategory(cat.id, {revision: 1, name: 'Branches North'});
    assert.equal(updated.name, 'Branches North');
    assert.equal(updated.revision, 2);

    // Persistence reload
    const reopened = new CostCentresStore(file);
    const loaded = reopened.getCategory('branches north');
    assert.ok(loaded);
    assert.equal(loaded.id, cat.id);

    // Deletion
    const res = reopened.deleteCategory(cat.id);
    assert.equal(res.deleted, true);
    assert.equal(reopened.listCategories().length, 1);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('cost centre CRUD, category binding, hierarchy and cycle prevention', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookr-cc-tree-'));
  const file = join(dir, 'test.cost-centres.json');
  try {
    const store = new CostCentresStore(file);
    const cat = store.createCategory({name: 'Departments'});

    // Create top-level centre
    const salesDept = store.createCentre({
      category_id: cat.id,
      name: 'Sales Dept',
      alias: 'SD'
    });
    assert.equal(salesDept.name, 'Sales Dept');
    assert.equal(salesDept.category_id, cat.id);
    assert.equal(salesDept.parent_id, null);
    assert.equal(salesDept.category_name, 'Departments');

    // Create child centre
    const domesticSales = store.createCentre({
      category_id: cat.id,
      parent_id: salesDept.id,
      name: 'Domestic Sales'
    });
    assert.equal(domesticSales.parent_id, salesDept.id);
    assert.equal(domesticSales.parent_name, 'Sales Dept');

    // Create grandchild centre
    const northDomestic = store.createCentre({
      category_id: cat.id,
      parent_id: domesticSales.id,
      name: 'North Domestic'
    });
    assert.equal(northDomestic.parent_id, domesticSales.id);

    // Self-parenting rejection
    assert.throws(
      () => store.updateCentre(salesDept.id, {parent_id: salesDept.id}),
      e => e instanceof BookError && /cannot be its own parent/i.test(e.message)
    );

    // Cyclic hierarchy rejection (setting ancestor to descendant)
    assert.throws(
      () => store.updateCentre(salesDept.id, {parent_id: northDomestic.id}),
      e => e instanceof BookError && /cyclic/i.test(e.message)
    );

    // Parent must belong to same category
    assert.throws(
      () => store.createCentre({category_id: 1, parent_id: salesDept.id, name: 'Invalid Dept'}),
      e => e instanceof BookError && /same cost category/i.test(e.message)
    );

    // Cannot delete category that contains centres
    assert.throws(
      () => store.deleteCategory(cat.id),
      e => e instanceof BookError && /active cost centres/i.test(e.message)
    );

    // Cannot delete parent centre before children
    assert.throws(
      () => store.deleteCentre(domesticSales.id),
      e => e instanceof BookError && /child centres/i.test(e.message)
    );

    // Delete grandchild first, then child
    store.deleteCentre(northDomestic.id);
    store.deleteCentre(domesticSales.id);
    store.deleteCentre(salesDept.id);

    // Now category deletion succeeds
    assert.equal(store.deleteCategory(cat.id).deleted, true);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('ledger cost centres applicability defaults and overrides', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookr-cc-app-'));
  const file = join(dir, 'test.cost-centres.json');
  try {
    const store = new CostCentresStore(file);
    // Defaults: true for revenue, false for others
    assert.equal(store.isApplicable(10, 'expense'), true);
    assert.equal(store.isApplicable(11, 'income'), true);
    assert.equal(store.isApplicable(12, 'sales'), true);
    assert.equal(store.isApplicable(13, 'purchase'), true);
    assert.equal(store.isApplicable(14, 'customer'), false);
    assert.equal(store.isApplicable(15, 'bank'), false);

    // Explicit override
    store.setApplicability(10, false);
    assert.equal(store.isApplicable(10, 'expense'), false);

    store.setApplicability(14, true);
    assert.equal(store.isApplicable(14, 'customer'), true);

    // Persistence on reload
    const reopened = new CostCentresStore(file);
    assert.equal(reopened.isApplicable(10, 'expense'), false);
    assert.equal(reopened.isApplicable(14, 'customer'), true);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
