import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, realpath} from 'node:fs/promises';
import {join, resolve, dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), base = 'http://127.0.0.1:4397';

async function httpFixture(action) {
  const tempRoot = await realpath(tmpdir());
  const directory = await mkdtemp(join(tempRoot, 'bookr-deletion-http-'));
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
      env: {...process.env, PORT: '4397', BOOKR_DB: file, BOOKR_TAILSCALE_IP: ''},
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
    throw new Error(output || 'Deletion HTTP server failed to start.');
  };

  const json = async (path, {company, method = 'GET', data, status = 200} = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(company ? {'X-Bookr-Company': company} : {}),
        ...(data !== undefined ? {'Content-Type': 'application/json'} : {})
      },
      body: data !== undefined ? JSON.stringify(data) : undefined
    });
    const body = await res.json();
    assert.equal(res.status, status, path + ': ' + JSON.stringify(body));
    return body;
  };

  try {
    await start();
    await action({json});
  } finally {
    await stop();
    try { await rm(directory, {recursive: true, force: true}); } catch {}
  }
}

test('HTTP API routes DELETE /api/companies/:id and DELETE /api/ledgers/:id', async () => {
  await httpFixture(async ({json}) => {
    // Create new company
    const comp = await json('/api/companies', {
      method: 'POST',
      data: {name: 'Disposable Company Corp'},
      status: 201
    });

    // Create a ledger in this company
    const ledger = await json('/api/ledgers', {
      company: comp.id,
      method: 'POST',
      data: {kind: 'customer', name: 'Temporary Customer'},
      status: 201
    });

    // Delete the ledger
    const delLedger = await json('/api/ledgers/' + ledger.id, {
      company: comp.id,
      method: 'DELETE',
      status: 200
    });
    assert.equal(delLedger.deleted, true);
    assert.equal(delLedger.id, ledger.id);

    // Verify ledger is gone
    const state = await json('/api/state', {company: comp.id});
    assert.ok(!state.ledgers.some(l => l.id === ledger.id));

    // Cannot delete Cash
    const cash = state.ledgers.find(l => l.name === 'Cash');
    await json('/api/ledgers/' + cash.id, {company: comp.id, method: 'DELETE', status: 400});

    // Delete the company
    const delComp = await json('/api/companies/' + comp.id, {
      method: 'DELETE',
      status: 200
    });
    assert.equal(delComp.deleted, true);
    assert.equal(delComp.id, comp.id);

    // Verify company is gone from list
    const compList = await json('/api/companies');
    assert.ok(!compList.companies.some(c => c.id === comp.id));

    // 404 for deleted company
    await json('/api/companies/' + comp.id, {status: 404});
  });
});
