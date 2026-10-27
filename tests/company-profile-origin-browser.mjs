import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {browserFixture} from './browser-fixture.mjs';
import {seedProfileOrigin,snapshotProfileOrigin,injectProfileOrigin} from './company-profile-origin-fixture.mjs';
import {captureVerifiedScreen} from './screen-evidence.mjs';

const root=join(dirname(fileURLToPath(import.meta.url)),'..'),out=join(root,'evidence/web/company-profile-origin',new Date().toISOString().replace(/\D/g,'')),results=[];
await mkdir(out,{recursive:true});
for(const key of ['id','revision']){
 const test=await browserFixture({port:4773,name:'profile-origin-browser-'+key,seed:seedProfileOrigin}),{page,base,fixture:f,errors}=test,requests=[],responses=[],blocked=[],captures=[];let step='Open valid target form',injection=null,before=null,originalSession=null;
 const draftMailing='Fictional unsaved mailing '+key,draftAddress='Fictional unsaved address '+key;
 page.on('request',request=>{const url=new URL(request.url());if(url.pathname.startsWith('/api/'))requests.push({method:request.method(),path:url.pathname,company:request.headers()['x-bookr-company']??null,data:request.postDataJSON()});});
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(request.method()!=='GET'&&!(request.method()==='PUT'&&path==='/api/companies/'+f.target.id)){blocked.push({method:request.method(),path});return route.abort('blockedbyclient');}
  return route.continue();
 });
 async function read(path,company='default',status=200){const response=await page.request.get(base+path,{headers:{'X-Bookr-Company':company}}),body=await response.json();assert.equal(response.status(),status,path+': '+JSON.stringify(body));return body;}
 const session=()=>page.evaluate(()=>Object.fromEntries(Object.keys(sessionStorage).sort().map(key=>[key,sessionStorage.getItem(key)])));
 let savedProfile,otherProfile;
 async function assertRetained(){
  assert.equal(await page.locator('#main').getAttribute('data-screen'),'company-alter');assert.equal(await page.locator('#company-form').getAttribute('data-company-id'),f.target.id);assert.equal(await page.locator('#company-form').getAttribute('data-company-revision'),String(savedProfile.revision));assert.equal(await page.locator('.screen-company').innerText(),savedProfile.name);assert.equal(await page.locator('#company-name').inputValue(),savedProfile.name);
  for(const [id,value]of [['company-mailing-name',draftMailing],['company-address',draftAddress]]){assert.equal(await page.locator('#'+id).inputValue(),value);assert.equal(await page.locator('#'+id).isEditable(),true);}
  assert.equal(await page.locator('#accept-company').isEnabled(),true);assert.deepEqual(await session(),originalSession);assert.equal(await page.evaluate(()=>window.__profileOriginDocument),'owned original document');assert.deepEqual(await page.evaluate(()=>window.__profileOriginSessionWrites),[]);assert.deepEqual(snapshotProfileOrigin(f),before);assert.deepEqual(await read('/api/companies/'+f.other.id),otherProfile);assert.equal((await read('/api/outstanding')).totals.pending,60000);
 }
 try{
  for(const id of ['default',f.target.id,f.other.id])await read('/api/state',id);
  savedProfile=await read('/api/companies/'+f.target.id);otherProfile=await read('/api/companies/'+f.other.id);
  await page.evaluate(target=>{sessionStorage.setItem('bookr.company-session',JSON.stringify({version:1,loadedIds:['default',target],activeId:'default'}));sessionStorage.setItem('bookr.company','default');sessionStorage.setItem('bookr.working-date.default',JSON.stringify({date:'2026-08-15',revision:7,period:{from:'2026-04-01',to:'2027-03-31'}}));sessionStorage.setItem('bookr.working-date.'+target,JSON.stringify({date:'2025-09-15',revision:3,period:{from:'2025-04-01',to:'2026-03-31'}}));},f.target.id);
  await page.reload({waitUntil:'networkidle'});await page.keyboard.press('Alt+k');await page.locator('#company-alter-menu').click();await page.locator('#main[data-mode="edit"]').waitFor();await page.locator('#company-search').fill(savedProfile.name);await page.locator('#company-options [data-company-id="'+f.target.id+'"]').click();await page.locator('#company-form').waitFor();
  assert.equal(await page.locator('#company-name').inputValue(),savedProfile.name);originalSession=await session();await page.evaluate(()=>{window.__profileOriginDocument='owned original document';window.__profileOriginSessionWrites=[];const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(this===sessionStorage&&/^bookr\.(company(?:-session)?$|working-date\.)/.test(key))window.__profileOriginSessionWrites.push({key,value});return original.call(this,key,value);};});
  await page.locator('#company-mailing-name').fill(draftMailing);await page.locator('#company-address').fill(draftAddress);
  step='Inject raw '+key+' only in owned fixture catalog';injection=injectProfileOrigin(f,key);before=snapshotProfileOrigin(f);
  for(let attempt=1;attempt<=2;attempt++){
   step='Reject save attempt '+attempt+' with retained draft';const pending=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/companies/'+f.target.id&&response.request().method()==='PUT');await page.keyboard.press('Control+a');const response=await pending,body=await response.json();responses.push({attempt,status:response.status(),body});
   assert.equal(response.status(),400,'An unrecognized raw '+key+' must not be silently removed by PUT');assert.deepEqual(Object.keys(body),['error']);assert.match(body.error,/unsupported.*(?:stored|company|setting)|(?:stored|company|setting).*unsupported/i);await page.waitForFunction(()=>document.querySelector('#accept-company')?.disabled===false&&Boolean(document.querySelector('#company-error')?.textContent));await assertRetained();
  }
  step='Saved-error API and retained unsaved screenshot';const readState=async()=>({savedProfile,targetError:await read('/api/companies/'+f.target.id,'default',400),other:await read('/api/companies/'+f.other.id),session:await session(),snapshot:snapshotProfileOrigin(f),outstanding:(await read('/api/outstanding')).totals.pending}),state=await readState();
  const capture=await captureVerifiedScreen({page,outputDir:join(out,'captures'),id:'raw-'+key+'-rejected-edit-draft',reference:null,readState,expected:{view:'company-alter',root:'#company-form',context:{targetId:f.target.id,activeId:'default',savedName:savedProfile.name,unsavedMailing:draftMailing},contextBindings:{targetId:{api:0,path:'id'},savedName:{api:0,path:'name'}},fields:[{selector:'.screen-company',read:'text',equals:savedProfile.name},{selector:'#company-name',read:'value',equals:savedProfile.name},{selector:'#company-mailing-name',read:'value',equals:draftMailing},{selector:'#company-error',read:'text',equals:state.targetError.error}],api:[{path:'savedProfile',equals:savedProfile},{path:'targetError',equals:state.targetError},{path:'session',equals:originalSession},{path:'snapshot',equals:before},{path:'outstanding',equals:60000}]}});captures.push({...capture.capture,recordFile:capture.recordFile});
  const writes=requests.filter(row=>row.method!=='GET');assert.equal(writes.length,2);for(const write of writes){assert.equal(write.method,'PUT');assert.equal(write.path,'/api/companies/'+f.target.id);assert.equal(write.company,'default');assert.equal(write.data.revision,savedProfile.revision);}assert.deepEqual(blocked,[]);assert.deepEqual(errors,[]);await assertRetained();results.push({key,passed:true,requests,responses,captures,scope:'Owned temporary fixture only; intentional raw-key SQL injection precedes the preservation baseline'});
 }catch(error){await page.screenshot({path:join(out,'raw-'+key+'-failure.png')}).catch(()=>{});results.push({key,passed:false,step,error:error.message,injection,before,after:snapshotProfileOrigin(f),requests,responses,blocked,captures,pageErrors:errors});}
 finally{await test.close();}
}
const result={application:'Bookr',passed:results.every(row=>row.passed),results,checkedAt:new Date().toISOString(),scope:'Original Bookr error handling only; fictional owned4773 fixtures, no protected/native/preview access'};await writeFile(join(out,result.passed?'green.json':'red.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:result.passed,cases:results.length,out}));assert.equal(result.passed,true,'Reserved stored profile origin must reject and preserve editable drafts.');
