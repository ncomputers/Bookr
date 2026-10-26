import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
import assert from 'node:assert/strict';

const owners=new WeakMap();
const pause=milliseconds=>new Promise(done=>setTimeout(done,milliseconds));
const alive=child=>child.exitCode===null&&child.signalCode===null;
async function privateDatabase(database){
  assert.equal(typeof database,'string','Provide an owned temporary database.');
  assert.ok(isAbsolute(database),'Use an absolute temporary database path.');
  const parent=await realpath(dirname(database)),temporary=await realpath(tmpdir()),part=relative(temporary,parent);
  assert.ok(part&&!part.startsWith('..')&&!isAbsolute(part),'Browser tests must use a separate directory beneath the OS temporary directory.');
  try{const actual=await realpath(database),filePart=relative(parent,actual);assert.ok(filePart&&!filePart.startsWith('..')&&!isAbsolute(filePart),'Temporary database link leaves its owned directory.');}
  catch(error){if(error.code!=='ENOENT')throw error;}
}
async function available(port){
  const probe=createServer();
  await new Promise((done,reject)=>{
    probe.once('error',reject);
    probe.listen({host:'127.0.0.1',port,exclusive:true},()=>probe.close(error=>error?reject(error):done()));
  }).catch(error=>{throw new Error('Owned test port '+port+' is unavailable; refusing to use another listener.',{cause:error});});
}

// A healthy HTTP response alone cannot prove ownership. The exact spawned
// child's successful localhost listen message is required before any request.
export async function startOwnedTestServer({root,port,database,onOutput=()=>{},script=join(root,'server.mjs'),env={},timeoutMs=8000}){
  assert.ok(Number.isInteger(port)&&port>0&&port<65536,'Choose an explicit test port.');
  assert.ok(Number.isFinite(timeoutMs)&&timeoutMs>0,'Choose a positive startup timeout.');
  await privateDatabase(database);await available(port);
  const child=spawn(process.execPath,[resolve(script)],{cwd:resolve(root),windowsHide:true,env:{...process.env,...env,PORT:String(port),BOOKR_DB:database,BOOKR_TAILSCALE_IP:''},stdio:['ignore','pipe','pipe']});
  let stdout='',output='',spawnError=null,closed=false;
  const ended=new Promise(done=>child.once('close',()=>{closed=true;done();}));
  child.once('error',error=>{spawnError=error;});
  child.stdout.on('data',bytes=>{const text=String(bytes);stdout+=text;output+=text;onOutput(text);});
  child.stderr.on('data',bytes=>{const text=String(bytes);output+=text;onOutput(text);});
  async function stop(){
    if(!closed&&alive(child)&&child.pid)child.kill();
    if(!closed){let timer;try{await Promise.race([ended,new Promise((done,reject)=>{timer=setTimeout(()=>reject(new Error('Owned test child did not stop: '+child.pid)),5000);})]);}finally{clearTimeout(timer);}}
  }
  owners.set(child,{stop});
  const marker='Bookr running at http://127.0.0.1:'+port,deadline=Date.now()+timeoutMs;
  try{
    while(Date.now()<deadline){
      if(spawnError)throw spawnError;
      if(!alive(child))throw new Error('Owned test server exited before readiness. '+output);
      const listening=stdout.split(/\r?\n/).some(line=>line===marker);
      if(listening){
        try{
          const response=await fetch('http://127.0.0.1:'+port+'/api/state',{method:'GET',signal:AbortSignal.timeout(Math.max(1,Math.min(1000,deadline-Date.now())))});
          await response.arrayBuffer();
          if(response.ok&&alive(child)&&!spawnError)return child;
        }catch(error){if(!alive(child)||spawnError)throw spawnError??new Error('Owned test server exited during readiness. '+output);}
      }
      await pause(25);
    }
    throw new Error('Owned test server did not prove localhost readiness. '+output);
  }catch(error){await stop();throw error;}
}

export async function stopOwnedTestServer(child){
  if(!child)return;
  const owner=owners.get(child);assert.ok(owner,'Refusing to stop a process not started by the owned test helper.');
  await owner.stop();
}
