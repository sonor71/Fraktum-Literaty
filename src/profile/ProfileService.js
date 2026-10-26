export const SOCIAL_PLATFORMS=['Telegram','VK','YouTube','TikTok','X','Instagram','Website','Other'];

export function normalizeUrl(value){
  const raw=String(value||'').trim();if(!raw)return '';
  let parsed;try{parsed=new URL(raw);}catch{throw new TypeError('Введите полный URL, начинающийся с https://');}
  if(!['https:','http:'].includes(parsed.protocol))throw new TypeError('Разрешены только HTTP и HTTPS ссылки');
  return parsed.href;
}

export function normalizePreferences({wantedGenres=[],unwantedGenres=[],wantedTopics=[],unwantedTopics=[]}){
  const unique=items=>[...new Set(items.map(Number).filter(id=>Number.isSafeInteger(id)&&id>0))];
  const wg=unique(wantedGenres),wt=unique(wantedTopics);
  return {wantedGenres:wg,unwantedGenres:unique(unwantedGenres).filter(id=>!wg.includes(id)),wantedTopics:wt,unwantedTopics:unique(unwantedTopics).filter(id=>!wt.includes(id))};
}

export function profilePayload(form){
  const get=name=>String(form.get(name)||'').trim();
  return {nickname:get('nickname'),username:get('username').replace(/^@/,''),first_name:get('firstName'),last_name:get('lastName'),bio:get('bio').slice(0,2000),current_status:get('currentStatus').slice(0,160),interests:get('interests').split(',').map(x=>x.trim()).filter(Boolean).slice(0,20),favorite_topics:get('favoriteTopics').split(',').map(x=>x.trim()).filter(Boolean).slice(0,20)};
}

export function parseRows(form,prefix,fields){
  const count=Math.min(20,Math.max(0,Number(form.get(`${prefix}Count`))||0)),rows=[];
  for(let index=0;index<count;index++){
    const row={};for(const field of fields)row[field]=String(form.get(`${prefix}.${index}.${field}`)||'').trim();
    if(row[fields[0]])rows.push(row);
  }
  return rows;
}

// A server null means deletion; fallback is only for fields absent from a partial response.
export function profileMediaState(profile,fallback={},resolveUrl){
  const result={};
  for(const kind of ['avatar','banner']){
    const column=`${kind}_path`,key=`${kind}Path`,urlKey=`${kind}Url`;
    const present=profile!=null&&Object.hasOwn(profile,column);
    const path=present?(profile[column]||''):(fallback[key]||'');
    result[key]=path;
    result[urlKey]=path?resolveUrl(kind==='banner'?'lit-profile-banners':'lit-avatars',path):(present?'':fallback[urlKey]||'');
  }
  return result;
}
