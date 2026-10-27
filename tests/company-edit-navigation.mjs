import assert from 'node:assert/strict';

// Shared navigation for regressions whose subject is the existing profile form.
export async function enterHighlightedCompanyEditor(page){
  await page.locator('#main[data-screen="companies"][data-mode="edit"]').waitFor();
  await page.keyboard.press('Enter');
  await page.locator('#main[data-screen="company-alter"] #company-form').waitFor();
}

export async function acceptCompanyAndReturnHome(page,name){
  const editing=await page.locator('#main').getAttribute('data-screen')==='company-alter';
  await page.keyboard.press('Control+a');
  if(editing){
    await page.locator('#main[data-screen="companies"][data-mode="edit"]').waitFor();
    assert.equal(await page.locator('#company-search').inputValue(),name);
    await page.getByRole('link',{name:'Bookr Gateway',exact:true}).click();
  }
  await page.waitForFunction(name=>document.querySelector('.company-pane .company-name')?.textContent===name,name);
}
