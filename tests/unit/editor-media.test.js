import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMediaObject,normalizePageMedia,serializeWorkContent,workPages} from '../../src/editor/MediaModel.js';
import {createEditorRoot} from '../../src/editor/EditorRoot.js';
import {createSaveQueue} from '../../src/editor/SaveQueue.js';
import {hasLegacyRecovery,legacyImageFile,replaceLegacyReferences} from '../../src/editor/LegacyMediaRecovery.js';

test('legacy canvas image metadata and geometry survive normalization and reload',()=>{
  const legacy={id:'photo',src:'https://assets.test/photo.webp',storagePath:'user/work/photo.webp',assetId:'asset',x:81,y:92,w:240,h:180,z:4,rotation:10,alt:'Фото',caption:'Подпись'};
  const normalized=normalizeMediaObject(legacy,'page-1');
  assert.equal(normalized.assetPath,legacy.storagePath);assert.equal(normalized.assetId,'asset');
  assert.equal(normalized.pageId,'page-1');assert.equal(normalized.width,240);assert.equal(normalized.zIndex,4);
  assert.deepEqual(normalizeMediaObject(JSON.parse(JSON.stringify(normalized)),'page-1'),normalized);
});

test('document, fragment, draft and book persist the same structured media object',()=>{
  for(const creationType of ['work','fragment','draft'])for(const editorMode of ['document','book']){
    const page={id:'page',html:'<p>Текст</p>'};normalizePageMedia(page);
    page.canvas.objects.push(normalizeMediaObject({id:'photo',url:'/assets/photo.png',assetPath:'user/photo.png',layoutMode:'free',x:100,y:150,width:280,height:220},page.id));
    const key=editorMode==='book'?'bookPages':'documentPages';
    const work={creationType,editorMode,[key]:[page]};
    const reloaded=JSON.parse(JSON.stringify(serializeWorkContent(work)));
    assert.deepEqual(workPages(reloaded)[0].canvas.objects[1],page.canvas.objects[1]);
    assert.equal(reloaded[key][0].canvas.objects[0].html,'<p>Текст</p>');
  }
});

test('free media clamps position and dimensions inside the sheet',()=>{
  const media=normalizeMediaObject({id:'photo',url:'/photo.png',x:-50,y:2000,width:2000,height:2000},'page');
  assert.equal(media.x,0);assert.equal(media.y,0);assert.equal(media.width,760);assert.equal(media.height,1080);
});

test('flow alignment changes geometry while preserving media identity and storage path',()=>{
  for(const wrapMode of ['left','right','center','full']){
    const image=normalizeMediaObject({id:'image',assetPath:'user/work/photo.png',url:'/photo.png',layoutMode:'flow',wrapMode,width:200,height:200},'page');
    assert.equal(image.id,'image');assert.equal(image.assetPath,'user/work/photo.png');
    assert.ok(image.x>=0&&image.x+image.width<=760);
    if(wrapMode==='left')assert.equal(image.x,72);
    if(wrapMode==='right')assert.equal(image.x,488);
    if(wrapMode==='center')assert.equal(image.x,280);
    if(wrapMode==='full')assert.equal(image.width,616);
  }
});

test('persistent media never accepts transient binary/blob/script URLs',()=>{
  for(const url of ['data:image/png;base64,AAAA','blob:https://site.test/uuid','javascript:alert(1)','//untrusted.test/x'])assert.equal(normalizeMediaObject({url},'page').url,'');
});

test('history cannot apply an undo snapshot to another page',()=>{
  let page='page-a',snapshot={x:10};
  const editor=createEditorRoot({readContext:()=>page,readSnapshot:()=>snapshot,applySnapshot:value=>{snapshot=value;}});
  editor.record('move',()=>{snapshot={x:20};});
  page='page-b';snapshot={x:80};
  assert.equal(editor.undo(),false);assert.deepEqual(snapshot,{x:80});
});

test('cloud saves serialize creation before updates and retain caller errors',async()=>{
  const save=createSaveQueue(),events=[];let release;
  const first=save(async()=>{events.push('create');await new Promise(resolve=>{release=resolve;});events.push('created');});
  const second=save(async()=>{events.push('update');throw new Error('Storage denied');});
  const rejected=assert.rejects(second,/Storage denied/);
  await Promise.resolve();assert.deepEqual(events,['create']);release();
  await first;await rejected;assert.deepEqual(events,['create','created','update']);
  await save(async()=>{events.push('retry');});assert.equal(events.at(-1),'retry');
});

test('legacy embedded binary is recoverable and blocks persistence until Storage upload',async()=>{
  const image=normalizeMediaObject({src:'data:image/png;base64,iVBORw0KGgo=',id:'legacy'},'page');
  const work={documentPages:[{id:'page',canvas:{objects:[image]}}]};
  assert.equal(image.url,'');assert.ok(image.legacyMediaKey);assert.equal(hasLegacyRecovery(work),true);
  assert.equal(JSON.stringify(work).includes('data:image'),false);
  assert.throws(()=>serializeWorkContent(work),/восстановите старые изображения/);
  const file=await legacyImageFile(image.legacyMediaKey);assert.equal(file.type,'image/png');assert.equal(file.size,8);
  replaceLegacyReferences(work,image.legacyMediaKey,{assetId:'asset',storagePath:'user/work/photo.png',url:'https://assets.test/photo.png'});
  assert.equal(hasLegacyRecovery(work),false);assert.equal(serializeWorkContent(work).documentPages[0].canvas.objects[0].assetPath,'user/work/photo.png');
});

test('path-only image resolves through the current public Storage URL after reload',()=>{
  const original=globalThis.__FRAKTUM_CONFIG__;
  globalThis.__FRAKTUM_CONFIG__={VITE_SUPABASE_URL:'https://project.supabase.co/'};
  try{assert.equal(normalizeMediaObject({assetPath:'user/work/photo name.png'},'page').url,'https://project.supabase.co/storage/v1/object/public/lit-work-assets/user/work/photo%20name.png');}
  finally{globalThis.__FRAKTUM_CONFIG__=original;}
});
