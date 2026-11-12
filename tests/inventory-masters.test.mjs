import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CompanyStore} from '../lib/companies.mjs';
import {startOwnedTestServer, stopOwnedTestServer} from './owned-test-server.mjs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('Inventory masters default seeds and CRUD operations with hierarchy and validation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookr-inv-masters-'));
  const file = join(dir, 'book.sqlite');
  let store;
  try {
    store = new CompanyStore({defaultFile: file});
    const book = store.book('default');
    const inv = book.inventory;

    // 1. Default seeds
    const units = inv.listUnits();
    assert.ok(units.length >= 1);
    const nos = units.find(u => u.symbol.toLowerCase() === 'nos');
    assert.ok(nos);
    assert.equal(nos.formal_name, 'Numbers');
    assert.equal(nos.decimal_places, 0);

    const godowns = inv.listGodowns();
    assert.ok(godowns.length >= 1);
    const mainGodown = godowns.find(g => g.name.toLowerCase() === 'main location');
    assert.ok(mainGodown);
    assert.equal(mainGodown.is_default, 1);

    const groups = inv.listStockGroups();
    assert.ok(groups.length >= 1);
    const primary = groups.find(g => g.name.toLowerCase() === 'primary');
    assert.ok(primary);

    // 2. Units CRUD
    const pcs = inv.createUnit({symbol: 'Pcs', formal_name: 'Pieces', decimal_places: 0, uqc: 'PCS-PIECES'});
    assert.equal(pcs.symbol, 'Pcs');
    assert.equal(pcs.formal_name, 'Pieces');

    const kgs = inv.createUnit({symbol: 'Kgs', formal_name: 'Kilograms', decimal_places: 3, uqc: 'KGS-KILOGRAMS'});
    assert.equal(kgs.decimal_places, 3);

    // Duplicate unit symbol rejected
    assert.throws(() => inv.createUnit({symbol: 'pcs'}), /already exists/);

    // Update unit
    const updatedPcs = inv.updateUnit(pcs.id, {formal_name: 'Pieces (Standard)', decimal_places: 0, uqc: 'PCS-PIECES'});
    assert.equal(updatedPcs.formal_name, 'Pieces (Standard)');

    // 3. Godowns CRUD & hierarchy
    const wh = inv.createGodown({name: 'Central Warehouse', address: 'Plot 42, Industrial Area'});
    assert.equal(wh.name, 'Central Warehouse');
    assert.equal(wh.is_default, 0);

    const rackA = inv.createGodown({name: 'Rack A1', parent_id: wh.id});
    assert.equal(rackA.parent_id, wh.id);

    // Duplicate godown name rejected
    assert.throws(() => inv.createGodown({name: 'central warehouse'}), /already exists/);

    // Cannot delete default godown
    assert.throws(() => inv.deleteGodown(mainGodown.id), /default/i);

    // Cycle prevention in godowns
    assert.throws(() => inv.updateGodown(wh.id, {parent_id: rackA.id}), /cyclic|cycle/i);

    // 4. Stock Groups CRUD & hierarchy
    const electronics = inv.createStockGroup({name: 'Electronics', parent_id: primary.id});
    assert.equal(electronics.name, 'Electronics');

    const computers = inv.createStockGroup({name: 'Computers', parent_id: electronics.id});
    assert.equal(computers.parent_id, electronics.id);

    // Duplicate group name rejected
    assert.throws(() => inv.createStockGroup({name: 'electronics'}), /already exists/);

    // Cycle prevention in stock groups
    assert.throws(() => inv.updateStockGroup(electronics.id, {parent_id: computers.id}), /cyclic|cycle/i);

    // Cannot delete Primary
    assert.throws(() => inv.deleteStockGroup(primary.id), /Primary/i);

    // Cannot delete parent group with children
    assert.throws(() => inv.deleteStockGroup(electronics.id), /sub-group|child/i);

    // 5. Stock Items CRUD & Opening balance
    const laptop = inv.createStockItem({
      name: 'Dell Latitude 5420',
      part_number: 'DL-5420-01',
      stock_group_id: computers.id,
      unit_id: nos.id,
      hsn_sac: '84713010',
      gst_rate: 18,
      taxability: 'Taxable',
      opening_qty: 5,
      opening_rate: 6500000, // Rs 65,000.00
      opening_value: 32500000, // Rs 325,000.00
      godown_id: wh.id
    });
    assert.equal(laptop.name, 'Dell Latitude 5420');
    assert.equal(laptop.opening_qty, 5);
    assert.equal(laptop.opening_rate, 6500000);
    assert.equal(laptop.opening_value, 32500000);

    // Check opening stock movement created
    const movements = inv.listMovements(laptop.id);
    assert.equal(movements.length, 1);
    assert.equal(movements[0].direction, 'inward');
    assert.equal(movements[0].voucher_type, 'Opening Stock');
    assert.equal(movements[0].quantity, 5);
    assert.equal(movements[0].rate, 6500000);
    assert.equal(movements[0].value, 32500000);

    // Cannot delete unit used by item
    assert.throws(() => inv.deleteUnit(nos.id), /used/i);

    // Cannot delete godown used by item or having children
    assert.throws(() => inv.deleteGodown(wh.id), /movement|item|child/i);

    // Update stock item
    const updatedLaptop = inv.updateStockItem(laptop.id, {
      name: 'Dell Latitude 5420 v2',
      gst_rate: 18,
      taxability: 'Taxable',
      opening_qty: 5,
      opening_rate: 6500000,
      opening_value: 32500000,
      godown_id: wh.id
    });
    assert.equal(updatedLaptop.name, 'Dell Latitude 5420 v2');

    // masters overview
    const masters = book.inventoryMasters();
    assert.ok(masters.units.length >= 3);
    assert.ok(masters.godowns.length >= 3);
    assert.ok(masters.stock_groups.length >= 3);
    assert.ok(masters.stock_items.length >= 1);

  } finally {
    try { store?.close(); } catch {}
    rmSync(dir, {recursive: true, force: true});
  }
});

