import {state,update,save,xpToLevel} from './state.js';
import {ANNOTATION_TYPES,FEEDBACK_CATEGORIES} from './data.js';
import * as pages from './pages.js';
import {esc,modal,toast} from './ui.js';
import {showFeedback,withOperation} from './feedback/OperationFeedback.js';
import {ensureSession,getSession,signOut,getMyProfile,updateMyProfile,fetchPublicFeed,createCloudPost,toggleCloudPostLike,fetchPostComments,createCloudComment,setCloudCommentReaction,isCloudAuthenticated,requestOtp,verifyOtp,createMyProfile,checkServerConnection,findProfileByUsername,getOrCreateDirectConversation,createCloudGroupConversation,fetchMyConversations,fetchConversationMessages,sendCloudMessage,getConversationPeer,createCloudCall,fetchIncomingCalls,getCloudCall,setCloudCallStatus,sendCloudCallSignal,fetchCloudCallSignals,fetchNotifications,markNotificationRead,markAllNotificationsRead,createReport,fetchModerationReports,setModerationReportStatus,requestAuthorVerification,fetchMyVerificationRequests,fetchVerificationRequests,resolveAuthorVerification,fetchCloudLiterature,saveCloudWork,saveCloudReview,setCloudReviewReaction,saveCloudReadingProgress,uploadWorkAsset,publicObjectUrl,fetchDiscoveryCatalogs,fetchMyProfileDetails,replaceMyProfileDetails,uploadProfileMedia,createEvaluationSession,completeEvaluationItem,fetchEvaluationCatalog,saveCloudFragment,createCloudAnnotation,deleteCloudAnnotation,fetchAuthorFeedback,saveCloudWorkTaxonomy} from './cloud.js';
import {AssetService} from './editor/AssetService.js';
import {CallSession,CALL_STATUS_LABELS} from './CallSession.js';
import {createEditorRoot} from './editor/EditorRoot.js';
import {createConnectionController} from './editor/ConnectionController.js';
import {removeDanglingConnections} from './editor/ConnectionModel.js';
import {scrollSelectedPage,pageHasContent,removeStudioPage} from './editor/PageNavigation.js';
import {normalizeMediaObject,normalizePageMedia,workPages} from './editor/MediaModel.js';
import {attachEditorImageStatus} from './editor/ImageStatus.js';
import {createSaveQueue} from './editor/SaveQueue.js';
import {hasLegacyRecovery,legacyImageFile,legacyRecoveryKeys,replaceLegacyReferences} from './editor/LegacyMediaRecovery.js';
import {profileEditor} from './profile/ProfileEditor.js';
import {normalizePreferences,normalizeUrl,parseRows,profilePayload} from './profile/ProfileService.js';
import {cropProfileImage} from './profile/ProfileMediaService.js';
import {removeProfileMedia,saveMyProfile} from './cloud.js';
import {profileMediaState} from './profile/ProfileService.js';
import {captureTextAnchor} from './annotations/TextAnchor.js';
import {sanitizeHtml,sanitizePaste} from './security/SanitizeHtml.js';
import {advanceSession,createLocalSession,validateSessionSize} from './evaluation/EvaluationService.js';
import {fetchCloudPost} from './cloud.js';
import {NAVIGATION_PAGES,routeFromLocation,routeUrl,transitionPage} from './navigation/Navigation.js';
import {sharePost} from './navigation/SharePost.js';

const app=document.querySelector('#app');
let signupRole=null;
let loginMode=false;
let forceAuthScreen=false;
let authMethod='email';
let otpPending=null;
let cloudFeedLoaded=false;
let readerFont=18;
let readerTheme=0;
let animateChatOpen=false;
let savedEditorRange=null;
let selectedTextAnchor=null;
let selectedMediaFigure=null;
let selectedCanvasObject=null;
const PAGE_CANVAS_W=760;
const PAGE_CANVAS_H=1080;
let studioAutosaveTimer=null;
const queueStudioSave=createSaveQueue();
let bookFlipLocked=false;
let swipeStartX=null;
let authReady=false;
let chatsPollTimer=null;
let incomingCallTimer=null;
let notificationsTimer=null;
let activeRtc=null;
let callStarting=false;
let pendingIncomingCallId=null;
let incomingCallPolling=false;
const seenIncomingCalls=new Set();
const workAssets=new AssetService({
  upload:(path,file)=>uploadWorkAsset(path,file),
  resolveUrl:path=>publicObjectUrl('lit-work-assets',`${getSession()?.user?.id}/${path}`)
});
const editorRoot=createEditorRoot({
  readContext:()=>{const ctx=currentCanvasState();return ctx?.page.id||null;},
  readSnapshot:()=>structuredClone(currentCanvasState()?.canvas||null),
  applySnapshot:snapshot=>{const ctx=currentCanvasState();if(!ctx||!snapshot)return;ctx.page.canvas=structuredClone(snapshot);save();render();},
  onChange:()=>{scheduleStudioAutosave();updateHistoryControls();}
});
const studioConnections=createConnectionController({context:currentCanvasState,sync:syncCanvasDomToState,history:editorRoot,changed:()=>{save();scheduleStudioAutosave();},feedback:showFeedback,selectObject:selectCanvasObject});
document.addEventListener('keydown',event=>{
  if(!(event.ctrlKey||event.metaKey)||event.key.toLowerCase()!=='z'||!document.querySelector('#freePageCanvas'))return;
  if(event.target.closest?.('input,textarea,[contenteditable="true"]'))return;
  event.preventDefault();event.stopImmediatePropagation();
  if(event.shiftKey)editorRoot.redo();else editorRoot.undo();
},true);

function render(){
  if(!authReady){app.innerHTML='<main class="onboarding"><section class="onboard-card"><h2>Подключение к FRAKTUM…</h2><p class="muted">Проверяем сессию Supabase.</p></section></main>';return;}
  if(!isCloudAuthenticated()||!state.user||forceAuthScreen){ const auth={method:authMethod,pending:otpPending,fromApp:false}; app.innerHTML= loginMode?pages.loginPage(auth):(signupRole?pages.registration(signupRole,auth):pages.onboarding()); attachSpecial(); return; }
  const map={home:pages.home,post:pages.postPage,evaluate:pages.evaluatePage,evaluation:pages.evaluationSession,read:pages.readDiscovery,work:pages.workDetailPage,reader:pages.readerPage,library:pages.library,create:pages.createPage,notes:pages.notesPage,communities:pages.communitiesPage,community:pages.communityDetail,messages:pages.messagesPage,profile:pages.profilePage,analytics:pages.analyticsPage,admin:pages.adminPage,feedback:pages.feedbackPage};
  app.innerHTML=(map[state.ui.page]||pages.home)();
  if(state.ui.modal) app.insertAdjacentHTML('beforeend',state.ui.modal);
  if(state.ui.toast){ app.insertAdjacentHTML('beforeend',toast(state.ui.toast)); setTimeout(()=>{update(s=>s.ui.toast=null,{persist:false}); const t=document.querySelector('.toast'); if(t)t.remove();},1800); }
  attachSpecial();
  animateDrawerIfNeeded();
}

function animateDrawerIfNeeded(){
  if(!animateChatOpen||!state.ui.chatPanelOpen)return;
  const shell=document.querySelector('.chat-shell');
  if(!shell){animateChatOpen=false;return;}
  shell.classList.remove('is-open');
  requestAnimationFrame(()=>requestAnimationFrame(()=>shell.classList.add('is-open')));
  animateChatOpen=false;
}

function toggleChatPanel(){
  const opening=!state.ui.chatPanelOpen;
  update(s=>s.ui.chatPanelOpen=opening,{persist:false});
  document.querySelector('.chat-shell')?.classList.toggle('is-open',opening);
  const drawer=document.querySelector('.chat-drawer');
  if(drawer)drawer.inert=!opening;
  const toggle=document.querySelector('.chat-edge-toggle');
  if(toggle){toggle.textContent=opening?'›':'‹';toggle.setAttribute('aria-expanded',String(opening));toggle.setAttribute('aria-label',opening?'Закрыть чаты':'Открыть чаты');if(!opening)toggle.focus({preventScroll:true});}
}

function notify(text){ update(s=>s.ui.toast=text,{persist:false}); render(); }
const reportedSyncIssues=new Set();
function reportSyncIssue(context,error){
  const message=`${context}: ${error instanceof Error?error.message:String(error)}`;
  update(s=>s.cloud.error=message,{persist:false});
  if(reportedSyncIssues.has(message))return;
  if(reportedSyncIssues.size>=32)reportedSyncIssues.clear();
  reportedSyncIssues.add(message);
  showFeedback(`Не удалось синхронизировать ${message}`,{kind:'error'});
}
function navigationSnapshot(){
  const {page,postId,selectedWorkId,selectedStudioWorkId,selectedCommunityId,evaluationWorkId,bookPageIndex}=state.ui;
  return {page,postId,selectedWorkId,selectedStudioWorkId,selectedCommunityId,evaluationWorkId,bookPageIndex};
}
function rememberNavigationScroll(){
  window.history.replaceState({...window.history.state,fraktum:{route:navigationSnapshot(),scroll:{x:window.scrollX,y:window.scrollY}}},'');
}
let navigationRevision=0;
let restoringNavigationScroll=false;
async function go(page,{route={},historyMode='push',scroll={x:0,y:0},restorationId=null}={}){
  if(!NAVIGATION_PAGES.has(page)&&page!=='post')return;
  if(document.querySelector('#workEditor')){syncStudioEditor();save();}
  if(historyMode==='push'&&!restoringNavigationScroll)rememberNavigationScroll();
  const revision=restorationId??++navigationRevision;
  if(restorationId==null){restoringNavigationScroll=false;clearTimeout(navigationScrollTimer);}
  const next={...navigationSnapshot(),...route,page};
  if(historyMode!=='none')window.history[historyMode==='replace'?'replaceState':'pushState']({fraktum:{route:next,scroll}},'',routeUrl(next));
  await transitionPage(()=>{
    if(revision!==navigationRevision)return;
    update(s=>{Object.assign(s.ui,next);s.ui.modal=null;s.ui.sidebarOpen=false;},{persist:false});
    render();
    window.scrollTo({left:scroll.x||0,top:scroll.y||0,behavior:'instant'});
    document.querySelector('.page')?.focus({preventScroll:true});
  },{reducedMotion:window.matchMedia('(prefers-reduced-motion: reduce)').matches});
}
async function restoreLocation({initial=false}={}){
  if(!authReady||!isCloudAuthenticated()||!state.user)return;
  const revision=++navigationRevision;
  restoringNavigationScroll=true;
  clearTimeout(navigationScrollTimer);
  const stored=window.history.state?.fraktum;
  const route={...(stored?.route||{}),...routeFromLocation(window.location)};
  const scroll=initial?{x:0,y:0}:stored?.scroll||{x:0,y:0};
  if(route.page==='post')update(s=>{s.ui.postRouteStatus='loading';s.ui.postRouteError=null;},{persist:false});
  try{
    await go(route.page,{route,historyMode:initial?'replace':'none',scroll,restorationId:revision});
    if(revision!==navigationRevision||route.page!=='post')return;
    try{
      const post=route.postId?await fetchCloudPost(route.postId):null;
      if(revision!==navigationRevision)return;
      update(s=>{s.ui.postRouteStatus=post?'ready':'missing';if(post)s.posts=[post,...s.posts.filter(item=>item.id!==post.id)];},{persist:false});
    }catch(error){
      if(revision!==navigationRevision)return;
      update(s=>{s.ui.postRouteStatus='error';s.ui.postRouteError=error.message;},{persist:false});
    }
    render();
    // The loading screen is shorter than the restored post. Apply the saved
    // position only after its content exists, and keep that position in history
    // while the request is pending.
    window.scrollTo({left:scroll.x||0,top:scroll.y||0,behavior:'instant'});
  }finally{
    if(revision===navigationRevision)restoringNavigationScroll=false;
  }
}
window.history.scrollRestoration='manual';
let navigationScrollTimer=null;
window.addEventListener('scroll',()=>{
  clearTimeout(navigationScrollTimer);
  if(restoringNavigationScroll)return;
  navigationScrollTimer=setTimeout(()=>{
    if(restoringNavigationScroll)return;
    const current=window.history.state;
    if(current?.fraktum)window.history.replaceState({...current,fraktum:{...current.fraktum,scroll:{x:window.scrollX,y:window.scrollY}}},'');
  },100);
},{passive:true});
window.addEventListener('popstate',()=>{restoreLocation().catch(error=>notify(`Не удалось перейти: ${error.message}`));});
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&state.ui.chatPanelOpen&&!state.ui.modal){toggleChatPanel();}});
function openModal(html,size){ update(s=>s.ui.modal=modal(html,size),{persist:false}); render(); }
function closeModal(){ update(s=>s.ui.modal=null,{persist:false}); render(); }

function attachSpecial(){
  const studioForm=document.querySelector('#workEditor');
  if(studioForm){
    const metadataNames=new Set(['title','kind','summary','formatId','genres','audienceIds','tagIds','targetType','evaluationTarget','evaluationText','feedback']);
    const captureMetadata=event=>{if(!metadataNames.has(event.target.name))return;const fields=collectEditor();if(!fields)return;const work=state.works.find(work=>work.id===fields.id);if(!work)return;const {id,...values}=fields;Object.assign(work,values);if(event.target.name==='title'){
      const current=currentCanvasState();editorRoot.begin('project title');
      for(const page of work.bookPages||[])if(page.type==='cover'||page.type==='title'){page.title=work.title;for(const object of page.canvas?.objects||[])if(object.type==='text'&&object.role==='title')object.html=`<div>${esc(work.title)}</div>`;}
      const titleObject=current?.canvas.objects.find(object=>object.type==='text'&&object.role==='title');if(titleObject){const content=document.querySelector(`[data-object-id="${CSS.escape(titleObject.id)}"] .canvas-text-content`);if(content)content.innerHTML=titleObject.html;}
      editorRoot.commit();
    }save();scheduleStudioAutosave();};
    studioForm.addEventListener('input',captureMetadata);studioForm.addEventListener('change',captureMetadata);
  }
  const reg=document.querySelector('#registrationOtpRequestForm'); if(reg) reg.addEventListener('submit',withOperation(handleRegistrationOtpRequest));
  const login=document.querySelector('#loginOtpRequestForm'); if(login) login.addEventListener('submit',withOperation(handleLoginOtpRequest));
  const verify=document.querySelector('#otpVerifyForm'); if(verify) verify.addEventListener('submit',withOperation(handleOtpVerify));
  const text=document.querySelector('#readerText');
  if(text){
    text.style.fontSize=`${readerFont}px`; text.dataset.theme=String(readerTheme); text.addEventListener('mouseup',captureSelection);
    if(state.ui.page==='reader') attachReadingProgress(text);
  }
  const global=document.querySelector('#globalSearch'); if(global) global.addEventListener('keydown',e=>{if(e.key==='Enter') searchGlobal(e.target.value)});
  document.querySelectorAll('.rich-editor,.canvas-text-content,[data-book-field]').forEach(ed=>{
    ed.addEventListener('mouseup',()=>{rememberEditorSelection();syncEditorToolbar();});
    ed.addEventListener('keyup',()=>{rememberEditorSelection();updateEditorWordCount();syncEditorToolbar();scheduleStudioAutosave();});
    ed.addEventListener('input',()=>{updateEditorWordCount();scheduleStudioAutosave();});
    ed.addEventListener('keydown',handleEditorShortcuts);
    ed.addEventListener('paste',handleStudioPaste);
  });
  const ribbon=document.querySelector('.word-ribbon');
  if(ribbon) ribbon.addEventListener('pointerdown',e=>{if(!e.target.closest('input[type="color"]'))rememberEditorSelection();},true);
  document.querySelectorAll('[data-editor-tool]').forEach(control=>{
    control.addEventListener('change',()=>applyEditorTool(control.dataset.editorTool,control.value));
    if(control.type==='color') control.addEventListener('input',()=>applyEditorTool(control.dataset.editorTool,control.value));
  });
  const upload=document.querySelector('#mediaUpload'); if(upload) upload.addEventListener('change',handleMediaUpload);
  const legacyUpload=document.querySelector('#legacyMediaUpload');if(legacyUpload)legacyUpload.addEventListener('change',async event=>{const file=event.target.files?.[0];if(file)await restoreLegacyMedia(file);});
  const avatarUpload=document.querySelector('#profileAvatarUpload');if(avatarUpload)avatarUpload.addEventListener('change',event=>handleProfileMedia(event,'avatar'));
  const bannerUpload=document.querySelector('#profileBannerUpload');if(bannerUpload)bannerUpload.addEventListener('change',event=>handleProfileMedia(event,'banner'));
  document.querySelector('#profileAvatarRemove')?.addEventListener('click',()=>handleProfileMediaRemoval('avatar'));
  document.querySelector('#profileBannerRemove')?.addEventListener('click',()=>handleProfileMediaRemoval('banner'));
  document.querySelectorAll('[data-tag-search]').forEach(input=>input.addEventListener('input',()=>{const query=input.value.trim().toLowerCase();input.closest('.preference-selector')?.querySelectorAll('[data-tag-label]').forEach(label=>{label.hidden=!!query&&!label.dataset.tagLabel.includes(query);});}));
  document.querySelectorAll('[data-taxonomy-search]').forEach(input=>input.addEventListener('input',()=>{const query=input.value.trim().toLowerCase();input.closest('.taxonomy-choices')?.querySelectorAll('[data-taxonomy-label]').forEach(label=>{label.hidden=!!query&&!label.dataset.taxonomyLabel.includes(query);});}));
  document.querySelectorAll('.preference-selector input[type="checkbox"]').forEach(input=>input.addEventListener('change',()=>{
    if(!input.checked)return;const [domain,side]=input.closest('[data-preference-kind]').dataset.preferenceKind.split('-');const opposite=document.querySelector(`[data-preference-kind="${domain}-${side==='wanted'?'unwanted':'wanted'}"] input[value="${CSS.escape(input.value)}"]`);if(opposite)opposite.checked=false;
  }));
  const widthSlider=document.querySelector('#mediaWidthSlider');
  if(widthSlider) widthSlider.addEventListener('input',()=>setMediaSize(widthSlider.value,true));
  const gapSlider=document.querySelector('#mediaGapSlider');
  if(gapSlider) gapSlider.addEventListener('input',()=>setMediaGap(gapSlider.value,true));
  attachMediaInteractions();
  updateMediaControls();
  attachCanvasInteractions();
  studioConnections.attach();
  scrollSelectedPage(document.querySelector('.studio-outline .page-list'));
  attachEditorImageStatus();
  attachCanvasWrapProxies();
  updateCanvasInspector();
  const bgColor=document.querySelector('#pageBackgroundColor'); if(bgColor) bgColor.addEventListener('input',()=>setPageBackgroundColor(bgColor.value));
  const textColor=document.querySelector('#pageTextColor'); if(textColor) textColor.addEventListener('input',()=>setPageTextColor(textColor.value));
  const bgFit=document.querySelector('#pageBackgroundFit'); if(bgFit) bgFit.addEventListener('change',()=>setPageBackgroundFit(bgFit.value));
  const rot=document.querySelector('#canvasRotationSlider'); if(rot) rot.addEventListener('input',()=>setCanvasObjectProperty('rotation',rot.value,true));
  const op=document.querySelector('#canvasOpacitySlider'); if(op) op.addEventListener('input',()=>setCanvasObjectProperty('opacity',Number(op.value)/100,true));
  const rad=document.querySelector('#canvasRadiusSlider'); if(rad) rad.addEventListener('input',()=>setCanvasObjectProperty('radius',rad.value,true));
  const fit=document.querySelector('#canvasImageFit'); if(fit) fit.addEventListener('change',()=>setCanvasObjectProperty('fit',fit.value));
  const wrap=document.querySelector('#canvasImageWrap'); if(wrap) wrap.addEventListener('change',()=>setCanvasObjectProperty('wrap',wrap.value));
  const layout=document.querySelector('#canvasImageLayout');if(layout)layout.addEventListener('change',()=>setCanvasObjectProperty('layout',layout.value));
  const caption=document.querySelector('#canvasImageCaption');if(caption)caption.addEventListener('change',()=>setCanvasObjectProperty('caption',caption.value));
  const gap=document.querySelector('#canvasWrapGapSlider'); if(gap) gap.addEventListener('input',()=>setCanvasObjectProperty('gap',gap.value,true));
  const tbg=document.querySelector('#canvasTextBgColor'); if(tbg) tbg.addEventListener('input',()=>setCanvasObjectProperty('textBg',tbg.value,true));
  const tbgm=document.querySelector('#canvasTextBgMode'); if(tbgm) tbgm.addEventListener('change',()=>setCanvasObjectProperty('textBgMode',tbgm.value));
  const tflow=document.querySelector('#canvasTextFlow'); if(tflow) tflow.addEventListener('change',()=>setCanvasObjectProperty('flow',tflow.value));
  attachBookSwipe();
  updateEditorWordCount();
  syncEditorToolbar();
  updateHistoryControls();
}

