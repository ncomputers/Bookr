import {readFile,open,mkdir,unlink} from 'node:fs/promises';
import {resolve,relative,isAbsolute,join} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {entryDate,inputRupees,formatRupees} from '../public/entry-values.js';

export class ScreenEvidenceError extends Error{
  constructor(code,message){super(message);this.name='ScreenEvidenceError';this.code=code;}
}
const check=(condition,code,message)=>{if(!condition)throw new ScreenEvidenceError(code,message);};
const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const subset=(actual,expected)=>object(expected)?object(actual) && Object.entries(expected).every(([key,value])=>Object.hasOwn(actual,key) && subset(actual[key],value)):isDeepStrictEqual(actual,expected);
const validPath=path=>typeof path==='string' && path.length>0 && path.split('.').every(key=>/^[\w-]+$/.test(key) && !['__proto__','prototype','constructor'].includes(key));
function at(value,path){
  if(!path)return value;
  for(const key of path.split('.')){
    check(/^[\w-]+$/.test(key) && !['__proto__','prototype','constructor'].includes(key),'INVALID_CONTRACT','Use plain property paths.');
    if(value==null || !Object.hasOwn(value,key))return undefined;value=value[key];
  }
  return value;
}
function pngSize(bytes){
  check(bytes.length>=24 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'REFERENCE_MISMATCH','Evidence must contain an original PNG.');
  return {width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
}
function inside(root,path){
  check(typeof path==='string' && path.length>0 && !isAbsolute(path),'REFERENCE_MISMATCH','Catalog paths must be relative to their declared root.');
  const full=resolve(root,path),part=relative(root,full);
  check(part && !part.startsWith('..') && !isAbsolute(part),'REFERENCE_MISMATCH','Reference path leaves its catalog root.');return full;
}
function validate(options){
  const {page,outputDir,id,expected,readState,reference=null}=options ?? {};
  check(page && typeof outputDir==='string' && outputDir.trim().length>0 && /^[a-z0-9][a-z0-9-]{0,95}$/.test(id ?? '') && object(expected) && typeof readState==='function','INVALID_CONTRACT','Provide a screen, immutable capture id, output directory and state reader.');
  check(typeof expected.view==='string' && expected.view && typeof expected.root==='string' && expected.root && object(expected.context),'INVALID_CONTRACT','Declare the exact view, root and context.');
  check(Array.isArray(expected.fields) && expected.fields.length>0 && Array.isArray(expected.api) && expected.api.length>0,'INVALID_CONTRACT','Bind visible fields and saved API state before capturing.');
  for(const field of expected.fields)check(object(field) && typeof field.selector==='string' && ['value','text','attribute','selectedText'].includes(field.read) && Object.hasOwn(field,'equals') && (field.read!=='attribute' || typeof field.attribute==='string'),'INVALID_CONTRACT','Declare each field selector, read method and expected value.');
  for(const rule of expected.api)check(object(rule) && validPath(rule.path) && Object.hasOwn(rule,'equals') && (rule.where===undefined || (object(rule.where) && Object.keys(rule.where).length>0)),'INVALID_CONTRACT','Declare each saved-state path and expected value.');
  if(expected.contextBindings!==undefined){
    check(object(expected.contextBindings),'INVALID_CONTRACT','Context bindings must be an object.');
    for(const binding of Object.values(expected.contextBindings))check(object(binding) && (binding.path===undefined || validPath(binding.path)),'INVALID_CONTRACT','Use plain property paths in context bindings.');
  }
  if(reference!==null)check(object(reference) && typeof reference.catalogPath==='string' && typeof reference.id==='string','REFERENCE_MISMATCH','A caller flag cannot certify a native reference; use an audited catalog entry.');
  check(['locator','evaluate','screenshot','viewportSize'].every(method=>typeof page[method]==='function'),'INVALID_CONTRACT','Provide a browser page.');
}
async function referenceRecord(reference,expected){
  if(reference===null)return {status:'unverified',reason:'No corresponding audited native capture supplied.'};
  try{
    const catalogBytes=await readFile(reference.catalogPath),catalog=JSON.parse(catalogBytes.toString('utf8'));
    check(catalog.schemaVersion===1 && typeof catalog.root==='string' && isAbsolute(catalog.root) && Array.isArray(catalog.entries),'REFERENCE_MISMATCH','Invalid reference catalog.');
    const entries=catalog.entries.filter(row=>row.id===reference.id);check(entries.length===1,'REFERENCE_MISMATCH','Choose one audited reference.');
    const row=entries[0];check(row.reviewed===true && row.view===expected.view && object(row.context) && subset(expected.context,row.context),'REFERENCE_MISMATCH','Native reference belongs to a different screen or transaction context.');
    check(object(expected.contextBindings) && Object.keys(row.context).every(key=>Object.hasOwn(expected.contextBindings,key)),'REFERENCE_MISMATCH','Every native context fact must be bound to actual DOM/API evidence.');
    const path=inside(catalog.root,row.path),bytes=await readFile(path),size=pngSize(bytes);
    check(sha(bytes)===row.sha256 && size.width===row.width && size.height===row.height,'REFERENCE_MISMATCH','Native image changed or its dimensions were misreported.');
    check(object(row.study) && typeof row.study.sha256==='string','REFERENCE_MISMATCH','Native reference needs a study anchor.');
    const studyPath=inside(catalog.root,row.study.path),studyBytes=await readFile(studyPath);
    check(sha(studyBytes)===row.study.sha256,'REFERENCE_MISMATCH','Native reference study changed.');
    return {status:'verified-context',id:row.id,path,sha256:row.sha256,...size,context:row.context,study:{path:studyPath,sha256:row.study.sha256},catalog:{path:resolve(reference.catalogPath),sha256:sha(catalogBytes)},provenance:row.provenance};
  }catch(error){if(error instanceof ScreenEvidenceError)throw error;throw new ScreenEvidenceError('REFERENCE_MISMATCH','Native reference could not be verified: '+error.message);}
}
async function readField(page,field){
  const node=page.locator(field.selector);
  check(await node.count()===1 && await node.isVisible(),'FIELD_MISMATCH','Expected one visible field: '+field.selector);
  const bounds=await node.boundingBox(),viewport=page.viewportSize();
  check(bounds && bounds.width>0 && bounds.height>0 && bounds.x>=-0.5 && bounds.y>=-0.5 && bounds.x+bounds.width<=viewport.width+0.5 && bounds.y+bounds.height<=viewport.height+0.5,'FIELD_MISMATCH','Field is outside the captured viewport: '+field.selector);
  const painted=await node.evaluate(element=>{
    for(let ancestor=element;ancestor;ancestor=ancestor.parentElement){
      const style=getComputedStyle(ancestor);
      if(Number(style.opacity)===0 || style.visibility!=='visible' || style.contentVisibility==='hidden')return false;
    }
    const box=element.getBoundingClientRect(),insetX=Math.min(2,box.width/4),insetY=Math.min(2,box.height/4);
    const points=[[box.x+box.width/2,box.y+box.height/2],[box.left+insetX,box.top+insetY],[box.right-insetX,box.top+insetY],[box.left+insetX,box.bottom-insetY],[box.right-insetX,box.bottom-insetY]];
    return points.every(([x,y])=>{const hit=document.elementFromPoint(x,y);return hit!==null && (hit===element || element.contains(hit));});
  });
  check(painted,'FIELD_MISMATCH','Field is hidden or covered in the captured screen: '+field.selector);
  const value=field.read==='value'?await node.inputValue():field.read==='text'?(await node.innerText()).trim():field.read==='attribute'?await node.getAttribute(field.attribute):await node.evaluate(el=>el.selectedOptions[0]?.textContent.trim() ?? '');
  return {selector:field.selector,read:field.read,...(field.attribute?{attribute:field.attribute}:{}),value,bounds};
}
const display=(value,format='string')=>format==='entry-date'?entryDate(value):format==='rupees'?inputRupees(value):format==='money'?formatRupees(value):format==='balance-dr'?formatRupees(value)+' Dr':format==='balance-cr'?formatRupees(value)+' Cr':String(value);
async function verify(page,expected,readState){
  const main=page.locator('#main'),root=page.locator(expected.root);
  check(await main.count()===1 && await main.getAttribute('data-screen')===expected.view && await root.count()===1 && await root.isVisible(),'WRONG_SCREEN','The requested screen is not the active visible screen.');
  const dialogs=page.locator('dialog[open]');
  check(expected.dialog?await dialogs.count()===1 && await page.locator(expected.dialog).count()===1 && await page.locator(expected.dialog).isVisible():await dialogs.count()===0,'WRONG_SCREEN','A different dialog is covering the requested screen.');
  const caption=(await page.locator('.screen-title h1').innerText()).trim();
  check(expected.caption===undefined || caption===expected.caption,'WRONG_SCREEN','Screen caption differs from the requested step.');
  const fields=[];
  for(const field of expected.fields){const observed=await readField(page,field);check(isDeepStrictEqual(observed.value,field.equals),'FIELD_MISMATCH','Unexpected value in '+field.selector);fields.push(observed);}
  const state=await readState(),api=[];
  for(const rule of expected.api){
    let actual=at(state,rule.path);
    if(rule.where){check(Array.isArray(actual),'STATE_MISMATCH','Expected a saved record collection.');const rows=actual.filter(row=>subset(row,rule.where));check(rows.length===1,'STATE_MISMATCH','Expected exactly one saved record at '+rule.path);actual=rows[0];}
    check(subset(actual,rule.equals),'STATE_MISMATCH','Saved state differs at '+rule.path);api.push({path:rule.path,...(rule.where?{where:rule.where}:{}),expected:rule.equals,actual});
  }
  const bindings={};
  for(const [key,binding] of Object.entries(expected.contextBindings ?? {})){
    check(Object.hasOwn(expected.context,key) && object(binding),'INVALID_CONTRACT','Declare the fact for each context binding.');
    const wanted=expected.context[key],observed={};
    if(binding.api!==undefined){check(Number.isInteger(binding.api) && api[binding.api],'INVALID_CONTRACT','Context binding must select a checked API record.');observed.apiValue=at(api[binding.api].actual,binding.path);check(subset(observed.apiValue,wanted),'STATE_MISMATCH','Context differs from saved state: '+key);}
    if(binding.field){const field=await readField(page,{selector:binding.field,read:binding.read ?? 'value',attribute:binding.attribute});check(field.value===display(wanted,binding.format),'FIELD_MISMATCH','Context differs from visible field: '+key);observed.field=field;}
    check(binding.api!==undefined || binding.field,'INVALID_CONTRACT','Context binding needs API or visible field evidence.');bindings[key]=observed;
  }
  return {caption,fields,api,bindings,stateSha256:sha(JSON.stringify(state)),viewport:page.viewportSize(),deviceScaleFactor:await page.evaluate(()=>devicePixelRatio)};
}

// Capture only the step whose screen, fields and saved data have all passed.
// Content-addressed filenames and exclusive writes preserve old evidence.
export async function captureVerifiedScreen(options){
  validate(options);
  const {page,outputDir,id,expected,readState,reference=null}=options;
  const native=await referenceRecord(reference,expected);
  await page.evaluate(async()=>{await document.fonts.ready;});
  const before=await verify(page,expected,readState);
  await page.evaluate(()=>{
    if(window.__bookrCapture)throw new Error('Another screen capture is active.');
    // Playwright temporarily changes only caret-color when caret:'hide' is used.
    // Keep observing every other style change, including changes later reverted.
    const withoutCaret=value=>{const parsed=document.createElement('span');parsed.style.cssText=value ?? '';parsed.style.removeProperty('caret-color');return parsed.style.cssText;};
    const state={changes:0},observer=new MutationObserver(records=>{
      for(const record of records){
        if(record.type==='attributes' && record.attributeName==='style' && withoutCaret(record.oldValue)===withoutCaret(record.target.getAttribute('style')))continue;
        state.changes++;
      }
    });
    const attributes=['class','style','data-screen','hidden','open','value','data-voucher-type'];
    observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeOldValue:true,attributeFilter:attributes});
    observer.observe(document.documentElement,{attributes:true,attributeOldValue:true,attributeFilter:attributes});
    window.__bookrCapture={state,observer};
  });
  let bytes,after,changes;
  try{
    bytes=Buffer.from(await page.screenshot({type:'png',fullPage:false,animations:'disabled',caret:'hide'}));
    try{after=await verify(page,expected,readState);}catch(error){throw new ScreenEvidenceError('SCREEN_CHANGED','Screen or saved data changed during capture: '+error.message);}
  }finally{
    changes=await page.evaluate(()=>{const capture=window.__bookrCapture;if(!capture)return -1;capture.observer.disconnect();delete window.__bookrCapture;return capture.state.changes;}).catch(()=>-1);
  }
  check(changes===0 && before.stateSha256===after.stateSha256 && isDeepStrictEqual(before.fields,after.fields) && isDeepStrictEqual(before.bindings,after.bindings) && isDeepStrictEqual(before.viewport,after.viewport) && before.deviceScaleFactor===after.deviceScaleFactor,'SCREEN_CHANGED','Screen, geometry or saved state changed during capture.');
  const imageSha256=sha(bytes),size=pngSize(bytes),directory=resolve(outputDir),stem=id+'--'+imageSha256,file=join(directory,stem+'.png'),recordFile=join(directory,stem+'.json');
  const record={schemaVersion:1,id,createdAt:new Date().toISOString(),verification:{content:true,api:true},screen:{view:expected.view,root:expected.root,caption:before.caption,context:expected.context,contextBindings:before.bindings},fields:before.fields,api:before.api,stateSha256:before.stateSha256,capture:{file,sha256:imageSha256,...size,viewport:before.viewport,deviceScaleFactor:before.deviceScaleFactor,fullPage:false,caret:'hidden',resized:false},reference:native,visualComparison:{status:'not-pixel-compared',reason:'Verified content and native context do not establish pixel equality; original image dimensions are retained.'}};
  await mkdir(directory,{recursive:true});let imageWritten=false,recordWritten=false,imageHandle,recordHandle;
  try{
    imageHandle=await open(file,'wx');imageWritten=true;await imageHandle.writeFile(bytes);await imageHandle.close();imageHandle=null;
    recordHandle=await open(recordFile,'wx');recordWritten=true;await recordHandle.writeFile(JSON.stringify(record,null,2)+'\n');await recordHandle.close();recordHandle=null;
  }catch(error){
    await Promise.allSettled([imageHandle?.close(),recordHandle?.close()]);
    if(recordWritten)await unlink(recordFile);if(imageWritten)await unlink(file);
    if(error.code==='EEXIST')throw new ScreenEvidenceError('FILE_EXISTS','Evidence is immutable; use a new capture id.');throw error;
  }
  return {...record,recordFile};
}
