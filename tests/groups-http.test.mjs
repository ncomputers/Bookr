import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, join, relative, isAbsolute, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), base = 'http://127.0.0.1:4398';

async function fixture(action) {
  const tempRoot = await realpath(tmpdir());
  const directory = await mkdtemp(join(tempRoot, 'bookr-groups-http-'));
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
      env: {...process.env, PORT: '4398', BOOKR_DB: file, BOOKR_TAILSCALE_IP: ''},
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
    throw new Error(output || 'Owned Groups HTTP server failed to start.');
  };

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

  try {
    await start();
    await action({json});
  } finally {
    await stop();
    const target = await realpath(directory);
    const part = relative(tempRoot, target);
    assert.ok(part && !part.startsWith('..') && !isAbsolute(part));
    await rm(target, {recursive: true, force: true});
  }
}

test('HTTP GET /api/groups returns 28 standard groups', async () => fixture(async ({json}) => {
  const groups = await json('/api/groups');
  assert.equal(groups.length, 28);
  assert.ok(groups.some(g => g.name === 'Sundry Debtors'));
  assert.ok(groups.some(g => g.name === 'Current Assets'));
}));

test('HTTP POST and PUT /api/groups creates and alters user groups', async () => fixture(async ({json}) => {
  const debtors = (await json('/api/groups')).find(g => g.name === 'Sundry Debtors');
  const created = await json('/api/groups', {
    method: 'POST',
    data: {name: 'Northern Debtors', alias: 'ND', parent_id: debtors.id},
    status: 201
  });
  assert.equal(created.name, 'Northern Debtors');
  assert.equal(created.nature, 'Assets');

  const altered = await json('/api/groups/' + created.id, {
    method: 'PUT',
    data: {revision: created.revision, name: 'North India Debtors', alias: 'NID'},
    status: 200
  });
  assert.equal(altered.name, 'North India Debtors');
  assert.equal(altered.revision, 2);

  // Deletion of user group
  await json('/api/groups/' + created.id, {method: 'DELETE', status: 200});
  const afterDelete = await json('/api/groups');
  assert.equal(afterDelete.length, 28);
}));
