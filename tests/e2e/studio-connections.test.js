import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createBrowserHarness} from './browser-harness.js';
let harness;
test.before(async()=>{harness=await createBrowserHarness();});
test.after(async()=>{await harness?.close();});

async function project(page,type='work',mode='book'){
  await page.locator('.menu-toggle').click();
  await page.locator('[data-action="navigate"][data-page="create"]').click();
  await page.locator('.studio-projects [data-action="new-work"]').click();
  await page.locator(`[data-action="set-create-type"][data-type="${type}"]`).click();
  await page.locator(`[data-action="start-create-project"][data-mode="${mode}"]`).click();
  await page.waitForSelector('#freePageCanvas');
  if(mode==='book')await page.locator('.page-list-item[data-index="2"]').click();
}
async function model(page){
  return page.evaluate(async()=>{const {state}=await import('/src/state.js');const work=state.works.find(work=>work.id===document.querySelector('#workEditor').dataset.id);return {work,index:state.ui.bookPageIndex,canvas:(work.editorMode==='book'?work.bookPages:work.documentPages)[state.ui.bookPageIndex||0].canvas,selected:state.ui.canvasSelectedObjectId};});
}
async function saved(page){await page.waitForFunction(()=>document.querySelector('.word-status span:last-child')?.textContent==='Сохранено в облаке');}
const toolbar=page=>page.locator('.canvas-selection-toolbar');
const clean=scenario=>{assert.deepEqual(scenario.errors,[]);assert.deepEqual(scenario.fixture.failures,[]);};

for(const viewport of [{width:1366,height:768},{width:1920,height:1080},{width:390,height:844}]){
  test(`Studio page list scrolls independently for 5/50/100/200 pages at ${viewport.width}`,async t=>{
    const scenario=await harness.scenario(t,{viewport});const {page}=scenario;
    await project(page);
    const heights=[];
    for(const count of [5,50,100,200]){
      await page.evaluate(async count=>{
        const {state}=await import('/src/state.js');const work=state.works.find(work=>work.id===document.querySelector('#workEditor').dataset.id);
        const base=structuredClone(work.bookPages[2]);work.bookPages=[...work.bookPages.slice(0,2),...Array.from({length:count-2},(_,i)=>({...structuredClone(base),id:`long-page-${i}`}))];
        state.ui.bookPageIndex=0;document.querySelector('[data-action="book-page-next"]').click();
      },count);
      const metrics=await page.locator('.studio-outline .page-list').evaluate(list=>({height:list.clientHeight,scrollHeight:list.scrollHeight,overflow:getComputedStyle(list).overflowY,documentHeight:document.documentElement.scrollHeight}));
      assert.equal(metrics.overflow,'auto');assert.ok(metrics.height<=Math.min(viewport.height*.55,600)+2);heights.push(metrics.documentHeight);
      if(count>5)assert.ok(metrics.scrollHeight>metrics.height*2);
      const scrollBefore=await page.evaluate(()=>window.scrollY);
      await page.locator('.page-list-item').last().evaluate(button=>button.click());
      const selected=await page.locator('.page-list').evaluate(list=>{const a=list.getBoundingClientRect(),b=list.querySelector('.active').getBoundingClientRect();return {visible:b.top>=a.top-1&&b.bottom<=a.bottom+1,top:list.scrollTop};});
      assert.ok(selected.visible);if(count>5)assert.ok(selected.top>0);
      assert.equal(await page.evaluate(()=>window.scrollY),scrollBefore,'page selection must not scroll outer document');
    }
    assert.ok(Math.max(...heights)-Math.min(...heights)<80,`page count expanded document: ${heights}`);
    await page.locator('.project-meta > summary').click();assert.equal(await page.locator('[name="summary"]').isVisible(),true);
    clean(scenario);
  });
}

