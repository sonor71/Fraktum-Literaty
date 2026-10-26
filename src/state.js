import {durableImageUrl,normalizeMediaObject,normalizePageMedia} from './editor/MediaModel.js';
import {hasLegacyRecovery,preserveLegacyImage} from './editor/LegacyMediaRecovery.js';
import {assertPersistableDocument} from './editor/Serialization.js';
const KEY='d20-platform-v4';

function textToHtml(text){
  return String(text||'').split(/\n\n+/).map(p=>`<p>${p.replace(/[&<>]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[ch]))}</p>`).join('') || '<p><br></p>';
}
const CANVAS_W=760;
const CANVAS_H=1080;
function textObject(id,html,x=72,y=80,w=616,h=880,extra={}){
  return {id,type:'text',x,y,w,h,z:1,rotation:0,html:html||'<p><br></p>',flow:true,locked:false,style:{fontFamily:'Georgia',fontSize:18,lineHeight:1.55,color:null,align:'left',background:'transparent',padding:6,...(extra.style||{})},...extra};
}
function canvasForLegacyPage(page,work,index){
  const p=page||{}; const now=work.id||Date.now();
  if(p.canvas&&Array.isArray(p.canvas.objects)){
    return {
      background:{color:'#f7f1e5',image:'',fit:'cover',position:'center',...(p.canvas.background||{})},
      textColor:p.canvas.textColor||'#191715',
      connections:p.canvas.connections||[],
      objects:p.canvas.objects.map((o,i)=>({
        id:o.id||`obj-${now}-${index}-${i}`,
        type:o.type==='image'?'image':'text',
        x:Number.isFinite(Number(o.x))?Number(o.x):70,
        y:Number.isFinite(Number(o.y))?Number(o.y):80,
        w:Number.isFinite(Number(o.w))?Number(o.w):(o.type==='image'?260:620),
        h:Number.isFinite(Number(o.h))?Number(o.h):(o.type==='image'?220:860),
        z:Number.isFinite(Number(o.z))?Number(o.z):i+1,
        rotation:Number(o.rotation)||0,
        locked:!!o.locked,
        ...(o.type==='image'?normalizeMediaObject(o,p.id):{html:o.html||'<p><br></p>',flow:o.flow!==false,role:o.role||'',style:{fontFamily:'Georgia',fontSize:18,lineHeight:1.55,color:null,align:'left',background:'transparent',padding:6,...(o.style||{})}})
      }))
    };
  }
  if(p.type==='cover'){
    return {background:{color:'#101d2d',image:p.image||work.cover||'',fit:'cover',position:'center'},textColor:'#ffffff',objects:[
      textObject(`cover-title-${now}`,`<div>${p.title||work.title||''}</div>`,72,150,616,210,{role:'title',flow:false,z:3,style:{fontFamily:'Georgia',fontSize:54,lineHeight:1.05,color:'#ffffff',align:'center',background:'transparent',padding:8}}),
      textObject(`cover-sub-${now}`,`<div>${p.subtitle||''}</div>`,118,390,524,100,{role:'subtitle',flow:false,z:3,style:{fontFamily:'Georgia',fontSize:22,lineHeight:1.25,color:'#ffffff',align:'center',background:'transparent',padding:6}}),
      textObject(`cover-author-${now}`,`<div>${p.author||work.author||''}</div>`,150,830,460,90,{role:'author',flow:false,z:3,style:{fontFamily:'Georgia',fontSize:20,lineHeight:1.25,color:'#ffffff',align:'center',background:'transparent',padding:6}})
    ]};
  }
  if(p.type==='title'){
    return {background:{color:'#f7f1e5',image:'',fit:'cover',position:'center'},textColor:'#191715',objects:[
      textObject(`title-main-${now}`,`<div>${p.title||work.title||''}</div>`,90,170,580,180,{role:'title',flow:false,z:2,style:{fontFamily:'Georgia',fontSize:42,lineHeight:1.08,color:'#191715',align:'center',background:'transparent',padding:8}}),
      textObject(`title-sub-${now}`,`<div>${p.subtitle||''}</div>`,130,370,500,120,{role:'subtitle',flow:false,z:2,style:{fontFamily:'Georgia',fontSize:22,lineHeight:1.3,color:'#342f2b',align:'center',background:'transparent',padding:6}}),
      textObject(`title-author-${now}`,`<div>${p.author||work.author||''}</div>`,150,630,460,90,{role:'author',flow:false,z:2,style:{fontFamily:'Georgia',fontSize:21,lineHeight:1.3,color:'#191715',align:'center',background:'transparent',padding:6}}),
      textObject(`title-year-${now}`,`<div>${p.year||String(new Date().getFullYear())}</div>`,260,920,240,70,{role:'year',flow:false,z:2,style:{fontFamily:'Georgia',fontSize:16,lineHeight:1.2,color:'#514a43',align:'center',background:'transparent',padding:4}})
    ]};
  }
  return {background:{color:'#f7f1e5',image:'',fit:'cover',position:'center'},textColor:'#191715',objects:[textObject(`flow-${now}-${index}`,p.html||textToHtml(work.content||''),72,72,616,936,{role:'body',flow:true,z:1})]};
}
function normalizeWork(work){
  const w={...work};
  const coverRecoveryKey=preserveLegacyImage(w.cover);if(coverRecoveryKey){w.coverRecoveryKey=coverRecoveryKey;w.cover='';}
  if(!w.publicationStatus) w.publicationStatus=w.status==='draft'?'draft':'published';
  if(!w.evaluationStatus) w.evaluationStatus=w.status==='evaluation'?'open':'closed';
  if(!w.targetType) w.targetType=w.evaluationTarget==='Весь текст'?'Всё произведение':'Фрагмент';
  if(!w.evaluationText) w.evaluationText='';
  if(!w.creationType) w.creationType='work';
  if(!w.editorMode) w.editorMode='document';
  if(!Array.isArray(w.documentPages)||!w.documentPages.length) w.documentPages=[{id:'doc-'+(w.id||Date.now())+'-1',html:textToHtml(w.content||'')}];
  if(!Array.isArray(w.bookPages)||!w.bookPages.length){
    w.bookPages=[
      {id:'cover-'+(w.id||Date.now()),type:'cover',title:w.title||'',subtitle:'',image:w.cover||''},
      {id:'title-'+(w.id||Date.now()),type:'title',title:w.title||'',author:w.author||'',subtitle:'',year:String(new Date().getFullYear())},
      {id:'page-'+(w.id||Date.now())+'-1',type:'content',html:textToHtml(w.content||'')}
    ];
  }
  w.bookPages=w.bookPages.map((p,i)=>normalizePageMedia({...p,canvas:canvasForLegacyPage(p,w,i)}));
  w.documentPages=w.documentPages.map(normalizePageMedia);
  if(!Array.isArray(w.mediaLibrary)) w.mediaLibrary=[];
  w.mediaLibrary=w.mediaLibrary.map(asset=>{const legacyMediaKey=preserveLegacyImage(asset.url||asset.src);return legacyMediaKey?{...asset,legacyMediaKey,url:'',src:''}:{...asset,url:durableImageUrl(asset.url||asset.src),src:durableImageUrl(asset.url||asset.src)};});
  if(w.evaluationStatus==='open') w.status='evaluation';
  else w.status=w.publicationStatus==='published'?'published':'draft';
  return w;
}

