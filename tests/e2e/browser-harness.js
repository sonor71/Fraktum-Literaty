// Browser regression fixtures exercise the real UI and HTTP contract. They do
// not connect to production or establish that Supabase RLS/OTP delivery works.
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {chromium} from 'playwright-core';

export const USER_ID='11111111-1111-4111-8111-111111111111';
export const POST_ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const BACKEND_ORIGIN='https://e2e.supabase.co';
export const PROFILE={id:USER_ID,username:'regression',nickname:'Regression Author',first_name:'Test',last_name:'Author',account_role:'author',author_verified:true,is_admin:false,xp:0,reviewer_reputation:0,bio:'Browser regression profile',avatar_path:null,banner_path:null};
const TABLES=['lit_profiles','lit_posts','lit_post_media','lit_post_reactions','lit_comments','lit_comment_reactions','lit_genres','lit_topics','lit_work_formats','lit_audience_segments','lit_tags','lit_profile_favorite_books','lit_profile_social_links','lit_profile_genre_preferences','lit_profile_topic_preferences','lit_follows','lit_user_achievements','lit_achievements','lit_profile_format_preferences','lit_profile_audience_preferences','lit_profile_tag_preferences','lit_author_verification_requests','lit_works','lit_work_versions','lit_reviews','lit_work_genres','lit_work_audiences','lit_work_tags','lit_review_reactions','lit_reading_progress','lit_conversation_members','lit_conversations','lit_messages','lit_calls','lit_call_signals','lit_notifications','lit_reports','lit_fragments','lit_review_annotations','lit_work_assets'];

function session(){
  return {access_token:'e2e-browser-access-token',refresh_token:'e2e-browser-refresh-token',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,user:{id:USER_ID,email:'regression@example.test'}};
}

export function createBackendFixture({posts=true,profile=PROFILE}={}){
  const tables=Object.fromEntries(TABLES.map(name=>[name,[]]));
  tables.lit_profiles=[structuredClone(profile)];
  tables.lit_genres=[{id:1,slug:'fantasy',name:'Фэнтези',active:true,sort_order:1}];
  if(posts)tables.lit_posts=[{id:POST_ID,author_id:USER_ID,post_type:'text',body:'Проверка стабильной ссылки на публикацию.',visibility:'public',created_at:'2026-10-26T10:00:00.000Z'}];
  const requests=[];
  const failures=[];
  const objects=new Map();
  const objectTypes=new Map();
  const fixture={tables,requests,failures,objects,session:session()};
  fixture.handle=async route=>{
    const request=route.request(),url=new URL(request.url()),method=request.method();
    const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS'};
    const reply=(data,status=200)=>route.fulfill({status,contentType:'application/json',headers,body:JSON.stringify(data)});
    if(method==='OPTIONS')return reply(null,200);
    let body;
    try{body=request.postDataJSON();}catch{body=null;}
    requests.push({pathname:url.pathname,search:url.search,method,body});
    if(url.pathname==='/auth/v1/otp')return reply({});
    if(url.pathname==='/auth/v1/verify'||url.pathname==='/auth/v1/token')return reply(fixture.session);
    if(url.pathname==='/auth/v1/logout')return reply({});
    if(url.pathname.startsWith('/storage/v1/object/')){
      const key=decodeURIComponent(url.pathname.replace('/storage/v1/object/','').replace(/^public\//,''));
      if(method==='POST'){
        objects.set(key,request.postDataBuffer());
        objectTypes.set(key,request.headers()['content-type']||'application/octet-stream');
        return reply({Key:key});
      }
      if(method==='DELETE'){
        for(const path of body?.prefixes||[]){objects.delete(`${key}/${path}`);objectTypes.delete(`${key}/${path}`);}
        return reply([]);
      }
      if(!objects.has(key))return reply({message:'Object not found in Storage fixture'},404);
      return route.fulfill({status:200,contentType:objectTypes.get(key),headers,body:objects.get(key)});
    }
    if(url.pathname.startsWith('/rest/v1/rpc/')){
      const rpc=url.pathname.split('/').at(-1);
      if(rpc==='lit_get_or_create_direct_conversation'){
        const peerId=body.p_other;
        const existing=tables.lit_conversations.find(conversation=>conversation.conversation_type==='direct'&&tables.lit_conversation_members.some(member=>member.conversation_id===conversation.id&&member.user_id===peerId));
        if(existing)return reply(existing.id);
        const id=crypto.randomUUID();
        tables.lit_conversations.push({id,conversation_type:'direct',created_by:USER_ID,created_at:new Date().toISOString()});
        tables.lit_conversation_members.push({conversation_id:id,user_id:USER_ID,role:'owner'},{conversation_id:id,user_id:peerId,role:'member'});
        return reply(id);
      }
      if(rpc==='lit_save_my_profile'){
        Object.assign(tables.lit_profiles.find(profile=>profile.id===USER_ID),body.p_profile);
        const details=body.p_details;
        tables.lit_profile_favorite_books=(details.favoriteBooks||[]).map(book=>({user_id:USER_ID,title:book.title,author_name:book.authorName,external_url:book.externalUrl}));
        tables.lit_profile_social_links=(details.socialLinks||[]).map(link=>({user_id:USER_ID,...link}));
        for(const [domain,column] of [['Genres','genre_id'],['Topics','topic_id']]){
          tables[`lit_profile_${domain==='Genres'?'genre':'topic'}_preferences`]=['wanted','unwanted'].flatMap(preference=>(details.preferences[`${preference}${domain}`]||[]).map(id=>({user_id:USER_ID,[column]:id,preference})));
        }
        return reply(null);
      }
      if(['lit_evaluate_my_achievements','lit_replace_my_profile_details','lit_replace_my_taxonomy_v2_preferences','lit_replace_work_taxonomy'].includes(rpc))return reply(null);
      failures.push(`Unhandled RPC fixture: ${rpc}`);
      return reply({message:`Unhandled fixture RPC ${rpc}`},500);
    }
    const table=url.pathname.replace('/rest/v1/','');
    if(!Object.hasOwn(tables,table)){
      failures.push(`Unhandled endpoint fixture: ${method} ${url.pathname}`);
      return reply({message:'Unhandled fixture endpoint'},500);
    }
    const matches=row=>[...url.searchParams].every(([column,filter])=>{
      if(filter.startsWith('eq.'))return String(row[column])===filter.slice(3);
      if(filter.startsWith('in.('))return filter.slice(4,-1).split(',').map(value=>value.replaceAll('"','')).includes(String(row[column]));
      if(filter.startsWith('ilike.'))return String(row[column]).toLowerCase()===filter.slice(6).toLowerCase();
      if(filter==='is.null')return row[column]==null;
      return true;
    });
    if(method==='GET')return reply(tables[table].filter(matches));
    if(method==='POST'){
      const inserted=(Array.isArray(body)?body:[body]).map(row=>({id:crypto.randomUUID(),created_at:new Date().toISOString(),...row}));
      tables[table].push(...inserted);
      return reply(inserted,201);
    }
    if(method==='PATCH'){
      const rows=tables[table].filter(matches);
      rows.forEach(row=>Object.assign(row,body));
      return reply(rows);
    }
    if(method==='DELETE'){
      tables[table]=tables[table].filter(row=>!matches(row));
      return reply([]);
    }
    failures.push(`Unhandled fixture method: ${method}`);
    return reply({message:'Unhandled fixture method'},405);
  };
  return fixture;
}

async function availablePort(){
  const reservation=createServer();
  await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});
  const {port}=reservation.address();
  await new Promise(resolve=>reservation.close(resolve));
  return port;
}