for(const {width,type,mode} of [{width:1366,type:'work',mode:'book'},{width:390,type:'fragment',mode:'document'},{width:768,type:'draft',mode:'document'},{width:1920,type:'work',mode:'document'}]){
  test(`Studio connects objects, moves live paths, edits and persists relationships at ${width}`,async t=>{
    const scenario=await harness.scenario(t,{viewport:{width,height:1000}});const {page,fixture}=scenario;
    await project(page,type,mode);
    await page.locator('.canvas-text-content').first().fill('Первое событие ведёт к следующему. '.repeat(6));
    await page.locator('#mediaUpload').setInputFiles('public/icons/icon-192.png');
    const image=page.locator('#freePageCanvas > .canvas-image-object').first();await image.click();
    const imageId=(await model(page)).canvas.objects.find(object=>object.type==='image').id;
    await toolbar(page).locator('[data-action="connection-start"]').click();
    assert.match(await page.locator('#connectionModeStatus').textContent(),/Выберите второй объект/);
    await page.locator('.canvas-text-content').first().click({position:{x:8,y:8}});
    let snapshot=await model(page);assert.equal(snapshot.canvas.connections.length,1);const id=snapshot.canvas.connections[0].id;
    assert.equal(snapshot.canvas.connections[0].fromObjectId,imageId);
    assert.equal(snapshot.canvas.connections[0].type,'cause');
    await image.click();await toolbar(page).locator('[data-action="connection-start"]').click();
    await page.locator('.canvas-text-content').first().click({position:{x:8,y:8}});
    assert.equal((await model(page)).canvas.connections.length,1);assert.match(await page.locator('#operationFeedback').textContent(),/уже существует/);
    await page.keyboard.press('Escape');
    const path=page.locator('#freePageCanvas .connection-line');const initialPath=await path.getAttribute('d');
    await image.scrollIntoViewIfNeeded();const rect=await image.boundingBox();
    await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();
    await page.mouse.move(rect.x+rect.width/2+35,rect.y+rect.height/2+45,{steps:5});
    assert.notEqual(await path.getAttribute('d'),initialPath,'line follows movement before pointerup');await page.mouse.up();
    await path.scrollIntoViewIfNeeded();
    const hit=await path.evaluate(element=>{const point=element.getPointAtLength(element.getTotalLength()/2),matrix=element.getScreenCTM();return {x:matrix.a*point.x+matrix.c*point.y+matrix.e,y:matrix.b*point.x+matrix.d*point.y+matrix.f};});
    const hitTarget=await page.evaluate(point=>{const target=document.elementFromPoint(point.x,point.y),object=target?.closest('.canvas-object');return {point,tag:target?.tagName,classes:target?.className,object:object?.dataset.objectId,bg:object?.dataset.bg,rect:object?.getBoundingClientRect().toJSON()};},hit);
    await page.mouse.click(hit.x,hit.y);
    assert.equal(await page.locator('#connectionLabel').isVisible(),true,JSON.stringify(hitTarget));
    await page.locator('.connection-list [data-action="connection-select"]').click();
    await page.locator('#connectionLabel').fill('привело к');await page.locator('#connectionLabel').press('Tab');
    await page.locator('#connectionType').selectOption('dependency');
    const from=(await model(page)).canvas.connections[0].fromObjectId;
    await page.locator('.connection-editor [data-action="connection-reverse"]').click();
    assert.notEqual((await model(page)).canvas.connections[0].fromObjectId,from);
    assert.equal((await model(page)).canvas.connections[0].label,'привело к');
    assert.match(await path.getAttribute('stroke-dasharray'),/9 6/);
    await page.locator('[data-action="editor-cmd"][data-cmd="undo"]').click();assert.equal((await model(page)).canvas.connections[0].fromObjectId,from);
    await page.locator('[data-action="editor-cmd"][data-cmd="redo"]').click();assert.notEqual((await model(page)).canvas.connections[0].fromObjectId,from);
    await saved(page);
    if(width===1366)await page.screenshot({path:'/tmp/fraktum-studio-connections.png',fullPage:true});
    const work=(await model(page)).work;
    const cloudContent=mode==='book'?fixture.tables.lit_work_versions[0].content:(type==='fragment'?fixture.tables.lit_fragments[0].content:fixture.tables.lit_work_versions[0].content);
    assert.equal((mode==='book'?cloudContent.bookPages[2]:cloudContent.documentPages[0]).canvas.connections[0].id,id);
    await page.reload();await page.waitForSelector('#freePageCanvas');
    assert.equal((await model(page)).canvas.connections[0].label,'привело к');
    if(mode==='book'){
      await page.locator('[data-action="studio-book-mode"][data-mode="book"]').click();
      assert.ok(await page.locator('.composition-preview .connection-line').count()>0);
      assert.equal(await page.locator('.composition-preview [data-action]').count(),0);
      await page.locator('.studio-mode-switch [data-action="studio-book-mode"][data-mode="edit"]').click();
    }
    await page.locator('.connection-list [data-action="connection-delete"]').click();assert.equal((await model(page)).canvas.connections.length,0);
    assert.ok((await model(page)).canvas.objects.some(object=>object.id===imageId));
    await page.locator('[data-cmd="undo"]').click();assert.equal((await model(page)).canvas.connections.length,1);
    await page.locator('#freePageCanvas > .canvas-image-object').first().click();
    await toolbar(page).locator('[data-action="canvas-delete"]').click();
    assert.equal((await model(page)).canvas.connections.length,0);assert.equal((await model(page)).selected,null);
    assert.ok(fixture.objects.size>0,'deleting placement must keep underlying asset');
    await page.locator('[data-cmd="undo"]').click();assert.equal((await model(page)).canvas.connections.length,1);
    await page.locator('[data-cmd="redo"]').click();await saved(page);await page.reload();await page.waitForSelector('#freePageCanvas');
    assert.equal((await model(page)).canvas.objects.some(object=>object.id===imageId),false);
    assert.equal((await model(page)).canvas.connections.length,0);assert.ok((await model(page)).work.mediaLibrary.length>0);
    assert.ok(work.id);clean(scenario);
  });
}

