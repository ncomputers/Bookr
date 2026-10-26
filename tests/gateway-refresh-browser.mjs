// Home refresh must expose loading and preserve the next explicit navigation.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {browserFixture} from './browser-fixture.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),out=join(root,'evidence/web/gateway-refresh',new Date().toISOString().replace(/[^0-9]/g,''));await mkdir(out,{recursive:true});
const test=await browserFixture({port:4767,name:'gateway-refresh-race',seed:()=>({})}),{page,get,errors}=test,writes=[];let release,entered,held=false,during;
const gate=new Promise(done=>release=done),intercepted=new Promise(done=>entered=done);const before=await get('/api/state');
await page.context().route('**/*',async route=>{const request=route.request(),path=new URL(request.url()).pathname;if(request.method()!=='GET'){writes.push({method:request.method(),path});return route.abort('blockedbyclient');}if(path==='/api/companies/default/summary'&&!held){held=true;entered();await gate;}return route.continue();});
try{
 await page.getByRole('link',{name:'Bookr Gateway',exact:true}).click();await intercepted;
 during={screen:await page.locator('#main').getAttribute('data-screen'),busy:await page.locator('#main').getAttribute('aria-busy'),vouchersDisabled:await page.getByRole('button',{name:'Vouchers',exact:true}).isDisabled()};
 assert.equal(during.busy,'true');assert.equal(during.vouchersDisabled,true);
 const click=page.getByRole('button',{name:'Vouchers',exact:true}).click();await Promise.race([click,new Promise(done=>setTimeout(done,180))]);release();await click;
 await page.locator('#sales-form').waitFor({timeout:2500});assert.equal(await page.locator('#main').getAttribute('aria-busy'),null);assert.deepEqual(await get('/api/state'),before);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
 const result={passed:true,heldEndpoint:'/api/companies/default/summary',during,apiWrites:0,pageErrors:errors};await writeFile(join(out,'green.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({directory:out,...result}));
}catch(error){release();await page.screenshot({path:join(out,'red.png')}).catch(()=>{});const result={passed:false,error:error.message,during,screen:await page.locator('#main').getAttribute('data-screen'),busy:await page.locator('#main').getAttribute('aria-busy'),selected:await page.locator('[data-menu].selected').first().getAttribute('data-menu').catch(()=>null),apiUnchanged:JSON.stringify(await get('/api/state'))===JSON.stringify(before),apiWrites:writes.length,pageErrors:errors};await writeFile(join(out,'red.json'),JSON.stringify(result,null,2));console.error(JSON.stringify({directory:out,...result}));throw error;}
finally{release();await test.close();}
