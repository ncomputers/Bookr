import {BookError} from './errors.mjs';

const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

function checkCycle(rows, targetId, candidateParentId, label = 'entity') {
  if (!targetId || !candidateParentId) return;
  if (Number(targetId) === Number(candidateParentId)) {
    throw new BookError(`A ${label} cannot be its own parent (cyclic hierarchy).`);
  }
  let current = candidateParentId;
  while (current) {
    if (Number(current) === Number(targetId)) {
      throw new BookError(`Cannot assign an ancestor or child into a cyclic ${label} hierarchy.`);
    }
    const parent = rows.find(r => Number(r.id) === Number(current));
    current = parent ? parent.parent_id : null;
  }
}

export class Inventory {
  constructor(db) {
    this.db = db;
  }

  // --- Units of Measure ---

  listUnits() {
    return this.db.prepare('SELECT * FROM units ORDER BY symbol COLLATE NOCASE ASC').all();
  }

  getUnit(id) {
    return this.db.prepare('SELECT * FROM units WHERE id = ?').get(id) || null;
  }

  getUnitBySymbol(symbol) {
    return this.db.prepare('SELECT * FROM units WHERE symbol = ? COLLATE NOCASE').get(symbol) || null;
  }

  createUnit({symbol, formal_name = '', decimal_places = 0, uqc = ''}) {
    if (!symbol || typeof symbol !== 'string' || !symbol.trim()) {
      throw new BookError('Unit symbol is required.');
    }
    const sym = symbol.trim();
    if (this.getUnitBySymbol(sym)) {
      throw new BookError(`Unit with symbol '${sym}' already exists.`);
    }
    const dec = Number.isInteger(Number(decimal_places)) ? Number(decimal_places) : 0;
    if (dec < 0 || dec > 4) {
      throw new BookError('Decimal places must be between 0 and 4.');
    }
    const info = this.db.prepare(`
      INSERT INTO units (symbol, formal_name, decimal_places, uqc)
      VALUES (?, ?, ?, ?)
    `).run(sym, String(formal_name || '').trim(), dec, String(uqc || '').trim().toUpperCase());
    return this.getUnit(info.lastInsertRowid);
  }

  updateUnit(id, {symbol, formal_name, decimal_places, uqc}) {
    const existing = this.getUnit(id);
    if (!existing) throw new BookError(`Unit #${id} not found.`, 404);
    const sym = symbol !== undefined ? (typeof symbol === 'string' ? symbol.trim() : '') : existing.symbol;
    if (!sym) throw new BookError('Unit symbol is required.');
    const duplicate = this.getUnitBySymbol(sym);
    if (duplicate && duplicate.id !== Number(id)) {
      throw new BookError(`Unit with symbol '${sym}' already exists.`);
    }
    const dec = decimal_places !== undefined ? (Number.isInteger(Number(decimal_places)) ? Number(decimal_places) : 0) : existing.decimal_places;
    if (dec < 0 || dec > 4) {
      throw new BookError('Decimal places must be between 0 and 4.');
    }
    const fname = formal_name !== undefined ? String(formal_name || '').trim() : existing.formal_name;
    const uqcCode = uqc !== undefined ? String(uqc || '').trim().toUpperCase() : existing.uqc;
    this.db.prepare(`
      UPDATE units
      SET symbol = ?, formal_name = ?, decimal_places = ?, uqc = ?
      WHERE id = ?
    `).run(sym, fname, dec, uqcCode, id);
    return this.getUnit(id);
  }

  deleteUnit(id) {
    const existing = this.getUnit(id);
    if (!existing) throw new BookError(`Unit #${id} not found.`, 404);
    const count = this.db.prepare('SELECT COUNT(*) AS c FROM stock_items WHERE unit_id = ?').get(id).c;
    if (count > 0) {
      throw new BookError(`Cannot delete unit '${existing.symbol}' as it is used by ${count} stock item(s).`);
    }
    this.db.prepare('DELETE FROM units WHERE id = ?').run(id);
    return {deleted: true, id: Number(id)};
  }