test('Studio connection cancellation, cards, duplicate prevention and page deletion safety',async t=>{
  const scenario=await harness.scenario(t);const {page}=scenario;await project(page);
  assert.equal(await page.locator('[data-action="launch-game"],.game-launch').count(),0);
  await page.locator('[data-action="canvas-add-card"]').click();await page.locator('.canvas-text-content').last().fill('Карточка доказательства');
  await toolbar(page).locator('[data-action="connection-start"]').click();await page.keyboard.press('Escape');
  assert.equal(await page.locator('#connectionModeStatus').textContent(),'');assert.equal((await model(page)).canvas.connections.length,0);
  await toolbar(page).locator('[data-action="connection-start"]').click();await page.locator('.canvas-text-content').last().click();
  assert.equal((await model(page)).canvas.connections.length,0);assert.match(await page.locator('#operationFeedback').textContent(),/другой объект/);
  await page.keyboard.press('Escape');
  const index=(await model(page)).index;
  await page.locator(`.page-delete[data-index="${index}"]`).click();await page.locator('.modal').waitFor();
  assert.equal((await model(page)).work.bookPages.length,3);
  await page.locator('.modal [data-action="close-modal"]').click();assert.equal((await model(page)).work.bookPages.length,3);
  await page.locator(`.page-delete[data-index="${index}"]`).click();await page.locator('[data-action="confirm-delete-studio-page"]').click();
  assert.equal((await model(page)).work.bookPages.length,2);assert.ok((await model(page)).index<2);
  assert.equal(await page.locator('.page-delete').count(),0);
  clean(scenario);
});

test('every rendered Studio action is registered and all controls have behavior or a visible unavailable state',async t=>{
  const scenario=await harness.scenario(t);const {page}=scenario;await project(page);
  const app=fs.readFileSync('src/app.js','utf8');
  const handled=new Set([...app.matchAll(/action==='([\w-]+)'/g)].map(match=>match[1]));
  const actions=await page.locator('.studio-v2 [data-action]').evaluateAll(elements=>[...new Set(elements.filter(element=>!element.disabled).map(element=>element.dataset.action))]);
  assert.deepEqual(actions.filter(action=>!handled.has(action)),[]);
  const empty=await page.locator('.studio-v2 button').evaluateAll(elements=>elements.filter(element=>!element.disabled&&!element.dataset.action).map(element=>element.outerHTML));assert.deepEqual(empty,[]);
  assert.doesNotMatch(await page.locator('.studio-v2').textContent(),/демо|prototype/);
  clean(scenario);
});

