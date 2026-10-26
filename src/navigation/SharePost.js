import {POST_UUID} from './Navigation.js';

export function postPermalink(post,origin){
  if(!post?.cloud||!POST_UUID.test(post.cloudId||''))throw new Error('У этого поста нет постоянной облачной ссылки');
  return new URL(`/post/${post.cloudId}`,origin).href;
}

export async function sharePost(post,{navigator:nav=globalThis.navigator,origin=globalThis.location.origin}={}){
  const url=postPermalink(post,origin);
  if(typeof nav.share==='function'){
    try{await nav.share({title:`Пост ${post.author||'FRAKTUM'}`,text:String(post.text||'').slice(0,180),url});return 'shared';}
    catch(error){if(error.name==='AbortError')return 'cancelled';throw error;}
  }
  if(typeof nav.clipboard?.writeText!=='function')throw new Error('Браузер не разрешает копирование ссылки. Откройте сайт по HTTPS');
  await nav.clipboard.writeText(url);
  return 'copied';
}
