import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {browserFixture} from './browser-fixture.mjs';

const test=await browserFixture({port:4360,name:'financial-layout-browser',seed:book=>{
 const customer=book.createCustomer({name:'Demo Customer'}),supplier=book.saveSupplier({name:'Study Supplier Fictional'}),first=book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:100000}),second=book.saveVoucher({type:'sale',date:'2026-04-01',customer_id:customer.id,account_id:2,amount:250075});
 book.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1,amount:40000,allocations:[{bill_id:first.bill.id,amount:40000}]});book.saveVoucher({type:'receipt',date:'2026-04-01',customer_id:customer.id,account_id:1,amount:82525,allocations:[{bill_id:second.bill.id,amount:62525},{bill_id:first.bill.id,amount:20000}]});
 const purchase=book.saveVoucher({type:'purchase',date:'2026-04-01',supplier_id:supplier.id,account_id:3,amount:150000,bill:{reference:'SUP-001'}});book.saveVoucher({type:'payment',date:'2026-04-01',supplier_id:supplier.id,account_id:1,amount:60000,allocations:[{bill_id:purchase.bill.id,amount:60000}]});return {customer,supplier,first,second,purchase};
}});
const {page,out,get,fixture:f,errors}=test;let step='startup';
try{
 await page.setViewportSize({width:1229,height:654});const baseline=await get('/api/state');await page.getByRole('button',{name:'Profit & Loss A/c',exact:true}).click();await page.locator('#financial-result').waitFor();assert.equal(await page.locator('#financial-result').innerText(),'2,000.75');
 step='each financial pane owns its company and period';const panes=page.locator('.financial-side');assert.equal(await panes.count(),2);const measurement={viewport:{width:1229,height:654},nativePurchaseTop:148,tolerance:3,purchase:await page.locator('[data-financial-key="purchases"]').boundingBox(),panes:await panes.allInnerTexts()};await writeFile(join(out,'financial-layout-measurement.json'),JSON.stringify(measurement,null,2)+'\n');console.log(JSON.stringify(measurement));for(const text of measurement.panes){assert.ok(text.includes(baseline.company),'Each financial pane must show its own company header.');assert.match(text,/1-Apr-2026/,'Each financial pane must show its own report period.');}assert.ok(Math.abs(measurement.purchase.y-148)<=3,'Purchase row must align to the observed native y148: '+JSON.stringify(measurement.purchase));assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,fixtureVouchers:baseline.vouchers.length,profit:200075,measurement}));
}catch(error){console.error('Financial layout browser failed at '+step);throw error;}finally{await test.close();}
