import {config} from './config.js';
import {serializeWorkContent} from './editor/MediaModel.js';
import {assertPersistableDocument} from './editor/Serialization.js';
import {validateProfileImage} from './profile/ProfileMediaService.js';
const SUPABASE_URL=config.supabaseUrl;
const SUPABASE_KEY=config.supabasePublishableKey;
const SESSION_KEY='d20-supabase-session-v1';

let session=loadSession();
let sessionRefresh=null;
let sessionRevision=0;

function loadSession(){
  try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null');}catch{return null;}
}
function saveSession(next){sessionRevision++;session=next||null;if(session)localStorage.setItem(SESSION_KEY,JSON.stringify(session));else localStorage.removeItem(SESSION_KEY);return session;}
function authHeaders(json=true){
  const h={apikey:SUPABASE_KEY};
  if(session?.access_token)h.Authorization=`Bearer ${session.access_token}`;
  if(json)h['Content-Type']='application/json';
  return h;
}
async function parse(res,service='Supabase API'){
  const text=await res.text();let data=null;
  try{data=text?JSON.parse(text):null;}catch{data=text;}
  if(!res.ok){
    const details=[data?.msg,data?.message,data?.error_description,data?.error,typeof data==='string'?data:null].find(value=>typeof value==='string'&&value.trim());
    const error=new Error(`${service} ${res.status}${details?`: ${details.trim()}`:''}`);
    error.status=res.status;
    throw error;
  }
  return data;
}
async function refreshSession(){
  if(!session?.refresh_token)return null;
  const revision=sessionRevision;
  const res=await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:SUPABASE_KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token})});
  const data=await parse(res,'Supabase Auth');
  if(revision!==sessionRevision)return session;
  return saveSession({...data,expires_at:Math.floor(Date.now()/1000)+(data.expires_in||3600)});
}
export async function ensureSession(){
  if(!session)return null;
  if(session.expires_at && session.expires_at < Math.floor(Date.now()/1000)+60){
    // Token rotation must be single-flight: parallel profile/catalogue requests
    // otherwise invalidate one another's refresh token.
    if(!sessionRefresh)sessionRefresh=refreshSession().finally(()=>{sessionRefresh=null;});
    try{await sessionRefresh;}catch(error){
      if(error.status===400||error.status===401)saveSession(null);
      throw error;
    }
  }
  return session;
}
export function getSession(){return session;}
export function isCloudAuthenticated(){return !!session?.access_token;}

export async function openFraktumGame(){
  const gameUrl=String(config.gameUrl||'https://fraktum-tcg-main.vercel.app').replace(/\/$/,'');
  let gameOrigin='';
  try{gameOrigin=new URL(gameUrl).origin;}catch{throw new Error('Некорректный адрес FRAKTUM TCG');}

  let popup=null;
  let cleanupTimer=null;

  const cleanup=()=>{
    window.removeEventListener('message',handleGameAuthRequest);
    if(cleanupTimer)clearTimeout(cleanupTimer);
  };

  const handleGameAuthRequest=async event=>{
    if(!popup||event.source!==popup||event.origin!==gameOrigin)return;
    if(event.data?.type!=='fraktum:auth-request')return;

    await ensureSession().catch(()=>null);
    if(!session?.access_token||!session?.refresh_token)return;

    let projectRef='';
    try{projectRef=new URL(SUPABASE_URL).hostname.split('.')[0]||'';}catch{}
    if(event.data?.projectRef&&projectRef&&event.data.projectRef!==projectRef)return;

    popup.postMessage({
      type:'fraktum:auth-session',
      projectRef,
      session:{
        access_token:session.access_token,
        refresh_token:session.refresh_token,
        expires_at:session.expires_at||null,
        token_type:session.token_type||'bearer',
        user:session.user||null
      }
    },gameOrigin);

    cleanupTimer=setTimeout(cleanup,1800);
  };

  window.addEventListener('message',handleGameAuthRequest);

  // Open immediately inside the click gesture so Safari/Chrome do not treat it
  // as an async popup and block it.
  popup=window.open(gameUrl,'fraktum-tcg');

  if(!popup){
    cleanup();
    throw new Error('Браузер заблокировал открытие FRAKTUM TCG. Разреши всплывающие окна для сайта.');
  }

  void ensureSession().catch(()=>null);
  cleanupTimer=setTimeout(cleanup,12000);
  return popup;
}

export async function signOut(){
  try{
    if(session?.access_token){
      const response=await fetch(`${SUPABASE_URL}/auth/v1/logout`,{method:'POST',headers:authHeaders(false)});
      await parse(response,'Supabase Auth');
    }
  }catch(error){throw new Error(`Вы вышли на этом устройстве, но сервер не подтвердил отзыв сессии: ${error.message}`);}
  finally{saveSession(null);}
}

export async function requestOtp({method,identifier,createUser=false,metadata={}}){
  const key=method==='phone'?'phone':'email';
  const body={[key]:identifier,create_user:!!createUser};
  if(createUser&&metadata&&Object.keys(metadata).length)body.data=metadata;
  if(method==='phone')body.channel='sms';
  const res=await fetch(`${SUPABASE_URL}/auth/v1/otp`,{method:'POST',headers:{apikey:SUPABASE_KEY,'Content-Type':'application/json'},body:JSON.stringify(body)});
  return parse(res,'Supabase Auth');
}

