import {hasLegacyRecovery,preserveLegacyImage} from './LegacyMediaRecovery.js';
import {normalizeConnections} from './ConnectionModel.js';
/** One durable image model shared by every editor and reader surface. */
export const PAGE_WIDTH=760;
export const PAGE_HEIGHT=1080;
const finite=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

export function durableImageUrl(value){
  const url=String(value||'').trim();
  return /^(https?:\/\/|\/(?!\/))/i.test(url)?url:'';
}

export function normalizeMediaObject(input={},pageId='',bounds={}){
  const pageWidth=bounds.width||PAGE_WIDTH,pageHeight=bounds.height||PAGE_HEIGHT;
  const width=clamp(finite(input.width??input.w,280),40,pageWidth);
  const height=clamp(finite(input.height??input.h,220),40,pageHeight);
  const layoutMode=input.layoutMode==='flow'?'flow':'free';
  const legacyWrap=input.wrap==='none'?'none':input.wrap==='auto'?'around':input.wrap;
  const wrapMode=['left','right','center','full','none','around'].includes(input.wrapMode||legacyWrap)?(input.wrapMode||legacyWrap):'around';
  let x=clamp(finite(input.x,72),0,pageWidth-width),y=clamp(finite(input.y,72),0,pageHeight-height);
  let mediaWidth=width;
  if(layoutMode==='flow'){
    if(wrapMode==='left')x=72;
    if(wrapMode==='right')x=pageWidth-72-width;
    if(wrapMode==='center')x=(pageWidth-width)/2;
    if(wrapMode==='full'){x=72;mediaWidth=pageWidth-144;}
    x=clamp(x,0,pageWidth-mediaWidth);
  }
  const zIndex=Math.max(1,finite(input.zIndex??input.z,2));
  const assetPath=String(input.assetPath||input.storagePath||'');
  const legacyMediaKey=input.legacyMediaKey||preserveLegacyImage(input.url||input.src);
  const storageRoot=String(globalThis.__FRAKTUM_CONFIG__?.VITE_SUPABASE_URL||'').trim().replace(/\/$/,'');
  const resolvedPath=assetPath&&storageRoot?`${storageRoot}/storage/v1/object/public/lit-work-assets/${assetPath.split('/').map(encodeURIComponent).join('/')}`:'';
  const url=durableImageUrl(input.url||input.src)||durableImageUrl(resolvedPath);
  return {...input,...(legacyMediaKey?{legacyMediaKey}:{}),id:input.id||crypto.randomUUID(),type:'image',assetId:input.assetId||'',assetPath,storagePath:assetPath,url,src:url,pageId,x,y,width:mediaWidth,height,zIndex,layoutMode,wrapMode,alt:String(input.alt||''),caption:String(input.caption||''),
    // Legacy geometry is an adapter for the existing canvas shell, never HTML.
    w:mediaWidth,h:height,z:zIndex,wrap:wrapMode==='none'?'none':'auto',rotation:finite(input.rotation,0),fit:input.fit==='contain'?'contain':'cover',locked:!!input.locked,gap:clamp(finite(input.gap,14),0,60)};
}

/** Extract old figure/image markup once; future saves contain text + objects. */
export function migrateEmbeddedImages(html,pageId){
  if(!globalThis.document)return {html:String(html||'<p><br></p>'),images:[]};
  const template=document.createElement('template');template.innerHTML=String(html||'<p><br></p>');
  const images=[];
  for(const img of [...template.content.querySelectorAll('img')]){
    const figure=img.closest('figure');
    const alignment=figure?.classList.contains('wrap-left')?'left':figure?.classList.contains('wrap-right')?'right':figure?.classList.contains('wrap-wide')?'full':'center';
    const percent=parseFloat(figure?.style.width||'45');
    images.push(normalizeMediaObject({src:img.getAttribute('src'),alt:img.getAttribute('alt'),caption:figure?.querySelector('figcaption')?.textContent||'',layoutMode:'flow',wrapMode:alignment,width:PAGE_WIDTH*clamp(percent,10,100)/100,y:72+images.length*230},pageId));
    if(figure)figure.remove();else img.remove();
  }
  return {html:template.innerHTML||'<p><br></p>',images};
}

export function normalizePageMedia(page){
  if(page.image){const key=preserveLegacyImage(page.image);if(key){page.canvas??={background:{},objects:[]};page.canvas.background??={};page.canvas.background.backgroundRecoveryKey=key;}page.image=durableImageUrl(page.image);}
  if(!page.canvas){
    const migrated=migrateEmbeddedImages(page.html,page.id);
    page.canvas={background:{color:'#f7f1e5',image:'',fit:'cover'},textColor:'#191715',objects:[{id:`body-${page.id}`,type:'text',role:'body',x:72,y:72,w:616,h:936,z:1,rotation:0,html:migrated.html,flow:true,locked:false,style:{fontFamily:'Georgia',fontSize:18,lineHeight:1.55,padding:6}},...migrated.images]};
  }
  const migratedImages=[];
  page.canvas.objects=(page.canvas.objects||[]).map(object=>{
    if(object.type==='image')return normalizeMediaObject(object,page.id);
    if(/<img\b/i.test(object.html||'')){
      const migrated=migrateEmbeddedImages(object.html,page.id);object.html=migrated.html;migratedImages.push(...migrated.images);
    }
    return object;
  });
  page.canvas.objects.push(...migratedImages);
  page.canvas.connections=normalizeConnections(page.canvas.connections,page.canvas.objects);
  page.html=page.canvas.objects.filter(object=>object.type==='text').map(object=>object.html||'').join('');
  if(page.canvas.background?.image){const key=preserveLegacyImage(page.canvas.background.image);if(key)page.canvas.background.backgroundRecoveryKey=key;page.canvas.background.image=durableImageUrl(page.canvas.background.image);}
  return page;
}

export function workPages(work){
  const key=work.editorMode==='book'?'bookPages':'documentPages';
  if(!work[key]?.length){
    const text=String(work.content||'').replace(/[&<>]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[char]));
    work[key]=[{id:`page-${work.id||crypto.randomUUID()}`,type:'content',html:`<p>${text.replaceAll('\n','<br>')}</p>`}];
  }
  work[key]=(work[key]||[]).map(normalizePageMedia);
  return work[key];
}

export function serializeWorkContent(work){
  if(hasLegacyRecovery(work))throw new Error('Сначала восстановите старые изображения в облако. Исходный снимок на устройстве сохранён.');
  const content={creationType:work.creationType||'work',editorMode:work.editorMode||'document',documentPages:(work.documentPages||[]).map(normalizePageMedia),bookPages:(work.bookPages||[]).map(normalizePageMedia),mediaLibrary:work.mediaLibrary||[],localVersion:work.version||'1'};
  if(hasLegacyRecovery(content))throw new Error('Сначала восстановите старые изображения в облако. Исходный снимок на устройстве сохранён.');
  return content;
}
