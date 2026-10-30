import {readFileSync, writeFileSync, renameSync, unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {BookError} from './errors.mjs';

export const PRIMARY_COST_CATEGORY = Object.freeze({
  id: 1,
  name: 'Primary Cost Category',
  alias: '',
  allocate_revenue: 1,
  allocate_non_revenue: 0,
  is_builtin: 1,
  revision: 1
});

const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

function checkCycle(centres, targetId, candidateParentId) {
  if (!targetId || !candidateParentId) return;
  if (targetId === candidateParentId) {
    throw new BookError('A cost centre cannot be its own parent (cyclic hierarchy).');
  }
  let current = candidateParentId;
  while (current) {
    if (current === targetId) {
      throw new BookError('Cannot assign an ancestor or child into a cyclic cost centre hierarchy.');
    }
    const parent = centres.find(c => c.id === current);
    current = parent ? parent.parent_id : null;
  }
}

export class CostCentresStore {
  constructor(file) {
    this.file = file;
  }

  read() {
    if (!this.file) return {version: 1, categories: [PRIMARY_COST_CATEGORY], centres: [], ledger_applicability: {}};
    let raw;
    try {
      raw = readFileSync(this.file, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return {version: 1, categories: [PRIMARY_COST_CATEGORY], centres: [], ledger_applicability: {}};
      throw e;
    }
    try {
      const data = JSON.parse(raw);
      if (!data || data.version !== 1 || !Array.isArray(data.categories) || !Array.isArray(data.centres)) {
        throw new BookError('Unsupported cost centres catalog.');
      }
      if (!data.categories.some(c => c.id === 1)) {
        data.categories.unshift(PRIMARY_COST_CATEGORY);
      }
      if (!data.ledger_applicability || typeof data.ledger_applicability !== 'object') {
        data.ledger_applicability = {};
      }
      return data;
    } catch {
      throw new BookError('The stored cost centres catalog is invalid. It has not been changed.');
    }
  }

  isApplicable(ledgerId, ledgerKind = null) {
    const data = this.read();
    if (Object.hasOwn(data.ledger_applicability, String(ledgerId))) {
      return Boolean(data.ledger_applicability[String(ledgerId)]);
    }
    return ['expense', 'income', 'sales', 'purchase'].includes(ledgerKind);
  }

  setApplicability(ledgerId, applicable) {
    const data = this.read();
    data.ledger_applicability[String(ledgerId)] = Boolean(applicable);
    this.save(data);
    return {ledger_id: Number(ledgerId), applicable: Boolean(applicable)};
  }

  getApplicabilityMap() {
    return this.read().ledger_applicability;
  }

  save(data) {
    if (!this.file) return;
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    let created = false;
    try {
      writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', {flag: 'wx'});
      created = true;
      renameSync(temporary, this.file);
      created = false;
    } finally {
      if (created) {
        try { unlinkSync(temporary); } catch {}
      }
    }
  }

  // Cost Categories
  listCategories() {
    return this.read().categories.sort((a, b) => {
      if (a.is_builtin !== b.is_builtin) return b.is_builtin - a.is_builtin;
      return a.name.localeCompare(b.name);
    });
  }

  getCategory(idOrName) {
    const categories = this.listCategories();
    if (typeof idOrName === 'number' || (typeof idOrName === 'string' && /^\d+$/.test(idOrName))) {
      return categories.find(c => c.id === Number(idOrName)) ?? null;
    }
    const name = String(idOrName).trim();
    return categories.find(c => same(c.name, name) || (c.alias && same(c.alias, name))) ?? null;
  }

  createCategory(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BookError('Enter valid cost category details.');
    }
    const name = String(input.name ?? '').trim();
    if (!name || name.length > 120) {
      throw new BookError('Cost category name must be between 1 and 120 characters.');
    }
    const alias = String(input.alias ?? '').trim();

    const data = this.read();
    if (data.categories.some(c => same(c.name, name))) {
      throw new BookError('A cost category with this name already exists.', 409);
    }

    const nextId = Math.max(10, ...data.categories.map(c => c.id)) + 1;
    const newCategory = {
      id: nextId,
      name,
      alias,
      allocate_revenue: input.allocate_revenue !== undefined ? (input.allocate_revenue ? 1 : 0) : 1,
      allocate_non_revenue: input.allocate_non_revenue ? 1 : 0,
      is_builtin: 0,
      revision: 1
    };

    data.categories.push(newCategory);
    this.save(data);
    return newCategory;
  }

  updateCategory(id, input) {
    const numericId = Number(id);
    if (numericId === 1) {
      throw new BookError('Primary Cost Category cannot be renamed or modified.', 400);
    }
    const data = this.read();
    const index = data.categories.findIndex(c => c.id === numericId);
    if (index === -1) {
      throw new BookError('Cost category not found.', 404);
    }

    const current = data.categories[index];
    const revision = input.revision !== undefined ? Number(input.revision) : current.revision;
    if (current.revision !== revision) {
      throw new BookError('Conflict: cost category revision is stale. Refresh and retry.', 409);
    }

    const name = String(input.name ?? current.name).trim();
    if (!name || name.length > 120) {
      throw new BookError('Cost category name must be between 1 and 120 characters.');
    }
    if (data.categories.some(c => c.id !== numericId && same(c.name, name))) {
      throw new BookError('A cost category with this name already exists.', 409);
    }

    const updated = {
      ...current,
      name,
      alias: String(input.alias ?? current.alias).trim(),
      allocate_revenue: input.allocate_revenue !== undefined ? (input.allocate_revenue ? 1 : 0) : current.allocate_revenue,
      allocate_non_revenue: input.allocate_non_revenue !== undefined ? (input.allocate_non_revenue ? 1 : 0) : current.allocate_non_revenue,
      revision: current.revision + 1
    };

    data.categories[index] = updated;
    this.save(data);
    return updated;
  }

  deleteCategory(id) {
    const numericId = Number(id);
    if (numericId === 1) {
      throw new BookError('Primary Cost Category cannot be deleted.', 400);
    }
    const data = this.read();
    const index = data.categories.findIndex(c => c.id === numericId);
    if (index === -1) {
      throw new BookError('Cost category not found.', 404);
    }
    const hasCentres = data.centres.some(c => c.category_id === numericId);
    if (hasCentres) {
      throw new BookError('Cannot delete cost category containing active cost centres.', 400);
    }

    const deleted = data.categories.splice(index, 1)[0];
    this.save(data);
    return {deleted: true, id: numericId, name: deleted.name};
  }

  // Cost Centres
  listCentres(categoryId = null) {
    const data = this.read();
    let centres = data.centres;
    if (categoryId !== null) {
      const numCat = Number(categoryId);
      centres = centres.filter(c => c.category_id === numCat);
    }
    return centres.map(c => {
      const category = data.categories.find(cat => cat.id === c.category_id);
      const parent = c.parent_id ? data.centres.find(p => p.id === c.parent_id) : null;
      return {
        ...c,
        category_name: category ? category.name : 'Unknown',
        parent_name: parent ? parent.name : null
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  getCentre(idOrName) {
    const all = this.listCentres();
    if (typeof idOrName === 'number' || (typeof idOrName === 'string' && /^\d+$/.test(idOrName))) {
      return all.find(c => c.id === Number(idOrName)) ?? null;
    }
    const name = String(idOrName).trim();
    return all.find(c => same(c.name, name) || (c.alias && same(c.alias, name))) ?? null;
  }

  createCentre(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BookError('Enter valid cost centre details.');
    }
    const name = String(input.name ?? '').trim();
    if (!name || name.length > 120) {
      throw new BookError('Cost centre name must be between 1 and 120 characters.');
    }
    const alias = String(input.alias ?? '').trim();

    const data = this.read();
    const categoryId = input.category_id !== undefined ? Number(input.category_id) : 1;
    const category = data.categories.find(c => c.id === categoryId);
    if (!category) {
      throw new BookError('Cost category not found.');
    }

    if (data.centres.some(c => c.category_id === categoryId && same(c.name, name))) {
      throw new BookError('A cost centre with this name already exists in this category.', 409);
    }

    const parentId = input.parent_id !== undefined && input.parent_id !== '' && input.parent_id !== null ? Number(input.parent_id) : null;
    if (parentId !== null) {
      const parent = data.centres.find(c => c.id === parentId);
      if (!parent) {
        throw new BookError('Parent cost centre not found.');
      }
      if (parent.category_id !== categoryId) {
        throw new BookError('Parent cost centre must belong to the same cost category.');
      }
    }

    const nextId = Math.max(100, ...data.centres.map(c => c.id)) + 1;
    const newCentre = {
      id: nextId,
      category_id: categoryId,
      parent_id: parentId,
      name,
      alias,
      revision: 1
    };

    data.centres.push(newCentre);
    this.save(data);
    return this.getCentre(nextId);
  }

  updateCentre(id, input) {
    const numericId = Number(id);
    const data = this.read();
    const index = data.centres.findIndex(c => c.id === numericId);
    if (index === -1) {
      throw new BookError('Cost centre not found.', 404);
    }

    const current = data.centres[index];
    const revision = input.revision !== undefined ? Number(input.revision) : current.revision;
    if (current.revision !== revision) {
      throw new BookError('Conflict: cost centre revision is stale. Refresh and retry.', 409);
    }

    const name = String(input.name ?? current.name).trim();
    if (!name || name.length > 120) {
      throw new BookError('Cost centre name must be between 1 and 120 characters.');
    }

    const categoryId = input.category_id !== undefined ? Number(input.category_id) : current.category_id;
    const category = data.categories.find(c => c.id === categoryId);
    if (!category) {
      throw new BookError('Cost category not found.');
    }

    if (data.centres.some(c => c.id !== numericId && c.category_id === categoryId && same(c.name, name))) {
      throw new BookError('A cost centre with this name already exists in this category.', 409);
    }

    const parentId = input.parent_id !== undefined ? (input.parent_id === '' || input.parent_id === null ? null : Number(input.parent_id)) : current.parent_id;
    if (parentId !== null) {
      const parent = data.centres.find(c => c.id === parentId);
      if (!parent) {
        throw new BookError('Parent cost centre not found.');
      }
      checkCycle(data.centres, numericId, parentId);
    }

    const updated = {
      ...current,
      category_id: categoryId,
      parent_id: parentId,
      name,
      alias: String(input.alias ?? current.alias).trim(),
      revision: current.revision + 1
    };

    data.centres[index] = updated;
    this.save(data);
    return this.getCentre(numericId);
  }

  deleteCentre(id) {
    const numericId = Number(id);
    const data = this.read();
    const index = data.centres.findIndex(c => c.id === numericId);
    if (index === -1) {
      throw new BookError('Cost centre not found.', 404);
    }

    const hasChildren = data.centres.some(c => c.parent_id === numericId);
    if (hasChildren) {
      throw new BookError('Cannot delete cost centre containing child centres.', 400);
    }

    const deleted = data.centres.splice(index, 1)[0];
    this.save(data);
    return {deleted: true, id: numericId, name: deleted.name};
  }
}