function baseState(){
  return {
    user:null,
    cloud:{serverOnline:false,connected:false,lastSync:null,error:null},
    catalogs:{genres:[],topics:[],formats:[],audiences:[],tags:[]},
    migrations:{},
    works:[],
    posts:[],
    postComments:[],
    reviews:[],
    library:{later:[],reading:[],completed:[]},
    readingProgress:{},
    annotations:{},
    communities:[],
    joinedCommunities:[],
    messages:[],
    peopleDirectory:[],
    friends:[],
    chatThreads:[],
    callHistory:[],
    activeCall:null,
    notifications:[
      {id:'local-welcome',kind:'system',title:'Добро пожаловать во FRAKTUM',body:'Заполните профиль и выберите интересы — так рекомендации станут точнее.',created_at:new Date().toISOString(),read_at:null}
    ],
    moderationReports:[],
    verificationRequests:[],
    privateNotes:'',
    ui:{
      page:'home',sidebarOpen:false,profileTab:'overview',selectedWorkId:null,selectedCommunityId:null,selectedStudioWorkId:null,
      modal:null,toast:null,selectedQuote:'',chatPanelOpen:false,chatTab:'chats',selectedChatId:'dm-elara',evaluationWorkId:null,evaluationMode:null,
      evaluationFilters:{genres:[],kinds:[],length:'any'},
      readFilters:{query:'',genre:'',length:''},
      createDraftType:null,bookPageIndex:0,bookViewMode:false,bookSpreadIndex:0,readerBookIndex:0,studioGrid:false,canvasSelectedObjectId:null
    },evaluationSession:null,evaluationCatalog:[],authorFeedback:[]
  };
}