  // --- Godowns / Locations ---

  listGodowns() {
    return this.db.prepare(`
      SELECT g.*, p.name AS parent_name
      FROM godowns g
      LEFT JOIN godowns p ON g.parent_id = p.id
      ORDER BY g.is_default DESC, g.name COLLATE NOCASE ASC
    `).all();
  }

  getGodown(id) {
    return this.db.prepare('SELECT * FROM godowns WHERE id = ?').get(id) || null;
  }

  getGodownByName(name) {
    return this.db.prepare('SELECT * FROM godowns WHERE name = ? COLLATE NOCASE').get(name) || null;
  }

  getDefaultGodown() {
    return this.db.prepare('SELECT * FROM godowns WHERE is_default = 1 LIMIT 1').get() || this.db.prepare('SELECT * FROM godowns ORDER BY id ASC LIMIT 1').get();
  }

  createGodown({name, parent_id = null, address = '', is_default = 0}) {
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new BookError('Godown name is required.');
    }
    const gName = name.trim();
    if (this.getGodownByName(gName)) {
      throw new BookError(`Godown '${gName}' already exists.`);
    }
    const pid = parent_id ? Number(parent_id) : null;
    if (pid && !this.getGodown(pid)) {
      throw new BookError(`Parent godown #${pid} does not exist.`);
    }
    const info = this.db.prepare(`
      INSERT INTO godowns (name, parent_id, address, is_default)
      VALUES (?, ?, ?, ?)
    `).run(gName, pid, String(address || '').trim(), is_default ? 1 : 0);
    return this.getGodown(info.lastInsertRowid);
  }

  updateGodown(id, {name, parent_id, address}) {
    const existing = this.getGodown(id);
    if (!existing) throw new BookError(`Godown #${id} not found.`, 404);
    const gName = name !== undefined ? (typeof name === 'string' ? name.trim() : '') : existing.name;
    if (!gName) throw new BookError('Godown name is required.');
    const duplicate = this.getGodownByName(gName);
    if (duplicate && duplicate.id !== Number(id)) {
      throw new BookError(`Godown '${gName}' already exists.`);
    }
    const pid = parent_id !== undefined ? (parent_id ? Number(parent_id) : null) : existing.parent_id;
    if (pid) {
      if (!this.getGodown(pid)) throw new BookError(`Parent godown #${pid} does not exist.`);
      const all = this.listGodowns();
      checkCycle(all, id, pid, 'godown');
    }
    const addr = address !== undefined ? String(address || '').trim() : existing.address;
    this.db.prepare(`
      UPDATE godowns
      SET name = ?, parent_id = ?, address = ?
      WHERE id = ?
    `).run(gName, pid, addr, id);
    return this.getGodown(id);
  }

  deleteGodown(id) {
    const existing = this.getGodown(id);
    if (!existing) throw new BookError(`Godown #${id} not found.`, 404);
    if (existing.is_default) {
      throw new BookError('Cannot delete the default godown.');
    }
    const childCount = this.db.prepare('SELECT COUNT(*) AS c FROM godowns WHERE parent_id = ?').get(id).c;
    if (childCount > 0) {
      throw new BookError(`Cannot delete godown '${existing.name}' as it has ${childCount} child godown(s).`);
    }
    const movementCount = this.db.prepare('SELECT COUNT(*) AS c FROM stock_movements WHERE godown_id = ?').get(id).c;
    if (movementCount > 0) {
      throw new BookError(`Cannot delete godown '${existing.name}' as it contains stock movement history.`);
    }
    this.db.prepare('DELETE FROM godowns WHERE id = ?').run(id);
    return {deleted: true, id: Number(id)};
  }

  // --- Stock Groups ---

  listStockGroups() {
    return this.db.prepare(`
      SELECT sg.*, p.name AS parent_name
      FROM stock_groups sg
      LEFT JOIN stock_groups p ON sg.parent_id = p.id
      ORDER BY sg.name COLLATE NOCASE ASC
    `).all();
  }

  getStockGroup(id) {
    return this.db.prepare('SELECT * FROM stock_groups WHERE id = ?').get(id) || null;
  }

  getStockGroupByName(name) {
    return this.db.prepare('SELECT * FROM stock_groups WHERE name = ? COLLATE NOCASE').get(name) || null;
  }

  createStockGroup({name, parent_id = null, is_addable = 1}) {
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new BookError('Stock group name is required.');
    }
    const gName = name.trim();
    if (this.getStockGroupByName(gName)) {
      throw new BookError(`Stock group '${gName}' already exists.`);
    }
    const pid = parent_id ? Number(parent_id) : null;
    if (pid && !this.getStockGroup(pid)) {
      throw new BookError(`Parent stock group #${pid} does not exist.`);
    }
    const info = this.db.prepare(`
      INSERT INTO stock_groups (name, parent_id, is_addable)
      VALUES (?, ?, ?)
    `).run(gName, pid, is_addable ? 1 : 0);
    return this.getStockGroup(info.lastInsertRowid);
  }

  updateStockGroup(id, {name, parent_id, is_addable}) {
    const existing = this.getStockGroup(id);
    if (!existing) throw new BookError(`Stock group #${id} not found.`, 404);
    const gName = name !== undefined ? (typeof name === 'string' ? name.trim() : '') : existing.name;
    if (!gName) throw new BookError('Stock group name is required.');
    const duplicate = this.getStockGroupByName(gName);
    if (duplicate && duplicate.id !== Number(id)) {
      throw new BookError(`Stock group '${gName}' already exists.`);
    }
    const pid = parent_id !== undefined ? (parent_id ? Number(parent_id) : null) : existing.parent_id;
    if (pid) {
      if (!this.getStockGroup(pid)) throw new BookError(`Parent stock group #${pid} does not exist.`);
      const all = this.listStockGroups();
      checkCycle(all, id, pid, 'stock group');
    }
    const addable = is_addable !== undefined ? (is_addable ? 1 : 0) : existing.is_addable;
    this.db.prepare(`
      UPDATE stock_groups
      SET name = ?, parent_id = ?, is_addable = ?
      WHERE id = ?
    `).run(gName, pid, addable, id);
    return this.getStockGroup(id);
  }

  deleteStockGroup(id) {
    const existing = this.getStockGroup(id);
    if (!existing) throw new BookError(`Stock group #${id} not found.`, 404);
    if (existing.name.toLowerCase() === 'primary') {
      throw new BookError('Cannot delete the Primary stock group.');
    }
    const childCount = this.db.prepare('SELECT COUNT(*) AS c FROM stock_groups WHERE parent_id = ?').get(id).c;
    if (childCount > 0) {
      throw new BookError(`Cannot delete stock group '${existing.name}' as it has ${childCount} sub-group(s).`);
    }
    const itemCount = this.db.prepare('SELECT COUNT(*) AS c FROM stock_items WHERE stock_group_id = ?').get(id).c;
    if (itemCount > 0) {
      throw new BookError(`Cannot delete stock group '${existing.name}' as it is used by ${itemCount} stock item(s).`);
    }
    this.db.prepare('DELETE FROM stock_groups WHERE id = ?').run(id);
    return {deleted: true, id: Number(id)};
  }

  // --- Stock Items ---

  listStockItems() {
    return this.db.prepare(`
      SELECT si.*, u.symbol AS unit_symbol, u.decimal_places, sg.name AS group_name, g.name AS godown_name
      FROM stock_items si
      JOIN units u ON si.unit_id = u.id
      LEFT JOIN stock_groups sg ON si.stock_group_id = sg.id
      LEFT JOIN godowns g ON si.godown_id = g.id
      ORDER BY si.name COLLATE NOCASE ASC
    `).all();
  }

  getStockItem(id) {
    return this.db.prepare(`
      SELECT si.*, u.symbol AS unit_symbol, u.decimal_places, sg.name AS group_name, g.name AS godown_name
      FROM stock_items si
      JOIN units u ON si.unit_id = u.id
      LEFT JOIN stock_groups sg ON si.stock_group_id = sg.id
      LEFT JOIN godowns g ON si.godown_id = g.id
      WHERE si.id = ?
    `).get(id) || null;
  }

  getStockItemByName(name) {
    return this.db.prepare('SELECT * FROM stock_items WHERE name = ? COLLATE NOCASE').get(name) || null;
  }

  createStockItem({
    name,
    part_number = '',
    stock_group_id = null,
    unit_id,
    hsn_sac = '',
    gst_rate = 0,
    taxability = 'Taxable',
    opening_qty = 0,
    opening_rate = 0,
    godown_id = null
  }) {
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new BookError('Stock item name is required.');
    }
    const iName = name.trim();
    if (this.getStockItemByName(iName)) {
      throw new BookError(`Stock item '${iName}' already exists.`);
    }
    if (!unit_id || !this.getUnit(unit_id)) {
      throw new BookError('Valid unit of measurement is required.');
    }
    const groupId = stock_group_id ? Number(stock_group_id) : null;
    if (groupId && !this.getStockGroup(groupId)) {
      throw new BookError(`Stock group #${groupId} does not exist.`);
    }
    const oQty = Number(opening_qty) || 0;
    const oRate = Math.round(Number(opening_rate) || 0); // integer paise
    const oVal = Math.round(oQty * oRate); // integer paise

    let gid = godown_id ? Number(godown_id) : null;
    if (oQty > 0 && !gid) {
      const defG = this.getDefaultGodown();
      gid = defG ? defG.id : null;
    }
    if (gid && !this.getGodown(gid)) {
      throw new BookError(`Godown #${gid} does not exist.`);
    }

    const info = this.db.prepare(`
      INSERT INTO stock_items (
        name, part_number, stock_group_id, unit_id,
        hsn_sac, gst_rate, taxability,
        opening_qty, opening_rate, opening_value, godown_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      iName,
      String(part_number || '').trim(),
      groupId,
      Number(unit_id),
      String(hsn_sac || '').trim(),
      Number(gst_rate) || 0,
      taxability || 'Taxable',
      oQty,
      oRate,
      oVal,
      gid
    );

    const itemId = info.lastInsertRowid;
    if (oQty > 0 && gid) {
      this.db.prepare(`
        INSERT INTO stock_movements (item_id, godown_id, voucher_id, voucher_type, date, direction, quantity, rate, value)
        VALUES (?, ?, NULL, 'Opening Stock', '1900-01-01', 'inward', ?, ?, ?)
      `).run(itemId, gid, oQty, oRate, oVal);
    }

    return this.getStockItem(itemId);
  }

  updateStockItem(id, {
    name,
    part_number,
    stock_group_id,
    unit_id,
    hsn_sac,
    gst_rate,
    taxability,
    opening_qty,
    opening_rate,
    godown_id
  }) {
    const existing = this.getStockItem(id);
    if (!existing) throw new BookError(`Stock item #${id} not found.`, 404);
    const iName = name !== undefined ? (typeof name === 'string' ? name.trim() : '') : existing.name;
    if (!iName) throw new BookError('Stock item name is required.');
    const duplicate = this.getStockItemByName(iName);
    if (duplicate && duplicate.id !== Number(id)) {
      throw new BookError(`Stock item '${iName}' already exists.`);
    }
    const uid = unit_id !== undefined ? Number(unit_id) : existing.unit_id;
    if (!uid || !this.getUnit(uid)) {
      throw new BookError('Valid unit of measurement is required.');
    }
    const pnum = part_number !== undefined ? String(part_number || '').trim() : existing.part_number;
    const gid_group = stock_group_id !== undefined ? (stock_group_id ? Number(stock_group_id) : null) : existing.stock_group_id;
    if (gid_group && !this.getStockGroup(gid_group)) {
      throw new BookError(`Stock group #${gid_group} does not exist.`);
    }
    const hsn = hsn_sac !== undefined ? String(hsn_sac || '').trim() : existing.hsn_sac;
    const gstRate = gst_rate !== undefined ? (Number(gst_rate) || 0) : existing.gst_rate;
    const tax = taxability !== undefined ? taxability : existing.taxability;
    const oQty = opening_qty !== undefined ? (Number(opening_qty) || 0) : existing.opening_qty;
    const oRate = opening_rate !== undefined ? Math.round(Number(opening_rate) || 0) : existing.opening_rate;
    const oVal = Math.round(oQty * oRate);
    let gid_loc = godown_id !== undefined ? (godown_id ? Number(godown_id) : null) : existing.godown_id;
    if (oQty > 0 && !gid_loc) {
      const defG = this.getDefaultGodown();
      gid_loc = defG ? defG.id : null;
    }

    this.db.prepare(`
      UPDATE stock_items
      SET name = ?, part_number = ?, stock_group_id = ?, unit_id = ?,
          hsn_sac = ?, gst_rate = ?, taxability = ?,
          opening_qty = ?, opening_rate = ?, opening_value = ?, godown_id = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      iName,
      pnum,
      gid_group,
      uid,
      hsn,
      gstRate,
      tax,
      oQty,
      oRate,
      oVal,
      gid_loc,
      id
    );

    // Sync opening stock movement
    this.db.prepare("DELETE FROM stock_movements WHERE item_id = ? AND voucher_type IN ('Opening Stock', 'opening')").run(id);
    if (oQty > 0 && gid_loc) {
      this.db.prepare(`
        INSERT INTO stock_movements (item_id, godown_id, voucher_id, voucher_type, date, direction, quantity, rate, value)
        VALUES (?, ?, NULL, 'Opening Stock', '1900-01-01', 'inward', ?, ?, ?)
      `).run(id, gid_loc, oQty, oRate, oVal);
    }

    return this.getStockItem(id);
  }

  deleteStockItem(id) {
    const existing = this.getStockItem(id);
    if (!existing) throw new BookError(`Stock item #${id} not found.`, 404);
    const nonOpeningCount = this.db.prepare("SELECT COUNT(*) AS c FROM stock_movements WHERE item_id = ? AND voucher_type NOT IN ('opening', 'Opening Stock')").get(id).c;
    if (nonOpeningCount > 0) {
      throw new BookError(`Cannot delete stock item '${existing.name}' as it is used in recorded transactions.`);
    }
    this.db.prepare('DELETE FROM stock_movements WHERE item_id = ?').run(id);
    this.db.prepare('DELETE FROM stock_items WHERE id = ?').run(id);
    return {deleted: true, id: Number(id)};
  }

  // --- Movements & Stock Ledger ---

  recordMovement({item_id, godown_id, voucher_id, voucher_type, date, direction, quantity, rate = 0, value = 0}) {
    const q = Number(quantity);
    if (isNaN(q) || q <= 0) throw new BookError('Movement quantity must be positive.');
    const d = String(direction).toLowerCase();
    if (d !== 'inward' && d !== 'outward') throw new BookError('Movement direction must be inward or outward.');
    const r = Math.round(Number(rate) || 0);
    const v = Math.round(Number(value) || 0);

    const info = this.db.prepare(`
      INSERT INTO stock_movements (item_id, godown_id, voucher_id, voucher_type, date, direction, quantity, rate, value)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(Number(item_id), Number(godown_id), voucher_id ? Number(voucher_id) : null, voucher_type, date, d, q, r, v);
    return info.lastInsertRowid;
  }

  deleteVoucherMovements(voucherId) {
    this.db.prepare('DELETE FROM stock_movements WHERE voucher_id = ?').run(Number(voucherId));
  }

  listMovements(itemId = null) {
    if (itemId) {
      return this.db.prepare(`
        SELECT sm.*, g.name AS godown_name, si.name AS item_name
        FROM stock_movements sm
        JOIN godowns g ON sm.godown_id = g.id
        JOIN stock_items si ON sm.item_id = si.id
        WHERE sm.item_id = ?
        ORDER BY sm.date ASC, sm.id ASC
      `).all(Number(itemId));
    }
    return this.db.prepare(`
      SELECT sm.*, g.name AS godown_name, si.name AS item_name
      FROM stock_movements sm
      JOIN godowns g ON sm.godown_id = g.id
      JOIN stock_items si ON sm.item_id = si.id
      ORDER BY sm.date ASC, sm.id ASC
    `).all();
  }

  // --- Stock Summary & Valuation ---

  stockSummary(period = {}) {
    const {from, to} = period;
    const items = this.listStockItems();
    const rows = [];

    for (const item of items) {
      let openingQty = 0;
      let openingVal = 0;
      let inwardQty = 0;
      let inwardVal = 0;
      let outwardQty = 0;
      let outwardVal = 0;

      const movements = this.db.prepare(`
        SELECT * FROM stock_movements
        WHERE item_id = ?
        ORDER BY date ASC, id ASC
      `).all(item.id);

      for (const m of movements) {
        const isOpening = m.voucher_type === 'Opening Stock' || m.voucher_type === 'opening';
        const isBefore = from && m.date < from && !isOpening;

        if (isOpening || isBefore) {
          if (m.direction === 'inward') {
            openingQty += m.quantity;
            openingVal += m.value;
          } else {
            openingQty -= m.quantity;
            openingVal -= m.value;
          }
        } else {
          // Inside period
          if (to && m.date > to) continue;
          if (m.direction === 'inward') {
            inwardQty += m.quantity;
            inwardVal += m.value;
          } else {
            outwardQty += m.quantity;
            outwardVal += m.value;
          }
        }
      }

      const closingQty = openingQty + inwardQty - outwardQty;
      // Moving average costing valuation:
      // Cumulative inwards = opening + period inwards
      const totalInQty = openingQty + inwardQty;
      const totalInVal = openingVal + inwardVal;
      let avgRate = 0;
      if (totalInQty > 0 && totalInVal > 0) {
        avgRate = Math.round(totalInVal / totalInQty);
      } else if (item.opening_rate > 0) {
        avgRate = item.opening_rate;
      }
      const closingVal = closingQty > 0 ? Math.round(closingQty * avgRate) : 0;

      rows.push({
        id: item.id,
        name: item.name,
        item_name: item.name,
        part_number: item.part_number,
        group_name: item.group_name || 'Primary',
        unit_symbol: item.unit_symbol,
        decimal_places: item.decimal_places,
        opening_qty: openingQty,
        opening_val: openingVal,
        opening_value: openingVal,
        inward_qty: inwardQty,
        inward_val: inwardVal,
        inward_value: inwardVal,
        outward_qty: outwardQty,
        outward_val: outwardVal,
        outward_value: outwardVal,
        closing_qty: closingQty,
        closing_rate: avgRate,
        average_rate: avgRate,
        closing_val: closingVal,
        closing_value: closingVal
      });
    }

    const totalOpeningVal = rows.reduce((s, r) => s + r.opening_val, 0);
    const totalInwardVal = rows.reduce((s, r) => s + r.inward_val, 0);
    const totalOutwardVal = rows.reduce((s, r) => s + r.outward_val, 0);
    const totalClosingVal = rows.reduce((s, r) => s + r.closing_val, 0);
    const totalClosingQty = rows.reduce((s, r) => s + r.closing_qty, 0);

    return {
      period: {from: from || null, to: to || null},
      items: rows,
      totals: {
        opening_val: totalOpeningVal,
        opening_value: totalOpeningVal,
        inward_val: totalInwardVal,
        inward_value: totalInwardVal,
        outward_val: totalOutwardVal,
        outward_value: totalOutwardVal,
        closing_val: totalClosingVal,
        closing_value: totalClosingVal,
        closing_qty: totalClosingQty
      }
    };
  }
}
