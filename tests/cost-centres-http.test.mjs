import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, join, relative, isAbsolute, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), base = 'http://127.0.0.1:4399';

async function fixture(action) {
  const tempRoot = await realpath(tmpdir());
  const directory = await mkdtemp(join(tempRoot, 'bookr-cost-centres-http-'));
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
      env: {...process.env, PORT: '4399', BOOKR_DB: file, BOOKR_TAILSCALE_IP: ''},
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
    throw new Error(output || 'Owned Cost Centres HTTP server failed to start.');
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

test('HTTP GET /api/cost-categories returns Primary Cost Category', async () => fixture(async ({json}) => {
  const categories = await json('/api/cost-categories');
  assert.equal(categories.length, 1);
  assert.equal(categories[0].name, 'Primary Cost Category');
  assert.equal(categories[0].is_builtin, 1);
}));

test('HTTP cost category and cost centre lifecycle', async () => fixture(async ({json}) => {
  // Create category
  const cat = await json('/api/cost-categories', {
    method: 'POST',
    data: {name: 'Regions', alias: 'REG'},
    status: 201
  });
  assert.equal(cat.name, 'Regions');

  // Create centre under Regions
  const south = await json('/api/cost-centres', {
    method: 'POST',
    data: {category_id: cat.id, name: 'South Region', alias: 'SR'},
    status: 201
  });
  assert.equal(south.name, 'South Region');
  assert.equal(south.category_id, cat.id);

  // List centres filtered by category
  const list = await json('/api/cost-centres?category_id=' + cat.id);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, south.id);

  // Alter centre
  const altered = await json('/api/cost-centres/' + south.id, {
    method: 'PUT',
    data: {revision: south.revision, name: 'Southern Region'},
    status: 200
  });
  assert.equal(altered.name, 'Southern Region');

  // Delete centre
  await json('/api/cost-centres/' + south.id, {method: 'DELETE', status: 200});

  // Delete category
  await json('/api/cost-categories/' + cat.id, {method: 'DELETE', status: 200});

  const remaining = await json('/api/cost-categories');
  assert.equal(remaining.length, 1);
}));
