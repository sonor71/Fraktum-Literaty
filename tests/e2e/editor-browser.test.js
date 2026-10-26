import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createBrowserHarness,USER_ID} from './browser-harness.js';

let harness;
before(async()=>{harness=await createBrowserHarness();});
after(async()=>{await harness?.close();});

async function newProject(page,type='work',mode='document'){
  await page.locator('.menu-toggle').click();
  await page.locator('[data-action="navigate"][data-page="create"]').first().click();
  await page.locator('.studio-projects [data-action="new-work"]').click();
  await page.locator(`[data-action="set-create-type"][data-type="${type}"]`).click();
  await page.locator(`[data-action="start-create-project"][data-mode="${mode}"]`).click();
  await page.waitForSelector('#freePageCanvas');
  if(mode==='book')await page.locator('[data-action="book-page-select"][data-index="2"]').click();
}

async function imageModel(page){
  return page.evaluate(async()=>{
    const {state}=await import('/src/state.js');
    const work=state.works.find(work=>work.id===document.querySelector('#workEditor').dataset.id);
    const pages=work.editorMode==='book'?work.bookPages:work.documentPages;
    return pages[state.ui.bookPageIndex||0].canvas.objects.find(object=>object.type==='image');
  });
}

for(const {type,mode,width} of [{type:'work',mode:'document',width:1366},{type:'draft',mode:'document',width:360},{type:'fragment',mode:'document',width:390},{type:'work',mode:'book',width:430}]){
  test(`browser: ${type}/${mode} uploads, wraps, moves, resizes and restores durable media`,async t=>{
    const {page,fixture,errors}=await harness.scenario(t,{viewport:{width,height:900}});
    await newProject(page,type,mode);
    await page.locator('.canvas-text-content').first().fill('Текст страницы. '.repeat(40));
    await page.locator('#mediaUpload').setInputFiles('public/icons/icon-192.png');
    const image=page.locator('#freePageCanvas > .canvas-image-object').first();
    await image.waitFor();
    const initial=await imageModel(page);
    assert.ok(initial.assetPath.startsWith('11111111-1111-4111-8111-111111111111/'));
    assert.match(initial.url,/^https:\/\/e2e\.supabase\.co\/storage\/v1\/object\/public\/lit-work-assets\//);
    assert.ok(initial.pageId);assert.equal(initial.width,280);
    assert.equal(fixture.objects.size,1);
    await image.click();
    await page.locator('#canvasImageLayout').selectOption('flow');
    await page.locator('#canvasImageWrap').selectOption('left');
    assert.equal((await imageModel(page)).x,72);
    assert.ok(await page.locator('.canvas-wrap-proxy').count()>0);
    await page.locator('#canvasImageWrap').selectOption('right');
    assert.equal((await imageModel(page)).x,408);
    await page.locator('#canvasImageLayout').selectOption('free');
    await image.scrollIntoViewIfNeeded();
    let rect=await image.boundingBox();
    await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();
    await page.mouse.move(rect.x+rect.width/2-60,rect.y+rect.height/2+70,{steps:6});await page.mouse.up();
    const moved=await imageModel(page);assert.equal(moved.layoutMode,'free');assert.notEqual(moved.y,initial.y);
    await page.locator('#canvasObjectKind').click();
    await page.keyboard.press('Control+z');assert.equal((await imageModel(page)).y,initial.y);
    await page.keyboard.press('Control+Shift+z');assert.equal((await imageModel(page)).y,moved.y);
    await image.scrollIntoViewIfNeeded();
    const handle=image.locator('.handle-se');rect=await handle.boundingBox();
    await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();
    await page.mouse.move(rect.x+rect.width/2+35,rect.y+rect.height/2+35,{steps:5});await page.mouse.up();
    const resized=await imageModel(page);assert.notEqual(resized.width,initial.width);
    assert.ok(resized.x>=0&&resized.y>=0&&resized.x+resized.width<=760&&resized.y+resized.height<=1080);
    await page.locator('#canvasImageCaption').fill('Сохранённая подпись');await page.locator('#canvasImageCaption').press('Tab');
    await page.waitForFunction(()=>document.querySelector('.word-status span:last-child')?.textContent==='Сохранено в облаке');
    const saved=await imageModel(page);
    const record=type==='fragment'?fixture.tables.lit_fragments[0]:fixture.tables.lit_work_versions[0];
    assert.ok(record);assert.equal(JSON.stringify(record.content).includes('data:image'),false);
    const contentPages=mode==='book'?record.content.bookPages:record.content.documentPages;
    assert.equal(contentPages.flatMap(page=>page.canvas.objects).find(object=>object.type==='image').assetPath,saved.assetPath);
    assert.equal(type==='fragment'?fixture.tables.lit_fragments.length:fixture.tables.lit_works.length,1);
    await page.reload();
    await page.locator('.menu-toggle').click();
    await page.locator('[data-action="navigate"][data-page="create"]').first().click();
    await page.waitForSelector('#freePageCanvas > .canvas-image-object');
    const restored=await imageModel(page);
    assert.equal(restored.assetPath,saved.assetPath);assert.equal(restored.width,saved.width);assert.equal(restored.y,saved.y);assert.equal(restored.caption,'Сохранённая подпись');
    await page.locator('#freePageCanvas > .canvas-image-object').click();
    await page.locator('[data-action="canvas-duplicate"]').click();
    assert.equal(await page.locator('#freePageCanvas > .canvas-image-object').count(),2);
    await page.locator('[data-action="canvas-delete"]').click();
    assert.equal(await page.locator('#freePageCanvas > .canvas-image-object').count(),1);
    const other=await harness.scenario(t,{fixture});
    await other.page.locator('.menu-toggle').click();
    await other.page.locator('[data-action="navigate"][data-page="create"]').click();
    if(mode==='book')await other.page.locator('[data-action="book-page-select"][data-index="2"]').click();
    await other.page.waitForSelector('#freePageCanvas > .canvas-image-object');
    assert.equal((await imageModel(other.page)).assetPath,saved.assetPath);
    assert.deepEqual(other.errors,[]);
    assert.deepEqual(errors,[]);assert.deepEqual(fixture.failures,[]);
  });
}

test('browser: failed editor image renders an actionable error instead of filename rectangle',async t=>{
  const {page,errors,fixture}=await harness.scenario(t);
  await page.route('**/assets/home/seventh-horizon.png',route=>route.fulfill({status:404,body:''}));
  await newProject(page);
  await page.locator('[data-action="insert-canvas-media"]').first().click();
  await page.waitForSelector('.canvas-image-object > .media-load-error');
  assert.match(await page.locator('.canvas-image-object > .media-load-error').textContent(),/Загрузите его повторно/);
  assert.deepEqual(fixture.failures,[]);
  // The intentionally rejected image request is the only expected console error.
  assert.equal(errors.filter(message=>!message.includes('404')).length,0);
});

test('browser: legacy HTML figure keeps its original snapshot until image recovery succeeds',async t=>{
  const {page,fixture,errors}=await harness.scenario(t);
  const source=`data:image/png;base64,${fs.readFileSync('public/icons/icon-192.png').toString('base64')}`;
  const snapshot=JSON.stringify({works:[{id:'legacy-work',authorId:USER_ID,title:'Старый черновик',editorMode:'document',creationType:'draft',status:'draft',publicationStatus:'draft',content:'Старый текст',documentPages:[{id:'legacy-page',html:`<p>Старый текст</p><figure class="embedded-media wrap-left" style="width:40%"><img src="${source}" alt="Старое фото"><figcaption>Старая подпись</figcaption></figure>`}],mediaLibrary:[]}],ui:{page:'create',selectedStudioWorkId:'legacy-work'}});
  await page.evaluate(snapshot=>localStorage.setItem('d20-platform-v4',snapshot),snapshot);
  await page.reload();
  await page.locator('.menu-toggle').click();
  await page.locator('[data-action="navigate"][data-page="create"]').click();
  await page.waitForSelector('.legacy-media-warning');
  assert.equal(await page.evaluate(()=>localStorage.getItem('d20-platform-v4')),snapshot);
  const image=await imageModel(page);assert.equal(image.caption,'Старая подпись');assert.equal(image.layoutMode,'flow');assert.equal(image.wrapMode,'left');
  await page.locator('.canvas-text-content').fill('Правки до восстановления');
  await page.waitForFunction(()=>document.querySelector('.word-status span:last-child')?.textContent.includes('Сохранение приостановлено'));
  assert.equal(await page.evaluate(()=>localStorage.getItem('d20-platform-v4')),snapshot);
  await page.locator('[data-action="restore-legacy-media"]').click();
  await page.waitForSelector('.legacy-media-warning',{state:'detached'});
  await page.waitForFunction(()=>document.querySelector('.word-status span:last-child')?.textContent==='Сохранено в облаке');
  const restored=await imageModel(page);
  assert.ok(restored.assetPath);assert.equal(restored.caption,'Старая подпись');assert.equal(restored.legacyMediaKey,undefined);
  assert.equal((await page.evaluate(()=>localStorage.getItem('d20-platform-v4'))).includes('data:image'),false);
  assert.equal(fixture.objects.size,1);assert.deepEqual(errors,[]);assert.deepEqual(fixture.failures,[]);
});

test('browser: clipboard file uploads to Storage; pasted HTML cannot persist inline images',async t=>{
  const {page,fixture,errors}=await harness.scenario(t);
  await newProject(page);
  const bytes=[...fs.readFileSync('public/icons/icon-192.png')];
  await page.locator('.canvas-text-content').focus();
  await page.evaluate(bytes=>{
    const data=new globalThis.DataTransfer();data.items.add(new File([new Uint8Array(bytes)],'clipboard.png',{type:'image/png'}));
    document.querySelector('.canvas-text-content').dispatchEvent(new globalThis.ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
  },bytes);
  await page.waitForSelector('#freePageCanvas > .canvas-image-object');
  assert.equal(fixture.objects.size,1);assert.ok((await imageModel(page)).assetPath);
  await page.locator('.canvas-text-content').focus();
  await page.evaluate(()=>{
    const content=document.querySelector('.canvas-text-content'),range=document.createRange();range.selectNodeContents(content);range.collapse(false);window.getSelection().removeAllRanges();window.getSelection().addRange(range);
    const data=new globalThis.DataTransfer();data.setData('text/html','<p>Текст из буфера</p><img src="data:image/png;base64,AAAA">');
    content.dispatchEvent(new globalThis.ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
  });
  assert.equal(await page.locator('.canvas-text-content img').count(),0);
  assert.match(await page.locator('#operationFeedback').textContent(),/Изображения вставляйте файлом/);
  await page.waitForFunction(()=>document.querySelector('.word-status span:last-child')?.textContent==='Сохранено в облаке');
  assert.equal(JSON.stringify(fixture.tables.lit_work_versions[0].content).includes('data:image'),false);
  assert.deepEqual(errors,[]);assert.deepEqual(fixture.failures,[]);
});

test('browser: title, summary and taxonomy survive immediate menu rendering and navigation',async t=>{
  const {page,fixture,errors}=await harness.scenario(t,{viewport:{width:390,height:900}});
  await newProject(page,'draft');
  await page.locator('.project-meta > summary').click();
  await page.locator('#workEditor [name="title"]').fill('Название после правки');
  await page.locator('#workEditor [name="summary"]').fill('Описание, которое нельзя потерять при открытии меню.');
  await page.locator('#workEditor .taxonomy-choices label[data-taxonomy-label="фэнтези"]').click();
  await page.locator('.menu-toggle').click();
  await page.locator('[data-action="navigate"][data-page="home"]').click();
  await page.locator('.menu-toggle').click();
  await page.locator('[data-action="navigate"][data-page="create"]').click();
  assert.equal(await page.locator('#workEditor [name="title"]').inputValue(),'Название после правки');
  assert.equal(await page.locator('#workEditor [name="summary"]').inputValue(),'Описание, которое нельзя потерять при открытии меню.');
  assert.equal(await page.locator('#workEditor input[name="genres"][value="Фэнтези"]').isChecked(),true);
  for(let attempt=0;attempt<100&&!fixture.tables.lit_work_versions.length;attempt++)await new Promise(resolve=>setTimeout(resolve,50));
  assert.ok(fixture.tables.lit_work_versions.length);
  assert.equal(fixture.tables.lit_works[0].title,'Название после правки');
  assert.equal(fixture.tables.lit_works[0].summary,'Описание, которое нельзя потерять при открытии меню.');
  assert.deepEqual(fixture.tables.lit_works[0].genres,['Фэнтези']);
  assert.deepEqual(errors,[]);assert.deepEqual(fixture.failures,[]);
});