function updateHistoryControls(){
  document.querySelectorAll('[data-action="editor-cmd"][data-cmd="undo"]').forEach(button=>button.disabled=!editorRoot.canUndo);
  document.querySelectorAll('[data-action="editor-cmd"][data-cmd="redo"]').forEach(button=>button.disabled=!editorRoot.canRedo);
}

function scheduleStudioAutosave(){
  const work=currentCanvasState()?.w;
  if(!work)return;
  clearTimeout(studioAutosaveTimer);
  studioAutosaveTimer=setTimeout(async()=>{
    const form=document.querySelector('#workEditor');
    if(form?.dataset.id===work.id){const fields=collectEditor();if(fields){const {id,...values}=fields;Object.assign(work,values);}}
    const pages=workPages(work).filter(page=>!page.type||page.type==='content');
    work.content=pages.map(page=>(page.canvas.objects||[]).filter(object=>object.type==='text').map(object=>textFromHtml(object.html)).join('\n')).join('\n\n');
    save();
    const label=form?.dataset.id===work.id?document.querySelector('.word-status span:last-child'):null;
    if(hasLegacyRecovery(state.works)){if(label)label.textContent='Сохранение приостановлено: восстановите старые изображения';return;}
    if(!isCloudAuthenticated()||!state.user?.verified){if(label)label.textContent='Сохранено на устройстве';return;}
    if(label)label.textContent='Сохраняем в облаке…';
    try{await persistStudioWork(work,work.evaluationStatus==='open'?'evaluation':work.publicationStatus==='published'?'published':'draft');if(label?.isConnected)label.textContent='Сохранено в облаке';}
    catch(error){if(label?.isConnected)label.textContent=`Не сохранено в облаке: ${error.message}`;update(s=>{s.cloud.error=`Автосохранение: ${error.message}`;},{persist:false});}
  },650);
}

function persistStudioWork(work,mode='draft',overrides={}){
  return queueStudioSave(async()=>{
    const snapshot={...structuredClone(work),...overrides};
    if(work.creationType==='fragment'){
      const fragment=await saveCloudFragment(snapshot,{publish:mode==='evaluation'||snapshot.publicationStatus==='published',evaluationOpen:mode==='evaluation'||snapshot.evaluationStatus==='open'});
      if(!fragment?.id)throw new Error('Сервер не вернул сохранённый фрагмент');
      const oldId=work.id,newId=`fragment:${fragment.id}`;
      update(s=>{work.fragmentCloudId=fragment.id;work.cloud=true;work.id=newId;work.publicationStatus=fragment.visibility==='public'?'published':'draft';work.evaluationStatus=fragment.evaluation_open?'open':'closed';if(s.ui.selectedStudioWorkId===oldId)s.ui.selectedStudioWorkId=newId;});
      const form=document.querySelector('#workEditor');if(form?.dataset.id===oldId)form.dataset.id=newId;
      if(state.ui.page==='create')rememberNavigationScroll();
      return {fragment};
    }
    const result=await saveCloudWork(snapshot,{mode});
    const oldId=work.id,newId=`cloud:${result.work.id}`;
    update(s=>{Object.assign(work,{id:newId,cloud:true,cloudId:result.work.id,cloudVersionId:result.version.id,version:String(result.version.version_no)});if(s.ui.selectedStudioWorkId===oldId)s.ui.selectedStudioWorkId=newId;if(s.ui.selectedWorkId===oldId)s.ui.selectedWorkId=newId;for(const key of ['later','reading','completed'])s.library[key]=s.library[key].map(id=>id===oldId?newId:id);if(s.readingProgress[oldId]!=null){s.readingProgress[newId]=s.readingProgress[oldId];delete s.readingProgress[oldId];}});
    const form=document.querySelector('#workEditor');if(form?.dataset.id===oldId)form.dataset.id=newId;
    if(state.ui.page==='create')rememberNavigationScroll();
    return result;
  });
}

async function restoreLegacyMedia(replacementFile=null){
  const work=currentCanvasState()?.w;if(!work)return;
  const keys=legacyRecoveryKeys(work);if(!keys.length)return;
  try{
    for(const key of replacementFile?keys.slice(0,1):keys){
      const file=replacementFile||await legacyImageFile(key),asset=await uploadStudioAsset(file);
      replaceLegacyReferences(state.works,key,asset);
      work.mediaLibrary??=[];if(!work.mediaLibrary.some(item=>item.storagePath===asset.storagePath))work.mediaLibrary.push(asset);
    }
    if(!hasLegacyRecovery(state.works)){state.cloud.error=null;save();}
    render();scheduleStudioAutosave();
  }catch(error){showFeedback(`Не удалось восстановить изображение: ${error.message}`);}
}

function handleEditorShortcuts(e){
  if(!(e.ctrlKey||e.metaKey))return;
  const k=e.key.toLowerCase();
  const map={b:'bold',i:'italic',u:'underline'};
  if(map[k]){e.preventDefault();rememberEditorSelection();execEditorCommand(map[k]);return;}
  if(k==='s'){e.preventDefault();void saveWork('draft');}
}

function attachBookSwipe(){
  document.querySelectorAll('.book-preview-scene,.reader-book-scene').forEach(scene=>{
    scene.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0)return;swipeStartX=e.clientX;});
    scene.addEventListener('pointerup',e=>{if(swipeStartX==null)return;const dx=e.clientX-swipeStartX;swipeStartX=null;if(Math.abs(dx)<55)return;const reader=scene.classList.contains('reader-book-scene');const action=dx<0?(reader?'reader-book-next':'book-spread-next'):(reader?'reader-book-prev':'book-spread-prev');const btn=scene.querySelector(`[data-action="${action}"]`);if(btn&&!btn.disabled)btn.click();});
  });
}

function cleanEditorHtml(el){
  const clone=el.cloneNode(true);
  clone.querySelectorAll('.media-drag-handle,.media-resize-handle').forEach(x=>x.remove());
  clone.querySelectorAll('.embedded-media').forEach(x=>x.classList.remove('selected','dragging'));
  return sanitizeHtml(clone.innerHTML);
}

function selectMediaFigure(figure){
  document.querySelectorAll('.rich-editor .embedded-media.selected').forEach(x=>x.classList.remove('selected'));
  selectedMediaFigure=figure||null;
  if(figure)figure.classList.add('selected');
  updateMediaControls();
}
function updateMediaControls(){
  const width=document.querySelector('#mediaWidthSlider'),gap=document.querySelector('#mediaGapSlider');
  if(!selectedMediaFigure){if(width)width.disabled=true;if(gap)gap.disabled=true;return;}
  if(width){width.disabled=false;width.value=String(Math.round(parseFloat(selectedMediaFigure.style.width)||55));}
  const g=Math.round(parseFloat(selectedMediaFigure.dataset.gap||18));if(gap){gap.disabled=false;gap.value=String(g);}
  const wo=document.querySelector('#mediaWidthOutput');if(wo)wo.textContent=`${width?.value||55}%`;
  const go=document.querySelector('#mediaGapOutput');if(go)go.textContent=`${g}px`;
}

function attachMediaInteractions(){
  selectedMediaFigure=null;
  document.querySelectorAll('.rich-editor .embedded-media').forEach(figure=>{
    figure.setAttribute('contenteditable','false');
    figure.setAttribute('draggable','false');
    const img=figure.querySelector('img');
    if(img){
      img.setAttribute('draggable','false');
      if(!img.dataset.dragBound){img.dataset.dragBound='1';img.addEventListener('pointerdown',startMediaDrag);}
    }
    if(!figure.querySelector('.media-drag-handle')){
      const handle=document.createElement('button');
      handle.type='button';
      handle.className='media-drag-handle';
      handle.textContent='⠿ Переместить';
      handle.title='Перетащите изображение по странице';
      handle.setAttribute('contenteditable','false');
      figure.appendChild(handle);
      handle.addEventListener('pointerdown',startMediaDrag);
    }
    if(!figure.querySelector('.media-resize-handle')){
      const resize=document.createElement('span');resize.className='media-resize-handle';resize.title='Тяните, чтобы изменить размер';resize.setAttribute('contenteditable','false');figure.appendChild(resize);resize.addEventListener('pointerdown',startMediaResize);
    }
  });
}

