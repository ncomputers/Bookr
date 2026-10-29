import {readFileSync, writeFileSync, renameSync, unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {BookError} from './errors.mjs';

export const STANDARD_GROUPS = Object.freeze([
  // 15 Primary Groups
  {id: 1, name: 'Branch / Divisions', parent_id: null, parent_name: null, nature: 'Liabilities', affects_gross_profit: 0, is_builtin: 1, revision: 1},
  {id: 2, name: 'Capital Account', parent_id: null, parent_name: null, nature: 'Liabilities', affects_gross_profit: 0, is_builtin: 1, revision: 1},
  {id: 3, name: 'Current Assets', parent_id: null, parent_name: null, nature: 'Assets', affects_gross_profit: 0, is_builtin: 1, revision: 1},
  {id: 4, name: 'Current Liabilities', parent_id: null, parent_name: null, nature: 'Liabilities', affects_gross_profit: 0, is_builtin: 1, revision: 1},
  {id: 5, name: 'Direct Expenses', parent_id: null, parent_name: null, nature: 'Expenses', affects_gross_profit: 1, is_builtin: 1, revision: 1},
  {id: 6, name: 'Direct Incomes', parent_id: null, parent_name: null, nature: 'Income', affects_gross_profit: 1, is_builtin: 1, revision: 1},
  {id: 7, name: 'Fixed Assets', parent_id: null, parent_name: null, nature: 'Assets', affects_gross_profit: 0, is_builtin: 1, revision: 1},
  {id: 8, name: 'Indirect Expenses', parent_id: null, parent_name: null, nature: 'Expenses', affects_gross_profit: 0, is_builtin: 1, revision: 1},
  {id: 9, name: 'Indirect Incomes', parent_id: null, parent_name: null, nature: 'Income', affects_gross_profit: 0, is_builtin: 1, revision: 1},
  {id: 10, name: 'Investments', parent_id: null, parent_name: null, nature: 'Assets', affects_gross_profit: 0, is_builtin: 1, revision: 1},
  {id: 11, name: 'Loans (Liability)', parent_id: null, parent_name: null, nature: 'Liabilities', affects_gross_profit: 0, is_builtin: 1, revision: 1},
  {id: 12, name: 'Misc. Expenses (ASSET)', parent_id: null, parent_name: null, nature: 'Assets', affects_gross_profit: 0, is_builtin: 1, revision: 1},
  {id: 13, name: 'Purchase Accounts', parent_id: null, parent_name: null, nature: 'Expenses', affects_gross_profit: 1, is_builtin: 1, revision: 1},
  {id: 14, name: 'Sales Accounts', parent_id: null, parent_name: null, nature: 'Income', affects_gross_profit: 1, is_builtin: 1, revision: 1},
  {id: 15, name: 'Suspense A/c', parent_id: null, parent_name: null, nature: 'Liabilities', affects_gross_profit: 0, is_builtin: 1, revision: 1},

  // 13 Secondary Groups
  {id: 16, name: 'Bank Accounts', parent_id: 3, parent_name: 'Current Assets', nature: 'Assets', affects_gross_profit: 0, is_builtin: 1, revision: 1},
  {id: 17, name: 'Bank OD A/c', parent_id: 11, parent_name: 'Loans (Liability)', nature: 'Liabilities', affects_gross_profit: 0, is_builtin: 1, revision: 1},
  {id: 18, name: 'Cash-in-Hand', parent_id: 3, parent_name: 'Current Assets', nature: 'Assets', affects_gross_profit: 0, is_builtin: 1, revision: 1},
  {id: 19, name: 'Deposits (Asset)', parent_id: 3, parent_name: 'Current Assets', nature: 'Assets', affects_gross_profit: 0, is_builtin: 1, revision: 1},
  {id: 20, name: 'Duties & Taxes', parent_id: 4, parent_name: 'Current Liabilities', nature: 'Liabilities', affects_gross_profit: 0, is_builtin: 1, revision: 1},
  {id: 21, name: 'Loans & Advances (Asset)', parent_id: 3, parent_name: 'Current Assets', nature: 'Assets', affects_gross_profit: 0, is_builtin: 1, revision: 1},
  {id: 22, name: 'Provisions', parent_id: 4, parent_name: 'Current Liabilities', nature: 'Liabilities', affects_gross_profit: 0, is_builtin: 1, revision: 1},
  {id: 23, name: 'Reserves & Surplus', parent_id: 2, parent_name: 'Capital Account', nature: 'Liabilities', affects_gross_profit: 0, is_builtin: 1, revision: 1},
  {id: 24, name: 'Secured Loans', parent_id: 11, parent_name: 'Loans (Liability)', nature: 'Liabilities', affects_gross_profit: 0, is_builtin: 1, revision: 1},
  {id: 25, name: 'Stock-in-Hand', parent_id: 3, parent_name: 'Current Assets', nature: 'Assets', affects_gross_profit: 0, is_builtin: 1, revision: 1},
  {id: 26, name: 'Sundry Creditors', parent_id: 4, parent_name: 'Current Liabilities', nature: 'Liabilities', affects_gross_profit: 0, is_builtin: 1, revision: 1},
  {id: 27, name: 'Sundry Debtors', parent_id: 3, parent_name: 'Current Assets', nature: 'Assets', affects_gross_profit: 0, is_builtin: 1, revision: 1},
  {id: 28, name: 'Unsecured Loans', parent_id: 11, parent_name: 'Loans (Liability)', nature: 'Liabilities', affects_gross_profit: 0, is_builtin: 1, revision: 1}
].map(Object.freeze));

export const DISPLAY_LABELS = Object.freeze([
  'Bank Accounts',
  'Bank OCC A/c',
  'Bank OD A/c',
  'Branch / Divisions',
  'Capital Account',
  'Cash-in-Hand',
  'Current Assets',
  'Current Liabilities',
  'Deposits (Asset)',
  'Direct Expenses',
  'Direct Incomes',
  'Duties & Taxes',
  'Expenses (Direct)',
  'Expenses (Indirect)',
  'Fixed Assets',
  'Income (Direct)',
  'Income (Indirect)',
  'Indirect Expenses',
  'Indirect Incomes',
  'Investments',
  'Loans & Advances (Asset)',
  'Loans (Liability)',
  'Misc. Expenses (ASSET)',
  'Provisions',
  'Purchase Accounts',
  'Reserves & Surplus',
  'Retained Earnings',
  'Sales Accounts',
  'Secured Loans',
  'Stock-in-Hand',
  'Sundry Creditors',
  'Sundry Debtors',
  'Suspense A/c',
  'Unsecured Loans'
]);

export const LABEL_CANONICAL_MAP = Object.freeze({
  'Bank OCC A/c': 'Bank OD A/c',
  'Expenses (Direct)': 'Direct Expenses',
  'Expenses (Indirect)': 'Indirect Expenses',
  'Income (Direct)': 'Direct Incomes',
  'Income (Indirect)': 'Indirect Incomes',
  'Retained Earnings': 'Reserves & Surplus'
});

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

function checkCycle(catalog, targetId, candidateParentId) {
  if (!targetId || !candidateParentId) return;
  if (targetId === candidateParentId) {
    throw new BookError('A group cannot be its own parent (cyclic hierarchy).');
  }
  let current = candidateParentId;
  while (current) {
    if (current === targetId) {
      throw new BookError('Cannot assign an ancestor or child into a cyclic group relationship.');
    }
    const parent = catalog.find(g => g.id === current);
    current = parent ? parent.parent_id : null;
  }
}

export class GroupsStore {
  constructor(file) {
    this.file = file;
  }

  read() {
    if (!this.file) return {version: 1, groups: []};
    let raw;
    try {
      raw = readFileSync(this.file, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return {version: 1, groups: []};
      throw e;
    }
    try {
      const data = JSON.parse(raw);
      if (!data || data.version !== 1 || !Array.isArray(data.groups)) {
        throw new BookError('Unsupported groups catalog.');
      }
      return data;
    } catch {
      throw new BookError('The stored groups catalog is invalid. It has not been changed.');
    }
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

  list() {
    const custom = this.read().groups;
    const combined = [...STANDARD_GROUPS, ...custom];
    return combined.sort((a, b) => {
      if (a.nature !== b.nature) return a.nature.localeCompare(b.nature);
      if (a.is_builtin !== b.is_builtin) return b.is_builtin - a.is_builtin;
      return a.name.localeCompare(b.name);
    });
  }

  get(idOrName) {
    const all = this.list();
    if (typeof idOrName === 'number' || (typeof idOrName === 'string' && /^\d+$/.test(idOrName))) {
      return all.find(g => g.id === Number(idOrName)) ?? null;
    }
    const name = String(idOrName).trim();
    return all.find(g => same(g.name, name) || (g.alias && same(g.alias, name))) ?? null;
  }

  createGroup(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BookError('Enter valid group details.');
    }
    const name = String(input.name ?? '').trim();
    if (!name || name.length > 120) {
      throw new BookError('Group name must be between 1 and 120 characters.');
    }
    const alias = String(input.alias ?? '').trim();

    const data = this.read();
    const existing = [...STANDARD_GROUPS, ...data.groups].find(g => same(g.name, name));
    if (existing) {
      throw new BookError('A group with this name already exists.', 409);
    }

    const parentId = input.parent_id !== undefined && input.parent_id !== '' && input.parent_id !== null ? Number(input.parent_id) : null;
    let nature = input.nature ?? null;
    let affectsGrossProfit = input.affects_gross_profit ? 1 : 0;
    let parentName = null;

    if (parentId !== null) {
      const parent = [...STANDARD_GROUPS, ...data.groups].find(g => g.id === parentId);
      if (!parent) {
        throw new BookError('Parent group not found.');
      }
      nature = parent.nature;
      parentName = parent.name;
      if (input.affects_gross_profit === undefined) {
        affectsGrossProfit = parent.affects_gross_profit;
      }
    } else {
      if (!nature || !['Assets', 'Liabilities', 'Expenses', 'Income'].includes(nature)) {
        throw new BookError('Primary groups must specify a valid nature: Assets, Liabilities, Expenses, or Income.');
      }
    }

    const nextId = Math.max(100, ...STANDARD_GROUPS.map(g => g.id), ...data.groups.map(g => g.id)) + 1;
    const newGroup = {
      id: nextId,
      name,
      alias,
      parent_id: parentId,
      parent_name: parentName,
      nature,
      affects_gross_profit: affectsGrossProfit,
      is_subledger: input.is_subledger ? 1 : 0,
      net_reporting: input.net_reporting ? 1 : 0,
      is_builtin: 0,
      revision: 1
    };

    data.groups.push(newGroup);
    this.save(data);
    return newGroup;
  }

  updateGroup(id, input) {
    const numericId = Number(id);
    const builtin = STANDARD_GROUPS.find(g => g.id === numericId);
    if (builtin) {
      throw new BookError('Built-in groups cannot be modified.', 400);
    }

    const data = this.read();
    const index = data.groups.findIndex(g => g.id === numericId);
    if (index === -1) {
      throw new BookError('Group not found.', 404);
    }

    const current = data.groups[index];
    const revision = input.revision !== undefined ? Number(input.revision) : current.revision;
    if (current.revision !== revision) {
      throw new BookError('Conflict: group revision is stale. Refresh and retry.', 409);
    }

    const name = String(input.name ?? current.name).trim();
    if (!name || name.length > 120) {
      throw new BookError('Group name must be between 1 and 120 characters.');
    }
    const duplicate = [...STANDARD_GROUPS, ...data.groups].find(g => g.id !== numericId && same(g.name, name));
    if (duplicate) {
      throw new BookError('A group with this name already exists.', 409);
    }

    const parentId = input.parent_id !== undefined ? (input.parent_id === '' || input.parent_id === null ? null : Number(input.parent_id)) : current.parent_id;
    if (parentId !== null) {
      const parent = [...STANDARD_GROUPS, ...data.groups].find(g => g.id === parentId);
      if (!parent) {
        throw new BookError('Parent group not found.');
      }
      checkCycle([...STANDARD_GROUPS, ...data.groups], numericId, parentId);
    }

    const updated = {
      ...current,
      name,
      alias: String(input.alias ?? current.alias).trim(),
      parent_id: parentId,
      parent_name: parentId ? [...STANDARD_GROUPS, ...data.groups].find(g => g.id === parentId)?.name : null,
      nature: parentId ? [...STANDARD_GROUPS, ...data.groups].find(g => g.id === parentId).nature : (input.nature ?? current.nature),
      affects_gross_profit: input.affects_gross_profit !== undefined ? (input.affects_gross_profit ? 1 : 0) : current.affects_gross_profit,
      is_subledger: input.is_subledger !== undefined ? (input.is_subledger ? 1 : 0) : current.is_subledger,
      net_reporting: input.net_reporting !== undefined ? (input.net_reporting ? 1 : 0) : current.net_reporting,
      revision: current.revision + 1
    };

    data.groups[index] = updated;
    this.save(data);
    return updated;
  }

  deleteGroup(id) {
    const numericId = Number(id);
    const builtin = STANDARD_GROUPS.find(g => g.id === numericId);
    if (builtin) {
      throw new BookError('Built-in groups cannot be deleted.', 400);
    }

    const data = this.read();
    const index = data.groups.findIndex(g => g.id === numericId);
    if (index === -1) {
      throw new BookError('Group not found.', 404);
    }

    const hasChildren = data.groups.some(g => g.parent_id === numericId);
    if (hasChildren) {
      throw new BookError('Cannot delete group containing child groups.', 400);
    }

    const deleted = data.groups.splice(index, 1)[0];
    this.save(data);
    return {deleted: true, id: numericId, name: deleted.name};
  }
}
