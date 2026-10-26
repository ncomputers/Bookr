import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startOwnedTestServer,stopOwnedTestServer} from './owned-test-server.mjs';
import {browserFixture} from './browser-fixture.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
async function fixture(){const prefix=join(tmpdir(),'bookr-owned-server-'),directory=await mkdtemp(prefix);return {directory,database:join(directory,'book.sqlite'),close:async()=>{assert.ok(directory.startsWith(prefix));await rm(directory,{recursive:true,force:true});}};}
async function sentinel(port=0){const requests=[];const server=createServer((request,response)=>{requests.push(request.method);response.writeHead(200,{'Content-Type':'application/json'});response.end('{"foreign":true}');});await new Promise((done,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',done);});return {port:server.address().port,requests,close:()=>new Promise(done=>server.close(done))};}
async function freePort(){const owned=await sentinel();const port=owned.port;await owned.close();return port;}
async function script(f,mode){const path=join(f.directory,mode+'.mjs'),log=join(f.directory,mode+'.requests');await writeFile(path,`import {createServer} from 'node:http';import {appendFileSync} from 'node:fs';const port=Number(process.env.PORT);const server=createServer((request,response)=>{appendFileSync(${JSON.stringify(log)},request.method+'\\n');response.writeHead(200,{'Content-Type':'application/json'});response.end('{}');});${mode==='exit'?'process.exit(7);':`server.listen(port,'127.0.0.1',()=>{${mode==='silent'?'':mode==='stderr'?"console.error('Bookr running at http://127.0.0.1:'+port);":"console.log('Bookr running at http://127.0.0.1:'+(port+1));"}});`}`);return {path,requests:async()=>readFile(log,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;})};}

test('occupied healthy sentinel is rejected before HTTP requests or browser launch',async()=>{
  const f=await fixture(),foreign=await sentinel();let browserLaunches=0;
  try{await assert.rejects(async()=>{await startOwnedTestServer({root,port:foreign.port,database:f.database});browserLaunches++;},/unavailable/);assert.deepEqual(foreign.requests,[]);assert.equal(browserLaunches,0);}
  finally{await foreign.close();await f.close();}
});
test('shared browser fixture refuses an occupied sentinel before opening a browser',async()=>{
  const foreign=await sentinel();
  try{await assert.rejects(browserFixture({port:foreign.port,name:'occupied-sentinel',seed:()=>({})}),/unavailable/);assert.deepEqual(foreign.requests,[]);}
  finally{await foreign.close();}
});
test('an owned temporary Bookr server proves its listener and can restart safely',async()=>{
  const f=await fixture(),port=await freePort();let child;
  try{for(let attempt=0;attempt<2;attempt++){child=await startOwnedTestServer({root,port,database:f.database});assert.equal(child.exitCode,null);const state=await (await fetch('http://127.0.0.1:'+port+'/api/state')).json();assert.equal(state.ledgers.length,3);assert.equal(state.vouchers.length,0);await stopOwnedTestServer(child);assert.ok(child.exitCode!==null||child.signalCode!==null);}}
  finally{await stopOwnedTestServer(child);await f.close();}
});
test('a listener appearing between owned starts is rejected on restart without touching it',async()=>{
  const f=await fixture(),port=await freePort();let child,foreign;
  try{child=await startOwnedTestServer({root,port,database:f.database});await stopOwnedTestServer(child);foreign=await sentinel(port);await assert.rejects(startOwnedTestServer({root,port,database:f.database}),/unavailable/);assert.deepEqual(foreign.requests,[]);const response=await fetch('http://127.0.0.1:'+port);assert.equal(response.status,200);assert.deepEqual(foreign.requests,['GET']);}
  finally{await stopOwnedTestServer(child);await foreign?.close();await f.close();}
});
for(const mode of ['silent','stderr','wrong-port'])test('HTTP is not probed without own exact stdout listen marker: '+mode,async()=>{
  const f=await fixture(),port=await freePort();const custom=await script(f,mode);
  try{await assert.rejects(startOwnedTestServer({root,port,database:f.database,script:custom.path,timeoutMs:1000}),/did not prove/);assert.equal(await custom.requests(),'');const replacement=await sentinel(port);await replacement.close();}
  finally{await f.close();}
});
test('failed child cannot become ready from a foreign health response',async()=>{
  const f=await fixture(),port=await freePort(),custom=await script(f,'exit');
  try{await assert.rejects(startOwnedTestServer({root,port,database:f.database,script:custom.path}),/exited before readiness/);assert.equal(await custom.requests(),'');}
  finally{await f.close();}
});
test('non-temporary database paths are rejected before startup',async()=>{
  const foreign=await sentinel();try{await assert.rejects(startOwnedTestServer({root,port:foreign.port,database:join(root,'package.json')}),/temporary directory/);assert.deepEqual(foreign.requests,[]);}finally{await foreign.close();}
});
