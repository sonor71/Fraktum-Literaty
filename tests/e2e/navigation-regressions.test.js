import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserHarness,createBackendFixture,BACKEND_ORIGIN,POST_ID} from './browser-harness.js';

let harness;
test.before(async()=>{harness=await createBrowserHarness();});
test.after(async()=>{await harness?.close();});

test('back and forward restore a long post scroll after its delayed permalink request',async t=>{
  const fixture=createBackendFixture();
  fixture.tables.lit_posts[0].body='Длинная публикация для проверки прокрутки.\n'.repeat(240);
  const {page,context,errors}=await harness.scenario(t,{fixture,path:`/post/${POST_ID}`});
  await page.waitForSelector('.permalink-post .post');
  await page.evaluate(()=>window.scrollTo(0,1000));
  await page.waitForFunction(()=>window.history.state?.fraktum?.scroll.y===1000);
  await page.locator('.avatar-btn').click();
  await page.waitForURL('**/#/profile');
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  let delayed=false;
  await context.route(`${BACKEND_ORIGIN}/rest/v1/lit_posts**`,async route=>{
    if(!delayed&&new URL(route.request().url()).searchParams.get('id')===`eq.${POST_ID}`){delayed=true;await pending;}
    return route.fallback();
  });
  await page.goBack();
  await page.waitForSelector('.permalink-post [role="status"]');
  // Wait beyond the scroll recorder debounce while only the short loading
  // screen exists. Its clamped position must not overwrite the saved entry.
  await page.waitForTimeout(180);
  assert.equal(await page.evaluate(()=>window.history.state.fraktum.scroll.y),1000);
  release();
  await page.waitForSelector('.permalink-post .post');
  await page.waitForFunction(()=>window.scrollY===1000);
  await page.goForward();
  await page.waitForURL('**/#/profile');
  await page.goBack();
  await page.waitForSelector('.permalink-post .post');
  await page.waitForFunction(()=>window.scrollY===1000);
  assert.deepEqual(errors,[]);assert.deepEqual(fixture.failures,[]);
});

test('a post made private no longer renders its cached card when its permalink is revisited',async t=>{
  const fixture=createBackendFixture();
  const {page,errors}=await harness.scenario(t,{fixture,path:`/post/${POST_ID}`});
  await page.waitForSelector('.permalink-post .post');
  await page.locator('.avatar-btn').click();
  await page.waitForURL('**/#/profile');
  fixture.tables.lit_posts[0].visibility='private';
  await page.goBack();
  await page.waitForSelector('.permalink-post .empty');
  assert.match(await page.locator('.permalink-post').innerText(),/Пост недоступен/);
  assert.equal(await page.locator(`.permalink-post .post[data-post-id="${POST_ID}"]`).count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(fixture.failures,[]);
});

test('navigation keeps pressed feedback pending until its View Transition update finishes',async t=>{
  const {page,errors}=await harness.scenario(t,{reducedMotion:'no-preference'});
  await page.evaluate(()=>Object.defineProperty(document,'startViewTransition',{configurable:true,value:update=>{
    let complete;
    const updateCallbackDone=new Promise(resolve=>{complete=resolve;});
    globalThis.__completeNavigation=()=>{update();complete();};
    return {updateCallbackDone};
  }}));
  await page.locator('.menu-toggle').click();
  const pressed=page.locator('.sidebar nav [data-page="read"]');
  await pressed.click();
  assert.equal(await pressed.getAttribute('aria-busy'),'true');
  assert.equal(await pressed.isDisabled(),true);
  await page.evaluate(()=>globalThis.__completeNavigation());
  await page.waitForFunction(()=>document.querySelector('.sidebar [data-page="read"]')?.classList.contains('active'));
  assert.equal(await page.locator('.sidebar [data-page="read"]').getAttribute('aria-busy'),null);
  assert.deepEqual(errors,[]);
});

test('failed navigation updates report an actionable error instead of an unhandled rejection',async t=>{
  const {page,errors}=await harness.scenario(t,{reducedMotion:'no-preference'});
  await page.evaluate(()=>Object.defineProperty(document,'startViewTransition',{configurable:true,value:()=>({updateCallbackDone:Promise.reject(new Error('navigation render regression'))})}));
  await page.locator('.menu-toggle').click();
  await page.locator('.sidebar nav [data-page="read"]').click();
  await page.waitForFunction(()=>document.querySelector('#operationFeedback')?.textContent.includes('navigation render regression'));
  assert.equal(await page.locator('.sidebar [data-page="read"]').isDisabled(),false);
  assert.deepEqual(errors,[]);
});

test('unsupported View Transitions use the real page animation and remove it after completion',async t=>{
  const {page,errors}=await harness.scenario(t,{reducedMotion:'no-preference'});
  await page.evaluate(()=>Object.defineProperty(document,'startViewTransition',{configurable:true,value:undefined}));
  await page.locator('.menu-toggle').click();
  const animation=await page.evaluate(()=>{
    document.querySelector('.sidebar [data-page="read"]').click();
    const target=document.querySelector('.page');
    return {entering:target.classList.contains('navigation-enter'),name:getComputedStyle(target).animationName,duration:getComputedStyle(target).animationDuration};
  });
  assert.equal(animation.entering,true);assert.equal(animation.name,'navigation-in');assert.equal(animation.duration,'0.2s');
  await page.waitForFunction(()=>!document.querySelector('.page')?.classList.contains('navigation-enter'));
  assert.deepEqual(errors,[]);
});

test('reduced motion bypasses page transitions and drawer movement animation',async t=>{
  const {page,errors}=await harness.scenario(t,{reducedMotion:'reduce'});
  await page.evaluate(()=>Object.defineProperty(document,'startViewTransition',{configurable:true,value:()=>{throw new Error('must not animate reduced motion');}}));
  await page.locator('.menu-toggle').click();
  await page.locator('.sidebar [data-page="read"]').click();
  await page.waitForFunction(()=>document.querySelector('.sidebar [data-page="read"]')?.classList.contains('active'));
  assert.equal(await page.locator('.navigation-enter').count(),0);
  assert.equal(await page.locator('.chat-slide').evaluate(element=>getComputedStyle(element).transitionDuration),'0s');
  assert.deepEqual(errors,[]);
});

test('duplicate programmatic auth submissions issue one request and preserve the form on failure',async t=>{
  const {page,context,fixture}=await harness.scenario(t,{authenticated:false});
  let release,calls=0;
  const pending=new Promise(resolve=>{release=resolve;});
  await context.route(`${BACKEND_ORIGIN}/auth/v1/otp`,async route=>{
    calls++;await pending;
    return route.fulfill({status:429,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({message:'delayed OTP rejection'})});
  });
  await page.locator('[data-action="show-login"]').click();
  await page.locator('#loginOtpRequestForm [name="identifier"]').fill('preserve@example.test');
  await page.evaluate(()=>{
    const form=document.querySelector('#loginOtpRequestForm');
    form.requestSubmit();form.requestSubmit();
  });
  await page.waitForFunction(()=>document.querySelector('#loginOtpRequestForm button[type="submit"]').disabled);
  release();
  await page.waitForFunction(()=>document.querySelector('#operationFeedback')?.textContent.includes('delayed OTP rejection'));
  assert.equal(calls,1);
  assert.equal(await page.locator('#loginOtpRequestForm [name="identifier"]').inputValue(),'preserve@example.test');
  assert.deepEqual(fixture.failures,[]);
});