export async function createBrowserHarness(){
  const port=await availablePort(),baseURL=`http://127.0.0.1:${port}`;
  let serverOutput='';
  const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:String(port),VITE_SUPABASE_URL:BACKEND_ORIGIN,VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_browser_regression'},stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',data=>{serverOutput+=data;});
  server.stderr.on('data',data=>{serverOutput+=data;});
  let browser;
  try{
    let ready=false;
    for(let attempt=0;attempt<80;attempt++){
      if(server.exitCode!=null)throw new Error(`Server exited: ${serverOutput}`);
      try{ready=(await fetch(baseURL)).ok;}catch{}
      if(ready)break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    if(!ready)throw new Error(`Server readiness timeout: ${serverOutput}`);
    const executablePath=process.env.CHROMIUM_PATH||'/usr/bin/chromium';
    browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required']});
  }catch(error){server.kill();throw error;}
  return {
    browser,baseURL,
    async close(){await browser.close();server.kill();},
    async scenario(t,{authenticated=true,viewport={width:1366,height:900},reducedMotion='reduce',fixture=createBackendFixture(),path='/'}={}){
      const context=await browser.newContext({viewport,reducedMotion,permissions:['clipboard-read','clipboard-write']});
      const errors=[];
      t.after(async()=>{await context.close();});
      await context.route(`${BACKEND_ORIGIN}/**`,fixture.handle);
      if(authenticated)await context.addInitScript(({session})=>{
        if(!localStorage.getItem('__e2e-session-seeded')){
          localStorage.setItem('d20-supabase-session-v1',JSON.stringify(session));
          localStorage.setItem('__e2e-session-seeded','1');
        }
      },{session:fixture.session});
      const page=await context.newPage();
      page.on('pageerror',error=>errors.push(error.message));
      page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
      await page.goto(`${baseURL}${path}`);
      await page.waitForSelector(authenticated?'.app-shell,.app-layout,.sidebar':'.onboard-card');
      return {page,context,fixture,errors,baseURL};
    }
  };
}
