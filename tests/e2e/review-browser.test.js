import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserHarness,createBackendFixture,BACKEND_ORIGIN} from './browser-harness.js';

let harness;
test.before(async()=>{harness=await createBrowserHarness();});
test.after(async()=>{await harness?.close();});

test('a denied review write preserves the form and never claims publication or awards local XP',async t=>{
  const fixture=createBackendFixture();
  const workId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const versionId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  fixture.tables.lit_works=[{id:workId,author_id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',title:'Review failure regression',summary:'A published work for the failure contract.',kind:'story',status:'published',genres:[],published_at:'2026-10-25T10:00:00Z'}];
  fixture.tables.lit_work_versions=[{id:versionId,work_id:workId,version_no:1,title:'Review failure regression',plain_text:'Опубликованный текст. '.repeat(20),content:{editorMode:'document'},evaluation_open:true,published_at:'2026-10-25T10:00:00Z'}];
  const {page,context}=await harness.scenario(t,{fixture,path:'/#/read'});
  await context.route(`${BACKEND_ORIGIN}/rest/v1/lit_reviews**`,async route=>{
    if(route.request().method()==='POST')return route.fulfill({status:403,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({message:'review permission denied'})});
    return route.fallback();
  });
  await page.locator(`[data-action="start-reading"][data-id="cloud:${workId}"]`).first().click();
  await page.locator('[data-action="open-review"]').first().click();
  const comment='Подробная рецензия, которую нельзя потерять при отказе сервера.';
  await page.locator('#reviewForm [name="comment"]').fill(comment);
  await page.locator('#reviewForm button.primary').click();
  await page.waitForFunction(()=>document.querySelector('#operationFeedback')?.textContent.includes('review permission denied'));
  assert.equal(await page.locator('#reviewForm [name="comment"]').inputValue(),comment);
  const snapshot=await page.evaluate(async()=>{const {state}=await import('/src/state.js');return {xp:state.user.xp,reviews:state.reviews.length,page:state.ui.page};});
  assert.equal(snapshot.xp,0);
  assert.equal(snapshot.reviews,0);
  assert.equal(snapshot.page,'reader');
  assert.equal(await page.locator('.review-success').count(),0);
  await context.unroute(`${BACKEND_ORIGIN}/rest/v1/lit_reviews**`);
  await page.locator('#reviewForm button.primary').click();
  await page.waitForFunction(async()=>{const {state}=await import('/src/state.js');return state.reviews[0]?.cloud===true;});
  assert.equal(fixture.tables.lit_reviews.length,1);
  assert.equal(fixture.tables.lit_reviews[0].body,comment);
  assert.equal(await page.locator('#operationFeedback').count(),0);
  await page.reload();
  await page.waitForSelector('.app-shell');
  assert.equal(await page.evaluate(async()=>{const {state}=await import('/src/state.js');return state.reviews[0]?.comment;}),comment);
});
