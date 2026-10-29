import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {BookError} from '../lib/errors.mjs';
import {STANDARD_GROUPS, DISPLAY_LABELS, LABEL_CANONICAL_MAP, GroupsStore} from '../lib/groups.mjs';

test('standard catalog defines 28 canonical groups and 34 native display labels', () => {
  assert.equal(STANDARD_GROUPS.length, 28);
  assert.equal(DISPLAY_LABELS.length, 34);
  const primary = STANDARD_GROUPS.filter(g => g.parent_id === null);
  assert.equal(primary.length, 15);
  const sub = STANDARD_GROUPS.filter(g => g.parent_id !== null);
  assert.equal(sub.length, 13);
  for (const label of DISPLAY_LABELS) {
    assert.ok(typeof label === 'string' && label.length > 0);
  }
  assert.equal(Object.keys(LABEL_CANONICAL_MAP).length, 6);
});

test('fresh GroupsStore lists all 28 standard groups with immutable builtins', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookr-groups-test-'));
  const file = join(dir, 'test.groups.json');
  try {
    const store = new GroupsStore(file);
    const groups = store.list();
    assert.equal(groups.length, 28);
    assert.ok(groups.every(g => g.is_builtin === 1));

    const cash = store.get('Cash-in-Hand');
    assert.ok(cash);
    assert.equal(cash.nature, 'Assets');

    const debtors = store.get('Sundry Debtors');
    assert.ok(debtors);
    assert.equal(debtors.parent_name, 'Current Assets');
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('user group creation, parent inheritance, persistence and cycle prevention', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookr-groups-cycle-'));
  const file = join(dir, 'test.groups.json');
  try {
    const store = new GroupsStore(file);
    const debtors = store.get('Sundry Debtors');
    const custom = store.createGroup({
      name: 'North Region Debtors',
      alias: 'NRD',
      parent_id: debtors.id
    });
    assert.equal(custom.name, 'North Region Debtors');
    assert.equal(custom.nature, 'Assets');
    assert.equal(custom.parent_id, debtors.id);
    assert.equal(custom.is_builtin, 0);
    assert.equal(custom.revision, 1);

    // Nested child group
    const subChild = store.createGroup({
      name: 'Delhi Retail Debtors',
      parent_id: custom.id
    });
    assert.equal(subChild.nature, 'Assets');
    assert.equal(subChild.parent_id, custom.id);

    // Persistence on reload
    const reopened = new GroupsStore(file);
    assert.equal(reopened.list().length, 30);
    assert.ok(reopened.get('North Region Debtors'));

    // Cycle prevention: cannot set custom's parent to subChild
    assert.throws(
      () => reopened.updateGroup(custom.id, {parent_id: subChild.id}),
      e => e instanceof BookError && /cycle|ancestor/i.test(e.message)
    );

    // Primary group creation
    const primaryCustom = store.createGroup({
      name: 'Custom Primary',
      nature: 'Liabilities'
    });
    assert.equal(primaryCustom.nature, 'Liabilities');
    assert.equal(primaryCustom.parent_id, null);

    // Rejection on missing nature for primary group
    assert.throws(
      () => store.createGroup({name: 'Invalid Primary Without Nature'}),
      BookError
    );
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('built-in groups cannot be modified or deleted; child groups protect parent deletion', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookr-groups-del-'));
  const file = join(dir, 'test.groups.json');
  try {
    const store = new GroupsStore(file);
    const debtors = store.get('Sundry Debtors');
    assert.throws(
      () => store.deleteGroup(debtors.id),
      e => e instanceof BookError && /built-in/i.test(e.message)
    );
    assert.throws(
      () => store.updateGroup(debtors.id, {name: 'Renamed Debtors'}),
      e => e instanceof BookError && /built-in/i.test(e.message)
    );

    const parent = store.createGroup({name: 'Branch Alpha', nature: 'Liabilities'});
    const child = store.createGroup({name: 'Sub-Branch 1', parent_id: parent.id});

    assert.throws(
      () => store.deleteGroup(parent.id),
      e => e instanceof BookError && /child groups/i.test(e.message)
    );

    store.deleteGroup(child.id);
    store.deleteGroup(parent.id);
    assert.equal(store.list().length, 28);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