test('HTTP routes for inventory masters (Units, Godowns, Stock Groups, Stock Items)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookr-inv-http-'));
  const database = join(dir, 'book.sqlite');
  const port = 4387;
  const base = `http://127.0.0.1:${port}`;

  let server;
  try {
    server = await startOwnedTestServer({root, port, database});

    const json = async (path, {method = 'GET', data, status = 200} = {}) => {
      const res = await fetch(base + path, {
        method,
        headers: data !== undefined ? {'Content-Type': 'application/json'} : {},
        body: data !== undefined ? JSON.stringify(data) : undefined
      });
      const body = await res.json();
      assert.equal(res.status, status, path + ': ' + JSON.stringify(body));
      return body;
    };

    // 1. GET /api/inventory/masters
    const masters = await json('/api/inventory/masters');
    assert.ok(Array.isArray(masters.units));
    assert.ok(Array.isArray(masters.godowns));
    assert.ok(Array.isArray(masters.stock_groups));
    assert.ok(Array.isArray(masters.stock_items));

    // 2. Unit HTTP endpoints
    const newUnit = await json('/api/inventory/units', {
      method: 'POST',
      data: {symbol: 'Box', formal_name: 'Boxes', decimal_places: 0, uqc: 'BOX-BOX'},
      status: 201
    });
    assert.equal(newUnit.symbol, 'Box');

    const gotUnit = await json(`/api/inventory/units/${newUnit.id}`);
    assert.equal(gotUnit.formal_name, 'Boxes');

    const updatedUnit = await json(`/api/inventory/units/${newUnit.id}`, {
      method: 'PUT',
      data: {formal_name: 'Outer Boxes', decimal_places: 0, uqc: 'BOX-BOX'}
    });
    assert.equal(updatedUnit.formal_name, 'Outer Boxes');

    await json(`/api/inventory/units/${newUnit.id}`, {method: 'DELETE'});
    await json(`/api/inventory/units/${newUnit.id}`, {status: 404});

    // 3. Godown HTTP endpoints
    const newGodown = await json('/api/inventory/godowns', {
      method: 'POST',
      data: {name: 'North Warehouse', address: 'Sector 5'},
      status: 201
    });
    assert.equal(newGodown.name, 'North Warehouse');

    const updatedGodown = await json(`/api/inventory/godowns/${newGodown.id}`, {
      method: 'PUT',
      data: {name: 'North Warehouse Annex'}
    });
    assert.equal(updatedGodown.name, 'North Warehouse Annex');

    await json(`/api/inventory/godowns/${newGodown.id}`, {method: 'DELETE'});
    await json(`/api/inventory/godowns/${newGodown.id}`, {status: 404});

    // 4. Stock Group HTTP endpoints
    const newGroup = await json('/api/inventory/stock-groups', {
      method: 'POST',
      data: {name: 'Peripherals'},
      status: 201
    });
    assert.equal(newGroup.name, 'Peripherals');

    const updatedGroup = await json(`/api/inventory/stock-groups/${newGroup.id}`, {
      method: 'PUT',
      data: {name: 'Computer Peripherals'}
    });
    assert.equal(updatedGroup.name, 'Computer Peripherals');

    // 5. Stock Item HTTP endpoints
    const defaultNos = masters.units.find(u => u.symbol.toLowerCase() === 'nos');
    const newItem = await json('/api/inventory/stock-items', {
      method: 'POST',
      data: {
        name: 'USB Optical Mouse',
        part_number: 'MS-USB-01',
        stock_group_id: updatedGroup.id,
        unit_id: defaultNos.id,
        hsn_sac: '84716060',
        gst_rate: 18,
        taxability: 'Taxable',
        opening_qty: 20,
        opening_rate: 35000, // Rs 350.00
        opening_value: 700000 // Rs 7,000.00
      },
      status: 201
    });
    assert.equal(newItem.name, 'USB Optical Mouse');
    assert.equal(newItem.opening_qty, 20);

    const gotItem = await json(`/api/inventory/stock-items/${newItem.id}`);
    assert.equal(gotItem.name, 'USB Optical Mouse');

    const updatedItem = await json(`/api/inventory/stock-items/${newItem.id}`, {
      method: 'PUT',
      data: {
        name: 'USB Optical Mouse (Black)',
        gst_rate: 18,
        taxability: 'Taxable',
        opening_qty: 20,
        opening_rate: 35000,
        opening_value: 700000
      }
    });
    assert.equal(updatedItem.name, 'USB Optical Mouse (Black)');

    // Delete item then delete group
    await json(`/api/inventory/stock-items/${newItem.id}`, {method: 'DELETE'});
    await json(`/api/inventory/stock-items/${newItem.id}`, {status: 404});

    await json(`/api/inventory/stock-groups/${newGroup.id}`, {method: 'DELETE'});
    await json(`/api/inventory/stock-groups/${newGroup.id}`, {status: 404});
  } finally {
    if (server) await stopOwnedTestServer(server);
    rmSync(dir, {recursive: true, force: true});
  }
});
