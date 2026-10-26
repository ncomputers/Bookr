import {startOwnedTestServer,stopOwnedTestServer} from './owned-test-server.mjs';
import {chromium} from 'playwright-core';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),base='http://127.0.0.1:4328';
const directory=await mkdtemp(join(tmpdir(),'bookr-discard-dialog-')),output=join(root,'evidence/web');
let server,browser,page,serverOutput='',step='startup';const errors=[],voucherWrites=[],paymentModes=[];
async function start(){server=await startOwnedTestServer({root,port:4328,database:join(directory,'book.sqlite'),onOutput:text=>{serverOutput+=text;}});}
async function state(){const response=await page.request.get(base+'/api/state');assert.equal(response.ok(),true);return response.json();}
async function stop(){await stopOwnedTestServer(server);}
async function assertDraft(expected,original){
  await page.locator('#entry-dialog').waitFor({state:'detached'});
  assert.equal(await page.locator('#sales-form').count(),1);
  assert.equal(await page.locator('#sale-amount').inputValue(),expected.amount);
  assert.equal(await page.locator('#sale-narration').inputValue(),expected.narration);
  assert.deepEqual(await state(),original);
}
async function prompt(){await page.keyboard.press('Escape');await page.locator('#entry-dialog').waitFor();}
async function focusedChoice(){return page.locator('#entry-dialog').evaluate(dialog=>dialog.contains(document.activeElement)?document.activeElement.value:null);}
async function assertPaymentDraft(expected,original){
  await page.locator('#entry-dialog').waitFor({state:'detached'});
  for(const [field,text] of Object.entries(expected))assert.equal(await page.locator('#receipt-'+field).inputValue(),text,field);
  assert.match(await page.locator('#receipt-allocation-summary').innerText(),/Discard Test Bill/);
  assert.equal(await page.locator('#receipt-narration').evaluate(el=>el===document.activeElement),true);
  assert.deepEqual(await state(),original);
}
async function paymentMode(mode){
  await page.keyboard.press('Control+h');await page.locator('#entry-mode-dialog').waitFor();
  if(mode==='single')await page.keyboard.press('ArrowDown');else await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');await page.locator('#entry-mode-dialog').waitFor({state:'detached'});
  await page.locator(mode==='single'?'#receipt-form[data-voucher-type="payment-single"]':'#receipt-form[data-voucher-type="payment"]').waitFor();
}
async function fillPaymentDraft(mode){
  await page.locator('#receipt-customer').fill('Fictional Discard Test Supplier');await page.locator('#receipt-customer').press('Enter');
  await page.locator('#receipt-amount').fill('400');await page.locator('#receipt-amount').press('Enter');await page.locator('#receipt-bills-dialog').waitFor();await page.keyboard.press('Enter');await page.keyboard.press('Enter');await page.keyboard.press('Enter');await page.keyboard.press('Control+a');await page.locator('#receipt-bills-dialog').waitFor({state:'detached'});
  await page.locator('#receipt-narration').fill('Retain '+mode+' payment and reviewed bill draft');
  return {customer:'Fictional Discard Test Supplier',account:'1',amount:'400',narration:'Retain '+mode+' payment and reviewed bill draft'};
}
try{
  await mkdir(output,{recursive:true});await start();
  browser=await chromium.launch({headless:true,executablePath:process.env.BOOKR_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'});
  page=await browser.newPage({viewport:{width:1229,height:655}});page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base,{waitUntil:'networkidle'});
  const customer=await page.request.post(base+'/api/customers',{data:{name:'Fictional Discard Test Buyer'}});assert.equal(customer.ok(),true);
  const supplierResponse=await page.request.post(base+'/api/suppliers',{data:{name:'Fictional Discard Test Supplier'}});assert.equal(supplierResponse.ok(),true);const supplier=await supplierResponse.json();
  const seeded=await state(),purchaseAccount=seeded.ledgers.find(ledger=>ledger.kind==='purchase');
  const purchase=await page.request.post(base+'/api/vouchers',{data:{type:'purchase',date:'2026-04-01',supplier_id:supplier.id,account_id:purchaseAccount.id,amount:100000,bill:{reference:'Discard Test Bill'}}});assert.equal(purchase.ok(),true);
  const original=await state();
  page.on('request',request=>{if(['POST','PUT'].includes(request.method()) && new URL(request.url()).pathname.startsWith('/api/vouchers'))voucherWrites.push(request.method()+' '+request.url());});
  await page.getByRole('button',{name:'Vouchers',exact:true}).click();await page.locator('#sales-form').waitFor();
  await page.locator('#sale-customer').fill('Fictional Discard Test Buyer');await page.keyboard.press('Enter');
  await page.locator('#voucher-details-dialog').waitFor();await page.keyboard.press('Control+a');
  await page.locator('#voucher-details-dialog[data-stage="party"]').waitFor();await page.keyboard.press('Control+a');
  await page.locator('#voucher-details-dialog').waitFor({state:'detached'});await page.locator('#sale-account').selectOption('2');
  const draft={amount:'1234.56',narration:'Fictional unsaved draft must survive Escape'};
  await page.locator('#sale-amount').fill(draft.amount);await page.locator('#sale-narration').fill(draft.narration);
  // The first Escape requests leaving; the second must choose No and stay here.
  await page.keyboard.press('Escape');await page.locator('#entry-dialog').waitFor();
  assert.match(await page.locator('#entry-dialog').innerText(),/Discard unsaved voucher changes/);
  await page.keyboard.press('Escape');await assertDraft(draft,original);
  assert.equal(await page.locator('#sale-narration').evaluate(el=>el===document.activeElement),true);
  // Switching voucher type follows the same discard confirmation path.
  await page.keyboard.press('F9');await page.locator('#entry-dialog').waitFor();
  await page.locator('#entry-dialog button[value="yes"]').focus();
  await page.keyboard.press('Escape');await assertDraft(draft,original);
  assert.equal(await page.locator('#purchase-form').count(),0);
  // Explicit native cancel requests are also interpreted as No.
  await page.keyboard.press('Escape');await page.locator('#entry-dialog').waitFor();
  await page.locator('#entry-dialog').evaluate(dialog=>dialog.dispatchEvent(new Event('cancel',{cancelable:true})));
  await assertDraft(draft,original);
  // Repeat after another edit, checking the prompt can reopen and cancel again.
  draft.narration+=' · continued typing';await page.locator('#sale-narration').fill(draft.narration);
  await page.keyboard.press('Escape');await page.locator('#entry-dialog').waitFor();await page.keyboard.press('Escape');await assertDraft(draft,original);
  await page.screenshot({path:join(output,'bookr-discard-escape-preserved.png'),fullPage:true});
  // Begin Payment without a mouse confirmation. The existing Sales draft is
  // explicitly discarded, while the saved fictional purchase stays unchanged.
  step='switch Sales to Payment with Y';await page.keyboard.press('F5');await page.locator('#entry-dialog').waitFor();await page.keyboard.press('y');await page.locator('#receipt-form[data-voucher-type="payment"]').waitFor();
  for(const mode of ['single','double']){
    step=mode+' Payment keyboard confirmation';await paymentMode(mode);const payment=await fillPaymentDraft(mode);
    // Enter acts on the default No, preserving the reviewed allocation too.
    await prompt();assert.equal(await focusedChoice(),'no');await page.keyboard.press('Enter');await assertPaymentDraft(payment,original);
    await prompt();await page.keyboard.press('Escape');await assertPaymentDraft(payment,original);
    await prompt();await page.keyboard.press('n');await assertPaymentDraft(payment,original);
    await page.keyboard.press('F9');await page.locator('#entry-dialog').waitFor();await page.keyboard.press('Escape');await assertPaymentDraft(payment,original);assert.equal(await page.locator('#purchase-form').count(),0);
    // The old dialog has no arrow-key selection: this is a focused regression,
    // separate from Escape, which already passes in the headless baseline.
    await prompt();await page.keyboard.press('ArrowLeft');assert.equal(await focusedChoice(),'yes','Left must select Discard');await page.keyboard.press('ArrowRight');assert.equal(await focusedChoice(),'no');await page.keyboard.press('Enter');await assertPaymentDraft(payment,original);
    await prompt();await page.keyboard.press('Tab');assert.equal(await focusedChoice(),'yes');await page.keyboard.press('Shift+Tab');assert.equal(await focusedChoice(),'no');await page.keyboard.press('Escape');await assertPaymentDraft(payment,original);
    await prompt();await page.keyboard.press('ArrowLeft');await page.keyboard.press('Escape');await assertPaymentDraft(payment,original);
    // Mode switching must retain the allocation after cancelling the prompt.
    await paymentMode(mode==='single'?'double':'single');assert.equal(await page.locator('#receipt-amount').inputValue(),'400');await paymentMode(mode);await page.locator('#receipt-narration').focus();await assertPaymentDraft(payment,original);
    await prompt();if(mode==='single')await page.screenshot({path:join(output,'bookr-payment-keyboard-confirmation.png'),fullPage:true});
    if(mode==='single'){await page.keyboard.press('ArrowLeft');await page.keyboard.press('Enter');}else await page.keyboard.press('d');
    await page.getByRole('heading',{name:'Gateway of Bookr',exact:true}).waitFor();assert.deepEqual(await state(),original);paymentModes.push({mode,escapeKeepsDraft:true,enterChoosesNo:true,arrowsSelect:true,tabCycles:true,allocationPreserved:true,keyboardDiscard:mode==='single'?'Left then Enter':'D'});
    if(mode==='single'){await page.getByRole('button',{name:'Vouchers',exact:true}).press('Enter');await page.locator('#sales-form').waitFor();await page.keyboard.press('F5');await page.locator('#receipt-form').waitFor();}
  }
  // Other voucher forms use the same component and preserve their drafts.
  for(const [key,form,narration] of [['F6','#receipt-form','#receipt-narration'],['F7','#journal-form','#journal-narration']]){
    step=key+' shared confirmation';await page.getByRole('button',{name:'Vouchers',exact:true}).press('Enter');await page.locator('#sales-form').waitFor();await page.keyboard.press(key);await page.locator(form).waitFor();await page.locator(narration).fill('Shared keyboard confirmation draft');
    if(key==='F6')await page.setViewportSize({width:320,height:844});
    await prompt();if(key==='F6'){
      const box=await page.locator('#entry-dialog').boundingBox();assert.ok(box.x>=0 && box.x+box.width<=320);assert.ok(box.y>=0 && box.y+box.height<=844);assert.equal(await focusedChoice(),'no');await page.screenshot({path:join(output,'bookr-confirmation-mobile.png'),fullPage:true});
    }
    await page.keyboard.press('n');await page.locator('#entry-dialog').waitFor({state:'detached'});assert.equal(await page.locator(narration).inputValue(),'Shared keyboard confirmation draft');await prompt();await page.keyboard.press('d');await page.getByRole('heading',{name:'Gateway of Bookr',exact:true}).waitFor();assert.deepEqual(await state(),original);await page.setViewportSize({width:1229,height:655});
  }
  assert.deepEqual(errors,[]);
  assert.deepEqual(voucherWrites,[]);
  const result={application:'Bookr',checkedAt:new Date().toISOString(),passed:true,testData:'Temporary fictional database with one seeded purchase; no live web or installed reference application data used',baseline:'Sales Escape already passed; expanded pre-fix Payment probe reaches and fails missing Left selection, not Escape',checks:{escapeFromDraftOpensDiscard:true,escapeChoosesNo:true,draftValuesPreserved:true,focusRestored:true,voucherTypeSwitchCancelled:true,escapeSafeWhenDiscardFocused:true,nativeCancelChoosesNo:true,repeatedCancelWorks:true,noVoucherSavedByConfirmation:true,receiptAndJournalSharedDialog:true,mobile320DialogFits:true},paymentModes,voucherWrites,vouchers:(await state()).vouchers.length,pageErrors:errors};
  await writeFile(join(output,'discard-dialog-check.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}catch(failure){console.error('Discard confirmation failed at '+step);throw failure;}
finally{await browser?.close();await stop();assert.ok(directory.startsWith(join(tmpdir(),'bookr-discard-dialog-')));await rm(directory,{recursive:true,force:true});}
