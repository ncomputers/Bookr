import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {Book} from '../lib/accounting.mjs';
// Owned disposable database/browser/server, reusable by future workflow checks.
export async function browserFixture({port,name,seed}){
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),out=join(root,'evidence/web'),base='http://127.0.0.1:'+port;
  const prefix=join(tmpdir(),'bookr-'+name+'-'),directory=await mkdtemp(prefix),file=join(directory,'book.sqlite');
  let server,browser,page,serverOutput='',fixture;const errors=[];
  async function stop(){if(!server || server.exitCode!==null || server.signalCode!==null)return;const ended=new Promise(r=>server.once('exit',r));server.kill();await ended;}
  async function start(){server=spawn(process.execPath,[join(root,'server.mjs')],{cwd:root,windowsHide:true,env:{...process.env,PORT:String(port),BOOKR_DB:file,BOOKR_TAILSCALE_IP:''},stdio:['ignore','pipe','pipe']});server.stdout.on('data',d=>serverOutput+=d);server.stderr.on('data',d=>serverOutput+=d);for(let i=0;i<80;i++){if(server.exitCode!==null)throw new Error(serverOutput);try{if((await fetch(base+'/api/state')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error(serverOutput || 'Owned server did not start.');}
  async function close(){try{await browser?.close();}finally{await stop();assert.ok(directory.startsWith(prefix));await rm(directory,{recursive:true,force:true});}}
  try{
    try{await fetch(base+'/api/state');throw new Error('Test port already occupied: '+port);}catch(error){if(!error.message.includes('fetch failed'))throw error;}
    const book=new Book(file);try{fixture=seed(book);}finally{book.close();}await mkdir(out,{recursive:true});await start();
    browser=await chromium.launch({headless:true,executablePath:process.env.BOOKR_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});page=await browser.newPage({viewport:{width:1229,height:655}});page.setDefaultTimeout(8000);page.setDefaultNavigationTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
    const request=async(path,data,method='get')=>{const response=await page.request[method](base+path,data===undefined?{}:{data});assert.equal(response.ok(),true,await response.text());return response.json();};
    await page.goto(base,{waitUntil:'networkidle'});await page.mouse.move(0,0);
    return {page,fixture,out,base,errors,get:path=>request(path),put:(path,data)=>request(path,data,'put'),restart:async()=>{await stop();await start();},close};
  }catch(error){await close();throw error;}
}