export function loadState(){
  try{
    const raw=localStorage.getItem(KEY);
    if(!raw) return baseState();
    const saved=JSON.parse(raw);
    const base=baseState();
    const seedWorkIds=new Set(['w-artificial','w-horizon','w-river','w-clock','w-snow']);
    const works=(Array.isArray(saved.works)?saved.works:[]).filter(work=>!seedWorkIds.has(work.id)).map(normalizeWork);
    const posts=(Array.isArray(saved.posts)?saved.posts:[]).filter(post=>post.cloud);
    const postComments=(Array.isArray(saved.postComments)?saved.postComments:[]).filter(comment=>comment.cloud);
    const seedCommunityIds=new Set(['c1','c2','c3','c4']);
    saved.communities=(saved.communities||[]).filter(item=>!seedCommunityIds.has(item.id));
    saved.reviews=(saved.reviews||[]).filter(review=>!String(review.id).startsWith('r-seed'));
    saved.peopleDirectory=[];saved.friends=[];saved.chatThreads=[];saved.messages=[];
    return {
      ...base,
      ...saved,
      works,
      posts,
      postComments,
      ui:{
        ...base.ui,
        ...saved.ui,
        evaluationFilters:{...base.ui.evaluationFilters,...saved.ui?.evaluationFilters},
        readFilters:{...base.ui.readFilters,...saved.ui?.readFilters}
      },
      library:{...base.library,...saved.library},
      readingProgress:{...base.readingProgress,...saved.readingProgress},
      migrations:{...base.migrations,...saved.migrations,singleReactionV12:true}
    };
  }catch{ return baseState(); }
}

export let state=loadState();

export function save(){
  if(hasLegacyRecovery(state.works)){state.cloud.error='Восстановите старые изображения в облако. Исходный снимок на устройстве сохранён.';return;}
  const copy=structuredClone(state);
  copy.ui.modal=null; copy.ui.toast=null; copy.ui.selectedQuote='';
  assertPersistableDocument(copy.works);
  localStorage.setItem(KEY,JSON.stringify(copy));
}

export function update(mutator,{persist=true}={}){
  mutator(state);
  if(persist) save();
}

export function reset(){
  state=baseState();
  save();
}

export function xpToLevel(xp){ return Math.max(1,Math.floor((xp||0)/200)+1); }
export function reviewerRank(rep){
  if(rep>=250) return 'Топ-рецензент';
  if(rep>=120) return 'Опытный критик';
  if(rep>=40) return 'Активный рецензент';
  return 'Начинающий читатель';
}