function startMediaResize(e){
  if(e.button!==0)return;e.preventDefault();e.stopPropagation();
  const handle=e.currentTarget,figure=handle.closest('.embedded-media'),editor=figure?.closest('.rich-editor');if(!figure||!editor)return;
  selectMediaFigure(figure);const rect=editor.getBoundingClientRect();
  try{handle.setPointerCapture(e.pointerId);}catch{}
  const move=ev=>{const fr=figure.getBoundingClientRect();const left=fr.left-rect.left;const px=Math.max(120,Math.min(rect.width-left-8,ev.clientX-fr.left));const pct=Math.max(20,Math.min(100,px/rect.width*100));figure.style.width=`${pct}%`;figure.style.maxWidth=`${pct}%`;updateMediaControls();};
  const up=ev=>{try{handle.releasePointerCapture(ev.pointerId);}catch{}handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',up);handle.removeEventListener('pointercancel',up);syncStudioEditor();save();};
  handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',up);handle.addEventListener('pointercancel',up);
}

function startMediaDrag(e){
  if(e.button!==0)return;
  e.preventDefault();e.stopPropagation();
  const handle=e.currentTarget;
  const figure=handle.closest('.embedded-media');
  const editor=figure?.closest('.rich-editor');
  if(!figure||!editor)return;
  selectMediaFigure(figure);
  figure.classList.add('dragging');
  document.body.classList.add('media-is-dragging');
  try{handle.setPointerCapture(e.pointerId);}catch{}

  const move=ev=>{
    ev.preventDefault();
    const rect=editor.getBoundingClientRect();
    const relX=(ev.clientX-rect.left)/Math.max(1,rect.width);
    figure.classList.remove('wrap-left','wrap-right','wrap-wide','wrap-block');
    if(relX<.38) figure.classList.add('wrap-left');
    else if(relX>.62) figure.classList.add('wrap-right');
    else figure.classList.add('wrap-block');

    const siblings=[...editor.children].filter(n=>n!==figure && !n.classList?.contains('media-drag-handle'));
    if(!siblings.length){editor.appendChild(figure);return;}
    let target=null;
    for(const node of siblings){
      const r=node.getBoundingClientRect();
      if(ev.clientY < r.top+r.height/2){target=node;break;}
    }
    if(target) editor.insertBefore(figure,target); else editor.appendChild(figure);
  };
  const up=ev=>{
    figure.classList.remove('dragging');
    document.body.classList.remove('media-is-dragging');
    try{handle.releasePointerCapture(ev.pointerId);}catch{}
    handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',up);handle.removeEventListener('pointercancel',up);
    syncStudioEditor();save();rememberEditorSelection();
  };
  handle.addEventListener('pointermove',move);
  handle.addEventListener('pointerup',up);
  handle.addEventListener('pointercancel',up);
}

function setMediaSize(percent,live=false){
  if(!selectedMediaFigure){if(!live)notify('Сначала выберите картинку на странице');return;}
  const value=Math.max(20,Math.min(100,Number(percent)||55));
  selectedMediaFigure.style.width=value+'%';selectedMediaFigure.style.maxWidth=value+'%';
  const out=document.querySelector('#mediaWidthOutput');if(out)out.textContent=`${Math.round(value)}%`;
  if(!live){syncStudioEditor();save();}else scheduleStudioAutosave();
}
function setMediaGap(px,live=false){
  if(!selectedMediaFigure){if(!live)notify('Сначала выберите картинку');return;}
  const value=Math.max(0,Math.min(48,Number(px)||0));selectedMediaFigure.dataset.gap=String(value);selectedMediaFigure.style.setProperty('--media-gap',`${value}px`);const out=document.querySelector('#mediaGapOutput');if(out)out.textContent=`${value}px`;if(live)scheduleStudioAutosave();else{syncStudioEditor();save();}
}
function toggleMediaCaption(){
  if(!selectedMediaFigure){notify('Сначала выберите картинку');return;}
  let cap=selectedMediaFigure.querySelector('figcaption');if(cap){cap.remove();}else{cap=document.createElement('figcaption');cap.textContent=selectedMediaFigure.querySelector('img')?.alt||'Иллюстрация';selectedMediaFigure.appendChild(cap);}syncStudioEditor();save();
}
function resetMediaPosition(){
  if(!selectedMediaFigure){notify('Сначала выберите картинку');return;}
  selectedMediaFigure.classList.remove('wrap-left','wrap-right','wrap-wide');selectedMediaFigure.classList.add('wrap-block');selectedMediaFigure.style.width='55%';selectedMediaFigure.style.maxWidth='55%';setMediaGap(18,true);updateMediaControls();syncStudioEditor();save();
}

function makeCanvasPage(type='content',title='Без названия',author=''){
  const id=Date.now()+Math.random().toString(36).slice(2,6);
  if(type==='cover')return {id:`cover-${id}`,type:'cover',title,author,subtitle:'',canvas:{background:{color:'#101d2d',image:'',fit:'cover',position:'center'},textColor:'#ffffff',objects:[
    {id:`cover-title-${id}`,type:'text',role:'title',x:72,y:150,w:616,h:210,z:3,rotation:0,html:`<div>${title}</div>`,flow:false,locked:false,style:{fontFamily:'Georgia',fontSize:54,lineHeight:1.05,color:'#ffffff',align:'center',background:'transparent',padding:8}},
    {id:`cover-author-${id}`,type:'text',role:'author',x:150,y:830,w:460,h:90,z:3,rotation:0,html:`<div>${author}</div>`,flow:false,locked:false,style:{fontFamily:'Georgia',fontSize:20,lineHeight:1.25,color:'#ffffff',align:'center',background:'transparent',padding:6}}
  ]}};
  if(type==='title')return {id:`title-${id}`,type:'title',title,author,subtitle:'',year:String(new Date().getFullYear()),canvas:{background:{color:'#f7f1e5',image:'',fit:'cover',position:'center'},textColor:'#191715',objects:[
    {id:`title-main-${id}`,type:'text',role:'title',x:90,y:170,w:580,h:180,z:2,rotation:0,html:`<div>${title}</div>`,flow:false,locked:false,style:{fontFamily:'Georgia',fontSize:42,lineHeight:1.08,color:'#191715',align:'center',background:'transparent',padding:8}},
    {id:`title-author-${id}`,type:'text',role:'author',x:150,y:630,w:460,h:90,z:2,rotation:0,html:`<div>${author}</div>`,flow:false,locked:false,style:{fontFamily:'Georgia',fontSize:21,lineHeight:1.3,color:'#191715',align:'center',background:'transparent',padding:6}},
    {id:`title-year-${id}`,type:'text',role:'year',x:260,y:920,w:240,h:70,z:2,rotation:0,html:`<div>${new Date().getFullYear()}</div>`,flow:false,locked:false,style:{fontFamily:'Georgia',fontSize:16,lineHeight:1.2,color:'#514a43',align:'center',background:'transparent',padding:4}}
  ]}};
  return {id:`page-${id}`,type:'content',label:'Страница',html:'<p><br></p>',canvas:{background:{color:'#f7f1e5',image:'',fit:'cover',position:'center'},textColor:'#191715',objects:[{id:`flow-${id}`,type:'text',role:'body',x:72,y:72,w:616,h:936,z:1,rotation:0,html:'<p><br></p>',flow:true,locked:false,style:{fontFamily:'Georgia',fontSize:18,lineHeight:1.55,color:null,align:'left',background:'transparent',padding:6}}]}};
}
function currentCanvasState(){
  const form=document.querySelector('#workEditor'); if(!form)return null;
  const w=state.works.find(x=>x.id===form.dataset.id); if(!w)return null;
  const pages=workPages(w),idx=Math.max(0,Math.min(pages.length-1,state.ui.bookPageIndex||0));
  const page=pages[idx]; if(!page)return null;
  page.canvas=page.canvas||{background:{color:page.type==='cover'?'#101d2d':'#f7f1e5',image:page.image||'',fit:'cover',position:'center'},textColor:page.type==='cover'?'#ffffff':'#191715',objects:[]};
  page.canvas.background=page.canvas.background||{color:'#f7f1e5',image:'',fit:'cover',position:'center'};
  page.canvas.objects=Array.isArray(page.canvas.objects)?page.canvas.objects:[];
  return {form,w,page,idx,canvas:page.canvas};
}
function canvasPercent(v,total){return `${(Number(v||0)/total*100).toFixed(4)}%`;}
function clampCanvas(v,min,max){return Math.max(min,Math.min(max,v));}
function applyCanvasObjectGeometry(obj){
  if(!obj)return;
  const x=Number(obj.dataset.x)||0,y=Number(obj.dataset.y)||0,w=Number(obj.dataset.w)||100,h=Number(obj.dataset.h)||100,r=Number(obj.dataset.rotation)||0;
  obj.style.left=canvasPercent(x,PAGE_CANVAS_W);obj.style.top=canvasPercent(y,PAGE_CANVAS_H);obj.style.width=canvasPercent(w,PAGE_CANVAS_W);obj.style.height=canvasPercent(h,PAGE_CANVAS_H);obj.style.zIndex=String(Number(obj.dataset.z)||1);obj.style.transform=`rotate(${r}deg)`;
  studioConnections.refreshGeometry();
}
function cleanCanvasTextHtml(content){
  const clone=content.cloneNode(true);clone.querySelectorAll('.canvas-wrap-proxy,img,figure').forEach(x=>x.remove());return sanitizeHtml(clone.innerHTML);
}
function handleStudioPaste(event){
  if([...event.clipboardData?.files||[]].some(file=>file.type.startsWith('image/')))return;
  const html=event.clipboardData?.getData('text/html');
  if(html&&/<img\b/i.test(html)){
    event.preventDefault();const template=document.createElement('template');template.innerHTML=sanitizeHtml(html);template.content.querySelectorAll('img,figure').forEach(image=>image.remove());
    const selection=window.getSelection();if(selection?.rangeCount){const range=selection.getRangeAt(0);range.deleteContents();range.insertNode(template.content);selection.collapseToEnd();event.target.dispatchEvent(new globalThis.Event('input',{bubbles:true}));}
    showFeedback('Текст вставлен. Изображения вставляйте файлом или через загрузку, чтобы сохранить их в облаке.');return;
  }
  sanitizePaste(event);
}
function serializeCanvasObject(obj,old={}){
  const base={...old,id:obj.dataset.objectId,type:obj.dataset.objectType||old.type||'text',x:Number(obj.dataset.x)||0,y:Number(obj.dataset.y)||0,w:Number(obj.dataset.w)||100,h:Number(obj.dataset.h)||100,z:Number(obj.dataset.z)||1,rotation:Number(obj.dataset.rotation)||0,locked:obj.dataset.locked==='1'};
  if(base.type==='image'){
    const img=obj.querySelector('img');
    return normalizeMediaObject({...base,width:base.w,height:base.h,zIndex:base.z,assetId:old.assetId||'',storagePath:old.storagePath||'',url:img?.getAttribute('src')||old.url||old.src||'',alt:img?.getAttribute('alt')||old.alt||'',caption:obj.dataset.caption||'',layoutMode:obj.dataset.layoutMode||old.layoutMode||'free',wrapMode:obj.dataset.wrapMode||old.wrapMode||'around',fit:obj.dataset.fit||old.fit||'cover',radius:Number(obj.dataset.radius)||0,opacity:obj.dataset.opacity==null?(old.opacity??1):Number(obj.dataset.opacity),gap:Number(obj.dataset.gap??14)},obj.closest('.page-composition')?.dataset.pageId||'');
  }
  const content=obj.querySelector('.canvas-text-content');
  return {...base,html:content?cleanCanvasTextHtml(content):(old.html||'<p><br></p>'),flow:obj.dataset.flow!=='0',role:obj.dataset.role||old.role||'',style:{...(old.style||{}),fontFamily:obj.dataset.fontFamily||old.style?.fontFamily||'Georgia',fontSize:Number(obj.dataset.fontSize)||old.style?.fontSize||18,lineHeight:Number(obj.dataset.lineHeight)||old.style?.lineHeight||1.55,color:obj.dataset.baseColor||old.style?.color||null,align:obj.dataset.align||old.style?.align||'left',background:obj.dataset.bg||old.style?.background||'transparent',padding:Number(obj.dataset.padding)||old.style?.padding||6}};
}
function syncCanvasDomToState(){
  const ctx=currentCanvasState(),canvasEl=document.querySelector('#freePageCanvas');if(!ctx||!canvasEl)return;
  const old=new Map((ctx.canvas.objects||[]).map(o=>[o.id,o]));
  ctx.canvas.objects=[...canvasEl.querySelectorAll(':scope > .canvas-object')].map(el=>serializeCanvasObject(el,old.get(el.dataset.objectId)||{}));
  ctx.canvas.background={...(ctx.canvas.background||{}),color:canvasEl.dataset.bgColor||ctx.canvas.background?.color||'#f7f1e5',image:canvasEl.dataset.bgImage||'',fit:canvasEl.dataset.bgFit||'cover',position:'center'};
  ctx.canvas.textColor=canvasEl.dataset.textColor||ctx.canvas.textColor||'#191715';
  ctx.page.html=ctx.canvas.objects.filter(object=>object.type==='text').map(object=>object.html||'').join('');
  const roleText={};for(const o of ctx.canvas.objects){if(o.type==='text'&&o.role){const d=document.createElement('div');d.innerHTML=o.html||'';roleText[o.role]=(d.innerText||'').trim();}}
  if(roleText.title){ctx.page.title=roleText.title;ctx.w.title=roleText.title;const titleInput=ctx.form.elements?.title;if(titleInput&&document.activeElement!==titleInput)titleInput.value=roleText.title;}
  if(roleText.subtitle!=null)ctx.page.subtitle=roleText.subtitle;
  if(roleText.author)ctx.page.author=roleText.author;
  if(roleText.year)ctx.page.year=roleText.year;
}
function selectCanvasObject(obj){
  document.querySelectorAll('#freePageCanvas > .canvas-object.is-selected').forEach(x=>x.classList.remove('is-selected'));
  selectedCanvasObject=obj||null;
  if(obj){obj.classList.add('is-selected');update(s=>s.ui.canvasSelectedObjectId=obj.dataset.objectId,{persist:false});}
  else update(s=>s.ui.canvasSelectedObjectId=null,{persist:false});
  updateCanvasInspector();
  studioConnections.objectSelected();
}
function updateCanvasInspector(){
  const toolbar=document.querySelector('.canvas-selection-toolbar');
  if(toolbar)toolbar.hidden=!(selectedCanvasObject&&document.body.contains(selectedCanvasObject));
  const empty=document.querySelector('#canvasObjectEmpty'),box=document.querySelector('#canvasObjectControls');
  if(!empty||!box)return;
  const obj=selectedCanvasObject&&document.body.contains(selectedCanvasObject)?selectedCanvasObject:null;
  empty.hidden=!!obj;box.hidden=!obj;if(!obj)return;
  const isImage=obj.dataset.objectType==='image';
  const kind=document.querySelector('#canvasObjectKind');if(kind)kind.textContent=isImage?'Фото / изображение':'Текстовый блок';
  const imageControls=document.querySelector('#canvasImageControls');if(imageControls)imageControls.hidden=!isImage;
  const textControls=document.querySelector('#canvasTextControls');if(textControls)textControls.hidden=isImage;
  const rot=document.querySelector('#canvasRotationSlider'),ro=document.querySelector('#canvasRotationOutput');if(rot)rot.value=String(Math.round(Number(obj.dataset.rotation)||0));if(ro)ro.textContent=`${Math.round(Number(obj.dataset.rotation)||0)}°`;
  const lock=document.querySelector('#canvasLockButton');if(lock)lock.textContent=obj.dataset.locked==='1'?'🔒 Разблокировать':'🔓 Зафиксировать';
  if(isImage){
    const op=document.querySelector('#canvasOpacitySlider'),oo=document.querySelector('#canvasOpacityOutput');const opacity=Math.round((Number(obj.dataset.opacity)||1)*100);if(op)op.value=String(opacity);if(oo)oo.textContent=`${opacity}%`;
    const rad=document.querySelector('#canvasRadiusSlider'),rout=document.querySelector('#canvasRadiusOutput');if(rad)rad.value=String(Number(obj.dataset.radius)||0);if(rout)rout.textContent=`${Number(obj.dataset.radius)||0}px`;
    const fit=document.querySelector('#canvasImageFit');if(fit)fit.value=obj.dataset.fit||'cover';
    const wrap=document.querySelector('#canvasImageWrap');if(wrap)wrap.value=obj.dataset.wrapMode||'around';
    const layout=document.querySelector('#canvasImageLayout');if(layout)layout.value=obj.dataset.layoutMode||'free';
    const caption=document.querySelector('#canvasImageCaption');if(caption)caption.value=obj.dataset.caption||'';
    const gap=document.querySelector('#canvasWrapGapSlider'),go=document.querySelector('#canvasWrapGapOutput');if(gap)gap.value=String(Number(obj.dataset.gap)||14);if(go)go.textContent=`${Number(obj.dataset.gap)||14}px`;
  }else{
    const bg=document.querySelector('#canvasTextBgColor'),mode=document.querySelector('#canvasTextBgMode'),flow=document.querySelector('#canvasTextFlow');
    const current=obj.dataset.bg||'transparent';if(bg)bg.value=current==='transparent'?'#fff1a8':current;if(mode)mode.value=current==='transparent'?'transparent':'color';if(flow)flow.value=obj.dataset.flow==='0'?'0':'1';
  }
}
function canvasPointerToUnits(canvas,clientX,clientY){
  const r=canvas.getBoundingClientRect();return {x:(clientX-r.left)/Math.max(1,r.width)*PAGE_CANVAS_W,y:(clientY-r.top)/Math.max(1,r.height)*PAGE_CANVAS_H};
}
function showCanvasGuides(canvas,obj){
  const x=Number(obj.dataset.x)||0,y=Number(obj.dataset.y)||0,w=Number(obj.dataset.w)||0,h=Number(obj.dataset.h)||0;
  const vx=Math.abs(x+w/2-PAGE_CANVAS_W/2)<7,hy=Math.abs(y+h/2-PAGE_CANVAS_H/2)<7;
  canvas.classList.toggle('show-guide-v',vx);canvas.classList.toggle('show-guide-h',hy);return {vx,hy};
}
function clearCanvasGuides(canvas){canvas?.classList.remove('show-guide-v','show-guide-h');}
function finishCanvasObjectGesture(obj,canvas){
  obj?.classList.remove('is-dragging','is-resizing','is-rotating');clearCanvasGuides(canvas);syncCanvasDomToState();editorRoot.commit();save();attachCanvasWrapProxies();updateCanvasInspector();
}
function startCanvasDrag(e,obj){
  if(!obj||obj.dataset.locked==='1'||e.button!==0)return;e.preventDefault();e.stopPropagation();editorRoot.begin('move');
  const canvas=obj.closest('#freePageCanvas');if(!canvas)return;selectCanvasObject(obj);obj.classList.add('is-dragging');
  if(obj.dataset.objectType==='image')obj.dataset.layoutMode='free';
  const start=canvasPointerToUnits(canvas,e.clientX,e.clientY),ox=Number(obj.dataset.x)||0,oy=Number(obj.dataset.y)||0,w=Number(obj.dataset.w)||100,h=Number(obj.dataset.h)||100;
  const target=e.currentTarget;try{target.setPointerCapture(e.pointerId);}catch{}
  const move=ev=>{const pt=canvasPointerToUnits(canvas,ev.clientX,ev.clientY);let x=clampCanvas(ox+pt.x-start.x,0,PAGE_CANVAS_W-w),y=clampCanvas(oy+pt.y-start.y,0,PAGE_CANVAS_H-h);if(state.ui.studioGrid&&!ev.altKey){x=clampCanvas(Math.round(x/10)*10,0,PAGE_CANVAS_W-w);y=clampCanvas(Math.round(y/10)*10,0,PAGE_CANVAS_H-h);}obj.dataset.x=String(x);obj.dataset.y=String(y);const guides=showCanvasGuides(canvas,obj);if(guides.vx&&!ev.altKey)obj.dataset.x=String(PAGE_CANVAS_W/2-w/2);if(guides.hy&&!ev.altKey)obj.dataset.y=String(PAGE_CANVAS_H/2-h/2);applyCanvasObjectGeometry(obj);attachCanvasWrapProxies();};
  const up=ev=>{try{target.releasePointerCapture(ev.pointerId);}catch{}target.removeEventListener('pointermove',move);target.removeEventListener('pointerup',up);target.removeEventListener('pointercancel',up);finishCanvasObjectGesture(obj,canvas);};
  target.addEventListener('pointermove',move);target.addEventListener('pointerup',up);target.addEventListener('pointercancel',up);
}
function startCanvasResize(e,obj,dir){
  if(!obj||obj.dataset.locked==='1'||e.button!==0)return;e.preventDefault();e.stopPropagation();editorRoot.begin('resize');const canvas=obj.closest('#freePageCanvas');if(!canvas)return;selectCanvasObject(obj);obj.classList.add('is-resizing');
  const start=canvasPointerToUnits(canvas,e.clientX,e.clientY),ox=Number(obj.dataset.x)||0,oy=Number(obj.dataset.y)||0,ow=Number(obj.dataset.w)||100,oh=Number(obj.dataset.h)||100,ratio=ow/Math.max(1,oh),isImage=obj.dataset.objectType==='image';const target=e.currentTarget;try{target.setPointerCapture(e.pointerId);}catch{}
  const move=ev=>{const pt=canvasPointerToUnits(canvas,ev.clientX,ev.clientY);let dx=pt.x-start.x,dy=pt.y-start.y,x=ox,y=oy,w=ow,h=oh;const minW=isImage?60:90,minH=isImage?50:48;if(dir.includes('e'))w=Math.max(minW,ow+dx);if(dir.includes('s'))h=Math.max(minH,oh+dy);if(dir.includes('w')){w=Math.max(minW,ow-dx);x=ox+(ow-w);}if(dir.includes('n')){h=Math.max(minH,oh-dy);y=oy+(oh-h);}if(isImage&&!ev.shiftKey&&dir.length===2){if(Math.abs(dx)>Math.abs(dy)){h=w/ratio;if(dir.includes('n'))y=oy+oh-h;}else{w=h*ratio;if(dir.includes('w'))x=ox+ow-w;}}w=clampCanvas(w,minW,PAGE_CANVAS_W);h=clampCanvas(h,minH,PAGE_CANVAS_H);x=clampCanvas(x,0,PAGE_CANVAS_W-w);y=clampCanvas(y,0,PAGE_CANVAS_H-h);obj.dataset.x=String(x);obj.dataset.y=String(y);obj.dataset.w=String(w);obj.dataset.h=String(h);applyCanvasObjectGeometry(obj);attachCanvasWrapProxies();};
  const up=ev=>{try{target.releasePointerCapture(ev.pointerId);}catch{}target.removeEventListener('pointermove',move);target.removeEventListener('pointerup',up);target.removeEventListener('pointercancel',up);finishCanvasObjectGesture(obj,canvas);};target.addEventListener('pointermove',move);target.addEventListener('pointerup',up);target.addEventListener('pointercancel',up);
}
function startCanvasRotate(e,obj){
  if(!obj||obj.dataset.locked==='1'||e.button!==0)return;e.preventDefault();e.stopPropagation();editorRoot.begin('rotate');const canvas=obj.closest('#freePageCanvas');if(!canvas)return;selectCanvasObject(obj);obj.classList.add('is-rotating');const or=obj.getBoundingClientRect(),cx=or.left+or.width/2,cy=or.top+or.height/2;const startAngle=Math.atan2(e.clientY-cy,e.clientX-cx)*180/Math.PI,base=Number(obj.dataset.rotation)||0,target=e.currentTarget;try{target.setPointerCapture(e.pointerId);}catch{}
  const move=ev=>{let angle=base+(Math.atan2(ev.clientY-cy,ev.clientX-cx)*180/Math.PI-startAngle);if(!ev.altKey)angle=Math.round(angle/5)*5;obj.dataset.rotation=String(Math.round(angle));applyCanvasObjectGeometry(obj);updateCanvasInspector();};
  const up=ev=>{try{target.releasePointerCapture(ev.pointerId);}catch{}target.removeEventListener('pointermove',move);target.removeEventListener('pointerup',up);target.removeEventListener('pointercancel',up);finishCanvasObjectGesture(obj,canvas);};target.addEventListener('pointermove',move);target.addEventListener('pointerup',up);target.addEventListener('pointercancel',up);
}
function addCanvasChrome(obj){
  if(obj.querySelector(':scope > .canvas-object-chrome'))return;
  const chrome=document.createElement('div');chrome.className='canvas-object-chrome';chrome.setAttribute('contenteditable','false');
  const move=document.createElement('button');move.type='button';move.dataset.action='canvas-move';move.className='canvas-move-handle';move.title='Перетащить или переместить стрелками';move.setAttribute('aria-label',move.title);move.textContent='⠿';move.addEventListener('pointerdown',e=>startCanvasDrag(e,obj));chrome.appendChild(move);
  for(const dir of ['nw','n','ne','e','se','s','sw','w']){const h=document.createElement('span');h.className=`canvas-resize-handle handle-${dir}`;h.dataset.dir=dir;h.addEventListener('pointerdown',e=>startCanvasResize(e,obj,dir));chrome.appendChild(h);}
  const rot=document.createElement('span');rot.className='canvas-rotate-handle';rot.title='Повернуть';rot.addEventListener('pointerdown',e=>startCanvasRotate(e,obj));chrome.appendChild(rot);obj.appendChild(chrome);
}
function autoGrowCanvasText(content){
  const obj=content.closest('.canvas-text-object'),canvas=obj?.closest('#freePageCanvas');if(!obj||!canvas)return;const overflow=content.scrollHeight-content.clientHeight;if(overflow<=2)return;const cr=canvas.getBoundingClientRect();const extra=overflow/Math.max(1,cr.height)*PAGE_CANVAS_H+8;const y=Number(obj.dataset.y)||0;obj.dataset.h=String(Math.min(PAGE_CANVAS_H-y,Number(obj.dataset.h||120)+extra));applyCanvasObjectGeometry(obj);
}
function attachCanvasInteractions(){
  const canvas=document.querySelector('#freePageCanvas');if(!canvas){selectedCanvasObject=null;return;}
  canvas.addEventListener('pointerdown',e=>{if(e.target===canvas||e.target.classList.contains('page-background-image'))selectCanvasObject(null);});
  canvas.addEventListener('dblclick',e=>{if(e.target.closest('.canvas-object'))return;const pt=canvasPointerToUnits(canvas,e.clientX,e.clientY);addCanvasTextObject('text',pt.x,pt.y);});
  canvas.addEventListener('dragover',e=>{if([...e.dataTransfer?.items||[]].some(i=>i.type?.startsWith('image/'))){e.preventDefault();canvas.classList.add('is-file-over');}});
  canvas.addEventListener('dragleave',e=>{if(!canvas.contains(e.relatedTarget))canvas.classList.remove('is-file-over');});
  canvas.addEventListener('drop',handleCanvasImageDrop);
  canvas.addEventListener('paste',handleCanvasImagePaste);
  canvas.querySelectorAll(':scope > .canvas-object').forEach(obj=>{
    addCanvasChrome(obj);obj.addEventListener('pointerdown',e=>{selectCanvasObject(obj);if(obj.dataset.objectType==='image'&&!e.target.closest('.canvas-object-chrome')&&obj.dataset.locked!=='1')startCanvasDrag(e,obj);},true);
    const content=obj.querySelector('.canvas-text-content');if(content){content.addEventListener('focus',()=>selectCanvasObject(obj));content.addEventListener('input',()=>{editorRoot.begin('edit text');autoGrowCanvasText(content);syncCanvasDomToState();editorRoot.commit();scheduleStudioAutosave();attachCanvasWrapProxies();});}
  });
  const wanted=state.ui.canvasSelectedObjectId;const target=wanted?canvas.querySelector(`[data-object-id="${CSS.escape(wanted)}"]`):null;if(target)selectCanvasObject(target);
  if(!document.body.dataset.canvasKeysBound){document.body.dataset.canvasKeysBound='1';document.addEventListener('keydown',e=>{const obj=selectedCanvasObject;if(!obj||!document.body.contains(obj))return;const inText=e.target.closest?.('.canvas-text-content,input,textarea,select');if(inText)return;if((e.key==='Delete'||e.key==='Backspace')){e.preventDefault();deleteSelectedCanvasObject();return;}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='d'){e.preventDefault();duplicateSelectedCanvasObject();return;}if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)&&obj.dataset.locked!=='1'){e.preventDefault();editorRoot.begin('keyboard move');if(obj.dataset.objectType==='image')obj.dataset.layoutMode='free';const step=e.shiftKey?10:1;let x=Number(obj.dataset.x)||0,y=Number(obj.dataset.y)||0,w=Number(obj.dataset.w)||100,h=Number(obj.dataset.h)||100;if(e.key==='ArrowLeft')x-=step;if(e.key==='ArrowRight')x+=step;if(e.key==='ArrowUp')y-=step;if(e.key==='ArrowDown')y+=step;obj.dataset.x=String(clampCanvas(x,0,PAGE_CANVAS_W-w));obj.dataset.y=String(clampCanvas(y,0,PAGE_CANVAS_H-h));applyCanvasObjectGeometry(obj);syncCanvasDomToState();editorRoot.commit();scheduleStudioAutosave();attachCanvasWrapProxies();}if(e.key==='Escape')selectCanvasObject(null);});}
}
async function handleCanvasImageDrop(e){
  const canvas=e.currentTarget;canvas.classList.remove('is-file-over');const file=[...e.dataTransfer?.files||[]].find(f=>f.type?.startsWith('image/'));if(!file)return;e.preventDefault();
  if(file.size>12_000_000){showFeedback('Изображение слишком большое. Максимум 12 МБ.');return;}
  try{const pt=canvasPointerToUnits(canvas,e.clientX,e.clientY),asset=await uploadStudioAsset(file);const ctx=currentCanvasState();if(ctx){ctx.w.mediaLibrary??=[];ctx.w.mediaLibrary.push(asset);}addCanvasImageObject(asset.url,file.name,pt.x-140,pt.y-110,asset);}catch(err){showFeedback(`Не удалось обработать изображение: ${err.message}`);}
}
async function handleCanvasImagePaste(e){
  const file=[...e.clipboardData?.files||[]].find(f=>f.type?.startsWith('image/'));if(!file)return;e.preventDefault();
  try{const asset=await uploadStudioAsset(file),ctx=currentCanvasState();if(ctx){ctx.w.mediaLibrary??=[];ctx.w.mediaLibrary.push(asset);}addCanvasImageObject(asset.url,file.name||'Вставленное изображение',240,250,asset);}catch(err){showFeedback(`Не удалось вставить изображение: ${err.message}`);}
}
function addCanvasTextObject(kind='text',x=100,y=120){
  const ctx=currentCanvasState();if(!ctx)return;syncCanvasDomToState();editorRoot.begin('create text');const id=`text-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,note=kind==='note'||kind==='card';const z=Math.max(0,...ctx.canvas.objects.map(o=>Number(o.z)||0))+1;ctx.canvas.objects.push({id,type:'text',role:kind==='card'?'connection-card':note?'note':'',x:clampCanvas(x,0,PAGE_CANVAS_W-260),y:clampCanvas(y,0,PAGE_CANVAS_H-120),w:note?300:360,h:note?180:150,z,rotation:0,html:kind==='card'?'<p>Новая карточка</p>':note?'<p>Новая заметка</p>':'<p>Введите текст…</p>',flow:!note,locked:false,style:{fontFamily:'Georgia',fontSize:note?20:18,lineHeight:1.45,color:note?'#34230f':null,align:'left',background:note?'#fff1a8':'transparent',padding:note?18:8}});update(s=>s.ui.canvasSelectedObjectId=id,{persist:false});editorRoot.commit();save();render();requestAnimationFrame(()=>{const el=document.querySelector(`[data-object-id="${CSS.escape(id)}"] .canvas-text-content`);if(el){el.focus();const sel=getSelection();sel?.selectAllChildren(el);}});
}
function addCanvasImageObject(src,name,x=220,y=220,asset={}){
  const ctx=currentCanvasState();if(!ctx)return;asset=Object.keys(asset).length?asset:(ctx.w.mediaLibrary||[]).find(item=>(item.url||item.src)===src)||{};syncCanvasDomToState();editorRoot.begin('create image');const id=`image-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,z=Math.max(0,...ctx.canvas.objects.map(o=>Number(o.z)||0))+1;ctx.canvas.objects.push(normalizeMediaObject({id,x,y,width:280,height:220,zIndex:z,rotation:0,assetId:asset.assetId||'',assetPath:asset.storagePath||'',url:String(src||''),alt:String(name||'Фото'),caption:'',layoutMode:'free',wrapMode:'around',fit:'cover',radius:0,opacity:1,gap:14,locked:false},ctx.page.id));update(s=>s.ui.canvasSelectedObjectId=id,{persist:false});editorRoot.commit();save();render();
}
function deleteSelectedCanvasObject(){if(!selectedCanvasObject){showFeedback('Сначала выберите объект');return;}const id=selectedCanvasObject.dataset.objectId,ctx=currentCanvasState();if(!ctx)return;syncCanvasDomToState();editorRoot.begin('delete');ctx.canvas.objects=ctx.canvas.objects.filter(o=>o.id!==id);removeDanglingConnections(ctx.canvas);update(s=>s.ui.canvasSelectedObjectId=null,{persist:false});selectedCanvasObject=null;editorRoot.commit();save();render();}
function duplicateSelectedCanvasObject(){if(!selectedCanvasObject)return;const id=selectedCanvasObject.dataset.objectId,ctx=currentCanvasState();if(!ctx)return;syncCanvasDomToState();editorRoot.begin('duplicate');const source=ctx.canvas.objects.find(o=>o.id===id);if(!source)return;const clone=structuredClone(source);clone.id=`${source.type}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;clone.x=clampCanvas((source.x||0)+28,0,PAGE_CANVAS_W-(source.w||100));clone.y=clampCanvas((source.y||0)+28,0,PAGE_CANVAS_H-(source.h||100));clone.z=Math.max(0,...ctx.canvas.objects.map(o=>Number(o.z)||0))+1;if(clone.type==='image')clone.zIndex=clone.z;ctx.canvas.objects.push(clone);update(s=>s.ui.canvasSelectedObjectId=clone.id,{persist:false});editorRoot.commit();save();render();}
function setCanvasLayer(mode){if(!selectedCanvasObject)return;editorRoot.begin('layer');const canvas=selectedCanvasObject.closest('#freePageCanvas');if(!canvas)return;const objects=[...canvas.querySelectorAll(':scope > .canvas-object')].sort((a,b)=>(Number(a.dataset.z)||0)-(Number(b.dataset.z)||0));let i=objects.indexOf(selectedCanvasObject);if(i<0)return;let j=i;if(mode==='front')j=objects.length-1;else if(mode==='back')j=0;else if(mode==='forward')j=Math.min(objects.length-1,i+1);else if(mode==='backward')j=Math.max(0,i-1);objects.splice(i,1);objects.splice(j,0,selectedCanvasObject);objects.forEach((o,k)=>{o.dataset.z=String(k+1);o.style.zIndex=String(k+1);});syncCanvasDomToState();editorRoot.commit();save();}
function toggleCanvasLock(){if(!selectedCanvasObject)return;editorRoot.begin('lock');selectedCanvasObject.dataset.locked=selectedCanvasObject.dataset.locked==='1'?'0':'1';selectedCanvasObject.classList.toggle('is-locked',selectedCanvasObject.dataset.locked==='1');syncCanvasDomToState();editorRoot.commit();save();updateCanvasInspector();}
function setCanvasObjectProperty(prop,value,live=false){
  const obj=selectedCanvasObject;if(!obj)return;editorRoot.begin(`change ${prop}`);const img=obj.querySelector('img');
  if(prop==='rotation'){obj.dataset.rotation=String(Number(value)||0);applyCanvasObjectGeometry(obj);const o=document.querySelector('#canvasRotationOutput');if(o)o.textContent=`${Math.round(Number(value)||0)}°`;}
  if(obj.dataset.objectType==='image'){
    if(prop==='opacity'){obj.dataset.opacity=String(value);if(img)img.style.opacity=String(value);const o=document.querySelector('#canvasOpacityOutput');if(o)o.textContent=`${Math.round(Number(value)*100)}%`;}
    if(prop==='radius'){obj.dataset.radius=String(Number(value)||0);if(img)img.style.borderRadius=`${Number(value)||0}px`;const o=document.querySelector('#canvasRadiusOutput');if(o)o.textContent=`${Number(value)||0}px`;}
    if(prop==='fit'){obj.dataset.fit=String(value);if(img)img.style.objectFit=String(value);}
    if(prop==='layout'||prop==='wrap'){
      if(prop==='layout')obj.dataset.layoutMode=value==='flow'?'flow':'free';
      if(prop==='wrap')obj.dataset.wrapMode=String(value);
      const media=normalizeMediaObject({x:Number(obj.dataset.x),y:Number(obj.dataset.y),width:Number(obj.dataset.w),height:Number(obj.dataset.h),layoutMode:obj.dataset.layoutMode,wrapMode:obj.dataset.wrapMode});
      obj.dataset.x=String(media.x);obj.dataset.y=String(media.y);obj.dataset.w=String(media.width);obj.dataset.h=String(media.height);obj.dataset.wrap=media.wrap;
      applyCanvasObjectGeometry(obj);attachCanvasWrapProxies();
    }
    if(prop==='caption'){obj.dataset.caption=String(value);let caption=obj.querySelector('.canvas-image-caption');if(!caption){caption=document.createElement('span');caption.className='canvas-image-caption';obj.appendChild(caption);}caption.textContent=String(value);}
    if(prop==='gap'){obj.dataset.gap=String(Number(value)||0);const o=document.querySelector('#canvasWrapGapOutput');if(o)o.textContent=`${Number(value)||0}px`;attachCanvasWrapProxies();}
  }else{
    const content=obj.querySelector('.canvas-text-content');
    if(prop==='textBg'){obj.dataset.bg=String(value);if(content)content.style.background=String(value);const mode=document.querySelector('#canvasTextBgMode');if(mode)mode.value='color';}
    if(prop==='textBgMode'){if(String(value)==='transparent'){obj.dataset.bg='transparent';if(content)content.style.background='transparent';}else{const c=document.querySelector('#canvasTextBgColor')?.value||'#fff1a8';obj.dataset.bg=c;if(content)content.style.background=c;}}
    if(prop==='flow'){obj.dataset.flow=String(value)==='0'?'0':'1';attachCanvasWrapProxies();}
  }
  syncCanvasDomToState();editorRoot.commit();if(live)scheduleStudioAutosave();else save();
}
function applyCanvasBackgroundDom(){
  const ctx=currentCanvasState(),canvas=document.querySelector('#freePageCanvas');if(!ctx||!canvas)return;const bg=ctx.canvas.background||{};canvas.dataset.bgColor=bg.color||'#f7f1e5';canvas.dataset.bgImage=bg.image||'';canvas.dataset.bgFit=bg.fit||'cover';canvas.dataset.textColor=ctx.canvas.textColor||'#191715';canvas.style.backgroundColor=bg.color||'#f7f1e5';let im=canvas.querySelector(':scope > .page-background-image');if(bg.image){if(!im){im=document.createElement('img');im.className='page-background-image';im.alt='';im.draggable=false;canvas.prepend(im);}im.src=bg.image;im.style.objectFit=bg.fit||'cover';}else im?.remove();canvas.querySelectorAll('.canvas-text-object').forEach(o=>{const content=o.querySelector('.canvas-text-content');if(content&&!o.dataset.baseColor)content.style.color=ctx.canvas.textColor||'#191715';});
}
function setPageBackgroundColor(color){const ctx=currentCanvasState();if(!ctx)return;editorRoot.begin('background color');ctx.canvas.background.color=String(color);editorRoot.commit();applyCanvasBackgroundDom();scheduleStudioAutosave();}
function setPageTextColor(color){const ctx=currentCanvasState();if(!ctx)return;editorRoot.begin('text color');ctx.canvas.textColor=String(color);editorRoot.commit();applyCanvasBackgroundDom();scheduleStudioAutosave();}
function setPageBackgroundFit(fit){const ctx=currentCanvasState();if(!ctx)return;editorRoot.begin('background fit');ctx.canvas.background.fit=fit==='contain'?'contain':'cover';editorRoot.commit();applyCanvasBackgroundDom();scheduleStudioAutosave();}
function setPageBackgroundImage(src){const ctx=currentCanvasState();if(!ctx)return;editorRoot.begin('background');const asset=(ctx.w.mediaLibrary||[]).find(item=>(item.url||item.src)===src);Object.assign(ctx.canvas.background,{image:String(src||''),assetId:asset?.assetId||null,assetPath:asset?.storagePath||null,storagePath:asset?.storagePath||null});delete ctx.canvas.background.backgroundRecoveryKey;editorRoot.commit();applyCanvasBackgroundDom();attachEditorImageStatus();save();}
function clearPageBackgroundImage(){setPageBackgroundImage('');}
function mergeBands(bands){const sorted=bands.filter(b=>b.end>b.start).sort((a,b)=>a.start-b.start),out=[];for(const b of sorted){const last=out.at(-1);if(last&&b.start<=last.end)last.end=Math.max(last.end,b.end);else out.push({...b});}return out;}
function exclusionGradient(bands,height){const m=mergeBands(bands);if(!m.length)return 'none';const stops=['transparent 0%'];for(const b of m){const a=clampCanvas(b.start/height*100,0,100),z=clampCanvas(b.end/height*100,0,100);stops.push(`transparent ${a.toFixed(2)}%`,`rgba(0,0,0,1) ${a.toFixed(2)}%`,`rgba(0,0,0,1) ${z.toFixed(2)}%`,`transparent ${z.toFixed(2)}%`);}stops.push('transparent 100%');return `linear-gradient(to bottom,${stops.join(',')})`;}
function attachCanvasWrapProxies(){
  document.querySelectorAll('.page-composition').forEach(canvas=>{
    canvas.querySelectorAll('.canvas-wrap-proxy').forEach(x=>x.remove());
    const images=[...canvas.querySelectorAll(':scope > .canvas-image-object[data-wrap="auto"]')];if(!images.length)return;
    for(const textObj of canvas.querySelectorAll(':scope > .canvas-text-object[data-flow="1"]')){
      const content=textObj.querySelector('.canvas-text-content');if(!content||Math.abs(Number(textObj.dataset.rotation)||0)>1)continue;const tr=textObj.getBoundingClientRect();if(tr.width<20||tr.height<20)continue;const left=[],right=[];
      for(const image of images){const ir=image.getBoundingClientRect();const ix=Math.max(ir.left,tr.left),iy=Math.max(ir.top,tr.top),rx=Math.min(ir.right,tr.right),by=Math.min(ir.bottom,tr.bottom);if(rx<=ix||by<=iy)continue;const gap=(Number(image.dataset.gap)||14)*(tr.width/PAGE_CANVAS_W);const center=(ir.left+ir.right)/2;const side=center<tr.left+tr.width/2?'left':'right';const band={start:Math.max(0,iy-tr.top-gap),end:Math.min(tr.height,by-tr.top+gap),width:side==='left'?Math.min(tr.width,rx-tr.left+gap):Math.min(tr.width,tr.right-ix+gap)};(side==='left'?left:right).push(band);}
      for(const [side,bands] of [['left',left],['right',right]]){if(!bands.length)continue;const proxy=document.createElement('span');proxy.className=`canvas-wrap-proxy proxy-${side}`;proxy.contentEditable='false';const width=Math.max(...bands.map(b=>b.width));proxy.style.cssText=`float:${side};width:${Math.max(1,width)}px;height:${Math.max(1,tr.height)}px;shape-outside:${exclusionGradient(bands,tr.height)};shape-image-threshold:.1;pointer-events:none;user-select:none;opacity:0;`;content.prepend(proxy);}
    }
  });
}

function attachReadingProgress(text){
  const workId=text.dataset.work; if(!workId)return;
  const saved=Math.max(0,Math.min(100,Number(state.readingProgress?.[workId]||0)));
  requestAnimationFrame(()=>{
    const max=Math.max(0,text.scrollHeight-text.clientHeight);
    if(max>0&&saved>0&&saved<100) text.scrollTop=max*(saved/100);
  });
  let timer=null;
  text.addEventListener('scroll',()=>{
    const max=Math.max(1,text.scrollHeight-text.clientHeight);
    const pct=Math.max(0,Math.min(99,Math.round((text.scrollTop/max)*100)));
    const label=document.querySelector('#readerProgressValue'); if(label)label.textContent=`${pct}%`;
    clearTimeout(timer); timer=setTimeout(()=>{update(s=>{s.readingProgress[workId]=pct;if(!s.library.completed.includes(workId)&&!s.library.reading.includes(workId))s.library.reading.push(workId);});const w=state.works.find(x=>x.id===workId);if(w?.cloud)saveCloudReadingProgress(w,{progress:pct,status:'reading'}).catch(error=>reportSyncIssue('Прогресс чтения',error));},320);
  });
}

function activeRichEditor(){
  const node=window.getSelection()?.anchorNode;
  const el=node?.nodeType===1?node:node?.parentElement;
  return el?.closest?.('.rich-editor,.canvas-text-content')||selectedCanvasObject?.querySelector?.('.canvas-text-content')||document.querySelector('.rich-editor,.canvas-text-content');
}
function rememberEditorSelection(){
  const sel=window.getSelection(); if(!sel||!sel.rangeCount)return;
  const range=sel.getRangeAt(0); const root=(range.commonAncestorContainer.nodeType===1?range.commonAncestorContainer:range.commonAncestorContainer.parentElement)?.closest?.('.rich-editor,.canvas-text-content');
  if(root) savedEditorRange=range.cloneRange();
}
function restoreEditorSelection(){
  const ed=activeRichEditor();
  if(!savedEditorRange)return ed;
  try{const sel=window.getSelection();sel.removeAllRanges();sel.addRange(savedEditorRange);}catch{}
  return activeRichEditor()||ed;
}
function updateEditorWordCount(){
  const label=document.querySelector('#editorWordCount'); if(!label)return;
  const text=[...document.querySelectorAll('.rich-editor,.canvas-text-content')].map(x=>x.innerText||'').join(' ').trim();
  const count=text?text.split(/\s+/).filter(Boolean).length:0; label.textContent=`${count} слов`;
}
function execEditorCommand(cmd,value=null){
  const ed=restoreEditorSelection(); if(!ed){notify('Сначала поставьте курсор в текст');return;}
  ed.focus();
  syncCanvasDomToState();editorRoot.begin(`format ${cmd}`);
  try{document.execCommand('styleWithCSS',false,true);if(!document.execCommand(cmd,false,value))showFeedback('Команда недоступна для текущего выделения');}
  catch(error){showFeedback(`Не удалось применить форматирование: ${error.message}`,{kind:'error'});}
  syncCanvasDomToState();editorRoot.commit();
  rememberEditorSelection();updateEditorWordCount();scheduleStudioAutosave();syncEditorToolbar();
}
function selectedBlocks(ed){
  const range=savedEditorRange; if(!ed||!range)return [];
  const blocks=[...ed.querySelectorAll('p,h1,h2,h3,h4,blockquote,li,div')].filter(el=>{try{return range.intersectsNode(el);}catch{return false;}});
  if(blocks.length)return blocks;
  const node=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
  const block=node?.closest?.('p,h1,h2,h3,h4,blockquote,li,div');return block&&ed.contains(block)?[block]:[ed];
}
function applyFontSize(px){
  const ed=restoreEditorSelection();if(!ed)return;
  ed.focus();syncCanvasDomToState();editorRoot.begin('font size');
  try{document.execCommand('styleWithCSS',false,false);document.execCommand('fontSize',false,'7');}catch(error){showFeedback(`Размер шрифта не изменён: ${error.message}`,{kind:'error'});}
  ed.querySelectorAll('font[size="7"]').forEach(font=>{const span=document.createElement('span');span.style.fontSize=`${px}px`;span.append(...font.childNodes);font.replaceWith(span);});
  syncCanvasDomToState();editorRoot.commit();
  rememberEditorSelection();scheduleStudioAutosave();
}
function applyEditorTool(tool,value){
  const ed=restoreEditorSelection();if(!ed){notify('Выделите текст или поставьте курсор');return;}
  ed.focus();
  if(tool==='fontFamily')execEditorCommand('fontName',value);
  else if(tool==='fontSize')applyFontSize(Number(value)||16);
  else if(tool==='color')execEditorCommand('foreColor',value);
  else if(tool==='backgroundColor')execEditorCommand('hiliteColor',value);
  else if(tool==='block')execEditorCommand('formatBlock',value);
  else if(tool==='lineHeight'){syncCanvasDomToState();editorRoot.begin('line height');selectedBlocks(ed).forEach(el=>el.style.lineHeight=String(value));syncCanvasDomToState();editorRoot.commit();rememberEditorSelection();scheduleStudioAutosave();}
  syncEditorToolbar();
}
function syncEditorToolbar(){
  const ed=activeRichEditor();if(!ed)return;
  const sel=window.getSelection();const node=sel?.anchorNode;const el=node?.nodeType===1?node:node?.parentElement;if(!el||!ed.contains(el))return;
  const cs=getComputedStyle(el);
  const family=document.querySelector('[data-editor-tool="fontFamily"]');if(family){const f=cs.fontFamily.replace(/["']/g,'').split(',')[0].trim();if([...family.options].some(o=>o.value===f))family.value=f;}
  const size=document.querySelector('[data-editor-tool="fontSize"]');if(size){const n=Math.round(parseFloat(cs.fontSize));if([...size.options].some(o=>Number(o.value)===n))size.value=String(n);}
  const line=document.querySelector('[data-editor-tool="lineHeight"]');if(line){const lh=parseFloat(cs.lineHeight)/Math.max(1,parseFloat(cs.fontSize));const best=[...line.options].map(o=>Number(o.value)).sort((a,b)=>Math.abs(a-lh)-Math.abs(b-lh))[0];if(best)line.value=String(best);}
}
function syncCurrentBookPage(){
  const form=document.querySelector('#workEditor'); if(!form)return;
  const id=form.dataset.id; const w=state.works.find(x=>x.id===id); if(!w)return;
  syncCanvasDomToState();
}
function syncDocumentPages(){
  const form=document.querySelector('#workEditor'); if(!form)return;
  const id=form.dataset.id; const w=state.works.find(x=>x.id===id); if(!w||w.editorMode==='book')return;
  if(document.querySelector('#freePageCanvas')){syncCanvasDomToState();return;}
  const editors=[...document.querySelectorAll('.doc-page-editor')];
  if(editors.length)w.documentPages=editors.map((el,i)=>normalizePageMedia({id:w.documentPages?.[i]?.id||`doc-${Date.now()}-${i}`,html:cleanEditorHtml(el)}));
}
function syncStudioEditor(){ syncCurrentBookPage(); syncDocumentPages(); }

function requestStudioPageDeletion(index){
  syncStudioEditor();const ctx=currentCanvasState();if(!ctx)return;
  const pages=workPages(ctx.w),page=pages[index];
  if(!page)throw new Error('Страница не найдена');
  if(['cover','title'].includes(page.type)||pages.length<=1)throw new Error('Эту страницу нельзя удалить');
  if(pageHasContent(page)){
    openModal(`<h2>Удалить страницу ${index+1}?</h2><p>На странице есть содержимое или связи. Удаление страницы не удаляет файлы проекта.</p><div class="actions"><button type="button" data-action="close-modal">Отмена</button><button type="button" class="danger" data-action="confirm-delete-studio-page" data-work="${esc(ctx.w.id)}" data-page="${esc(page.id)}">Удалить страницу</button></div>`);return;
  }
  confirmStudioPageDeletion(ctx.w.id,page.id);
}
function confirmStudioPageDeletion(workId,pageId){
  const work=state.works.find(item=>item.id===workId);if(!work)throw new Error('Проект недоступен');
  const index=workPages(work).findIndex(page=>page.id===pageId);
  const selected=workPages(work)[state.ui.bookPageIndex||0]?.id;
  const next=removeStudioPage(work,index);
  state.ui.bookPageIndex=selected===pageId?next:Math.max(0,workPages(work).findIndex(page=>page.id===selected));
  state.ui.bookSpreadIndex=Math.min(state.ui.bookSpreadIndex||0,workPages(work).length-1);
  state.ui.canvasSelectedObjectId=null;state.ui.modal=null;
  save();rememberNavigationScroll();render();scheduleStudioAutosave();
}
function textFromHtml(html){const d=document.createElement('div');d.innerHTML=html||'';return (d.innerText||'').trim();}
function insertMedia(src,name){
  if(document.querySelector('#freePageCanvas')){const asset=currentCanvasState()?.w.mediaLibrary?.find(item=>(item.url||item.src)===src)||{};addCanvasImageObject(src,name,220,220,asset);return;}
  const form=document.querySelector('#workEditor'); if(!form)return;
  const w=state.works.find(x=>x.id===form.dataset.id); if(!w)return;
  const pageType=document.querySelector('.book-stage')?.dataset.pageType;
  if(w.editorMode==='book'&&pageType==='cover'){
    syncCurrentBookPage(); update(s=>{const p=s.works.find(x=>x.id===w.id)?.bookPages?.[s.ui.bookPageIndex||0];if(p)p.image=src;});render();return;
  }
  const ed=restoreEditorSelection(); if(!ed){notify('Поставьте курсор в текст и повторите');return;}
  const figure=document.createElement('figure');figure.className='embedded-media wrap-block';figure.contentEditable='false';figure.dataset.gap='18';figure.style.cssText='width:55%;max-width:55%;--media-gap:18px';
  const img=document.createElement('img');img.src=String(src);img.alt=String(name||'Иллюстрация');img.draggable=false;figure.appendChild(img);
  const cap=document.createElement('figcaption');cap.textContent=String(name||'Иллюстрация');figure.appendChild(cap);
  const range=savedEditorRange;let block=null;
  if(range){let node=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;while(node&&node.parentElement!==ed)node=node.parentElement;if(node&&node.parentElement===ed)block=node;}
  if(block)block.after(figure);else ed.appendChild(figure);
  if(!figure.nextSibling){const p=document.createElement('p');p.innerHTML='<br>';ed.appendChild(p);}
  attachMediaInteractions();selectMediaFigure(figure);updateEditorWordCount();scheduleStudioAutosave();
}
function setMediaWrap(wrap){
  if(!selectedMediaFigure){notify('Сначала нажмите на картинку в тексте');return;}
  selectedMediaFigure.classList.remove('wrap-left','wrap-right','wrap-wide','wrap-block'); selectedMediaFigure.classList.add(wrap);
  if(wrap==='wrap-wide'){selectedMediaFigure.style.width='100%';selectedMediaFigure.style.maxWidth='100%';}
  else if(wrap==='wrap-block' && parseFloat(selectedMediaFigure.style.width||'0')>=95){selectedMediaFigure.style.width='65%';selectedMediaFigure.style.maxWidth='65%';}
  updateMediaControls();syncStudioEditor();save();
}
async function handleMediaUpload(e){
  const file=e.target.files?.[0]; if(!file)return;
  syncStudioEditor();
  if(file.size>12_000_000){showFeedback('Изображение слишком большое. Максимум 12 МБ.');e.target.value='';return;}
  const form=document.querySelector('#workEditor'); const id=form?.dataset.id; if(!id)return;
  try{
    const asset=await uploadStudioAsset(file);
    const src=asset.url;
    update(s=>{const w=s.works.find(x=>x.id===id);if(w)(w.mediaLibrary??=[]).push(asset);},{persist:true});
    addCanvasImageObject(src,file.name,220,220,asset);
  }catch(err){showFeedback(`Не удалось обработать изображение: ${err.message}`);}finally{e.target.value='';}
}
async function uploadStudioAsset(file){
  const workId=currentCanvasState()?.w?.cloudId||currentCanvasState()?.w?.id||'draft';
  if(!isCloudAuthenticated())throw new Error('Для загрузки изображения нужна активная облачная сессия');
  return workAssets.uploadImage(file,{workId:String(workId).replace(/^cloud:/,'')});
}

function startCreateProject(type,mode){
  const id='w-'+Date.now();
  update(s=>{
    const blank={id,authorId:s.user.id,author:s.user.name,title:'Без названия',kind:type==='fragment'?'Фрагмент':'Роман',genres:[],summary:'',cover:'/assets/home/reading-cover.png',version:'0.1',rating:0,ratingsCount:0,authorActivity:20,createdAt:new Date().toISOString(),minutes:2,publicationStatus:'draft',evaluationStatus:'closed',status:'draft',targetType:'Фрагмент',evaluationTarget:'Фрагмент',evaluationText:'',feedbackWanted:[],content:'',creationType:type,writingStatus:type==='draft'?'draft':'writing',editorMode:mode,documentPages:[{id:'doc-'+Date.now(),html:'<p><br></p>'}],bookPages:[makeCanvasPage('cover','Без названия',s.user.name),makeCanvasPage('title','Без названия',s.user.name),makeCanvasPage('content','Без названия',s.user.name)],mediaLibrary:[]};
    s.works.unshift(blank);s.ui.selectedStudioWorkId=id;s.ui.createDraftType=null;s.ui.bookPageIndex=0;s.ui.bookViewMode=false;s.ui.bookSpreadIndex=0;s.ui.page='create';
  }); rememberNavigationScroll();render();
}
function cleanIdentifier(method,value){
  const raw=String(value||'').trim();
  if(method==='phone')return raw.replace(/[\s()\-]/g,'');
  return raw.toLowerCase();
}
function cloudUserFrom(profile,authUser,fallback={}){
  return {
    id:authUser?.id||profile?.id,
    nickname:profile?.nickname||fallback.nickname||profile?.username||'Пользователь',
    name:profile?.nickname||fallback.nickname||profile?.username||'Пользователь',
    firstName:profile?.first_name??fallback.firstName??'',
    lastName:profile?.last_name??fallback.lastName??'',
    username:profile?.username||fallback.username||'',
    email:authUser?.email||fallback.email||'',
    phone:authUser?.phone||fallback.phone||'',
    role:(profile?.account_role==='author'&&profile?.author_verified)?'author':'reader',
    requestedRole:profile?.account_role||fallback.role||'reader',
    verified:!!profile?.author_verified,
    isAdmin:!!profile?.is_admin,
    xp:profile?.xp||0,
    reputation:profile?.reviewer_reputation||0,
    bio:profile?.bio??fallback.bio??'',currentStatus:profile?.current_status??fallback.currentStatus??'',interests:profile?.interests??fallback.interests??[],favoriteTopics:profile?.favorite_topics??fallback.favoriteTopics??[],
    ...profileMediaState(profile,fallback,publicObjectUrl),
    preferences:profile?.wanted_genres||fallback.preferences||[],
    avoid:profile?.unwanted_genres||fallback.avoid||[],
    cloud:true,
    createdAt:new Date().toISOString()
  };
}
function mergeProfileDetails(user,details,catalogs){
  const genreName=new Map(catalogs.genres.map(item=>[Number(item.id),item.name]));
  const ids=(rows,preference)=>rows.filter(row=>row.preference===preference).map(row=>Number(row.genre_id??row.topic_id));
  Object.assign(user,{favoriteBooks:details.favoriteBooks,socialLinks:details.socialLinks,followers:details.followers,following:details.following,achievements:details.achievements||[],wantedGenreIds:ids(details.genrePreferences,'wanted'),unwantedGenreIds:ids(details.genrePreferences,'unwanted'),wantedTopicIds:ids(details.topicPreferences,'wanted'),unwantedTopicIds:ids(details.topicPreferences,'unwanted')});
  user.wantedGenreNames=user.wantedGenreIds.map(id=>genreName.get(id)).filter(Boolean);
}
async function waitForProfile(){
  for(let i=0;i<4;i++){
    const profile=await getMyProfile();
    if(profile)return profile;
    await new Promise(r=>setTimeout(r,250*(i+1)));
  }
  return null;
}
async function handleRegistrationOtpRequest(e){
  e.preventDefault();
  const fd=new FormData(e.currentTarget); const role=e.currentTarget.dataset.role;
  const genres=fd.getAll('genres'); const avoid=fd.getAll('avoid').filter(x=>!genres.includes(x));
  const nickname=String(fd.get('nickname')||'').trim();
  const firstName=String(fd.get('firstName')||'').trim();
  const lastName=String(fd.get('lastName')||'').trim();
  const username=String(fd.get('username')||'').trim().replace(/^@/,'');
  const identifier=cleanIdentifier(authMethod,fd.get('identifier'));
  if(authMethod==='phone'&&!/^\+\d{7,15}$/.test(identifier)){showFeedback('Телефон укажите в международном формате, например +79991234567.');return;}
  const metadata={username,nickname,first_name:firstName,last_name:lastName,account_role:role};
  try{
    await requestOtp({method:authMethod,identifier,createUser:true,metadata});
    otpPending={mode:'register',method:authMethod,identifier,role,registration:{nickname,firstName,lastName,username,preferences:genres,avoid,email:authMethod==='email'?identifier:'',phone:authMethod==='phone'?identifier:''},metadata};
    render();
  }catch(err){showFeedback(`Не удалось отправить код: ${err.message}`);}
}
async function handleLoginOtpRequest(e){
  e.preventDefault();const fd=new FormData(e.currentTarget);const identifier=cleanIdentifier(authMethod,fd.get('identifier'));
  if(authMethod==='phone'&&!/^\+\d{7,15}$/.test(identifier)){showFeedback('Телефон укажите в международном формате, например +79991234567.');return;}
  try{
    await requestOtp({method:authMethod,identifier,createUser:false});
    otpPending={mode:'login',method:authMethod,identifier};render();
  }catch(err){showFeedback(`Не удалось отправить код: ${err.message}`);}
}
async function resendOtp(){
  if(!otpPending)return;
  try{
    await requestOtp({method:otpPending.method,identifier:otpPending.identifier,createUser:otpPending.mode==='register',metadata:otpPending.metadata||{}});
    showFeedback('Код отправлен повторно');
  }catch(err){showFeedback(`Не удалось повторно отправить код: ${err.message}`);}
}
async function handleOtpVerify(e){
  e.preventDefault(); if(!otpPending)return;
  const token=String(new FormData(e.currentTarget).get('token')||'').trim();
  if(!token){showFeedback('Введите код из сообщения.');return;}
  try{
    const auth=await verifyOtp({method:otpPending.method,identifier:otpPending.identifier,token});
    if(!auth?.access_token||!auth?.user)throw new Error('Supabase не вернул активную сессию');
    const fallback=otpPending.registration||{};
    let profile=await waitForProfile();
    // Этот Supabase-проект используется и другими частями Fraktum. Если email/телефон
    // уже существовал в auth.users раньше, триггер INSERT не создаст lit_profiles повторно.
    // В таком случае завершаем именно регистрацию литературного профиля после успешного OTP.
    if(!profile && otpPending.mode==='register'){
      profile=await createMyProfile({
        username:fallback.username,
        nickname:fallback.nickname,
        firstName:fallback.firstName,
        lastName:fallback.lastName,
        role:'reader'
      });
    }
    if(!profile)throw new Error('Для этого аккаунта ещё нет профиля FRAKTUM. Нажмите «Регистрация», чтобы создать его.');
    if(otpPending.mode==='register'){
      const updated=await updateMyProfile({wanted_genres:fallback.preferences||[],unwanted_genres:fallback.avoid||[]}).catch(()=>null);
      if(updated) profile=updated;
      else Object.assign(profile,{wanted_genres:fallback.preferences||profile.wanted_genres,unwanted_genres:fallback.avoid||profile.unwanted_genres});
      if(otpPending.role==='author'){
        await requestAuthorVerification('Заявка создана при регистрации автора в Closed Beta.').catch(err=>reportSyncIssue('Заявка автора',err));
      }
    }
    const user=cloudUserFrom(profile,auth.user,fallback);
    await refreshIdentityData(user);
    update(s=>{s.user=user;s.ui.page='home';s.cloud={...(s.cloud||{}),connected:true,serverOnline:true,lastSync:new Date().toISOString(),error:null};});
    signupRole=null;loginMode=false;otpPending=null;forceAuthScreen=false;await refreshCloudLiterature();await refreshCloudFeed();await refreshCloudChats(false);await refreshNotifications(false);if(user.isAdmin)await refreshAdminData(false);startCloudPolling();render();await restoreLocation({initial:true});
  }catch(err){showFeedback(`Код не подтверждён: ${err.message}`);}
}

async function refreshCloudFeed(){
  if(!isCloudAuthenticated())return;
  try{const cloud=await fetchPublicFeed();update(s=>{const linked=s.ui.page==='post'?s.posts.find(post=>post.cloudId===s.ui.postId):null;s.posts=linked&&!cloud.some(post=>post.id===linked.id)?[linked,...cloud]:cloud;s.cloud={...(s.cloud||{}),connected:true,serverOnline:true,lastSync:new Date().toISOString(),error:null};},{persist:false});cloudFeedLoaded=true;}catch(err){update(s=>{s.cloud={...(s.cloud||{}),connected:isCloudAuthenticated(),lastSync:null,error:err.message};},{persist:false});}
}
async function refreshIdentityData(user){
  const [catalogs,details]=await Promise.all([fetchDiscoveryCatalogs(),fetchMyProfileDetails()]);mergeProfileDetails(user,details,catalogs);update(s=>{s.catalogs=catalogs;s.user=user;},{persist:true});
}

async function refreshCloudLiterature(){
  if(!isCloudAuthenticated())return;
  try{
    const data=await fetchCloudLiterature();
    update(s=>{
      const localWorks=(s.works||[]).filter(w=>!w.cloud);
      const localReviews=(s.reviews||[]).filter(r=>!r.cloud);
      s.works=[...localWorks,...(data.works||[])];
      s.reviews=[...localReviews,...(data.reviews||[])];
      if(s.ui.selectedWorkId&&!s.works.some(w=>w.id===s.ui.selectedWorkId))s.ui.selectedWorkId=null;
      if(s.ui.selectedStudioWorkId&&!s.works.some(w=>w.id===s.ui.selectedStudioWorkId))s.ui.selectedStudioWorkId=null;
    },{persist:false});
  }catch(err){reportSyncIssue('literature sync',err);}
}

async function refreshNotifications(renderIfChanged=false){
  if(!isCloudAuthenticated())return;
  try{
    const rows=await fetchNotifications();
    const prevUnread=(state.notifications||[]).filter(n=>!n.read_at).length;
    const nextUnread=(rows||[]).filter(n=>!n.read_at).length;
    update(s=>s.notifications=rows||[],{persist:false});
    if(renderIfChanged&&prevUnread!==nextUnread&&!document.activeElement?.matches('input,textarea,[contenteditable="true"]'))render();
  }catch(err){reportSyncIssue('notifications',err);}
}
async function refreshAdminData(renderAfter=false){
  if(!state.user?.isAdmin||!isCloudAuthenticated())return;
  try{
    const [reports,verification]=await Promise.all([fetchModerationReports(),fetchVerificationRequests()]);
    update(s=>{s.moderationReports=reports||[];s.verificationRequests=verification||[];},{persist:false});
    if(renderAfter)render();
  }catch(err){reportSyncIssue('admin sync',err);}
}
function notificationCenter(){
  const items=state.notifications||[];
  openModal(`<div class="notification-center"><div class="row spread"><div><span class="eyebrow">FRAKTUM</span><h2>Уведомления</h2></div>${items.some(n=>!n.read_at)?`<button data-action="notifications-read-all">Прочитать всё</button>`:''}</div><div class="notification-list">${items.length?items.map(n=>`<button class="notification-item ${n.read_at?'':'unread'}" data-action="notification-open" data-id="${n.id}" data-kind="${esc(n.entity_type||'')}" data-entity="${esc(n.entity_id||'')}"><span>${n.kind==='message'?'💬':n.kind==='review'?'✍':n.kind==='comment'?'↩':n.kind==='reaction'?'♥':'●'}</span><div><b>${esc(n.title)}</b><p>${esc(n.body||'')}</p><small>${new Date(n.created_at).toLocaleString('ru-RU')}</small></div></button>`).join(''):'<div class="empty"><h3>Новых событий нет</h3><p>Комментарии, рецензии и сообщения появятся здесь.</p></div>'}</div></div>`,'wide');
}
function reportDialog(targetType,targetId){
  openModal(`<h2>Пожаловаться</h2><p class="muted">Жалоба попадёт в закрытую очередь модерации FRAKTUM.</p><form id="reportForm"><input type="hidden" name="targetType" value="${esc(targetType)}"><input type="hidden" name="targetId" value="${esc(targetId)}"><label>Причина<select name="reason"><option>Спам</option><option>Оскорбления</option><option>Нарушение авторских прав</option><option>Опасный или запрещённый контент</option><option>Другое</option></select></label><label>Комментарий<textarea name="details" rows="4" placeholder="Что произошло?"></textarea></label><button class="primary wide">Отправить жалобу</button></form>`);
}
function publishChecklistDialog(){
  const x=collectEditor();if(!x)return;
  const w=state.works.find(z=>z.id===x.id);if(!w)return;
  const checks=[['Название',!!x.title],['Описание',x.summary.length>=20],['Жанр',x.genres.length>0],['Текст',x.content.trim().length>=100],['Обложка',!!(w.cover&& !w.cover.includes('reading-cover'))]];
  const ready=checks.filter(c=>c[1]).length;
  openModal(`<div class="publish-checklist"><span class="eyebrow">Публикация</span><h2>${esc(x.title||'Без названия')}</h2><p>Проверьте карточку произведения перед отправкой в раздел «Читать».</p><div class="publish-checks">${checks.map(([label,ok])=>`<div class="${ok?'ok':'warn'}"><b>${ok?'✓':'!'} ${label}</b><span>${ok?'готово':label==='Обложка'?'можно опубликовать и добавить позже':'нужно заполнить'}</span></div>`).join('')}</div><div class="modal-actions"><button data-action="close-modal">Вернуться</button><button data-action="preview-work">Предпросмотр</button><button class="primary" data-action="confirm-publish-work" ${ready<4?'disabled':''}>${w.publicationStatus==='published'?'Обновить публикацию':'Опубликовать'}</button></div></div>`,'wide');
}
function previewCurrentWork(){
  const x=collectEditor();if(!x)return;
  const w=state.works.find(z=>z.id===x.id);if(!w)return;
  openModal(`<div class="publish-preview"><span class="eyebrow">Предпросмотр карточки</span><div class="preview-work-card"><img src="${esc(w.cover||'/assets/home/reading-cover.png')}" alt=""><div><h2>${esc(x.title||'Без названия')}</h2><p class="muted">${esc(state.user.name)} · ${esc(x.kind)}</p><div>${x.genres.map(g=>`<span class="pill">${esc(g)}</span>`).join('')}</div><p>${esc(x.summary||'Описание ещё не добавлено.')}</p><small>${x.content.trim()?x.content.trim().split(/\s+/).length:0} слов · ~${Math.max(1,Math.ceil(x.content.length/900))} мин</small></div></div><div class="modal-actions"><button data-action="close-modal">Закрыть</button></div></div>`,'wide');
}
let lastChatSignature='';
async function refreshCloudChats(renderIfChanged=true){
  if(!isCloudAuthenticated())return;
  try{
    const data=await fetchMyConversations();
    let selectedId=state.ui.selectedChatId;
    if(!data.threads.some(t=>t.id===selectedId))selectedId=data.threads[0]?.id||null;
    if(selectedId){
      const selected=data.threads.find(t=>t.id===selectedId);
      if(selected)selected.messages=await fetchConversationMessages(selectedId);
    }
    const sig=JSON.stringify(data.threads.map(t=>[t.id,t.title,(t.messages||[]).map(m=>m.id)]));
    const changed=sig!==lastChatSignature;
    update(s=>{s.chatThreads=data.threads;s.peopleDirectory=data.people;s.friends=data.threads.filter(t=>t.type==='dm').flatMap(t=>t.memberIds).filter((x,i,a)=>a.indexOf(x)===i);s.ui.selectedChatId=selectedId;},{persist:false});
    const typing=document.activeElement?.closest?.('.thread-message-form');
    if(changed&&renderIfChanged&&!typing){lastChatSignature=sig;render();}
    else if(!changed||!renderIfChanged)lastChatSignature=sig;
  }catch(err){reportSyncIssue('chat sync',err);}
}
function startCloudPolling(){
  clearInterval(chatsPollTimer);clearInterval(incomingCallTimer);clearInterval(notificationsTimer);
  chatsPollTimer=setInterval(()=>refreshCloudChats(true),1800);
  incomingCallTimer=setInterval(pollIncomingCalls,1500);
  notificationsTimer=setInterval(()=>refreshNotifications(true),7000);
}
function stopCloudPolling(){clearInterval(chatsPollTimer);clearInterval(incomingCallTimer);clearInterval(notificationsTimer);chatsPollTimer=null;incomingCallTimer=null;notificationsTimer=null;}

async function pollIncomingCalls(){
  if(!isCloudAuthenticated()||activeRtc||callStarting||incomingCallPolling)return;
  incomingCallPolling=true;
  try{
    if(pendingIncomingCallId){
      const pending=await getCloudCall(pendingIncomingCallId);
      if(!pending||pending.status!=='ringing'){
        pendingIncomingCallId=null;
        if(document.querySelector('.incoming-call'))closeModal();
      }
    }
    const calls=await fetchIncomingCalls();
    if(!isCloudAuthenticated()||activeRtc||callStarting)return;
    const fresh=calls.find(c=>Date.now()-new Date(c.created_at).getTime()<60000&&!seenIncomingCalls.has(c.id));
    if(!fresh)return;
    seenIncomingCalls.add(fresh.id);
    pendingIncomingCallId=fresh.id;
    const caller=fresh.caller?.nickname||fresh.caller?.username||'Пользователь';
    openModal(`<div class="incoming-call"><span class="eyebrow">Входящий ${fresh.mode==='video'?'видеозвонок':'аудиозвонок'}</span><h2>${esc(caller)}</h2><p class="muted">Звонок идёт через WebRTC. Браузер попросит доступ к ${fresh.mode==='video'?'камере и микрофону':'микрофону'}.</p><div class="modal-actions"><button class="danger" data-action="decline-cloud-call" data-id="${fresh.id}">Отклонить</button><button class="primary" data-action="accept-cloud-call" data-id="${fresh.id}">Принять</button></div></div>`,'wide');
  }catch(err){reportSyncIssue('incoming calls',err);}finally{incomingCallPolling=false;}
}

function removeCallOverlay(){document.querySelector('#realCallOverlay')?.remove();}
function showCallOverlay({title,mode,status='Соединение'}){
  removeCallOverlay();
  const box=document.createElement('section');box.id='realCallOverlay';box.className=`real-call-overlay ${mode==='video'?'video':'audio'}`;
  box.setAttribute('role','dialog');box.setAttribute('aria-label','Звонок');
  box.innerHTML=`<div class="real-call-head"><div><span class="eyebrow">${mode==='video'?'Видеозвонок':'Аудиозвонок'}</span><h3>${esc(title)}</h3><small id="realCallStatus" role="status" aria-live="polite">${esc(status)}</small></div><button class="danger" id="realCallHangup">Завершить</button></div>${mode==='video'?`<div class="call-videos"><video id="remoteCallVideo" autoplay playsinline></video><video id="localCallVideo" autoplay playsinline muted></video></div>`:`<div class="audio-call-orb">☎</div><audio id="remoteCallAudio" autoplay></audio>`}<p id="realCallError" role="status" hidden></p><div class="actions"><button type="button" id="realCallMute" disabled aria-pressed="false">Выключить микрофон</button>${mode==='video'?'<button type="button" id="realCallCamera" disabled aria-pressed="false">Выключить камеру</button><button type="button" id="realCallSwitchCamera" disabled>Сменить камеру</button>':''}<button type="button" id="realCallPlay" hidden>Включить звук</button></div>`;
  document.body.appendChild(box);box.querySelector('#realCallHangup')?.addEventListener('click',()=>endCall(true));
  box.querySelector('#realCallMute')?.addEventListener('click',()=>{if(activeRtc)activeRtc.setMuted(!activeRtc.controls().muted);});
  box.querySelector('#realCallCamera')?.addEventListener('click',()=>{if(activeRtc)activeRtc.setCameraEnabled(!activeRtc.controls().cameraEnabled);});
  box.querySelector('#realCallSwitchCamera')?.addEventListener('click',async event=>{const session=activeRtc;if(!session)return;event.currentTarget.disabled=true;try{await session.switchCamera();}catch(error){showCallError(error.message);}finally{if(activeRtc===session)updateCallControls(session.controls());}});
  box.querySelector('#realCallPlay')?.addEventListener('click',async()=>{const media=document.querySelector(mode==='video'?'#remoteCallVideo':'#remoteCallAudio');try{await media?.play();box.querySelector('#realCallPlay').hidden=true;}catch(error){showCallError(`Браузер не разрешил воспроизведение: ${error.message}`);}});
}
function setCallStatusText(text){const el=document.querySelector('#realCallStatus');if(el)el.textContent=text;}
function showCallError(text){const el=document.querySelector('#realCallError');if(el){el.hidden=!text;el.textContent=text||'';}}
function updateCallControls({muted=false,cameraEnabled=true,canSwitchCamera=false}={}){
  const mic=document.querySelector('#realCallMute');if(mic){mic.disabled=!activeRtc?.localStream||activeRtc.ended;mic.textContent=muted?'Включить микрофон':'Выключить микрофон';mic.setAttribute('aria-pressed',String(muted));}
  const camera=document.querySelector('#realCallCamera');if(camera){camera.disabled=!activeRtc?.localStream||activeRtc.ended;camera.textContent=cameraEnabled?'Выключить камеру':'Включить камеру';camera.setAttribute('aria-pressed',String(!cameraEnabled));}
  const swap=document.querySelector('#realCallSwitchCamera');if(swap){swap.disabled=!canSwitchCamera||!activeRtc||activeRtc.ended;swap.title=canSwitchCamera?'Сменить камеру':'Вторая камера недоступна';}
}
function attachCallMedia(selector,stream){
  const media=document.querySelector(selector);if(!media)return;media.srcObject=stream;
  const playing=media.play();if(playing)playing.catch(()=>{if(!media.isConnected)return;const play=document.querySelector('#realCallPlay');if(play)play.hidden=false;});
}
async function setupRtc({callId,conversationId,peerId,title,mode,initiator}){
  showCallOverlay({title,mode,status:CALL_STATUS_LABELS[initiator?'calling':'connecting']});
  const session=new CallSession({callId,conversationId,peerId,title,mode,initiator,
    signaling:{send:(type,payload)=>sendCloudCallSignal(callId,peerId,type,payload),fetch:afterId=>fetchCloudCallSignals(callId,afterId),getStatus:()=>getCloudCall(callId),setStatus:status=>setCloudCallStatus(callId,status)},
    onState:(callState,detail)=>{
      if(activeRtc!==session&&!(session.ended&&document.querySelector('#realCallOverlay')?.dataset.callId===callId))return;
      const overlay=document.querySelector('#realCallOverlay');if(overlay)overlay.dataset.callState=callState;
      setCallStatusText(detail.label);showCallError(detail.error);
      window.dispatchEvent(new window.CustomEvent('fraktum:callstate',{detail:{state:callState}}));
    },
    onLocalStream:stream=>{if(activeRtc===session)attachCallMedia('#localCallVideo',stream);},
    onRemoteStream:stream=>{if(activeRtc===session)attachCallMedia(mode==='video'?'#remoteCallVideo':'#remoteCallAudio',stream);},
    onControlsChanged:controls=>{if(activeRtc===session)updateCallControls(controls);},
    onEnded:()=>{
      if(activeRtc!==session)return;activeRtc=null;
      update(s=>{s.callHistory.push({id:callId,title,mode:mode==='video'?'Видео':'Аудио',endedAt:new Date().toLocaleString('ru-RU',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'})});s.activeCall=null;s.ui.chatTab='calls';},{persist:false});
      const close=document.querySelector('#realCallHangup');if(close)close.textContent='Закрыть';updateCallControls();render();
    }
  });
  activeRtc=session;
  callStarting=false;
  document.querySelector('#realCallOverlay').dataset.callId=callId;
  window.FraktumRTC={diagnostics:()=>({...session.diagnostics})};
  update(s=>{s.activeCall={threadId:conversationId,callId,title,mode,startedAt:new Date().toISOString(),real:true};s.ui.chatTab='calls';s.ui.chatPanelOpen=true;},{persist:false});
  await session.start();
}
async function acceptCloudCall(callId){
  if(activeRtc||callStarting){notify('Сначала завершите текущий звонок');return;}const attempt={};callStarting=attempt;
  try{
    const call=await getCloudCall(callId);if(!call||call.status!=='ringing')throw new Error('Звонок уже завершён');
    const peer=await getConversationPeer(call.conversation_id);pendingIncomingCallId=null;closeModal();
    await setupRtc({callId,conversationId:call.conversation_id,peerId:peer.id,title:peer.nickname||peer.username||'Пользователь',mode:call.mode,initiator:false});
  }catch(err){if(document.querySelector('#realCallOverlay')?.dataset.callId!==callId||!document.querySelector('#realCallError')?.textContent)showFeedback(`Не удалось принять звонок: ${err.message}`);}finally{if(callStarting===attempt)callStarting=false;}
}
async function declineCloudCall(callId){try{await setCloudCallStatus(callId,'declined');pendingIncomingCallId=null;closeModal();}catch(err){showFeedback(err.message);}}
async function finishLocalCall(updateServer=true){
  if(!activeRtc){removeCallOverlay();return;}
  await activeRtc.end({notifyPeer:updateServer});
  if(!updateServer)removeCallOverlay();
}
window.addEventListener('pagehide',()=>{if(activeRtc)activeRtc.end({notifyPeer:false});});

function animateBookTurn({reader=false,direction=1}){
  if(bookFlipLocked)return;
  const w=state.works.find(x=>x.id===state.ui.selectedWorkId)||state.works.find(x=>x.id===document.querySelector('#workEditor')?.dataset.id);if(!w)return;
  const pages=w.bookPages||[];const field=reader?'readerBookIndex':'bookSpreadIndex';const current=Math.max(0,Number(state.ui[field]||0));
  const singlePage=window.matchMedia?.('(max-width:820px)')?.matches;
  let next;if(singlePage)next=current+(direction>0?1:-1);else if(direction>0)next=current===0?1:current+2;else next=current<=1?0:current-2;next=Math.max(0,Math.min(pages.length-1,next));if(next===current)return;
  const spread=document.querySelector(reader?'.reader-book-spread':'[data-book-spread]');if(!spread){update(s=>s.ui[field]=next,{persist:false});render();return;}
  bookFlipLocked=true;spread.classList.add(direction>0?'turn-next':'turn-prev');
  if(reader){const pct=Math.min(99,Math.round(((next+1)/Math.max(1,pages.length))*100));update(s=>{s.readingProgress[w.id]=pct;if(!s.library.reading.includes(w.id))s.library.reading.push(w.id);},{persist:true});if(w.cloud)saveCloudReadingProgress(w,{progress:pct,status:'reading'}).catch(error=>reportSyncIssue('Прогресс чтения',error));}
  setTimeout(()=>{update(s=>s.ui[field]=next,{persist:false});bookFlipLocked=false;render();},360);
}

function captureSelection(){
  const text=document.querySelector('#readerText'),sel=window.getSelection();selectedTextAnchor=captureTextAnchor(text,sel);const quote=selectedTextAnchor?.selectedText;
  document.querySelector('#annotationQuickbar')?.remove();
  if(quote&&quote.length>=2){update(s=>s.ui.selectedQuote=quote,{persist:false});const bar=document.createElement('div');bar.id='annotationQuickbar';bar.className='annotation-quickbar';bar.innerHTML=ANNOTATION_TYPES.map(([type,label])=>`<button data-action="annotation-type" data-type="${type}">${label}</button>`).join('');text?.closest('.reader-sheet')?.appendChild(bar);}
}

function searchGlobal(q){
  q=(q||'').trim().toLowerCase(); if(!q)return;
  const w=state.works.find(x=>x.title.toLowerCase().includes(q)||x.author.toLowerCase().includes(q));
  if(w){update(s=>{s.ui.selectedWorkId=w.id;s.ui.page=w.publicationStatus==='published'?'work':'home';},{persist:false});render();return;}
  notify('Ничего не найдено');
}

app.addEventListener('click',withOperation(async e=>{
  const figure=e.target.closest('.rich-editor .embedded-media');
  if(figure && !e.target.closest('.media-drag-handle')) selectMediaFigure(figure);
  else if(!figure && selectedMediaFigure && !e.target.closest('.studio-media')) selectMediaFigure(null);
  const el=e.target.closest('[data-action]'); if(!el)return;
  // A modal backdrop closes only when the backdrop itself is clicked.
  // Clicks on inputs, chips and controls inside the modal must stay inside the modal.
  if(el.classList.contains('modal-backdrop') && e.target.closest('[data-stop]')) return;
  const action=el.dataset.action;
  if(action==='choose-role'){signupRole=el.dataset.role;loginMode=false;otpPending=null;render();return;}
  if(action==='show-login'){loginMode=true;signupRole=null;otpPending=null;render();return;}
  if(action==='show-signup'){loginMode=false;signupRole=null;otpPending=null;render();return;}
  if(action==='auth-method'){authMethod=el.dataset.method==='phone'?'phone':'email';otpPending=null;render();return;}
  if(action==='cancel-otp'){otpPending=null;render();return;}
  if(action==='resend-otp'){return resendOtp();}
  if(action==='cloud-login'){forceAuthScreen=true;loginMode=true;signupRole=null;otpPending=null;render();return;}

  if(action==='cloud-logout'){stopCloudPolling();if(activeRtc)await finishLocalCall(false);try{await signOut();}finally{update(s=>{s.user=null;s.posts=[];s.chatThreads=[];s.peopleDirectory=[];s.friends=[];s.cloud={...(s.cloud||{}),connected:false};},{persist:false});loginMode=true;forceAuthScreen=false;render();}return;}
  if(action==='back-onboarding'){signupRole=null;otpPending=null;render();return;}
  if(action==='navigate'){if(el.dataset.page==='admin')await refreshAdminData(false);if(el.dataset.page==='feedback')await refreshAuthorFeedback();return go(el.dataset.page);}
  if(action==='toggle-sidebar'){update(s=>s.ui.sidebarOpen=!s.ui.sidebarOpen,{persist:false});render();return;}
  if(action==='start-evaluation') return startEvaluation();
  if(action==='evaluation-session-dialog') return evaluationSessionDialog();
  if(action==='evaluation-catalog') return openEvaluationCatalog();
  if(action==='evaluation-mode-home'){update(s=>{s.ui.evaluationMode=null;s.evaluationSession=null;},{persist:false});render();return;}
  if(action==='evaluation-catalog-open') return openCatalogEvaluation(el.dataset.version);
  if(action==='evaluation-session-next') return advanceEvaluationSession();
  if(action==='evaluation-filters') return evaluationFiltersDialog();
  if(action==='close-modal'){closeModal();return;}
  if(action==='close-modal-local'){closeModal();return;}
  if(action==='switch-role') return switchRole();
  if(action==='open-work') return openWork(el.dataset.id);
  if(action==='work-details') return openWorkDetails(el.dataset.id);
  if(action==='start-reading') return openWork(el.dataset.id);
  if(action==='toggle-later') return toggleLibrary('later',el.dataset.id);
  if(action==='apply-read-filters') return applyReadFilters();
  if(action==='reset-read-filters') return resetReadFilters();
  if(action==='save-selection') return annotationDialog();
  if(action==='annotation-type') return annotationDialog(el.dataset.type);
  if(action==='delete-annotation') return deleteAnnotation(el.dataset.work,el.dataset.scope||'evaluation',Number(el.dataset.index));
  if(action==='open-review') return reviewDialog(el.dataset.id,el.dataset.mode||'full');
  if(action==='react-review') return reactReview(el.dataset.id,el.dataset.kind);
  if(action==='reply-review') return replyReviewDialog(el.dataset.id);
  if(action==='report-review') return reportDialog('review',el.dataset.id);
  if(action==='feedback-work'){update(s=>s.ui.feedbackWorkId=el.dataset.id,{persist:false});render();return;}
  if(action==='profile-tab'){update(s=>s.ui.profileTab=el.dataset.tab,{persist:false});render();return;}
  if(action==='open-post') return postDialog();
  if(action==='open-notifications'){await refreshNotifications(false);notificationCenter();return;}
  if(action==='notifications-read-all'){await markAllNotificationsRead();await refreshNotifications(false);notificationCenter();return;}
  if(action==='notification-open'){await markNotificationRead(el.dataset.id);await refreshNotifications(false);closeModal();if(el.dataset.kind==='conversation'&&el.dataset.entity){update(s=>{s.ui.selectedChatId=el.dataset.entity;s.ui.page='messages';},{persist:false});await refreshCloudChats(false);}render();return;}
  if(action==='report-content') return reportDialog(el.dataset.targetType||'content',el.dataset.targetId||'');
  if(action==='refresh-admin'){await refreshAdminData(true);return;}
  if(action==='moderation-status'){await setModerationReportStatus(el.dataset.id,el.dataset.status);await refreshAdminData(true);return;}
  if(action==='resolve-verification'){await resolveAuthorVerification(el.dataset.id,el.dataset.status);await refreshAdminData(true);return;}
  if(action==='open-post-comments') return postCommentsDialog(el.dataset.id);
  if(action==='react-post-comment') return reactPostComment(el.dataset.post,el.dataset.id,el.dataset.kind);
  if(action==='like-post') return likePost(el.dataset.id);
  if(action==='share-post'){
    try{const result=await sharePost(state.posts.find(post=>post.id===el.dataset.id));if(result==='copied')notify('Ссылка скопирована');}
    catch(error){notify(`Не удалось поделиться: ${error.message}`);}
    return;
  }
  if(action==='new-work'){update(s=>{s.ui.selectedStudioWorkId='__new__';s.ui.createDraftType=null;s.ui.bookPageIndex=0;s.ui.bookViewMode=false;s.ui.bookSpreadIndex=0;},{persist:false});render();return;}
  if(action==='set-create-type'){update(s=>s.ui.createDraftType=el.dataset.type||null,{persist:false});render();return;}
  if(action==='start-create-project') return startCreateProject(el.dataset.type||'work',el.dataset.mode||'document');
  if(action==='studio-book-mode'){syncStudioEditor();update(s=>{s.ui.bookViewMode=el.dataset.mode==='book';if(s.ui.bookViewMode){const i=Math.max(0,s.ui.bookPageIndex||0);s.ui.bookSpreadIndex=i===0?0:(i%2===1?i:i-1);}},{persist:false});render();return;}
  if(action==='book-spread-next'){animateBookTurn({reader:false,direction:1});return;}
  if(action==='book-spread-prev'){animateBookTurn({reader:false,direction:-1});return;}
  if(action==='reader-book-next'){animateBookTurn({reader:true,direction:1});return;}
  if(action==='reader-book-prev'){animateBookTurn({reader:true,direction:-1});return;}
  if(action==='studio-focus-media'){document.querySelector('#studioMediaPanel')?.scrollIntoView({behavior:'smooth',block:'start'});return;}
  if(action==='studio-toggle-grid'){update(s=>s.ui.studioGrid=!s.ui.studioGrid,{persist:false});document.querySelector('.word-canvas')?.classList.toggle('show-page-grid',!!state.ui.studioGrid);document.querySelector('#freePageCanvas')?.classList.toggle('show-canvas-grid',!!state.ui.studioGrid);return;}
  if(action==='editor-cmd'){el.dataset.cmd==='undo'?editorRoot.undo():el.dataset.cmd==='redo'?editorRoot.redo():execEditorCommand(el.dataset.cmd,el.dataset.value||null);return;}
  if(action==='editor-link'){const url=prompt('Ссылка (https://...)');if(url)execEditorCommand('createLink',url);return;}
  if(action==='restore-legacy-media'){await restoreLegacyMedia();return;}
  if(action==='insert-media'){insertMedia(el.dataset.src,el.dataset.name);return;}
  if(action==='canvas-add-text'){const c=document.querySelector('#freePageCanvas');addCanvasTextObject('text',c?PAGE_CANVAS_W*.18:110,c?PAGE_CANVAS_H*.16:150);return;}
  if(action==='canvas-add-note'){addCanvasTextObject('note',120,180);return;}
  if(action==='canvas-add-card'){addCanvasTextObject('card',160,220);return;}
  if(action==='canvas-move'){showFeedback('Перетаскивайте объект или перемещайте его клавишами со стрелками.');return;}
  if(action==='connection-start'||action==='connection-select'||action==='connection-delete'||action==='connection-reverse'||action==='connection-cancel')return studioConnections.handleAction(action,el);
  if(action==='insert-canvas-media'){addCanvasImageObject(el.dataset.src,el.dataset.name);return;}
  if(action==='set-page-background'){setPageBackgroundImage(el.dataset.src);return;}
  if(action==='clear-page-background'){clearPageBackgroundImage();return;}
  if(action==='canvas-layer'){setCanvasLayer(el.dataset.layer);return;}
  if(action==='canvas-duplicate'){duplicateSelectedCanvasObject();return;}
  if(action==='canvas-lock'){toggleCanvasLock();return;}
  if(action==='canvas-delete'){deleteSelectedCanvasObject();return;}
  if(action==='media-wrap'){setMediaWrap(el.dataset.wrap);return;}
  if(action==='media-size'){setMediaSize(el.dataset.size);return;}
  if(action==='media-caption-toggle'){toggleMediaCaption();return;}
  if(action==='media-reset'){resetMediaPosition();return;}
  if(action==='delete-media'){if(selectedMediaFigure){selectedMediaFigure.remove();selectedMediaFigure=null;syncStudioEditor();save();updateEditorWordCount();}else notify('Сначала нажмите на картинку в тексте');return;}
  if(action==='book-page-select'){syncCurrentBookPage();const idx=Number(el.dataset.index)||0;update(s=>{s.ui.bookPageIndex=idx;s.ui.canvasSelectedObjectId=null;if(s.ui.bookViewMode)s.ui.bookSpreadIndex=idx===0?0:(idx%2===1?idx:idx-1);},{persist:true});rememberNavigationScroll();render();return;}
  if(action==='book-page-prev'){syncCurrentBookPage();update(s=>{s.ui.bookPageIndex=Math.max(0,(s.ui.bookPageIndex||0)-1);s.ui.canvasSelectedObjectId=null;},{persist:true});rememberNavigationScroll();render();return;}
  if(action==='book-page-next'){syncCurrentBookPage();const w=state.works.find(x=>x.id===document.querySelector('#workEditor')?.dataset.id);update(s=>{s.ui.bookPageIndex=Math.min(Math.max(0,(w?workPages(w).length:1)-1),(s.ui.bookPageIndex||0)+1);s.ui.canvasSelectedObjectId=null;},{persist:true});rememberNavigationScroll();render();return;}
  if(action==='add-book-page'){syncCurrentBookPage();const id=document.querySelector('#workEditor')?.dataset.id;update(s=>{const w=s.works.find(x=>x.id===id);if(w){const page=makeCanvasPage('content',w.title,w.author||s.user?.name||'');page.label=`Страница ${Math.max(1,w.bookPages.length-1)}`;w.bookPages.push(page);s.ui.bookPageIndex=w.bookPages.length-1;s.ui.bookViewMode=false;s.ui.canvasSelectedObjectId=null;}});rememberNavigationScroll();render();scheduleStudioAutosave();return;}
  if(action==='delete-book-page'||action==='delete-studio-page')return requestStudioPageDeletion(Number(el.dataset.index));
  if(action==='confirm-delete-studio-page')return confirmStudioPageDeletion(el.dataset.work,el.dataset.page);
  if(action==='add-document-page'){syncDocumentPages();const id=document.querySelector('#workEditor')?.dataset.id;update(s=>{const w=s.works.find(x=>x.id===id);if(w){w.documentPages.push(normalizePageMedia({id:'doc-'+crypto.randomUUID(),html:'<p><br></p>'}));s.ui.bookPageIndex=w.documentPages.length-1;s.ui.canvasSelectedObjectId=null;}});rememberNavigationScroll();render();scheduleStudioAutosave();return;}
  if(action==='studio-select'){syncStudioEditor();update(s=>{s.ui.selectedStudioWorkId=el.dataset.id;s.ui.page='create';s.ui.bookPageIndex=0;s.ui.bookViewMode=false;s.ui.bookSpreadIndex=0;s.ui.canvasSelectedObjectId=null;},{persist:true});rememberNavigationScroll();render();return;}
  if(action==='save-work') return saveWork('draft');
  if(action==='publish-work') return saveWork('published');
  if(action==='open-publish-checklist') return publishChecklistDialog();
  if(action==='confirm-publish-work'){closeModal();return saveWork('published');}
  if(action==='preview-work') return previewCurrentWork();
  if(action==='publish-evaluation') return saveWork('evaluation');
  if(action==='close-evaluation') return closeEvaluation();
  if(action==='new-version') return newVersion();
  if(action==='evaluate-next'){closeModal();return startEvaluation();}
  if(action==='save-notes') return saveNotes();
  if(action==='join-community') return joinCommunity(el.dataset.id);
  if(action==='open-community'){update(s=>{s.ui.selectedCommunityId=el.dataset.id;s.ui.page='community';},{persist:false});render();return;}
  if(action==='create-community') return communityDialog();
  if(action==='analytics'){update(s=>{s.ui.selectedWorkId=el.dataset.id;s.ui.page='analytics';},{persist:false});render();return;}
  if(action==='generate-summary') return generateSummary(el.dataset.id);
  if(action==='font-up'){readerFont=Math.min(26,readerFont+1);render();return;}
  if(action==='font-down'){readerFont=Math.max(14,readerFont-1);render();return;}
  if(action==='toggle-reader-theme'){readerTheme=(readerTheme+1)%3;render();return;}
  if(action==='edit-profile') return profileDialog();
  if(action==='toggle-chat-panel'){toggleChatPanel();return;}
  if(action==='chat-tab'){update(s=>{s.ui.chatTab=el.dataset.tab;s.ui.chatPanelOpen=true;const pool=s.chatThreads.filter(t=>el.dataset.tab==='groups'?t.type==='group':t.type==='dm');if(pool.length&&!pool.some(t=>t.id===s.ui.selectedChatId))s.ui.selectedChatId=pool[0].id;},{persist:false});render();return;}
  if(action==='open-thread'){update(s=>{s.ui.selectedChatId=el.dataset.id;s.ui.chatPanelOpen=true;const t=s.chatThreads.find(x=>x.id===el.dataset.id);s.ui.chatTab=t?.type==='group'?'groups':'chats';},{persist:false});await refreshCloudChats(false);render();return;}
  if(action==='select-thread'){update(s=>{s.ui.selectedChatId=el.dataset.id;},{persist:false});await refreshCloudChats(false);render();return;}
  if(action==='open-chat-person') return openChatWithPerson(el.dataset.id);
  if(action==='new-collab-group') return collaborationGroupDialog();
  if(action==='start-call') return startCall(el.dataset.id,el.dataset.mode||'audio');
  if(action==='accept-cloud-call') return acceptCloudCall(el.dataset.id);
  if(action==='decline-cloud-call') return declineCloudCall(el.dataset.id);
  if(action==='end-call') return endCall(true);
}));


app.addEventListener('change',e=>{
  const sel=e.target.closest('.word-command-select'); if(!sel)return;
  execEditorCommand(sel.dataset.command,sel.value);
});

app.addEventListener('submit',withOperation(async e=>{
  if(e.target.id==='annotationForm'){e.preventDefault();await saveAnnotation(new FormData(e.target));}
  if(e.target.id==='reviewForm'){e.preventDefault();await submitReview(new FormData(e.target));}
  if(e.target.id==='postForm'){e.preventDefault();await submitPost(new FormData(e.target));}
  if(e.target.id==='reportForm'){e.preventDefault();const fd=new FormData(e.target);try{await createReport({targetType:fd.get('targetType'),targetId:fd.get('targetId'),reason:fd.get('reason'),details:fd.get('details')});closeModal();notify('Жалоба отправлена модерации');}catch(err){showFeedback(`Не удалось отправить жалобу: ${err.message}`);}}
  if(e.target.id==='authorVerificationForm'){e.preventDefault();const fd=new FormData(e.target);try{await requestAuthorVerification(String(fd.get('note')||''));closeModal();notify('Заявка отправлена. После проверки статус обновится.');}catch(err){showFeedback(`Не удалось отправить заявку: ${err.message}`);}}
  if(e.target.id==='postCommentForm'){e.preventDefault();await submitPostComment(new FormData(e.target));}
  if(e.target.id==='evaluationFiltersForm'){e.preventDefault();saveEvaluationFilters(new FormData(e.target));}
  if(e.target.id==='evaluationSessionForm'){e.preventDefault();await beginEvaluationSession(new FormData(e.target));}
  if(e.target.id==='readFiltersForm'){e.preventDefault();saveReadFilters(new FormData(e.target));}
  if(e.target.id==='communityForm'){e.preventDefault();submitCommunity(new FormData(e.target));}
  if(e.target.id==='profileForm'){e.preventDefault();await saveProfile(new FormData(e.target));}
  if(e.target.id==='replyReviewForm'){e.preventDefault();saveReviewReply(new FormData(e.target));}
  if(e.target.id==='friendForm'){e.preventDefault();await addFriend(new FormData(e.target));}
  if(e.target.id==='collabGroupForm'){e.preventDefault();await saveCollaborationGroup(new FormData(e.target));}
  if(e.target.matches('.thread-message-form')){e.preventDefault();await sendThreadMessage(e.target,new FormData(e.target));}
}));

async function openChatWithPerson(personId){
  const p=state.peopleDirectory.find(x=>x.id===personId); if(!p)return;
  try{
    animateChatOpen=!state.ui.chatPanelOpen;
    const id=await getOrCreateDirectConversation(personId);
    update(s=>{s.ui.selectedChatId=id;s.ui.chatTab='chats';s.ui.chatPanelOpen=true;},{persist:false});
    await refreshCloudChats(false);render();
  }catch(err){showFeedback(`Не удалось открыть чат: ${err.message}`);}
}

async function addFriend(fd){
  const username=String(fd.get('username')||'').trim().replace(/^@/,'');
  if(!username)return;
  try{
    const p=await findProfileByUsername(username);
    if(!p){notify(`@${username} не найден`);return;}
    if(p.id===state.user.id){notify('Нельзя написать самому себе');return;}
    animateChatOpen=!state.ui.chatPanelOpen;
    const id=await getOrCreateDirectConversation(p.id);
    update(s=>{s.ui.selectedChatId=id;s.ui.chatTab='chats';s.ui.chatPanelOpen=true;},{persist:false});
    await refreshCloudChats(false);render();
  }catch(err){showFeedback(`Не удалось добавить пользователя: ${err.message}`);}
}

async function sendThreadMessage(form,fd){
  const text=String(fd.get('message')||'').trim(); if(!text)return;
  const id=form.dataset.thread;
  try{
    form.querySelector('input[name="message"]').value='';
    await sendCloudMessage(id,text);
    update(s=>s.ui.selectedChatId=id,{persist:false});
    await refreshCloudChats(false);render();
  }catch(err){showFeedback(`Сообщение не отправлено: ${err.message}`);}
}

function saveNotes(){
  const notes=document.querySelector('#privateNotes');if(!notes)return;
  update(s=>{s.privateNotes=String(notes.value||'');});notify('Заметки сохранены на этом устройстве');
}

// TODO: enable community mutations only after a server-backed membership API exists.
function joinCommunity(){ notify('Сообщества · Скоро. Облачное участие пока недоступно.'); }
function communityDialog(){ notify('Создание сообществ · Скоро'); }
function submitCommunity(){ notify('Создание сообществ · Скоро'); }

function generateSummary(workId){
  const work=state.works.find(item=>item.id===workId);if(!work)return;
  const reviews=state.reviews.filter(review=>review.workId===workId);
  if(!reviews.length){notify('Для сводки пока недостаточно рецензий');return;}
  const average=reviews.reduce((sum,review)=>sum+Number(review.rating||0),0)/reviews.length;
  const categories={};for(const review of reviews)for(const [name,value] of Object.entries(review.categories||{}))(categories[name]??=[]).push(Number(value)||0);
  const ranked=Object.entries(categories).map(([name,values])=>[name,values.reduce((a,b)=>a+b,0)/values.length]).sort((a,b)=>b[1]-a[1]);
  openModal(`<h2>Сводка: ${esc(work.title)}</h2><p>На основе ${reviews.length} рецензий средняя оценка — <b>${average.toFixed(1)} / 5</b>.</p>${ranked.length?`<p>Сильнее всего читатели оценили: <b>${esc(ranked[0][0])}</b> (${ranked[0][1].toFixed(1)}).</p><p>Основная зона роста: <b>${esc(ranked.at(-1)[0])}</b> (${ranked.at(-1)[1].toFixed(1)}).</p>`:'<p>Категориальных оценок пока нет.</p>'}<button class="primary wide" data-action="close-modal">Закрыть</button>`);
}

function collaborationGroupDialog(){
  if(state.user.role!=='author'){notify('Рабочие группы проектов доступны автору');return;}
  const friends=state.friends.map(id=>state.peopleDirectory.find(p=>p.id===id)).filter(Boolean);
  openModal(`<h2>Новая группа проекта</h2><p class="muted">Чат хранится в Supabase. Участники смогут получать сообщения со своих аккаунтов.</p><form id="collabGroupForm"><label>Название<input name="name" required placeholder="Например: Искусственная судьба — команда"></label><fieldset><legend>Участники</legend><div class="chip-checks">${friends.map(p=>`<label><input type="checkbox" name="members" value="${p.id}"><span>${esc(p.name)} · @${esc(p.username)}</span></label>`).join('')||'<p class="muted">Сначала откройте личный чат с пользователем по username.</p>'}</div></fieldset><p class="muted">Реальные WebRTC-звонки включены для личных чатов. Групповые звонки будут отдельным этапом.</p><button class="primary wide">Создать группу</button></form>`,'wide');
}

async function saveCollaborationGroup(fd){
  const name=String(fd.get('name')||'').trim(); if(!name)return;
  try{
    const members=fd.getAll('members');
    const id=await createCloudGroupConversation(name,members);
    update(s=>{s.ui.selectedChatId=id;s.ui.chatTab='groups';s.ui.chatPanelOpen=true;s.ui.modal=null;},{persist:false});
    await refreshCloudChats(false);render();
  }catch(err){showFeedback(`Группа не создана: ${err.message}`);}
}

async function startCall(threadId,mode){
  const t=state.chatThreads.find(x=>x.id===threadId); if(!t)return;
  if(t.type!=='dm'){notify('Реальные групповые звонки пока не включены. Откройте личный чат.');return;}
  if(activeRtc||callStarting){notify('Сначала завершите текущий звонок');return;}
  const attempt={};callStarting=attempt;
  let attemptedCallId=null;
  try{
    const peer=await getConversationPeer(threadId);
    const call=await createCloudCall(threadId,mode);
    if(!call)throw new Error('Сервер не создал звонок');
    attemptedCallId=call.id;
    await setupRtc({callId:call.id,conversationId:threadId,peerId:peer.id,title:peer.nickname||peer.username||t.title,mode:call.mode,initiator:true});
    render();
  }catch(err){
    if(document.querySelector('#realCallOverlay')?.dataset.callId!==attemptedCallId||!document.querySelector('#realCallError')?.textContent)showFeedback(`Не удалось начать звонок: ${err.message}`);
  }finally{if(callStarting===attempt)callStarting=false;}
}

async function endCall(updateServer=true){
  if(activeRtc)return finishLocalCall(updateServer);
  update(s=>s.activeCall=null,{persist:false});removeCallOverlay();render();
}

function switchRole(){
  if(state.user.role==='author'){ notify('Автор уже имеет все возможности читателя.'); return; }
  if(state.user.verified){ update(s=>{s.user.role='author';s.ui.page='create';});render();return; }
  openModal(`<h2>Стать автором</h2><p>Для закрытой beta мы используем ручную верификацию: заявка попадает администратору FRAKTUM. Документы на сайте не хранятся.</p><form id="authorVerificationForm"><label>Коротко о себе<textarea name="note" rows="5" placeholder="Что вы пишете, есть ли уже опубликованные тексты или профиль автора"></textarea></label><button class="primary wide">Отправить заявку</button></form>`);
}

function openWorkDetails(id){
  const w=state.works.find(x=>x.id===id); if(!w||w.publicationStatus!=='published'){notify('Полная версия этого произведения пока не опубликована');return;}
  update(s=>{s.ui.selectedWorkId=id;s.ui.page='work';},{persist:false});render();
}
function openWork(id){
  const w=state.works.find(x=>x.id===id); if(!w||w.publicationStatus!=='published'){notify('Полная версия этого произведения пока не опубликована');return;}
  update(s=>{s.ui.selectedWorkId=id;s.ui.readerBookIndex=0;s.ui.page='reader'; if(!s.library.reading.includes(id)&&!s.library.completed.includes(id))s.library.reading.push(id); if(s.readingProgress[id]==null)s.readingProgress[id]=0;}); if(w.cloud)saveCloudReadingProgress(w,{progress:Number(state.readingProgress[id]||0),status:'reading'}).catch(error=>reportSyncIssue('Прогресс чтения',error));render();
}
async function toggleLibrary(bucket,id){ let added=false;update(s=>{const a=s.library[bucket];const i=a.indexOf(id);if(i>=0)a.splice(i,1);else{a.push(id);added=true;}});const w=state.works.find(x=>x.id===id);if(w?.cloud&&bucket==='later')await saveCloudReadingProgress(w,{progress:Number(state.readingProgress[id]||0),status:added?'read_later':'reading'}).catch(error=>reportSyncIssue('Прогресс чтения',error));render(); }

function saveReadFilters(fd){
  update(s=>{s.ui.readFilters={query:String(fd.get('query')||'').trim(),genre:String(fd.get('genre')||''),length:String(fd.get('length')||'')};s.ui.page='read';},{persist:true});render();
}
function applyReadFilters(){
  const form=document.querySelector('#readFiltersForm'); if(form)saveReadFilters(new FormData(form));
}
function resetReadFilters(){update(s=>s.ui.readFilters={query:'',genre:'',length:''});render();}

function evaluationSessionDialog(){
  openModal(`<h2>Быстрая сессия</h2><p class="muted">Набор фиксируется при старте и не меняется в процессе.</p><form id="evaluationSessionForm"><div class="session-size-options">${[3,5,10,20].map(size=>`<label><input type="radio" name="size" value="${size}" ${size===5?'checked':''}><span>${size}</span></label>`).join('')}</div><label>Другое количество<input name="customSize" type="number" min="1" max="50" placeholder="1–50"></label><button class="primary wide">Начать</button></form>`);
}
async function beginEvaluationSession(fd){
  let size;try{size=validateSessionSize(fd.get('customSize')||fd.get('size'));}catch(error){showFeedback(error.message);return;}
  try{const result=await createEvaluationSession(size),session=createLocalSession(result.items,size,result.id);update(s=>{s.evaluationSession=session;s.ui.evaluationMode='session';s.ui.page='evaluation';s.ui.modal=null;s.ui.selectedQuote='';},{persist:false});render();}catch(error){showFeedback(`Не удалось создать сессию: ${error.message}`);}
}
async function openEvaluationCatalog(){
  try{const items=await fetchEvaluationCatalog({limit:24});update(s=>{s.evaluationCatalog=items;s.ui.evaluationMode='catalog';},{persist:false});render();}catch(error){showFeedback(`Каталог недоступен: ${error.message}`);}
}
function openCatalogEvaluation(versionId){
  const item=state.evaluationCatalog.find(entry=>entry.versionId===versionId);if(!item)return;const session=createLocalSession([item],1,`catalog:${versionId}`);update(s=>{s.evaluationSession=session;s.ui.page='evaluation';s.ui.selectedQuote='';},{persist:false});render();
}
async function advanceEvaluationSession(){
  const session=state.evaluationSession;if(!session)return;const item=session.items[session.currentIndex];
  if(!String(session.id).startsWith('catalog:')){try{await completeEvaluationItem(session.id,item.position);}catch(error){showFeedback(`Прогресс не сохранён: ${error.message}`);return;}}
  const next=advanceSession(session);update(s=>{s.evaluationSession=next;s.ui.selectedQuote='';if(next.status==='completed'){s.ui.page='evaluate';s.ui.evaluationMode=null;}},{persist:false});if(next.status==='completed')notify('Сессия завершена');else render();
}
function startEvaluation(){
  const candidates=pages.getEvaluationCandidates();
  if(!candidates.length){notify('По текущим фильтрам нет подходящих отрывков');return;}
  const current=state.ui.evaluationWorkId;
  const currentIndex=candidates.findIndex(w=>w.id===current);
  const next=candidates[(currentIndex+1+candidates.length)%candidates.length]||candidates[0];
  update(s=>{s.ui.evaluationWorkId=next.id;s.ui.page='evaluation';s.ui.selectedQuote='';},{persist:false});
  render();
}

function evaluationFiltersDialog(){
  const f=state.ui.evaluationFilters||{genres:[],kinds:[],length:'any'};
  const kinds=['Роман','Рассказ','Повесть','Стихотворение','Фрагмент'];
  openModal(`<h2>Фильтр оценки</h2><p class="muted">Настройте, какие короткие отрывки будут попадаться в режиме «Оценить».</p><form id="evaluationFiltersForm"><fieldset class="taxonomy-choices"><legend>Жанры</legend><input type="search" data-taxonomy-search placeholder="Найти жанр"><div class="taxonomy-choice-list">${(state.catalogs?.genres||[]).map(g=>`<label data-taxonomy-label="${esc(g.name.toLowerCase())}"><input type="checkbox" name="genres" value="${esc(g.name)}" ${(f.genres||[]).includes(g.name)?'checked':''}><span>${esc(g.name)}</span></label>`).join('')}</div></fieldset><fieldset><legend>Тип произведения</legend><div class="chip-checks">${kinds.map(k=>`<label><input type="checkbox" name="kinds" value="${k}" ${(f.kinds||[]).includes(k)?'checked':''}><span>${k}</span></label>`).join('')}</div></fieldset><label>Размер отрывка<select name="length"><option value="any" ${f.length==='any'?'selected':''}>Любой, до 5 минут</option><option value="tiny" ${f.length==='tiny'?'selected':''}>Очень короткий, до 2 минут</option><option value="short" ${f.length==='short'?'selected':''}>Обычный, 3–5 минут</option></select></label><button class="primary wide">Сохранить фильтр</button></form>`,'wide');
}
function saveEvaluationFilters(fd){
  update(s=>{s.ui.evaluationFilters={genres:fd.getAll('genres'),kinds:fd.getAll('kinds'),length:String(fd.get('length')||'any')};s.ui.evaluationWorkId=null;s.ui.modal=null;s.ui.page='evaluate';});
  render();
}

async function postCommentsDialog(postId){
  const post=state.posts.find(p=>p.id===postId); if(!post)return;
  let comments=state.postComments.filter(c=>c.postId===postId);
  if(post.cloud){
    openModal(`<h2>Комментарии</h2><p class="muted">Загрузка из облака…</p>`,'wide');
    try{comments=await fetchPostComments(post.cloudId);}catch(err){showFeedback(err.message);comments=[];}
  }
  const cards=comments.length?comments.map(c=>`<article class="post-comment"><div class="row spread"><b>${esc(c.author)}</b><small>${esc(c.time||'')}</small></div><p>${esc(c.text)}</p><div class="reaction-bar"><button class="${c.myReaction==='helpful'?'active':''}" data-action="react-post-comment" data-post="${postId}" data-id="${c.id}" data-kind="helpful">👍 Полезно ${c.reactions?.helpful||0}</button><button class="${c.myReaction==='disagree'?'active':''}" data-action="react-post-comment" data-post="${postId}" data-id="${c.id}" data-kind="disagree">≠ Не согласен ${c.reactions?.disagree||0}</button><button class="${c.myReaction==='unhelpful'?'active':''}" data-action="react-post-comment" data-post="${postId}" data-id="${c.id}" data-kind="unhelpful">👎 Бесполезно ${c.reactions?.unhelpful||0}</button><button data-action="report-content" data-target-type="comment" data-target-id="${c.id}">⚑</button></div></article>`).join(''):'<p class="muted">Комментариев пока нет. Будьте первым.</p>';
  openModal(`<div class="comments-modal-head"><div><span class="eyebrow">${esc(post.role||'Пользователь')}</span><h2>Комментарии к посту</h2></div><span>${comments.length} всего</span></div><blockquote>${esc(post.text)}</blockquote><section class="post-comments-list">${cards}</section><form id="postCommentForm"><input type="hidden" name="postId" value="${postId}"><label>Ваш комментарий<textarea name="text" rows="4" required placeholder="Напишите мнение..."></textarea></label><button class="primary wide">Отправить комментарий</button></form>`,'wide');
}
async function submitPostComment(fd){
  const postId=String(fd.get('postId')); const text=String(fd.get('text')||'').trim(); if(!text)return;
  const post=state.posts.find(x=>x.id===postId);
  if(!post?.cloud){notify('Комментарии доступны только для серверных постов');return;}
  try{await createCloudComment(post.cloudId,text);await refreshCloudFeed();closeModal();await postCommentsDialog(postId);}catch(err){showFeedback(err.message);}
}
async function reactPostComment(postId,commentId,kind){
  const post=state.posts.find(x=>x.id===postId);
  if(!post?.cloud){notify('Реакции доступны только для серверных комментариев');return;}
  try{await setCloudCommentReaction(commentId,kind);await postCommentsDialog(postId);}catch(err){showFeedback(err.message);}
}

function annotationDialog(selectedType='unclear'){
  const quote=(state.ui.selectedQuote||'').trim();if(!quote){notify('Сначала выделите фразу в тексте');return;}const type=ANNOTATION_TYPES.some(([value])=>value===selectedType)?selectedType:'unclear',label=ANNOTATION_TYPES.find(([value])=>value===type)?.[1];
  openModal(`<h2>${label}</h2><blockquote>“${esc(quote.slice(0,500))}”</blockquote><form id="annotationForm"><input type="hidden" name="type" value="${type}"><label>Пояснение <span class="muted">необязательно</span><textarea name="comment" rows="4" placeholder="Почему вы отметили этот фрагмент?"></textarea></label><div class="modal-actions"><button type="button" data-action="close-modal">Отмена</button><button class="primary">Сохранить</button></div></form>`);
}
async function saveAnnotation(fd){
  const sessionItem=state.evaluationSession?.items?.[state.evaluationSession.currentIndex],legacy=state.ui.evaluationWorkId,localWork=state.works.find(work=>work.id===(sessionItem?.workId||legacy));const type=String(fd.get('type')||'comment'),body=String(fd.get('comment')||'').trim(),anchor=selectedTextAnchor||{selectedText:state.ui.selectedQuote};
  const payload={type,body,...anchor,workId:sessionItem?.cloudWorkId||localWork?.cloudId||null,versionId:sessionItem?.versionId||localWork?.cloudVersionId||null,fragmentId:sessionItem?.fragmentId||null};if(!payload.workId&&!payload.fragmentId){showFeedback('Пометка требует облачную версию или фрагмент');return;}
  try{const saved=await createCloudAnnotation(payload),key=`${sessionItem?.workId||legacy}:evaluation`,label=ANNOTATION_TYPES.find(([value])=>value===type)?.[1]||type;update(s=>{(s.annotations[key]??=[]).push({id:saved.id,type,label,quote:anchor.selectedText,comment:body,anchor});s.ui.selectedQuote='';s.ui.modal=null;});selectedTextAnchor=null;render();}catch(error){showFeedback(`Пометка не сохранена: ${error.message}`);}
}
async function deleteAnnotation(work,scope,index){const key=`${work}:${scope}`,annotation=state.annotations[key]?.[index];try{if(annotation?.id)await deleteCloudAnnotation(annotation.id);update(s=>s.annotations[key]?.splice(index,1));render();}catch(error){showFeedback(`Пометка не удалена: ${error.message}`);}}
async function refreshAuthorFeedback(){try{const rows=await fetchAuthorFeedback();update(s=>s.authorFeedback=rows||[],{persist:false});}catch(error){reportSyncIssue('feedback sync',error);}}

function reviewDialog(workId,scope='full'){
  const w=state.works.find(x=>x.id===workId); if(!w){showFeedback('Версия произведения недоступна. Обновите каталог.');return;} const existing=state.reviews.find(r=>r.workId===workId&&r.version===w.version&&r.authorId===state.user.id&&((r.scope||'evaluation')===scope));
  openModal(`<h2>${existing?'Изменить рецензию':'Полноценная рецензия'}</h2><p>${esc(w.title)} · версия ${esc(w.version)}</p><form id="reviewForm"><input type="hidden" name="workId" value="${w.id}"><input type="hidden" name="scope" value="${scope}"><label>Общая оценка<select name="rating">${[5,4,3,2,1].map(n=>`<option value="${n}" ${existing?.rating===n?'selected':''}>${n} / 5</option>`).join('')}</select></label><div class="rating-grid">${FEEDBACK_CATEGORIES.map(c=>`<label>${c}<select name="cat:${c}">${[5,4,3,2,1].map(n=>`<option value="${n}" ${existing?.categories?.[c]===n?'selected':''}>${n}</option>`).join('')}</select></label>`).join('')}</div><label>Общее мнение<textarea name="comment" rows="7" minlength="30" required placeholder="Минимум 30 символов. Что работает, что стоит улучшить и почему?">${esc(existing?.comment||'')}</textarea></label><label class="toggle"><input type="checkbox" name="anonymous" ${existing?.anonymous?'checked':''}> Опубликовать анонимно</label><p class="muted">За полноценную рецензию начисляется XP. Пометки внутри текста также учитываются.</p><button class="primary wide">Опубликовать рецензию</button></form>`,'wide');
}
async function submitReview(fd){
  const workId=String(fd.get('workId')); const scope=String(fd.get('scope')||'full'); const w=state.works.find(x=>x.id===workId); if(!w?.cloudId||!w?.cloudVersionId){showFeedback('Для рецензии нужна опубликованная облачная версия.');return;} const comment=String(fd.get('comment')||'').trim(); if(comment.length<30){showFeedback('Нужно минимум 30 символов.');return;}
  const cats={}; FEEDBACK_CATEGORIES.forEach(c=>cats[c]=Number(fd.get('cat:'+c)||0));
  const annotationKey=`${workId}:${scope}`;
  const previous=state.reviews.find(review=>review.workId===workId&&review.version===w.version&&review.authorId===state.user.id&&((review.scope||'evaluation')===scope));
  const reviewInput={...previous,scope,anonymous:fd.get('anonymous')==='on',rating:Number(fd.get('rating')),comment,categories:cats,annotations:structuredClone(state.annotations[annotationKey]||[])};
  let savedReview;
  try{savedReview=await saveCloudReview({work:w,review:reviewInput});if(!savedReview?.id)throw new Error('Сервер не подтвердил сохранение рецензии');}
  catch(error){showFeedback(`Рецензия не опубликована: ${error.message}`,{kind:'error'});return;}
  let wasFirst=false;
  update(s=>{
    let r=s.reviews.find(x=>x.workId===workId&&x.version===w.version&&x.authorId===s.user.id&&((x.scope||'evaluation')===scope));
    wasFirst=!r;
    const payload={...reviewInput,id:r?.id||`cloud-review:${savedReview.id}`,cloud:true,cloudId:savedReview.id,workId,version:w.version,scope,authorId:s.user.id,author:s.user.name,reactions:r?.reactions||{helpful:0,disagree:0,unhelpful:0},createdAt:savedReview.created_at||new Date().toISOString()};
    if(r)Object.assign(r,payload);else s.reviews.push(payload);
    if(scope==='full'){
      const current=s.reviews.filter(x=>x.workId===workId&&x.version===w.version&&x.scope==='full'); if(current.length){w.rating=current.reduce((a,x)=>a+x.rating,0)/current.length;w.ratingsCount=current.length;}
      s.library.reading=s.library.reading.filter(id=>id!==workId); if(!s.library.completed.includes(workId))s.library.completed.push(workId); s.readingProgress[workId]=100; s.ui.page='work';s.ui.selectedWorkId=workId;
    }else{
      s.ui.page='evaluate';s.ui.evaluationWorkId=null;
    }
    s.ui.modal=null;
  });
  if(scope==='full'&&w.cloud)saveCloudReadingProgress(w,{progress:100,status:'completed'}).catch(error=>reportSyncIssue('Прогресс чтения',error));
  if(scope==='evaluation'){
    openModal(`<div class="review-success"><span class="eyebrow">Рецензия опубликована</span><h2>${wasFirst?'Спасибо за отзыв':'Рецензия обновлена'}</h2><p>Отзыв привязан к версии ${esc(w.version)}. Можно сразу перейти к следующему короткому отрывку.</p><div class="actions"><button data-action="navigate" data-page="evaluate">Закончить</button><button class="primary" data-action="evaluate-next">ОЦЕНИТЬ ДАЛЕЕ →</button></div></div>`);
  }else{
    notify(wasFirst?'Произведение прочитано. Рецензия опубликована':'Рецензия обновлена');
  }
}
async function reactReview(id,kind){const review=state.reviews.find(x=>x.id===id);if(review?.cloudId){try{await setCloudReviewReaction(review.cloudId,kind);await refreshCloudLiterature();render();return;}catch(err){showFeedback(`Реакция не сохранена: ${err.message}`);return;}}update(s=>{const r=s.reviews.find(x=>x.id===id);if(!r)return;r.reactions??={helpful:0,disagree:0,unhelpful:0};const prev=r.myReaction||null;if(prev===kind){r.reactions[kind]=Math.max(0,(r.reactions[kind]||0)-1);r.myReaction=null;}else{if(prev)r.reactions[prev]=Math.max(0,(r.reactions[prev]||0)-1);r.reactions[kind]=(r.reactions[kind]||0)+1;r.myReaction=kind;}});render();}
// TODO: persist author replies through an ownership-checked cloud API before enabling.
function replyReviewDialog(){ notify('Ответы автора · Скоро'); }
function saveReviewReply(){ notify('Ответы автора · Скоро'); }

function postDialog(){openModal(`<h2>Новый пост</h2><form id="postForm"><label>Текст<textarea name="text" rows="5" placeholder="Что хотите рассказать?"></textarea></label><label>Фото или видео<input name="media" type="file" multiple accept="image/*,video/mp4,video/webm"></label><p class="muted">Фото и видео загружаются в Supabase Storage. Для медиа нужен облачный вход.</p><button class="primary wide">Опубликовать</button></form>`,'wide');}
async function submitPost(fd){
  const text=String(fd.get('text')||'').trim();const files=fd.getAll('media').filter(x=>x&&x.size);if(!text&&!files.length)return;
  if(!isCloudAuthenticated()){showFeedback('Сессия закончилась. Войдите снова.');loginMode=true;render();return;}
  try{await createCloudPost({text,files});update(s=>{s.ui.modal=null;},{persist:false});await refreshCloudFeed();render();}catch(err){showFeedback(`Не удалось опубликовать: ${err.message}`);}
}
async function likePost(id){const p=state.posts.find(x=>x.id===id);if(!p?.cloud){notify('Этот пост не является серверным');return;}try{await toggleCloudPostLike(p.cloudId);await refreshCloudFeed();render();}catch(err){showFeedback(err.message);}}

function collectEditor(){
  const f=document.querySelector('#workEditor');if(!f)return null;const fd=new FormData(f);syncStudioEditor();const w=state.works.find(x=>x.id===f.dataset.id);if(!w)return null;
  let content='';
  if(w.editorMode==='book') content=(w.bookPages||[]).filter(p=>p.type==='content').map(p=>(p.canvas?.objects||[]).filter(o=>o.type==='text').map(o=>textFromHtml(o.html)).filter(Boolean).join('\n')).filter(Boolean).join('\n\n');
  else content=(w.documentPages||[]).map(p=>textFromHtml(p.html)).filter(Boolean).join('\n\n');
  const evaluationText=w.creationType==='fragment'?content:String(fd.get('evaluationText')||w.evaluationText||'');
  return {id:f.dataset.id,title:String(fd.get('title')||w.title||'').trim(),kind:fd.get('kind')||w.kind,genres:fd.getAll('genres').map(String).filter(Boolean),summary:String(fd.get('summary')||'').trim(),targetType:String(fd.get('targetType')||w.targetType||'Фрагмент'),evaluationTarget:String(fd.get('evaluationTarget')||w.evaluationTarget||'Фрагмент').trim(),evaluationText,feedbackWanted:fd.getAll('feedback'),formatId:Number(fd.get('formatId'))||null,genreIds:fd.getAll('genres').map(name=>Number(state.catalogs.genres.find(item=>item.name===name)?.id)).filter(Number.isFinite).slice(0,3),audienceIds:fd.getAll('audienceIds').map(Number).filter(Number.isFinite),tagIds:fd.getAll('tagIds').map(Number).filter(Number.isFinite).slice(0,30),content};
}
async function saveWork(mode='draft'){
  if(hasLegacyRecovery(state.works)){showFeedback('Сохранение приостановлено: восстановите старые изображения. Исходный снимок на устройстве сохранён; новые правки пока только в памяти.',{kind:'error'});return;}
  const x=collectEditor(); if(!x||!x.title){showFeedback('Укажите название.');return;}
  const current=state.works.find(z=>z.id===x.id); const fragment=current?.creationType==='fragment';
  if(mode==='published'&&!x.content.trim()){showFeedback('Чтобы опубликовать полное произведение, добавьте текст.');return;}
  if(mode==='evaluation'&&!x.evaluationText.trim()&&!x.content.trim()){showFeedback('Добавьте текст для оценки.');return;}
  update(s=>{
    const w=s.works.find(z=>z.id===x.id); if(!w)return;
    Object.assign(w,{title:x.title,kind:x.kind,genres:x.genres,summary:x.summary,targetType:x.targetType,evaluationTarget:x.evaluationTarget,evaluationText:x.evaluationText,feedbackWanted:x.feedbackWanted,formatId:x.formatId,genreIds:x.genreIds,audienceIds:x.audienceIds,tagIds:x.tagIds,content:x.content,minutes:Math.max(1,Math.ceil(x.content.length/900))});
    if(w.editorMode==='book'){const cover=w.bookPages?.find(p=>p.type==='cover');const title=w.bookPages?.find(p=>p.type==='title');if(cover){cover.title=w.title;cover.author=w.author;}if(title){title.title=w.title;title.author=w.author;}if(cover?.canvas?.background?.image)w.cover=cover.canvas.background.image;}
    w.status=w.evaluationStatus==='open'?'evaluation':w.publicationStatus==='published'?'published':'draft';
  });
  const local=state.works.find(z=>z.id===x.id);
  if(isCloudAuthenticated()&&state.user?.role==='author'&&state.user?.verified&&local){
    try{
      const result=await persistStudioWork(local,mode);
      if(!result.fragment)await saveCloudWorkTaxonomy(result.work.id,{formatId:x.formatId,genreIds:x.genreIds,audienceIds:x.audienceIds,tagIds:x.tagIds});
      update(()=>{
        if(mode==='published'&&!fragment){local.publicationStatus='published';local.publishedAt=local.publishedAt||new Date().toISOString();}
        if(mode==='evaluation'){local.evaluationStatus='open';local.evaluationOpenedAt=new Date().toISOString();}
        local.status=local.evaluationStatus==='open'?'evaluation':local.publicationStatus==='published'?'published':'draft';
      });
    }catch(err){showFeedback(`Локально сохранено, но Supabase не синхронизирован: ${err.message}`);return;}
  }else{showFeedback(mode==='draft'?'Черновик сохранён на устройстве':'Для публикации нужна действующая сессия подтверждённого автора. Текст сохранён на устройстве.',{kind:mode==='draft'?'status':'error'});return;}
  const msg=mode==='published'?'Произведение опубликовано в разделе «Читать»':mode==='evaluation'?'Текст опубликован в разделе «Оценить»':'Черновик сохранён'; notify(msg);
}

async function closeEvaluation(){
  syncStudioEditor();const id=document.querySelector('#workEditor')?.dataset.id;const w=state.works.find(x=>x.id===id);if(!w)return;
  try{await persistStudioWork(w,'draft',{evaluationStatus:'closed'});update(()=>{w.evaluationStatus='closed';w.status=w.publicationStatus==='published'?'published':'draft';});notify('Приём новых оценок закрыт. Старые рецензии сохранены.');}
  catch(error){showFeedback(`Не удалось закрыть оценку: ${error.message}`,{kind:'error'});}
}
function newVersion(){
  syncStudioEditor();const id=document.querySelector('#workEditor')?.dataset.id;const w=state.works.find(x=>x.id===id);if(!w)return;const [a,b]=w.version.split('.').map(Number);
  update(s=>{w.version=`${a}.${(b||0)+1}`;w.cloudVersionId=null;w.publicationStatus='draft';w.evaluationStatus='closed';w.status='draft';});notify('Создана новая версия. Сохраняем в облаке…');scheduleStudioAutosave();
}

function profileDialog(){openModal(profileEditor(state.user,state.catalogs||{genres:[],topics:[]}), 'wide');}
function profileMediaBusy(busy){
  for(const id of ['profileAvatarUpload','profileBannerUpload','profileAvatarRemove','profileBannerRemove']){
    const control=document.getElementById(id);if(control)control.disabled=busy||(id.endsWith('Remove')&&!state.user?.[id.includes('Banner')?'bannerPath':'avatarPath']);
  }
  const saveButton=document.querySelector('#profileForm button[type="submit"]');if(saveButton)saveButton.disabled=busy;
}
function applyProfileMedia(kind,result){update(s=>{s.user[`${kind}Path`]=result.path;s.user[`${kind}Url`]=result.url;});}
async function handleProfileMedia(event,kind){
  const file=event.target.files?.[0];if(!file)return;const status=document.querySelector('#profileMediaStatus');if(status)status.textContent='Загрузка…';profileMediaBusy(true);
  try{const prepared=await cropProfileImage(file,kind==='banner'?{aspect:3,width:1500,height:500}:{aspect:1,width:512,height:512});const result=await uploadProfileMedia(kind,prepared);applyProfileMedia(kind,result);if(status)status.textContent=result.cleanupWarning||'Изображение сохранено';}
  catch(error){if(status)status.textContent=`Ошибка загрузки: ${error.message}`;}finally{profileMediaBusy(false);event.target.value='';}
}
async function handleProfileMediaRemoval(kind){
  const status=document.querySelector('#profileMediaStatus');if(status)status.textContent='Удаление…';profileMediaBusy(true);
  try{const result=await removeProfileMedia(kind);applyProfileMedia(kind,result);if(status)status.textContent=result.cleanupWarning||'Изображение удалено';}
  catch(error){if(status)status.textContent=`Ошибка удаления: ${error.message}`;}finally{profileMediaBusy(false);}
}
async function saveProfile(fd){
  const payload=profilePayload(fd);if(!payload.nickname||!payload.username){showFeedback('Никнейм и username обязательны');return;}
  let favoriteBooks,socialLinks;try{favoriteBooks=parseRows(fd,'book',['title','authorName','externalUrl']).map(book=>({...book,externalUrl:book.externalUrl?normalizeUrl(book.externalUrl):''}));socialLinks=parseRows(fd,'social',['platform','label','url']).map(link=>({...link,label:link.label||link.platform,url:normalizeUrl(link.url)}));}catch(error){showFeedback(error.message);return;}
  const preferences=normalizePreferences({wantedGenres:fd.getAll('wantedGenres'),unwantedGenres:fd.getAll('unwantedGenres'),wantedTopics:fd.getAll('wantedTopics'),unwantedTopics:fd.getAll('unwantedTopics')});
  const button=document.querySelector('#profileForm button[type="submit"]'),status=document.querySelector('#profileSaveStatus');let committed=false;
  if(button){button.disabled=true;button.textContent='Сохранение…';}if(status)status.textContent='';
  try{await saveMyProfile({profile:payload,favoriteBooks,socialLinks,preferences});committed=true;const [profile,details]=await Promise.all([getMyProfile(),fetchMyProfileDetails()]);if(!profile)throw new Error('Профиль не найден после сохранения');const user=cloudUserFrom(profile,getSession()?.user,state.user);mergeProfileDetails(user,details,state.catalogs);update(s=>{s.user=user;s.ui.modal=null;});render();}
  catch(error){if(status)status.textContent=`${committed?'Изменения сохранены, но профиль не обновился. Обновите страницу':'Профиль не сохранён'}: ${error.message}`;}
  finally{if(button){button.disabled=false;button.textContent='Сохранить профиль';}}
}

async function bootstrap(){
  const serverOnline=await checkServerConnection();
  update(s=>{s.cloud={...(s.cloud||{}),serverOnline};},{persist:false});
  if(serverOnline){try{const catalogs=await fetchDiscoveryCatalogs();update(s=>s.catalogs=catalogs,{persist:false});}catch(error){reportSyncIssue('taxonomy bootstrap',error);}}
  await ensureSession().catch(error=>reportSyncIssue('Восстановление сессии',error));
  const auth=getSession();
  if(auth?.user?.id){
    try{
      const profile=await getMyProfile();
      if(profile){
        const user=cloudUserFrom(profile,auth.user,state.user||{});
        await refreshIdentityData(user);
        update(s=>{s.user=user;s.cloud={...(s.cloud||{}),connected:true,serverOnline:true};},{persist:true});
        await refreshCloudLiterature();await refreshCloudFeed();await refreshCloudChats(false);await refreshNotifications(false);if(user.isAdmin)await refreshAdminData(false);startCloudPolling();
      }else update(s=>s.user=null,{persist:false});
    }catch(err){reportSyncIssue('bootstrap profile',err);update(s=>s.user=null,{persist:false});}
  }else{
    stopCloudPolling();update(s=>{s.user=null;s.posts=[];s.chatThreads=[];s.peopleDirectory=[];s.friends=[];s.cloud={...(s.cloud||{}),connected:false};},{persist:false});
  }
  authReady=true;render();await restoreLocation({initial:true});
}
bootstrap();
