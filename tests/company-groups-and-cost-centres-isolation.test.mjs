import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm, realpath} from 'node:fs/promises';
import {writeFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve, join, relative, isAbsolute, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CompanyStore} from '../lib/companies.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = 'http://127.0.0.1:4402';

test('CompanyStore isolates groups and cost centres per company and cleans files on delete', async () => {
  const tempRoot = await realpath(tmpdir());
  const directory = await mkdtemp(join(tempRoot, 'bookr-cc-groups-unit-'));
  const defaultFile = join(directory, 'book.sqlite');
  let store;
  try {
    store = new CompanyStore({defaultFile});
    const alpha = store.create({name: 'Alpha Corporate'});
    const beta = store.create({name: 'Beta Enterprises'});

    // 1. Verify GroupsStore isolation
    const alphaGroups = store.groups(alpha.id);
    const betaGroups = store.groups(beta.id);
    const defaultGroups = store.groups('default');

    assert.equal(alphaGroups.list().length, 28);
    assert.equal(betaGroups.list().length, 28);

    // Create a group in Alpha
    const debtors = alphaGroups.list().find(g => g.name === 'Sundry Debtors');
    const createdAlphaGroup = alphaGroups.createGroup({
      name: 'Alpha North Debtors',
      alias: 'AND',
      parent_id: debtors.id
    });
    assert.equal(alphaGroups.list().length, 29);
    assert.equal(betaGroups.list().length, 28);
    assert.equal(defaultGroups.list().length, 28);

    // Create a group in Beta
    const createdBetaGroup = betaGroups.createGroup({
      name: 'Beta South Debtors',
      alias: 'BSD',
      parent_id: debtors.id
    });
    assert.equal(betaGroups.list().length, 29);
    assert.equal(alphaGroups.list().length, 29);
    assert.ok(!alphaGroups.list().some(g => g.name === 'Beta South Debtors'));
    assert.ok(!betaGroups.list().some(g => g.name === 'Alpha North Debtors'));

    // 2. Verify CostCentresStore isolation
    const alphaCC = store.costCentres(alpha.id);
    const betaCC = store.costCentres(beta.id);

    assert.equal(alphaCC.listCategories().length, 1);
    assert.equal(betaCC.listCategories().length, 1);

    const alphaCat = alphaCC.createCategory({name: 'Alpha Projects', alias: 'AP'});
    const alphaCentre = alphaCC.createCentre({category_id: alphaCat.id, name: 'Project Manhattan'});

    assert.equal(alphaCC.listCategories().length, 2);
    assert.equal(alphaCC.listCentres(alphaCat.id).length, 1);
    assert.equal(betaCC.listCategories().length, 1);
    assert.equal(betaCC.listCentres(alphaCat.id).length, 0);

    // Check files on disk
    const alphaFile = store.fileFor(alpha.id);
    const betaFile = store.fileFor(beta.id);
    assert.ok(existsSync(alphaFile + '.groups.json'));
    assert.ok(existsSync(alphaFile + '.cost-centres.json'));
    assert.ok(existsSync(betaFile + '.groups.json'));

    // Reopen store to verify persistence
    store.close();
    store = new CompanyStore({defaultFile});
    assert.equal(store.groups(alpha.id).list().length, 29);
    assert.equal(store.groups(beta.id).list().length, 29);
    assert.equal(store.costCentres(alpha.id).listCategories().length, 2);
    assert.equal(store.costCentres(beta.id).listCategories().length, 1);

    // 3. Delete Alpha and verify companion files are removed
    store.delete(alpha.id);
    assert.ok(!existsSync(alphaFile + '.groups.json'));
    assert.ok(!existsSync(alphaFile + '.cost-centres.json'));
    assert.ok(existsSync(betaFile + '.groups.json'));
  } finally {
    store?.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test('Safe migration copies legacy shared groups and cost centres to existing companies lacking own files', async () => {
  const tempRoot = await realpath(tmpdir());
  const directory = await mkdtemp(join(tempRoot, 'bookr-migration-test-'));
  const defaultFile = join(directory, 'book.sqlite');
  let store;
  try {
    // 1. Setup a company
    store = new CompanyStore({defaultFile});
    const gamma = store.create({name: 'Gamma Legacy'});
    const gammaFile = store.fileFor(gamma.id);
    store.close();

    // 2. Simulate legacy state: write shared companion files next to defaultFile, but gamma has none
    const legacyGroups = {
      version: 1,
      groups: [{
        id: 101,
        name: 'Legacy Shared Group',
        alias: 'LSG',
        parent_id: 3,
        parent_name: 'Current Assets',
        nature: 'Assets',
        affects_gross_profit: 0,
        is_builtin: 0,
        revision: 1
      }]
    };
    const legacyCC = {
      version: 1,
      categories: [{
        id: 1,
        name: 'Primary Cost Category',
        alias: '',
        allocate_revenue: 1,
        allocate_non_revenue: 0,
        is_builtin: 1,
        revision: 1
      }, {
        id: 2,
        name: 'Legacy Category',
        alias: 'LC',
        allocate_revenue: 1,
        allocate_non_revenue: 0,
        is_builtin: 0,
        revision: 1
      }],
      centres: [],
      ledger_applicability: {}
    };
    writeFileSync(defaultFile + '.groups.json', JSON.stringify(legacyGroups));
    writeFileSync(defaultFile + '.cost-centres.json', JSON.stringify(legacyCC));

    assert.ok(!existsSync(gammaFile + '.groups.json'));
    assert.ok(!existsSync(gammaFile + '.cost-centres.json'));

    // 3. Reopen CompanyStore which runs safe migration
    store = new CompanyStore({defaultFile});

    // Verify Gamma now has its own migrated files without touching default
    assert.ok(existsSync(gammaFile + '.groups.json'));
    assert.ok(existsSync(gammaFile + '.cost-centres.json'));
    assert.ok(store.groups(gamma.id).list().some(g => g.name === 'Legacy Shared Group'));
    assert.ok(store.costCentres(gamma.id).listCategories().some(c => c.name === 'Legacy Category'));

    // 4. Any new modification to Gamma does NOT leak back to default
    store.groups(gamma.id).createGroup({
      name: 'Gamma Private Group',
      alias: 'GPG',
      parent_id: 3
    });
    assert.ok(store.groups(gamma.id).list().some(g => g.name === 'Gamma Private Group'));
    assert.ok(!store.groups('default').list().some(g => g.name === 'Gamma Private Group'));
  } finally {
    store?.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test('HTTP API scopes groups and cost centres to X-Bookr-Company header with full isolation', async () => {
  const tempRoot = await realpath(tmpdir());
  const directory = await mkdtemp(join(tempRoot, 'bookr-cc-groups-http-'));
  const file = join(directory, 'book.sqlite');
  let server, output = '';

  const stop = async () => {
    if (server && server.exitCode === null && server.signalCode === null) {
      const ended = new Promise(done => server.once('exit', done));
      server.kill();
      await ended;
    }
  };

  const start = async () => {
    server = spawn(process.execPath, [join(root, 'server.mjs')], {
      cwd: root,
      windowsHide: true,
      env: {...process.env, PORT: '4402', BOOKR_DB: file, BOOKR_TAILSCALE_IP: ''},
      stdio: ['ignore', 'pipe', 'pipe']
    });
    server.stdout.on('data', b => output += b);
    server.stderr.on('data', b => output += b);
    for (let i = 0; i < 80; i++) {
      if (server.exitCode !== null) throw new Error(output);
      try {
        if ((await fetch(base + '/api/state')).ok) return;
      } catch {}
      await new Promise(d => setTimeout(d, 100));
    }
    throw new Error(output || 'Owned HTTP server failed to start.');
  };

  const json = async (path, {method = 'GET', data, company, status = 200} = {}) => {
    const headers = {
      ...(data !== undefined ? {'Content-Type': 'application/json'} : {}),
      ...(company ? {'X-Bookr-Company': company} : {})
    };
    const res = await fetch(base + path, {
      method,
      headers,
      body: data !== undefined ? JSON.stringify(data) : undefined
    });
    const body = await res.json();
    assert.equal(res.status, status, path + ': ' + JSON.stringify(body));
    return body;
  };

  try {
    await start();

    // Create 2 companies
    const compA = await json('/api/companies', {method: 'POST', data: {name: 'HTTP Company A'}, status: 201});
    const compB = await json('/api/companies', {method: 'POST', data: {name: 'HTTP Company B'}, status: 201});

    // 1. Company A creates custom group
    const debtors = (await json('/api/groups', {company: compA.id})).find(g => g.name === 'Sundry Debtors');
    const groupA = await json('/api/groups', {
      company: compA.id,
      method: 'POST',
      data: {name: 'Company A Debtors', alias: 'CAD', parent_id: debtors.id},
      status: 201
    });
    assert.equal(groupA.name, 'Company A Debtors');

    // Company B must NOT see Company A Debtors
    const groupsB = await json('/api/groups', {company: compB.id});
    assert.equal(groupsB.length, 28);
    assert.ok(!groupsB.some(g => g.name === 'Company A Debtors'));

    // Default company must NOT see Company A Debtors
    const groupsDefault = await json('/api/groups');
    assert.equal(groupsDefault.length, 28);
    assert.ok(!groupsDefault.some(g => g.name === 'Company A Debtors'));

    // 2. Company B creates cost category & centre
    const catB = await json('/api/cost-categories', {
      company: compB.id,
      method: 'POST',
      data: {name: 'Company B Divisions', alias: 'CBD'},
      status: 201
    });
    const centreB = await json('/api/cost-centres', {
      company: compB.id,
      method: 'POST',
      data: {category_id: catB.id, name: 'B South Division', alias: 'BSD'},
      status: 201
    });

    // Company A must NOT see Company B's category or centre
    const catsA = await json('/api/cost-categories', {company: compA.id});
    assert.equal(catsA.length, 1);
    assert.equal(catsA[0].name, 'Primary Cost Category');

    const centresA = await json('/api/cost-centres', {company: compA.id});
    assert.equal(centresA.length, 0);

    // Company B lists centres
    const centresB = await json('/api/cost-centres', {company: compB.id});
    assert.equal(centresB.length, 1);
    assert.equal(centresB[0].name, 'B South Division');

    // Applicability map isolation
    await json('/api/cost-centres/applicability', {
      company: compA.id,
      method: 'POST',
      data: {ledger_id: 1, applicable: true}
    });
    const appMapA = await json('/api/cost-centres/applicability', {company: compA.id});
    assert.equal(appMapA['1'], true);

    const appMapB = await json('/api/cost-centres/applicability', {company: compB.id});
    assert.equal(appMapB['1'], undefined);

    // 3. Restart server and verify persistence per company
    await stop();
    await start();

    const groupsAAfter = await json('/api/groups', {company: compA.id});
    assert.ok(groupsAAfter.some(g => g.name === 'Company A Debtors'));

    const catsBAfter = await json('/api/cost-categories', {company: compB.id});
    assert.ok(catsBAfter.some(c => c.name === 'Company B Divisions'));
  } finally {
    await stop();
    const target = await realpath(directory);
    const part = relative(tempRoot, target);
    assert.ok(part && !part.startsWith('..') && !isAbsolute(part));
    await rm(target, {recursive: true, force: true});
  }
});