export async function verifyOtp({method,identifier,token}){
  const body={type:method==='phone'?'sms':'email',token:String(token||'').trim()};
  if(method==='phone')body.phone=identifier;else body.email=identifier;
  const res=await fetch(`${SUPABASE_URL}/auth/v1/verify`,{method:'POST',headers:{apikey:SUPABASE_KEY,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await parse(res,'Supabase Auth');
  if(data?.access_token)saveSession({...data,expires_at:Math.floor(Date.now()/1000)+(data.expires_in||3600)});
  return data;
}

export async function checkServerConnection(){
  if(!SUPABASE_URL||!SUPABASE_KEY)return false;
  try{
    const res=await fetch(`${SUPABASE_URL}/rest/v1/lit_profiles?select=id&limit=1`,{headers:{apikey:SUPABASE_KEY}});
    if(!res.ok)return false;
    await res.text();
    return true;
  }catch{return false;}
}

export async function rest(path,{method='GET',body,headers={}}={}){
  await ensureSession();
  const res=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:{...authHeaders(body!==undefined),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  return parse(res);
}
export async function rpc(name,body={}){
  return rest(`rpc/${name}`,{method:'POST',body,headers:{Prefer:'return=representation'}});
}
export async function getMyProfile(){
  await ensureSession(); if(!session?.user?.id)return null;
  const rows=await rest(`lit_profiles?id=eq.${session.user.id}&select=*`);return rows?.[0]||null;
}
export async function createMyProfile({username,nickname='',firstName='',lastName='',role='reader'}={}){
  await ensureSession(); if(!session?.user?.id)throw new Error('Нет облачной сессии');
  const cleanUsername=String(username||'').trim().replace(/^@/,'');
  if(!cleanUsername)throw new Error('Username обязателен');
  const rows=await rest('lit_profiles',{method:'POST',body:{
    id:session.user.id,
    username:cleanUsername,
    nickname:String(nickname||'').trim(),
    first_name:String(firstName||'').trim(),
    last_name:String(lastName||'').trim(),
    account_role:role==='author'?'author':'reader',
    author_verified:false,
    xp:0,
    reviewer_reputation:0
  },headers:{Prefer:'return=representation'}});
  return rows?.[0]||null;
}
export async function updateMyProfile(patch){
  await ensureSession(); if(!session?.user?.id)throw new Error('Нет облачной сессии');
  const editable=new Set(['username','nickname','first_name','last_name','bio','current_status','interests','favorite_topics','wanted_genres','unwanted_genres','avatar_path','banner_path']);
  if(Object.keys(patch).some(key=>!editable.has(key)))throw new Error('Недопустимое поле профиля');
  const rows=await rest(`lit_profiles?id=eq.${session.user.id}`,{method:'PATCH',body:patch,headers:{Prefer:'return=representation'}});
  if(!rows?.[0])throw new Error('Профиль не обновлён: проверьте права доступа');
  return rows[0];
}

export async function saveMyProfile({profile,favoriteBooks=[],socialLinks=[],preferences}){
  await ensureSession();if(!session?.user?.id)throw new Error('Нет облачной сессии');
  return rpc('lit_save_my_profile',{p_profile:profile,p_details:{favoriteBooks,socialLinks,preferences}});
}

export async function fetchDiscoveryCatalogs(){
  const [genres,topics,formats,audiences,tags]=await Promise.all([
    rest('lit_genres?active=eq.true&select=id,slug,name,parent_id,sort_order&order=sort_order.asc&limit=200'),
    rest('lit_topics?active=eq.true&select=id,slug,name,group_name,sort_order&order=group_name.asc,sort_order.asc&limit=300'),
    rest('lit_work_formats?active=eq.true&select=id,slug,name,sort_order&order=sort_order.asc&limit=100'),
    rest('lit_audience_segments?active=eq.true&select=id,slug,name,sort_order&order=sort_order.asc&limit=100'),
    rest('lit_tags?active=eq.true&select=id,slug,name,group_name,adult_only,content_warning,aliases,sort_order&order=group_name.asc,sort_order.asc&limit=1000')
  ]);return {genres:genres||[],topics:topics||[],formats:formats||[],audiences:audiences||[],tags:tags||[]};
}
export async function fetchMyProfileDetails(){
  await ensureSession();const me=session?.user?.id;if(!me)return {favoriteBooks:[],socialLinks:[],genrePreferences:[],topicPreferences:[],followers:0,following:0};
  await rpc('lit_evaluate_my_achievements').catch(()=>null);
  const [favoriteBooks,socialLinks,genrePreferences,topicPreferences,followers,following,achievementProgress,achievements,formatPreferences,audiencePreferences,tagPreferences]=await Promise.all([
    rest(`lit_profile_favorite_books?user_id=eq.${me}&select=id,title,author_name,cover_path,external_url,sort_order&order=sort_order.asc&limit=50`),
    rest(`lit_profile_social_links?user_id=eq.${me}&select=id,platform,label,url,sort_order&order=sort_order.asc&limit=50`),
    rest(`lit_profile_genre_preferences?user_id=eq.${me}&select=genre_id,preference&limit=300`),rest(`lit_profile_topic_preferences?user_id=eq.${me}&select=topic_id,preference&limit=300`),
    rest(`lit_follows?following_id=eq.${me}&select=follower_id&limit=1000`),rest(`lit_follows?follower_id=eq.${me}&select=following_id&limit=1000`),
    rest(`lit_user_achievements?user_id=eq.${me}&select=achievement_id,earned_at,progress,showcase_order&limit=100`),rest('lit_achievements?active=eq.true&select=id,slug,name,description,category,icon,rarity,condition_value&limit=100'),rest(`lit_profile_format_preferences?user_id=eq.${me}&select=format_id,preference&limit=100`),rest(`lit_profile_audience_preferences?user_id=eq.${me}&select=audience_id,preference&limit=100`),rest(`lit_profile_tag_preferences?user_id=eq.${me}&select=tag_id,preference&limit=1000`)
  ]);
  const progressMap=Object.fromEntries((achievementProgress||[]).map(row=>[row.achievement_id,row]));const userAchievements=(achievements||[]).map(item=>({...item,...(progressMap[item.id]||{progress:0,earned_at:null})}));
  return {favoriteBooks:favoriteBooks||[],socialLinks:socialLinks||[],genrePreferences:genrePreferences||[],topicPreferences:topicPreferences||[],followers:followers?.length||0,following:following?.length||0,achievements:userAchievements,formatPreferences:formatPreferences||[],audiencePreferences:audiencePreferences||[],tagPreferences:tagPreferences||[]};
}
export async function replaceMyTaxonomyV2Preferences(preferences){return rpc('lit_replace_my_taxonomy_v2_preferences',{p_formats:preferences.formats||[],p_audiences:preferences.audiences||[],p_tags:preferences.tags||[]});}
export async function replaceMyProfileDetails({favoriteBooks=[],socialLinks=[],preferences}){
  return rpc('lit_replace_my_profile_details',{p_books:favoriteBooks,p_links:socialLinks,p_wanted_genres:preferences.wantedGenres,p_unwanted_genres:preferences.unwantedGenres,p_wanted_topics:preferences.wantedTopics,p_unwanted_topics:preferences.unwantedTopics});
}

export async function uploadProfileMedia(kind,file){
  await ensureSession();const me=session?.user?.id;if(!me)throw new Error('Войдите в аккаунт');
  const {bucket,column}=profileMediaTarget(kind);validateProfileImage(file,kind==='avatar'?5_242_880:8_388_608);
  const previous=await getMyProfile();if(!previous)throw new Error('Профиль не найден');
  const extension={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type];
  const path=`${me}/${kind}/${crypto.randomUUID()}.${extension}`;
  const url=await uploadPublicMedia(bucket,path,file);
  try{await updateMyProfile({[column]:path});}
  catch(error){
    try{await removePublicMedia(bucket,path);}catch(cleanupError){throw new Error(`${error.message}. Не удалось убрать незакреплённый файл: ${cleanupError.message}`,{cause:error});}
    throw error;
  }
  let cleanupWarning='';
  if(previous[column]&&String(previous[column]).startsWith(`${me}/`)){
    try{await removePublicMedia(bucket,previous[column]);}catch(error){cleanupWarning=`Изображение сохранено, но прежний файл не удалён: ${error.message}`;}
  }
  return {path,url,cleanupWarning};
}

function profileMediaTarget(kind){
  if(!['avatar','banner'].includes(kind))throw new TypeError('Неизвестный тип изображения профиля');
  return {bucket:kind==='banner'?'lit-profile-banners':'lit-avatars',column:kind==='banner'?'banner_path':'avatar_path'};
}
async function removePublicMedia(bucket,path){
  const response=await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}`,{method:'DELETE',headers:authHeaders(),body:JSON.stringify({prefixes:[path]})});
  await parse(response,'Supabase Storage');
}
export async function removeProfileMedia(kind){
  await ensureSession();const me=session?.user?.id;if(!me)throw new Error('Войдите в аккаунт');
  const {bucket,column}=profileMediaTarget(kind),previous=await getMyProfile();if(!previous)throw new Error('Профиль не найден');
  // Detach first: a storage error must never leave a profile pointing at a missing image.
  await updateMyProfile({[column]:null});
  let cleanupWarning='';
  if(previous[column]&&String(previous[column]).startsWith(`${me}/`)){
    try{await removePublicMedia(bucket,previous[column]);}catch(error){cleanupWarning=`Изображение удалено из профиля, но файл не удалён из Storage: ${error.message}`;}
  }
  return {path:'',url:'',cleanupWarning};
}

const inFilter=ids=>ids.map(x=>`\"${String(x).replaceAll('"','')}\"`).join(',');
export function publicObjectUrl(bucket,path){return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${String(path).split('/').map(encodeURIComponent).join('/')}`;}
export async function uploadPublicMedia(bucket,path,file){
  await ensureSession(); if(!session?.access_token)throw new Error('Войдите в аккаунт');
  const res=await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`,{method:'POST',headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${session.access_token}`,'Content-Type':file.type||'application/octet-stream','x-upsert':'false'},body:file});
  await parse(res);return publicObjectUrl(bucket,path);
}

export async function uploadWorkAsset(path,file){
  await ensureSession();if(!session?.user?.id)throw new Error('Войдите в аккаунт');
  if(!String(path).startsWith(`${session.user.id}/`))path=`${session.user.id}/${path}`;
  const url=await uploadPublicMedia('lit-work-assets',path,file);
  return {storagePath:path,url};
}

export async function fetchPublicFeed(){
  const posts=await rest('lit_posts?visibility=eq.public&select=id,author_id,post_type,body,work_id,version_id,created_at&order=created_at.desc&limit=50');
  return hydrateCloudPosts(posts);
}

// A permalink must resolve independently of the newest fifty feed entries.
export async function fetchCloudPost(postId){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(postId||''))throw new Error('Некорректная ссылка на пост');
  const posts=await rest(`lit_posts?id=eq.${postId}&visibility=eq.public&select=id,author_id,post_type,body,work_id,version_id,created_at&limit=1`);
  const hydrated=await hydrateCloudPosts(posts);
  return hydrated[0]||null;
}

async function hydrateCloudPosts(posts){
  if(!posts?.length)return [];
  const postIds=posts.map(p=>p.id);const authorIds=[...new Set(posts.map(p=>p.author_id))];
  const [profiles,media,likes,comments]=await Promise.all([
    rest(`lit_profiles?id=in.(${inFilter(authorIds)})&select=id,username,nickname,avatar_path,account_role,author_verified`),
    rest(`lit_post_media?post_id=in.(${inFilter(postIds)})&select=*&order=sort_order.asc`),
    rest(`lit_post_reactions?post_id=in.(${inFilter(postIds)})&select=post_id,user_id,reaction`),
    rest(`lit_comments?post_id=in.(${inFilter(postIds)})&select=id,post_id`)
  ]);
  const profileMap=Object.fromEntries((profiles||[]).map(p=>[p.id,p]));
  return posts.map(p=>{
    const prof=profileMap[p.author_id]||{};
    const pm=(media||[]).filter(m=>m.post_id===p.id).map(m=>({...m,url:publicObjectUrl('lit-post-media',m.storage_path)}));
    return {id:`cloud:${p.id}`,cloudId:p.id,cloud:true,authorId:p.author_id,author:prof.nickname||prof.username||'Пользователь',username:prof.username||'',avatar:prof.avatar_path?publicObjectUrl('lit-avatars',prof.avatar_path):'',role:prof.account_role==='author'?'Автор':'Читатель',text:p.body||'',postType:p.post_type,workId:p.work_id||null,media:pm,likes:(likes||[]).filter(x=>x.post_id===p.id).length,comments:(comments||[]).filter(x=>x.post_id===p.id).length,createdAt:p.created_at};
  });
}

export async function createCloudPost({text,files=[]}){
  await ensureSession();if(!session?.user?.id)throw new Error('Сначала войдите в аккаунт');
  const inserted=await rest('lit_posts',{method:'POST',body:{author_id:session.user.id,post_type:files.length?'media':'text',body:text,visibility:'public'},headers:{Prefer:'return=representation'}});
  const post=inserted?.[0];if(!post)throw new Error('Не удалось создать пост');
  let order=0;
  for(const file of files){
    const safe=file.name.replace(/[^a-zA-Z0-9._-]+/g,'-');
    const path=`${session.user.id}/${post.id}/${Date.now()}-${order}-${safe}`;
    await uploadPublicMedia('lit-post-media',path,file);
    await rest('lit_post_media',{method:'POST',body:{post_id:post.id,media_type:file.type.startsWith('video/')?'video':'image',storage_path:path,sort_order:order,alt_text:file.name}});
    order++;
  }
  return post;
}
export async function toggleCloudPostLike(postId){
  await ensureSession();if(!session?.user?.id)throw new Error('Сначала войдите');
  const existing=await rest(`lit_post_reactions?post_id=eq.${postId}&user_id=eq.${session.user.id}&select=post_id`);
  if(existing?.length)await rest(`lit_post_reactions?post_id=eq.${postId}&user_id=eq.${session.user.id}`,{method:'DELETE'});
  else await rest('lit_post_reactions',{method:'POST',body:{post_id:postId,user_id:session.user.id,reaction:'like'}});
}
export async function fetchPostComments(postId){
  const comments=await rest(`lit_comments?post_id=eq.${postId}&select=id,author_id,body,created_at&order=created_at.asc`);
  if(!comments?.length)return [];
  const ids=[...new Set(comments.map(c=>c.author_id))];
  const [profiles,reactions]=await Promise.all([
    rest(`lit_profiles?id=in.(${inFilter(ids)})&select=id,nickname,username,avatar_path`),
    rest(`lit_comment_reactions?comment_id=in.(${inFilter(comments.map(c=>c.id))})&select=comment_id,user_id,reaction`)
  ]);
  const pm=Object.fromEntries((profiles||[]).map(p=>[p.id,p]));
  return comments.map(c=>{const p=pm[c.author_id]||{};const rs=(reactions||[]).filter(r=>r.comment_id===c.id);const mine=rs.find(r=>r.user_id===session?.user?.id)?.reaction||null;return {id:c.id,cloud:true,author:p.nickname||p.username||'Пользователь',text:c.body,createdAt:c.created_at,time:new Date(c.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}),myReaction:mine,reactions:{helpful:rs.filter(r=>r.reaction==='helpful').length,disagree:rs.filter(r=>r.reaction==='disagree').length,unhelpful:rs.filter(r=>r.reaction==='unhelpful').length}};});
}
export async function createCloudComment(postId,text){
  await ensureSession();if(!session?.user?.id)throw new Error('Сначала войдите');
  return rest('lit_comments',{method:'POST',body:{author_id:session.user.id,post_id:postId,body:text},headers:{Prefer:'return=representation'}});
}
export async function setCloudCommentReaction(commentId,reaction){
  await ensureSession();if(!session?.user?.id)throw new Error('Сначала войдите');
  const userId=session.user.id;
  const current=await rest(`lit_comment_reactions?comment_id=eq.${commentId}&user_id=eq.${userId}&select=reaction`);
  const previous=current?.[0]?.reaction||null;
  if(previous===reaction){
    await rest(`lit_comment_reactions?comment_id=eq.${commentId}&user_id=eq.${userId}`,{method:'DELETE'});
    return {reaction:null};
  }
  if(previous){
    await rest(`lit_comment_reactions?comment_id=eq.${commentId}&user_id=eq.${userId}`,{method:'PATCH',body:{reaction},headers:{Prefer:'return=minimal'}});
  }else{
    await rest('lit_comment_reactions',{method:'POST',body:{comment_id:commentId,user_id:userId,reaction},headers:{Prefer:'return=minimal'}});
  }
  return {reaction};
}


// ---- Literature notifications, moderation and closed-beta administration ----
export async function fetchNotifications(limit=40){
  await ensureSession();const me=session?.user?.id;if(!me)return [];
  const rows=await rest(`lit_notifications?user_id=eq.${me}&select=id,user_id,actor_id,kind,title,body,entity_type,entity_id,created_at,read_at&order=created_at.desc&limit=${Number(limit)||40}`);
  return rows||[];
}
export async function markNotificationRead(id){
  await ensureSession();const me=session?.user?.id;if(!me)return;
  return rest(`lit_notifications?id=eq.${encodeURIComponent(id)}&user_id=eq.${me}`,{method:'PATCH',body:{read_at:new Date().toISOString()},headers:{Prefer:'return=minimal'}});
}
export async function markAllNotificationsRead(){
  await ensureSession();const me=session?.user?.id;if(!me)return;
  return rest(`lit_notifications?user_id=eq.${me}&read_at=is.null`,{method:'PATCH',body:{read_at:new Date().toISOString()},headers:{Prefer:'return=minimal'}});
}
export async function createReport({targetType,targetId,reason,details=''}){
  await ensureSession();const me=session?.user?.id;if(!me)throw new Error('Сначала войдите');
  const rows=await rest('lit_reports',{method:'POST',body:{reporter_id:me,target_type:String(targetType||'content'),target_id:String(targetId||''),reason:String(reason||'Другое'),details:String(details||'')},headers:{Prefer:'return=representation'}});
  return rows?.[0]||null;
}
export async function fetchModerationReports(){
  await ensureSession();
  return rest('lit_reports?select=*&order=created_at.desc&limit=100');
}
export async function setModerationReportStatus(id,status){
  await ensureSession();
  const patch={status};if(['resolved','dismissed'].includes(status))patch.resolved_at=new Date().toISOString();
  return rest(`lit_reports?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:patch,headers:{Prefer:'return=representation'}});
}
export async function requestAuthorVerification(note=''){
  await ensureSession();const me=session?.user?.id;if(!me)throw new Error('Сначала войдите');
  const rows=await rest('lit_author_verification_requests',{method:'POST',body:{user_id:me,note:String(note||'')},headers:{Prefer:'return=representation'}});
  return rows?.[0]||null;
}
export async function fetchMyVerificationRequests(){
  await ensureSession();const me=session?.user?.id;if(!me)return [];
  return rest(`lit_author_verification_requests?user_id=eq.${me}&select=*&order=created_at.desc&limit=10`);
}
export async function fetchVerificationRequests(){
  await ensureSession();
  return rest('lit_author_verification_requests?select=*&order=created_at.desc&limit=100');
}
export async function resolveAuthorVerification(id,status){
  const rows=await rpc('lit_resolve_author_verification',{p_request:id,p_status:status});
  return Array.isArray(rows)?rows[0]:rows;
}


// ---- Cloud literature core: works, versions, reviews and reading progress ----
const kindToDb=(kind)=>({Роман:'novel',Повесть:'novella',Рассказ:'story',Стихотворение:'poem',Фрагмент:'other'}[kind]||'other');
const kindFromDb=(kind)=>({novel:'Роман',novella:'Повесть',story:'Рассказ',poem:'Стихотворение',other:'Другое'}[kind]||'Другое');

export async function fetchCloudLiterature(){
  await ensureSession();const me=session?.user?.id;if(!me)return {works:[],reviews:[]};
  const fragments=await rest(`lit_fragments?author_id=eq.${me}&select=id,author_id,title,content,plain_text,visibility,evaluation_open,created_at,updated_at,published_at&order=updated_at.desc&limit=200`);
  const ownFragments=(fragments||[]).map(fragment=>({id:`fragment:${fragment.id}`,cloud:true,fragmentCloudId:fragment.id,authorId:fragment.author_id,author:'Автор',title:fragment.title,kind:'Фрагмент',genres:[],summary:'',cover:'',version:'1',rating:0,ratingsCount:0,content:fragment.plain_text||'',creationType:'fragment',editorMode:fragment.content?.editorMode||'document',documentPages:fragment.content?.documentPages||[{id:`page-${fragment.id}`,html:''}],bookPages:fragment.content?.bookPages||[],mediaLibrary:fragment.content?.mediaLibrary||[],publicationStatus:fragment.visibility==='public'?'published':'draft',evaluationStatus:fragment.evaluation_open?'open':'closed',status:fragment.evaluation_open?'evaluation':'draft',evaluationText:fragment.plain_text||'',feedbackWanted:[],minutes:Math.max(1,Math.ceil((fragment.plain_text||'').length/900)),createdAt:fragment.created_at}));
  const works=await rest('lit_works?select=id,author_id,title,summary,kind,status,genres,topics,content_rating,cover_path,format_id,created_at,updated_at,published_at,writing_status&order=updated_at.desc&limit=200');
  if(!works?.length)return {works:ownFragments,reviews:[]};
  const workIds=works.map(w=>w.id);
  const [versions,profiles,reviews,workGenres,workAudiences,workTags]=await Promise.all([
    rest(`lit_work_versions?work_id=in.(${inFilter(workIds)})&select=id,work_id,version_no,title,content,plain_text,evaluation_open,evaluation_excerpt,evaluation_meta,published_at,created_at&order=version_no.desc`),
    rest(`lit_profiles?id=in.(${inFilter([...new Set(works.map(w=>w.author_id))])})&select=id,username,nickname,avatar_path,account_role,author_verified`),
    rest(`lit_reviews?work_id=in.(${inFilter(workIds)})&select=id,reviewer_id,work_id,version_id,scope,anonymous,rating,category_ratings,body,annotations,created_at&order=created_at.desc`),
    rest(`lit_work_genres?work_id=in.(${inFilter(workIds)})&select=work_id,genre_id,is_primary&limit=1000`),rest(`lit_work_audiences?work_id=in.(${inFilter(workIds)})&select=work_id,audience_id&limit=1000`),rest(`lit_work_tags?work_id=in.(${inFilter(workIds)})&select=work_id,tag_id&limit=5000`)
  ]);
  const reviewerIds=[...new Set((reviews||[]).map(r=>r.reviewer_id))];
  const [reviewers,reactions]=await Promise.all([
    reviewerIds.length?rest(`lit_profiles?id=in.(${inFilter(reviewerIds)})&select=id,username,nickname,avatar_path`):Promise.resolve([]),
    reviews?.length?rest(`lit_review_reactions?review_id=in.(${inFilter(reviews.map(r=>r.id))})&select=review_id,user_id,reaction`):Promise.resolve([])
  ]);
  const pm=Object.fromEntries((profiles||[]).map(p=>[p.id,p]));
  const rpm=Object.fromEntries((reviewers||[]).map(p=>[p.id,p]));
  const versionById=Object.fromEntries((versions||[]).map(v=>[v.id,v]));
  const uiWorks=[...ownFragments];
  const uiIdByCloud={};
  for(const w of works){
    const vs=(versions||[]).filter(v=>v.work_id===w.id).sort((a,b)=>b.version_no-a.version_no);
    let v;
    if(w.author_id===me)v=vs[0];
    else v=vs.find(x=>x.published_at)||vs.find(x=>x.evaluation_open);
    if(!v)continue;
    const prof=pm[w.author_id]||{};
    const meta=v.evaluation_meta||{};const content=v.content||{};
    const id=`cloud:${w.id}`;uiIdByCloud[w.id]=id;
    uiWorks.push({
      id,cloud:true,cloudId:w.id,cloudVersionId:v.id,authorId:w.author_id,author:prof.nickname||prof.username||'Автор',
      title:w.title,summary:w.summary||'',kind:kindFromDb(w.kind),genres:w.genres||[],tags:w.topics||[],cover:w.cover_path||'/assets/home/reading-cover.png',
      version:String(v.version_no),rating:0,ratingsCount:0,authorActivity:50,createdAt:w.created_at,minutes:Math.max(1,Math.ceil(String(v.plain_text||'').length/900)),
      publicationStatus:w.status==='published'&&!!v.published_at?'published':'draft',evaluationStatus:v.evaluation_open?'open':'closed',status:v.evaluation_open?'evaluation':(w.status==='published'&&v.published_at?'published':'draft'),
      targetType:meta.targetType||'Фрагмент',evaluationTarget:meta.evaluationTarget||'Фрагмент',evaluationText:v.evaluation_excerpt||'',feedbackWanted:meta.feedbackWanted||[],content:v.plain_text||'',
      creationType:content.creationType||'work',editorMode:content.editorMode||'document',documentPages:content.documentPages||[],bookPages:content.bookPages||[],mediaLibrary:content.mediaLibrary||[],contentRating:w.content_rating||'general',topics:w.topics||[],formatId:w.format_id||null,writingStatus:w.writing_status||'draft',genreIds:(workGenres||[]).filter(row=>row.work_id===w.id).sort((a,b)=>Number(b.is_primary)-Number(a.is_primary)).map(row=>row.genre_id),audienceIds:(workAudiences||[]).filter(row=>row.work_id===w.id).map(row=>row.audience_id),tagIds:(workTags||[]).filter(row=>row.work_id===w.id).map(row=>row.tag_id)
    });
  }
  const uiReviews=(reviews||[]).map(r=>{
    const rp=rpm[r.reviewer_id]||{};const vr=versionById[r.version_id];const rs=(reactions||[]).filter(x=>x.review_id===r.id);
    return {id:`cloud-review:${r.id}`,cloud:true,cloudId:r.id,workId:uiIdByCloud[r.work_id]||`cloud:${r.work_id}`,version:String(vr?.version_no||''),scope:r.scope,authorId:r.reviewer_id,author:rp.nickname||rp.username||'Читатель',anonymous:!!r.anonymous,rating:Number(r.rating||0),comment:r.body||'',categories:r.category_ratings||{},annotations:r.annotations||[],reactions:{helpful:rs.filter(x=>x.reaction==='helpful').length,disagree:rs.filter(x=>x.reaction==='disagree').length,unhelpful:rs.filter(x=>x.reaction==='unhelpful').length},myReaction:rs.find(x=>x.user_id===me)?.reaction||null,createdAt:r.created_at};
  });
  for(const w of uiWorks){const rs=uiReviews.filter(r=>r.workId===w.id&&r.scope==='full');if(rs.length){w.rating=rs.reduce((a,r)=>a+r.rating,0)/rs.length;w.ratingsCount=rs.length;}}
  return {works:uiWorks,reviews:uiReviews};
}

export async function saveCloudWork(local,{mode='draft'}={}){
  await ensureSession();const me=session?.user?.id;if(!me)throw new Error('Сначала войдите');
  const content=assertPersistableDocument(serializeWorkContent(local));
  let workId=local.cloudId||null;
  const published=mode==='published'||local.publicationStatus==='published';
  const workPayload={title:local.title||'Без названия',summary:local.summary||'',kind:kindToDb(local.kind),status:published?'published':'draft',genres:local.genres||[],topics:local.topics||[],content_rating:local.contentRating||'general'};
  let work;
  if(workId){
    const rows=await rest(`lit_works?id=eq.${workId}`,{method:'PATCH',body:{...workPayload,...(published?{published_at:local.publishedAt||new Date().toISOString()}:{})},headers:{Prefer:'return=representation'}});work=rows?.[0];
  }else{
    const rows=await rest('lit_works',{method:'POST',body:{author_id:me,...workPayload,...(published?{published_at:new Date().toISOString()}:{})},headers:{Prefer:'return=representation'}});work=rows?.[0];workId=work?.id;
  }
  if(!workId)throw new Error('Не удалось сохранить произведение');
  const versionPayload={title:local.title||'Без названия',content,plain_text:local.content||'',evaluation_open:mode==='evaluation'||local.evaluationStatus==='open',evaluation_excerpt:local.evaluationText||'',evaluation_meta:{targetType:local.targetType||'Фрагмент',evaluationTarget:local.evaluationTarget||'Фрагмент',feedbackWanted:local.feedbackWanted||[]},...(published?{published_at:local.publishedAt||new Date().toISOString()}:{})};
  let version;
  if(local.cloudVersionId){
    const rows=await rest(`lit_work_versions?id=eq.${local.cloudVersionId}`,{method:'PATCH',body:versionPayload,headers:{Prefer:'return=representation'}});version=rows?.[0];
  }else{
    const existing=await rest(`lit_work_versions?work_id=eq.${workId}&select=id,version_no&order=version_no.desc&limit=1`);const next=(existing?.[0]?.version_no||0)+1;
    const rows=await rest('lit_work_versions',{method:'POST',body:{work_id:workId,created_by:me,version_no:next,...versionPayload},headers:{Prefer:'return=representation'}});version=rows?.[0];
  }
  if(!version)throw new Error('Не удалось сохранить версию');
  return {work,version};
}

export async function saveCloudWorkTaxonomy(workId,taxonomy){return rpc('lit_replace_work_taxonomy',{p_work:workId,p_format:taxonomy.formatId||null,p_genres:(taxonomy.genreIds||[]).slice(0,3),p_audiences:taxonomy.audienceIds||[],p_tags:(taxonomy.tagIds||[]).slice(0,30)});}

export async function saveCloudReview({work,review}){
  await ensureSession();const me=session?.user?.id;if(!me)throw new Error('Сначала войдите');
  if(!work?.cloudId||!work?.cloudVersionId)return null;
  const payload={reviewer_id:me,work_id:work.cloudId,version_id:work.cloudVersionId,scope:review.scope||'evaluation',anonymous:!!review.anonymous,rating:Number(review.rating||0),category_ratings:review.categories||{},body:review.comment||'',annotations:review.annotations||[],updated_at:new Date().toISOString()};
  let existing;
  if(review.cloudId)existing=[{id:review.cloudId}];
  else existing=await rest(`lit_reviews?reviewer_id=eq.${me}&work_id=eq.${work.cloudId}&version_id=eq.${work.cloudVersionId}&scope=eq.${encodeURIComponent(review.scope||'evaluation')}&select=id&limit=1`);
  if(existing?.[0]?.id){const rows=await rest(`lit_reviews?id=eq.${existing[0].id}`,{method:'PATCH',body:payload,headers:{Prefer:'return=representation'}});return rows?.[0]||null;}
  const rows=await rest('lit_reviews',{method:'POST',body:payload,headers:{Prefer:'return=representation'}});return rows?.[0]||null;
}

export async function setCloudReviewReaction(reviewId,reaction){
  await ensureSession();const me=session?.user?.id;if(!me)throw new Error('Сначала войдите');
  const current=await rest(`lit_review_reactions?review_id=eq.${reviewId}&user_id=eq.${me}&select=reaction`);const previous=current?.[0]?.reaction||null;
  if(previous===reaction){await rest(`lit_review_reactions?review_id=eq.${reviewId}&user_id=eq.${me}`,{method:'DELETE'});return null;}
  if(previous)await rest(`lit_review_reactions?review_id=eq.${reviewId}&user_id=eq.${me}`,{method:'PATCH',body:{reaction},headers:{Prefer:'return=minimal'}});
  else await rest('lit_review_reactions',{method:'POST',body:{review_id:reviewId,user_id:me,reaction},headers:{Prefer:'return=minimal'}});
  return reaction;
}

export async function saveCloudReadingProgress(work,{progress=0,status='reading'}={}){
  await ensureSession();const me=session?.user?.id;if(!me||!work?.cloudId)return;
  const row={user_id:me,work_id:work.cloudId,version_id:work.cloudVersionId||null,status,progress:Math.max(0,Math.min(100,Number(progress)||0)),last_position:0,updated_at:new Date().toISOString()};
  return rest('lit_reading_progress?on_conflict=user_id,work_id',{method:'POST',body:row,headers:{Prefer:'resolution=merge-duplicates,return=minimal'}});
}

export async function createEvaluationSession(targetCount){
  const rows=await rpc('lit_create_evaluation_session',{p_target_count:targetCount});
  if(!rows?.length)throw new Error('Сессия не содержит текстов');
  return {id:rows[0].session_id,items:rows.map(row=>({position:row.item_id,workId:`cloud:${row.work_id}`,cloudWorkId:row.work_id,versionId:row.version_id,title:row.title,plainText:row.plain_text,status:'pending'}))};
}
export async function completeEvaluationItem(sessionId,position){return rpc('lit_complete_evaluation_item',{p_session:sessionId,p_position:position});}
export async function fetchEvaluationCatalog({limit=24,offset=0}={}){
  const pageSize=Math.min(50,Number(limit)||24),start=Math.max(0,Number(offset)||0);
  const [versions,fragments]=await Promise.all([rest(`lit_work_versions?evaluation_open=eq.true&select=id,work_id,title,plain_text,created_at&order=created_at.desc&limit=${pageSize}&offset=${start}`),rest(`lit_fragments?visibility=eq.public&evaluation_open=eq.true&select=id,work_id,version_id,title,plain_text,published_at&order=published_at.desc&limit=${pageSize}&offset=${start}`)]);
  if(!versions?.length&&!fragments?.length)return [];
  const ids=[...new Set((versions||[]).map(version=>version.work_id))],works=await rest(`lit_works?id=in.(${inFilter(ids)})&select=id,author_id,title,summary,genres,topics,cover_path&limit=50`),workMap=Object.fromEntries((works||[]).map(work=>[work.id,work]));
  const workItems=(versions||[]).map(version=>{const work=workMap[version.work_id]||{};return {versionId:version.id,cloudWorkId:version.work_id,workId:`cloud:${version.work_id}`,title:work.title||version.title,summary:work.summary||'',genres:work.genres||[],topics:work.topics||[],cover:work.cover_path||'',plainText:version.plain_text||'',minutes:Math.max(1,Math.ceil(String(version.plain_text||'').length/900)),createdAt:version.created_at};});
  const fragmentItems=(fragments||[]).map(fragment=>({fragmentId:fragment.id,versionId:fragment.version_id||`fragment:${fragment.id}`,cloudWorkId:fragment.work_id,workId:fragment.work_id?`cloud:${fragment.work_id}`:`fragment:${fragment.id}`,title:fragment.title,summary:'Фрагмент',genres:[],topics:[],cover:'',plainText:fragment.plain_text||'',minutes:Math.max(1,Math.ceil(String(fragment.plain_text||'').length/900)),createdAt:fragment.published_at}));
  return [...fragmentItems,...workItems].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,pageSize);
}
export async function saveCloudFragment(local,{publish=true}={}){
  await ensureSession();const me=session?.user?.id;if(!me)throw new Error('Войдите в аккаунт');
  const content=assertPersistableDocument({type:'doc',content:[{type:'paragraph',text:local.content||''}],...serializeWorkContent(local)});
  const payload={author_id:me,work_id:local.cloudId||null,version_id:local.cloudVersionId||null,title:local.title||'Без названия',content,plain_text:local.content||'',visibility:publish?'public':'private',evaluation_open:publish,updated_at:new Date().toISOString(),...(publish?{published_at:local.publishedAt||new Date().toISOString()}:{})};
  if(local.fragmentCloudId){const rows=await rest(`lit_fragments?id=eq.${local.fragmentCloudId}&author_id=eq.${me}`,{method:'PATCH',body:payload,headers:{Prefer:'return=representation'}});return rows?.[0];}
  const rows=await rest('lit_fragments',{method:'POST',body:payload,headers:{Prefer:'return=representation'}});return rows?.[0];
}
export async function createCloudAnnotation(annotation){
  await ensureSession();const me=session?.user?.id;if(!me)throw new Error('Войдите в аккаунт');
  const rows=await rest('lit_review_annotations',{method:'POST',body:{reviewer_id:me,work_id:annotation.workId||null,version_id:annotation.versionId||null,fragment_id:annotation.fragmentId||null,annotation_type:annotation.type,block_id:annotation.blockId||null,start_offset:annotation.startOffset,end_offset:annotation.endOffset,selected_text:annotation.selectedText,prefix_text:annotation.prefixText||null,suffix_text:annotation.suffixText||null,body:annotation.body||''},headers:{Prefer:'return=representation'}});return rows?.[0];
}
export async function deleteCloudAnnotation(id){return rest(`lit_review_annotations?id=eq.${encodeURIComponent(id)}`,{method:'DELETE'});}
export async function fetchAuthorFeedback(){
  await ensureSession();const me=session?.user?.id;if(!me)return [];
  const works=await rest(`lit_works?author_id=eq.${me}&select=id&limit=200`);if(!works?.length)return [];
  return rest(`lit_review_annotations?work_id=in.(${inFilter(works.map(work=>work.id))})&select=id,reviewer_id,work_id,version_id,fragment_id,annotation_type,selected_text,body,created_at&order=created_at.desc&limit=200`);
}

// ---- Real user search, conversations and messages ----
export async function findProfileByUsername(username){
  await ensureSession();if(!session?.user?.id)throw new Error('Сначала войдите');
  const q=encodeURIComponent(String(username||'').trim().replace(/^@/,'').replace(/[,*()]/g,''));
  if(!q)return null;
  const rows=await rest(`lit_profiles?username=ilike.${q}&select=id,username,nickname,avatar_path,account_role,author_verified&limit=1`);
  return rows?.[0]||null;
}
export async function getOrCreateDirectConversation(otherUserId){
  await ensureSession();if(!session?.user?.id)throw new Error('Сначала войдите');
  return rpc('lit_get_or_create_direct_conversation',{p_other:otherUserId});
}
export async function createCloudGroupConversation(title,memberIds=[],workId=null){
  await ensureSession();const me=session?.user?.id;if(!me)throw new Error('Сначала войдите');
  const rows=await rest('lit_conversations',{method:'POST',body:{conversation_type:'project',title,created_by:me,work_id:workId||null},headers:{Prefer:'return=representation'}});
  const c=rows?.[0];if(!c)throw new Error('Не удалось создать группу');
  const unique=[...new Set([me,...memberIds.filter(Boolean)])];
  await rest('lit_conversation_members',{method:'POST',body:unique.map(id=>({conversation_id:c.id,user_id:id,role:id===me?'owner':'member'}))});
  return c.id;
}
export async function fetchMyConversations(){
  await ensureSession();const me=session?.user?.id;if(!me)return {threads:[],people:[]};
  const own=await rest(`lit_conversation_members?user_id=eq.${me}&select=conversation_id,role`);
  const ids=[...new Set((own||[]).map(x=>x.conversation_id))];
  if(!ids.length)return {threads:[],people:[]};
  const [convs,members]=await Promise.all([
    rest(`lit_conversations?id=in.(${inFilter(ids)})&select=id,conversation_type,title,created_by,work_id,created_at&order=created_at.desc`),
    rest(`lit_conversation_members?conversation_id=in.(${inFilter(ids)})&select=conversation_id,user_id,role,joined_at`)
  ]);
  const userIds=[...new Set((members||[]).map(x=>x.user_id))];
  const profiles=userIds.length?await rest(`lit_profiles?id=in.(${inFilter(userIds)})&select=id,username,nickname,avatar_path,account_role,author_verified`):[];
  const pmap=Object.fromEntries((profiles||[]).map(p=>[p.id,p]));
  const threads=(convs||[]).map(c=>{
    const cm=(members||[]).filter(m=>m.conversation_id===c.id);
    const others=cm.filter(m=>m.user_id!==me).map(m=>pmap[m.user_id]).filter(Boolean);
    const direct=c.conversation_type==='direct';
    const title=direct?(others[0]?.nickname||others[0]?.username||'Пользователь'):(c.title||'Группа');
    return {id:c.id,cloud:true,type:direct?'dm':'group',title,memberIds:others.map(p=>p.id),members:others.map(p=>({id:p.id,name:p.nickname||p.username,username:p.username,avatar:p.avatar_path?publicObjectUrl('lit-avatars',p.avatar_path):'',role:p.account_role,online:null})),messages:[],callsEnabled:direct};
  });
  const people=(profiles||[]).filter(p=>p.id!==me).map(p=>({id:p.id,name:p.nickname||p.username,username:p.username,avatar:p.avatar_path?publicObjectUrl('lit-avatars',p.avatar_path):'',role:p.account_role,online:null}));
  return {threads,people};
}
export async function fetchConversationMessages(conversationId){
  await ensureSession();const me=session?.user?.id;if(!me)return [];
  const rows=await rest(`lit_messages?conversation_id=eq.${conversationId}&select=id,sender_id,body,created_at,edited_at&order=created_at.asc&limit=250`);
  if(!rows?.length)return [];
  const ids=[...new Set(rows.map(x=>x.sender_id))];
  const profiles=await rest(`lit_profiles?id=in.(${inFilter(ids)})&select=id,nickname,username`);
  const pm=Object.fromEntries((profiles||[]).map(p=>[p.id,p]));
  return rows.map(m=>({id:m.id,fromId:m.sender_id,from:pm[m.sender_id]?.nickname||pm[m.sender_id]?.username||'Пользователь',text:m.body,time:new Date(m.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}),createdAt:m.created_at,mine:m.sender_id===me}));
}
export async function sendCloudMessage(conversationId,text){
  await ensureSession();const me=session?.user?.id;if(!me)throw new Error('Сначала войдите');
  return rest('lit_messages',{method:'POST',body:{conversation_id:conversationId,sender_id:me,body:text},headers:{Prefer:'return=representation'}});
}

// ---- Real WebRTC call signaling persisted in Supabase ----
export async function getConversationPeer(conversationId){
  await ensureSession();const me=session?.user?.id;if(!me)throw new Error('Сначала войдите');
  const members=await rest(`lit_conversation_members?conversation_id=eq.${conversationId}&select=user_id`);
  const ids=(members||[]).map(x=>x.user_id).filter(id=>id!==me);
  if(ids.length!==1)throw new Error('В этой версии реальный звонок работает только один-на-один');
  const profiles=await rest(`lit_profiles?id=eq.${ids[0]}&select=id,username,nickname,avatar_path&limit=1`);
  return profiles?.[0]||{id:ids[0],username:'',nickname:'Пользователь'};
}
export async function createCloudCall(conversationId,mode='audio'){
  await ensureSession();const me=session?.user?.id;if(!me)throw new Error('Сначала войдите');
  const rows=await rest('lit_calls',{method:'POST',body:{conversation_id:conversationId,started_by:me,mode:mode==='video'?'video':'audio',status:'ringing'},headers:{Prefer:'return=representation'}});
  return rows?.[0]||null;
}
export async function fetchIncomingCalls(){
  await ensureSession();const me=session?.user?.id;if(!me)return [];
  const rows=await rest(`lit_calls?status=eq.ringing&started_by=neq.${me}&select=id,conversation_id,started_by,mode,status,created_at&order=created_at.desc&limit=5`);
  if(!rows?.length)return [];
  const starters=[...new Set(rows.map(x=>x.started_by))];
  const profiles=await rest(`lit_profiles?id=in.(${inFilter(starters)})&select=id,username,nickname,avatar_path`);
  const pm=Object.fromEntries((profiles||[]).map(p=>[p.id,p]));
  return rows.map(c=>({...c,caller:pm[c.started_by]||null}));
}
export async function getCloudCall(callId){
  const rows=await rest(`lit_calls?id=eq.${callId}&select=*&limit=1`);return rows?.[0]||null;
}
export async function setCloudCallStatus(callId,status){
  const patch={status};if(status==='active')patch.answered_at=new Date().toISOString();if(['ended','declined','missed'].includes(status))patch.ended_at=new Date().toISOString();
  const rows=await rest(`lit_calls?id=eq.${callId}`,{method:'PATCH',body:patch,headers:{Prefer:'return=representation'}});return rows?.[0]||null;
}
export async function sendCloudCallSignal(callId,recipientId,signalType,payload={}){
  await ensureSession();const me=session?.user?.id;if(!me)throw new Error('Сначала войдите');
  return rest('lit_call_signals',{method:'POST',body:{call_id:callId,sender_id:me,recipient_id:recipientId,signal_type:signalType,payload},headers:{Prefer:'return=minimal'}});
}
export async function fetchCloudCallSignals(callId,afterId=0){
  await ensureSession();const me=session?.user?.id;if(!me)return [];
  return rest(`lit_call_signals?call_id=eq.${callId}&recipient_id=eq.${me}&id=gt.${Number(afterId)||0}&select=id,call_id,sender_id,recipient_id,signal_type,payload,created_at&order=id.asc`);
}