test('published reader, new version, project switches and closing evaluation retain structured connections',async t=>{
  const scenario=await harness.scenario(t);const {page,fixture}=scenario;await project(page);
  await page.locator('.canvas-text-content').first().fill('Текст произведения для публикации и оценки. '.repeat(12));
  await page.locator('.canvas-media-card [data-action="insert-canvas-media"]').first().click();
  await toolbar(page).locator('[data-action="connection-start"]').click();
  await page.locator('.canvas-text-content').first().click({position:{x:8,y:8}});
  await saved(page);const original=(await model(page)).work;
  await page.locator('.project-meta > summary').click();
  await page.locator('[name="summary"]').fill('Описание опубликованной книги со структурными связями.');
  await page.locator('.taxonomy-choices label[data-taxonomy-label="фэнтези"]').click();
  await page.locator('[data-action="open-publish-checklist"]').click();
  await page.locator('[data-action="confirm-publish-work"]').click();
  await page.locator('.save-state .status-pill.published').waitFor();
  assert.equal(fixture.tables.lit_work_versions[0].content.bookPages[2].canvas.connections.length,1);
  const readerId='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  fixture.tables.lit_profiles.push({...fixture.tables.lit_profiles[0],id:readerId,username:'other-reader',account_role:'reader',author_verified:false});
  const reader=await harness.scenario(t,{fixture:{...fixture,session:{...fixture.session,user:{...fixture.session.user,id:readerId}}},path:'/#/read'});
  await reader.page.locator('[data-action="start-reading"]').first().click();await reader.page.locator('[data-action="reader-book-next"]').first().click();
  const readerLine=reader.page.locator('.composition-reader .connection-line');
  await readerLine.waitFor({state:'attached'});
  const painted=await readerLine.evaluate(path=>{const bounds=path.closest('svg').getBoundingClientRect(),style=getComputedStyle(path);return {width:bounds.width,height:bounds.height,length:path.getTotalLength(),stroke:style.stroke,strokeWidth:parseFloat(style.strokeWidth)};});
  // A horizontal SVG path has a zero-height geometric bounding box. Check its
  // visible SVG viewport and painted stroke rather than HTML box visibility.
  assert.ok(painted.width>0&&painted.height>0&&painted.length>0&&painted.stroke!=='none'&&painted.strokeWidth>0,JSON.stringify(painted));
  assert.equal(await reader.page.locator('.composition-reader [data-action],.composition-reader .canvas-object-chrome').count(),0);
  clean(reader);
  await page.locator('[data-action="new-version"]').click();await saved(page);
  assert.equal(fixture.tables.lit_work_versions.length,2);
  assert.equal(fixture.tables.lit_work_versions[1].content.bookPages[2].canvas.connections.length,1);
  await page.locator('.page-list-item[data-index="2"]').click();
  await page.locator('[data-action="publish-evaluation"]').click();await page.locator('[data-action="close-evaluation"]').waitFor();
  const closed=page.waitForResponse(response=>response.url().includes('/lit_work_versions')&&response.request().method()==='PATCH'&&response.request().postDataJSON()?.evaluation_open===false);
  await page.locator('[data-action="close-evaluation"]').click();await closed;
  await page.locator('[data-action="close-evaluation"]').waitFor({state:'detached'});
  assert.equal((await model(page)).work.evaluationStatus,'closed');
  assert.equal(fixture.tables.lit_work_versions[1].evaluation_open,false);
  await page.locator('.studio-projects [data-action="new-work"]').click();
  await page.locator('[data-action="set-create-type"][data-type="draft"]').click();
  await page.locator('[data-action="start-create-project"]').click();
  await page.locator(`.studio-projects [data-action="studio-select"][data-id="${original.id}"]`).click();
  await page.locator('.page-list-item[data-index="2"]').click();assert.equal((await model(page)).canvas.connections.length,1);
  await page.reload();await page.waitForSelector('#freePageCanvas');assert.equal((await model(page)).canvas.connections.length,1);
  clean(scenario);
});

test('Studio formatting uses editor history and visible delete handles text, notes and cards',async t=>{
  const scenario=await harness.scenario(t);const {page}=scenario;await project(page,'draft','document');
  const text=page.locator('.canvas-text-content').first();await text.fill('Текст с форматированием');await text.click();await page.keyboard.press('Control+a');
  await page.locator('[data-cmd="bold"]').click();
  assert.match((await model(page)).canvas.objects[0].html,/font-weight:\s*(bold|700)|<b>|<strong>/);
  await page.locator('[data-editor-tool="fontSize"]').selectOption('24');
  assert.match((await model(page)).canvas.objects[0].html,/font-size:\s*24px/);
  await saved(page);await page.reload();await page.waitForSelector('#freePageCanvas');
  assert.match((await model(page)).canvas.objects[0].html,/font-size:\s*24px/);
  for(const kind of ['text','note','card']){
    await page.locator(`[data-action="canvas-add-${kind}"]`).click();
    const selected=(await model(page)).selected;assert.ok(selected);
    await toolbar(page).locator('[data-action="canvas-delete"]').click();assert.equal((await model(page)).canvas.objects.some(object=>object.id===selected),false);
    await page.locator('[data-cmd="undo"]').click();assert.equal((await model(page)).canvas.objects.some(object=>object.id===selected),true);
    await page.locator('[data-cmd="redo"]').click();assert.equal((await model(page)).canvas.objects.some(object=>object.id===selected),false);
  }
  clean(scenario);
});
