import {chatDrawer,chatDock,messagesContent} from './chat/ChatView.js';
import {state, xpToLevel, reviewerRank} from './state.js';
import {FEEDBACK_CATEGORIES, ANNOTATION_TYPES} from './data.js';
import {esc,stars,pill,cover,progress,empty} from './ui.js';
import {profileView} from './profile/ProfileView.js';
import {feedbackView} from './feedback/FeedbackView.js';
import {sanitizeHtml} from './security/SanitizeHtml.js';
import {normalizeMediaObject,normalizePageMedia,workPages} from './editor/MediaModel.js';
import {hasLegacyRecovery} from './editor/LegacyMediaRecovery.js';

const me=()=>state.user;
const myWorks=()=>state.works.filter(w=>w.authorId===me()?.id);
const workById=id=>state.works.find(w=>w.id===id);
const reviewsFor=(id,version)=>state.reviews.filter(r=>r.workId===id && (!version||r.version===version));
const isIn=(bucket,id)=>state.library[bucket].includes(id);
const avg=(xs)=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;
const genreNames=()=>state.catalogs?.genres?.map(item=>item.name)||[];
const taxonomyIdChoices=(name,items,selected=[])=>`<section class="taxonomy-choices"><input type="search" data-taxonomy-search placeholder="Поиск"><div class="taxonomy-choice-list">${items.map(item=>`<label data-taxonomy-label="${esc(item.name.toLowerCase())}"><input type="checkbox" name="${name}" value="${item.id}" ${selected.map(Number).includes(Number(item.id))?'checked':''}><span>${esc(item.name)}${item.content_warning?' ⚠':''}</span></label>`).join('')}</div></section>`;
function taxonomyChoices(name,selected=[]){const genres=state.catalogs?.genres||[];return `<section class="taxonomy-choices"><input type="search" data-taxonomy-search placeholder="Найти жанр"><div class="taxonomy-choice-list">${genres.map(genre=>`<label data-taxonomy-label="${esc(genre.name.toLowerCase())}"><input type="checkbox" name="${name}" value="${esc(genre.name)}" ${selected.includes(genre.name)?'checked':''}><span>${esc(genre.name)}</span></label>`).join('')}</div></section>`;}

const BUILTIN_MEDIA=[
  {src:'/assets/home/seventh-horizon.png',name:'Замок в горах'},
  {src:'/assets/home/river-remembers.png',name:'Мост у реки'},
  {src:'/assets/home/sidebar-art.png',name:'Горный пейзаж'},
  {src:'/assets/home/quote-card.png',name:'Тёмный пейзаж'},
  {src:'/assets/home/brand.png',name:'Эмблема FRAKTUM'}
];

export function onboarding(){
  return `<main class="onboarding"><section class="onboard-card">
    <div class="brand-lockup"><img src="/assets/home/brand.png" alt="FRAKTUM"><div><h1>FRAKTUM</h1><p>Литературная платформа для авторов и читателей</p></div></div>
    <div class="step-badge">v0.19 · Free Canvas Book Studio</div>
    <h2>Кем вы хотите пользоваться платформой?</h2>
    <p class="muted">Роль можно изменить позже. Автор получает публикацию произведений, полный Book Studio и аналитику.</p>
    <div class="role-grid">
      <button class="role-card" data-action="choose-role" data-role="reader"><b>Читатель</b><span>Читать, оценивать, писать посты, вступать в сообщества.</span><em>Без верификации</em></button>
      <button class="role-card" data-action="choose-role" data-role="author"><b>Автор</b><span>Всё как у читателя + публикация произведений, версии, аналитика, полный редактор.</span><em>Нужна проверка реального человека</em></button>
    </div><button class="secondary wide" data-action="show-login">Уже есть аккаунт — войти</button>
  </section></main>`;
}

export function loginPage(auth={}){
  const method=auth.method==='phone'?'phone':'email';
  if(auth.pending){
    return `<main class="onboarding"><form class="onboard-card" id="otpVerifyForm" data-mode="login">
      <button type="button" class="text-btn" data-action="cancel-otp">← Назад</button>
      <span class="eyebrow">Supabase OTP</span><h2>Введите код</h2>
      <p class="muted">Код отправлен на <b>${esc(auth.pending.identifier||'')}</b>.</p>
      <label>Код подтверждения<input class="otp-code" name="token" inputmode="numeric" autocomplete="one-time-code" maxlength="8" required placeholder="123456"></label>
      <button class="primary wide" type="submit">Подтвердить и войти</button>
      <button class="secondary wide" type="button" data-action="resend-otp">Отправить код ещё раз</button>
    </form></main>`;
  }
  return `<main class="onboarding"><form class="onboard-card" id="loginOtpRequestForm">
    <button type="button" class="text-btn" data-action="show-signup">← К регистрации</button>
    <span class="eyebrow">Supabase Auth</span><h2>Вход по коду</h2>
    <p class="muted">Пароль не нужен. Выберите способ входа, получите одноразовый код и введите его на следующем шаге.</p>
    <div class="auth-method-tabs"><button type="button" class="${method==='email'?'active':''}" data-action="auth-method" data-method="email">Email</button><button type="button" class="${method==='phone'?'active':''}" data-action="auth-method" data-method="phone">Телефон</button></div>
    <label>${method==='phone'?'Номер телефона':'Email'}<input name="identifier" ${method==='phone'?'type="tel" inputmode="tel" placeholder="+79991234567"':'type="email" placeholder="you@example.com"'} required></label>
    <button class="primary wide" type="submit">Отправить код</button>
  </form></main>`;
}

export function registration(role,auth={}){
  const author=role==='author';
  const method=auth.method==='phone'?'phone':'email';
  if(auth.pending){
    return `<main class="onboarding"><form class="onboard-card" id="otpVerifyForm" data-mode="register">
      <button type="button" class="text-btn" data-action="cancel-otp">← Назад</button>
      <span class="eyebrow">Регистрация · ${method==='phone'?'SMS':'Email'} OTP</span><h2>Подтвердите контакт</h2>
      <p class="muted">Код отправлен на <b>${esc(auth.pending.identifier||'')}</b>. После подтверждения аккаунт будет создан на сервере.</p>
      <label>Код подтверждения<input class="otp-code" name="token" inputmode="numeric" autocomplete="one-time-code" maxlength="8" required placeholder="123456"></label>
      <button class="primary wide" type="submit">Подтвердить регистрацию</button>
      <button class="secondary wide" type="button" data-action="resend-otp">Отправить код ещё раз</button>
    </form></main>`;
  }
  return `<main class="onboarding"><form class="onboard-card" id="registrationOtpRequestForm" data-role="${role}">
    <button type="button" class="text-btn" data-action="back-onboarding">← Назад</button>
    <h2>${author?'Регистрация автора':'Регистрация читателя'}</h2>
    <div class="form-grid two"><label>Никнейм<input name="nickname" required placeholder="Как вас будут видеть на платформе"></label><label>Username<input name="username" required placeholder="@username"></label></div>
    <div class="form-grid two"><label>Имя<input name="firstName" required placeholder="Ваше имя"></label><label>Фамилия<input name="lastName" required placeholder="Ваша фамилия"></label></div>
    <div class="auth-method-tabs"><button type="button" class="${method==='email'?'active':''}" data-action="auth-method" data-method="email">Регистрация по email</button><button type="button" class="${method==='phone'?'active':''}" data-action="auth-method" data-method="phone">По телефону</button></div>
    <label>${method==='phone'?'Номер телефона':'Email'}<input name="identifier" ${method==='phone'?'type="tel" inputmode="tel" placeholder="+79991234567"':'type="email" placeholder="you@example.com"'} required></label>
    <fieldset><legend>Что вам интересно читать?</legend>${taxonomyChoices('genres')}</fieldset>
    <fieldset><legend>Что не хотите видеть?</legend>${taxonomyChoices('avoid')}</fieldset>
    ${author?`<div class="verification-box"><h3>Верификация автора в Closed Beta</h3><p>После подтверждения контакта мы автоматически создадим заявку на ручную проверку. До одобрения аккаунт работает как читатель. Документы FRAKTUM не хранит.</p></div>`:''}
    <button class="primary wide" type="submit">Отправить код</button>
  </form></main>`;
}

export function shell(content){
  const u=me();
  const author=u.role==='author';
  const serverOnline=!!state.cloud?.serverOnline;
  const nav=[
    ['home','Главная'],['evaluate','Оценить'],['read','Читать'],['library','Библиотека'],
    [author?'create':'notes',author?'Создать':'Мои заметки'],...(author?[['feedback','Обратная связь']]:[]),['messages','Сообщения'],
    ...(u.isAdmin?[['admin','Админ-панель']]:[])
  ];
  const unread=(state.notifications||[]).filter(n=>!n.read_at).length;
  return `<div class="app-shell ${state.ui.sidebarOpen?'sidebar-is-open':''}">
    <aside class="sidebar ${state.ui.sidebarOpen?'open':''}">
      <div class="sidebar-head"><b>Меню</b><button class="sidebar-close" data-action="toggle-sidebar" title="Закрыть меню">×</button></div>
      <nav>${nav.map(([id,label])=>`<button data-action="navigate" data-page="${id}" class="${(state.ui.page===id||(id==='evaluate'&&state.ui.page==='evaluation'))?'active':''}">${label}</button>`).join('')}</nav>
      <div class="side-user"><b>${esc(u.nickname||u.name)}</b><small>${author?'Автор ✓ · может читать и рецензировать':'Читатель'} · уровень ${xpToLevel(u.xp)}</small>${author?'':`<button data-action="switch-role">Стать автором</button>`}</div>
    </aside>
    <button class="sidebar-backdrop ${state.ui.sidebarOpen?'show':''}" data-action="toggle-sidebar" aria-label="Закрыть меню"></button>
    <div class="content-shell"><header class="topbar"><button class="menu-toggle" data-action="toggle-sidebar" aria-label="Открыть меню" title="Меню"><span></span><span></span><span></span></button><div class="search"><input id="globalSearch" placeholder="Поиск книг, авторов, сообществ..."></div><div class="level-mini"><span>XP ${u.xp}</span>${progress(((u.xp%200)/200)*100)}</div><span class="cloud-state ${serverOnline?'online':'local'}" title="${serverOnline?'Supabase отвечает':'Нет соединения с Supabase'}">${serverOnline?(u.cloud?'☁ единый аккаунт':'☁ server online'):'☁ offline'}</span><button class="game-launch" data-action="launch-game" title="Открыть FRAKTUM TCG с этим же аккаунтом">TCG</button><button class="notification-bell ${unread?'has-unread':''}" data-action="open-notifications" title="Уведомления">🔔${unread?`<i>${unread>99?'99+':unread}</i>`:''}</button><button class="avatar-btn" data-action="navigate" data-page="profile">${esc((u.nickname||u.name||"?").slice(0,1).toUpperCase())}</button>${u.cloud?`<button class="cloud-logout" data-action="cloud-logout" title="Выйти из облака">↪</button>`:`<button class="cloud-connect" data-action="cloud-login">Подключить аккаунт</button>`}</header>
      <main class="page" tabindex="-1">${hasLegacyRecovery(state.works)?'<aside class="legacy-media-warning" role="status">Сохранение на устройстве приостановлено: восстановите старые изображения в разделе «Создать». Исходный снимок сохранён; новые правки пока остаются в памяти.</aside>':''}${content}</main>
    </div>
    <div class="chat-shell ${state.ui.chatPanelOpen?'is-open':''}">
      <div class="chat-slide">
        <button class="chat-edge-toggle" data-action="toggle-chat-panel" aria-controls="chat-drawer" aria-expanded="${!!state.ui.chatPanelOpen}" aria-label="${state.ui.chatPanelOpen?'Закрыть чаты':'Открыть чаты'}">${state.ui.chatPanelOpen?'›':'‹'}</button>
        ${chatDrawer(state)}
      </div>
      ${chatDock(state)}
    </div>
  </div>`;
}

function postMedia(p){
  const items=p.media||[]; if(!items.length)return '';
  const cls=`post-media-grid count-${Math.min(items.length,4)}`;
  return `<div class="${cls}">${items.slice(0,4).map((m,i)=>m.media_type==='video'?`<video controls preload="metadata" src="${esc(m.url)}"></video>`:`<img src="${esc(m.url)}" alt="${esc(m.alt_text||'')}" loading="lazy">`).join('')}${items.length>4?`<span class="media-more">+${items.length-4}</span>`:''}</div>`;
}
function postAvatar(p){return p.avatar?`<img class="post-avatar" src="${esc(p.avatar)}" alt="">`:`<span class="post-avatar fallback">${esc((p.author||'?').slice(0,1).toUpperCase())}</span>`;}
export function postCard(p){
  return `<article class="card post ${p.editorial?'editorial-post':''} ${p.media?.length?'media-post':''}" data-post-id="${esc(p.cloudId||p.id)}"><div class="post-head"><div class="post-author">${postAvatar(p)}<span><b>${esc(p.author)}</b><small>@${esc(p.username||'')} · ${esc(p.role||'Пользователь')}</small></span></div><small class="post-time">${relativeTime(p.createdAt)}${p.cloud?' · ☁':''}</small></div>${p.text?`<p class="post-text">${esc(p.text)}</p>`:''}${postMedia(p)}${p.workId?`<button class="linked-work" data-action="open-work" data-id="cloud:${esc(p.workId)}">Открыть произведение →</button>`:''}<div class="post-actions"><button data-action="like-post" data-id="${esc(p.id)}">♡ ${p.likes}</button><button data-action="open-post-comments" data-id="${esc(p.id)}">💬 ${p.comments}</button><button data-action="share-post" data-id="${esc(p.id)}" ${p.cloud?'':'disabled title="Пост ещё не опубликован"'}>↗ Поделиться</button><button data-action="report-content" data-target-type="post" data-target-id="${esc(p.cloudId||p.id)}" aria-label="Пожаловаться на пост">⚑</button></div></article>`;
}

export function postPage(){
  const post=state.ui.postRouteStatus==='missing'?null:state.posts.find(item=>item.cloudId===state.ui.postId);
  const body=state.ui.postRouteStatus==='loading'?'<p role="status">Загружаем пост…</p>':state.ui.postRouteStatus==='error'?empty('Не удалось открыть пост',state.ui.postRouteError||'Проверьте соединение и попробуйте ещё раз.'):post?postCard(post):empty('Пост недоступен','Он удалён, закрыт автором или ссылка неверна.');
  return shell(`<div class="page-head"><h1>Пост</h1><button data-action="navigate" data-page="home">В ленту</button></div><section class="permalink-post">${body}</section>`);
}
function relativeTime(value){
  if(!value)return 'без даты';
  const d=new Date(value); if(Number.isNaN(d.getTime()))return 'без даты';
  const diff=Math.max(0,Date.now()-d.getTime());
  const min=Math.floor(diff/60000); if(min<1)return 'только что'; if(min<60)return `${min} мин назад`;
  const h=Math.floor(min/60); if(h<24)return `${h} ч назад`;
  const days=Math.floor(h/24); if(days<7)return `${days} дн назад`;
  return d.toLocaleDateString('ru-RU',{day:'2-digit',month:'short',year:d.getFullYear()===new Date().getFullYear()?undefined:'numeric'});
}

function launchChecklist(){
  const u=me();
  const items=[
    ['Профиль заполнен',Boolean(u.nickname&&u.username&&u.firstName)],
    ['Выбраны интересы',(u.preferences||[]).length>0],
    ['Добавлено произведение в библиотеку',state.library.later.length+state.library.reading.length+state.library.completed.length>0],
    ['Оставлена первая рецензия',state.reviews.some(r=>r.authorId===u.id)],
    ['Есть сообщество',state.joinedCommunities.length>0],
    ...(u.role==='author'?[['Создан авторский проект',myWorks().length>0]]:[])
  ];
  const done=items.filter(x=>x[1]).length;
  const pct=Math.round(done/items.length*100);
  if(pct===100)return '';
  return `<section class="card launch-checklist"><div class="row spread"><div><span class="eyebrow">Первый запуск</span><h3>Настройте FRAKTUM под себя</h3></div><b>${pct}%</b></div>${progress(pct)}<div class="checklist-items">${items.map(([label,ok])=>`<span class="${ok?'done':''}">${ok?'✓':'○'} ${esc(label)}</span>`).join('')}</div></section>`;
}

export function home(){
  const u=me();
  const recommended=getRecommendations().slice(0,3);
  return shell(`<div class="page-head"><div><h1>Главная</h1><p>Социальная лента: посты, обновления произведений и сообщества.</p></div><button class="primary" data-action="open-post">+ Пост</button></div>
    <div class="dashboard-grid"><section class="stack">
      ${launchChecklist()}
      ${state.posts.length?state.posts.map(postCard).join(''):empty('Лента пока пуста','Опубликуйте первый пост или подпишитесь на авторов.')}
    </section><aside class="stack"><section class="card"><h3>Для вас</h3><p class="muted">Рекомендации учитывают ваши жанры, активность авторов и бонус новым авторам.</p>${recommended.map(w=>`<button class="mini-work" data-action="open-work" data-id="${w.id}">${cover(w)}<span><b>${esc(w.title)}</b><small>${esc(w.author)} · ${stars(w.rating)}</small></span></button>`).join('')}</section><section class="card"><h3>Ваш прогресс</h3><div class="stats-row"><div><b>${u.xp}</b><small>XP</small></div><div><b>${u.reputation}</b><small>репутация</small></div><div><b>${reviewerRank(u.reputation)}</b><small>рецензент</small></div></div></section></aside></div>`);
}

function recommendationScore(w){
  const u=me();
  const wanted=(u.preferences||[]).filter(g=>w.genres.includes(g)).length*20;
  const avoided=(u.avoid||[]).filter(g=>w.genres.includes(g)).length*40;
  const active=w.authorActivity||30;
  const newBonus=(Date.now()-new Date(w.createdAt).getTime())/(864e5)<14?18:0;
  return wanted-avoided+active*.35+newBonus+(w.rating||0)*4;
}
export function getRecommendations(){ return [...state.works].filter(w=>w.publicationStatus==='published' && w.authorId!==me()?.id).sort((a,b)=>recommendationScore(b)-recommendationScore(a)); }

function evaluationMinutes(w){ return Math.max(1,Math.min(5,Math.ceil(String(w.content||'').slice(0,2200).length/700))); }
function evaluationExcerpt(w){
  const source=String(w.evaluationText||w.content||'');
  const paragraphs=source.split(/\n\n/).filter(Boolean);
  const chosen=paragraphs.slice(0,Math.min(4,paragraphs.length)).join('\n\n');
  return chosen.slice(0,2600);
}
export function getEvaluationCandidates(){
  const f=state.ui.evaluationFilters||{genres:[],kinds:[],length:'any'};
  return [...state.works].filter(w=>w.evaluationStatus==='open' && w.authorId!==me()?.id)
    .filter(w=>!f.genres?.length||f.genres.some(g=>w.genres.includes(g)))
    .filter(w=>!f.kinds?.length||f.kinds.includes(w.kind))
    .filter(w=>f.length==='any'||(f.length==='tiny'?evaluationMinutes(w)<=2:evaluationMinutes(w)>=3));
}
export function evaluatePage(){
  if(state.ui.evaluationMode==='catalog')return evaluationCatalogPage();
  return shell(`<section class="evaluation-hero"><span class="eyebrow">Оценка текстов</span><h1>Как вы хотите оценивать?</h1><p>Быстрая сессия фиксирует набор текстов и прогресс. В каталоге вы самостоятельно выбираете произведение.</p><div class="evaluation-mode-grid"><button class="evaluation-mode-card" data-action="evaluation-session-dialog"><b>Быстрая сессия</b><span>3, 5, 10, 20 или своё количество текстов</span></button><button class="evaluation-mode-card" data-action="evaluation-catalog"><b>Каталог</b><span>Фильтры и самостоятельный выбор</span></button></div><button class="evaluation-filter" data-action="evaluation-filters">Настроить фильтры</button></section>`);
}
function evaluationCatalogPage(){const items=state.evaluationCatalog||[];return shell(`<div class="page-head"><div><button class="text-btn" data-action="evaluation-mode-home">← Режим оценки</button><h1>Каталог оценки</h1><p>Свежие публичные версии, открытые для обратной связи.</p></div></div><div class="evaluation-catalog">${items.length?items.map(item=>`<article class="card evaluation-catalog-card">${item.cover?`<img src="${esc(item.cover)}" alt="">`:''}<div><span class="eyebrow">~${item.minutes} мин</span><h2>${esc(item.title)}</h2><p>${esc(item.summary||String(item.plainText).slice(0,180))}</p><div>${(item.genres||[]).map(pill).join('')}</div><button class="primary" data-action="evaluation-catalog-open" data-version="${item.versionId}">Оценить</button></div></article>`).join(''):empty('Нет доступных текстов','Измените фильтры или вернитесь позже.')}</div>`);}

export function evaluationSession(){
  const session=state.evaluationSession;if(session){const item=session.items[session.currentIndex];if(!item)return shell(empty('Сессия завершена','Все тексты оценены.'));const pct=Math.round(session.completedCount/session.targetCount*100);const anns=state.annotations[`${item.workId}:evaluation`]||[];return shell(`<div class="evaluation-head"><button class="text-btn" data-action="navigate" data-page="evaluate">← Выйти</button><div><span class="eyebrow">Сессия · ${session.completedCount+1} / ${session.targetCount}</span><h1>${esc(item.title)}</h1></div></div><div class="session-progress"><span style="width:${pct}%"></span></div><div class="evaluation-layout"><section class="reader-sheet evaluation-sheet"><div class="reader-toolbar"><button data-action="font-down">A−</button><button data-action="font-up">A+</button><button data-action="toggle-reader-theme">Фон</button><button data-action="save-selection" class="accent">Отметить выделение</button></div><article id="readerText" class="reader-text">${String(item.plainText||'').split(/\n\n/).map(text=>`<p>${esc(text)}</p>`).join('')}</article><div class="reader-finish"><span>${anns.length} пометок</span><button class="primary" data-action="evaluation-session-next">${session.completedCount+1>=session.targetCount?'Завершить сессию':'Следующий текст'}</button></div></section></div>`);}
  const candidates=getEvaluationCandidates();
  let w=workById(state.ui.evaluationWorkId);
  if(!w||!candidates.some(x=>x.id===w.id)) w=candidates[0];
  if(!w) return shell(`<button class="text-btn" data-action="navigate" data-page="evaluate">← Назад</button>${empty('Нет подходящих отрывков','Измените фильтры раздела «Оценить».')}`);
  const anns=state.annotations[`${w.id}:evaluation`]||[];
  const excerpt=evaluationExcerpt(w);
  return shell(`<div class="evaluation-head"><button class="text-btn" data-action="navigate" data-page="evaluate">← К выбору</button><div><span class="eyebrow">${esc(w.kind)} · ~${evaluationMinutes(w)} мин</span><h1>${esc(w.title)}</h1><p>${esc(w.author)} · ${esc(w.evaluationTarget)}</p></div><button data-action="start-evaluation">Другой отрывок →</button></div><div class="evaluation-layout"><section class="reader-sheet evaluation-sheet"><div class="reader-toolbar"><button data-action="font-down">A−</button><button data-action="font-up">A+</button><button data-action="toggle-reader-theme">Фон</button><button data-action="save-selection" class="accent">Отметить выделение</button></div><article id="readerText" class="reader-text"><h2>Фрагмент для оценки</h2>${excerpt.split(/\n\n/).map(p=>`<p>${esc(p)}</p>`).join('')}</article><div class="reader-finish"><span>${anns.length} пометок</span><button class="primary" data-action="open-review" data-id="${w.id}" data-mode="evaluation">Завершить оценку</button></div></section><aside class="reader-notes"><h3>Ваши пометки</h3>${anns.length?anns.map((a,i)=>`<div class="annotation"><b>${esc(a.label)}</b><q>${esc(a.quote)}</q>${a.comment?`<p>${esc(a.comment)}</p>`:''}<button data-action="delete-annotation" data-work="${w.id}" data-scope="evaluation" data-index="${i}">Удалить</button></div>`).join(''):empty('Пока пусто','Выделите фразу и нажмите «Отметить выделение».')}</aside></div>`);
}

export function readDiscovery(){
  const f=state.ui.readFilters||{query:'',genre:'',length:''};
  const works=getReadCandidates();
  return shell(`<div class="page-head"><div><h1>Читать</h1><p>Полные опубликованные произведения. Короткие фрагменты для критики находятся отдельно в разделе «Оценить».</p></div></div>
    <form class="filterbar read-filterbar" id="readFiltersForm"><label>Поиск<input name="query" value="${esc(f.query||'')}" placeholder="Название или автор"></label><label>Жанр<select name="genre"><option value="">Все</option>${genreNames().map(g=>`<option ${f.genre===g?'selected':''}>${esc(g)}</option>`).join('')}</select></label><label>Длина<select name="length"><option value="" ${!f.length?'selected':''}>Любая</option><option value="short" ${f.length==='short'?'selected':''}>до 10 минут</option><option value="medium" ${f.length==='medium'?'selected':''}>10–20 минут</option><option value="long" ${f.length==='long'?'selected':''}>20+ минут</option></select></label><button class="primary">Показать</button><button type="button" data-action="reset-read-filters">Сбросить</button></form>
    <div class="work-grid">${works.length?works.map(workCard).join(''):empty('Нет совпадений','Попробуйте изменить фильтры.')}</div>`);
}

export function getReadCandidates(){
  const f=state.ui.readFilters||{query:'',genre:'',length:''};
  const q=String(f.query||'').trim().toLowerCase();
  return getRecommendations().filter(w=>(!q||w.title.toLowerCase().includes(q)||w.author.toLowerCase().includes(q))&&(!f.genre||w.genres.includes(f.genre))&&(!f.length||(f.length==='short'?w.minutes<=10:f.length==='medium'?w.minutes>10&&w.minutes<=20:w.minutes>20)));
}

export function workCard(w){
  const later=isIn('later',w.id);
  const reading=isIn('reading',w.id);
  const pct=Math.round(state.readingProgress?.[w.id]||0);
  return `<article class="work-card">${cover(w,'big')}<div class="work-body"><div class="row spread"><span class="eyebrow">${esc(w.kind)} · ~${w.minutes} мин</span><span>${stars(w.rating)} ${(w.rating||0).toFixed(1)}</span></div><h2>${esc(w.title)}</h2><p class="author-line">${esc(w.author)}</p><div>${w.genres.map(pill).join('')}</div><p>${esc(w.summary)}</p>${reading&&pct>0?`<div class="work-progress"><small>Прогресс ${pct}%</small>${progress(pct)}</div>`:''}<div class="actions"><button class="primary" data-action="work-details" data-id="${w.id}">Подробнее</button><button data-action="start-reading" data-id="${w.id}">${reading?'Читать далее':'Читать'}</button><button data-action="toggle-later" data-id="${w.id}">${later?'✓ Читать позже':'＋ Читать позже'}</button></div></div></article>`;
}

export function workDetailPage(){
  const w=workById(state.ui.selectedWorkId);
  if(!w||w.publicationStatus!=='published') return readDiscovery();
  const rs=reviewsFor(w.id,w.version).filter(r=>(r.scope||'full')==='full');
  const later=isIn('later',w.id), reading=isIn('reading',w.id), completed=isIn('completed',w.id);
  const pct=Math.round(state.readingProgress?.[w.id]||0);
  return shell(`<button class="text-btn" data-action="navigate" data-page="read">← Каталог</button><section class="work-detail card">${cover(w,'detail-cover')}<div class="work-detail-main"><div class="row spread"><span class="eyebrow">${esc(w.kind)} · версия ${esc(w.version)}</span><span>${stars(w.rating)} ${(w.rating||0).toFixed(1)} · ${w.ratingsCount||0} оценок</span></div><h1>${esc(w.title)}</h1><p class="author-line">${esc(w.author)}</p><div>${w.genres.map(pill).join('')}</div><p class="work-summary">${esc(w.summary)}</p><div class="work-meta-strip"><span><b>${String(w.content||'').trim()?String(w.content||'').trim().split(/\s+/).length:0}</b><small>слов</small></span><span><b>~${w.minutes}</b><small>мин чтения</small></span><span><b>${w.editorMode==='book'?Math.max(1,(w.bookPages||[]).filter(p=>p.type==='content').length):Math.max(1,(w.documentPages||[]).length)}</b><small>${w.editorMode==='book'?'страниц':'частей'}</small></span><span><b>v${esc(w.version)}</b><small>версия</small></span></div>${reading&&pct>0?`<div class="work-progress"><b>Вы прочитали ${pct}%</b>${progress(pct)}</div>`:''}<div class="actions"><button class="primary" data-action="start-reading" data-id="${w.id}">${completed?'Перечитать':reading?'Читать далее':'Начать читать'}</button><button data-action="toggle-later" data-id="${w.id}">${later?'✓ В «читать позже»':'＋ Читать позже'}</button>${w.authorId!==me()?.id?`<button data-action="report-content" data-target-type="work" data-target-id="${w.cloudId||w.id}">⚑ Пожаловаться</button>`:''}</div></div></section><section class="work-detail-reviews"><div class="page-head"><div><h2>Отзывы о текущей версии</h2><p>${rs.length?`${rs.length} рецензий читателей`:'Полных рецензий пока нет.'}</p></div></div>${rs.length?rs.slice(0,6).map(r=>reviewCard(r,w.authorId===me()?.id)).join(''):empty('Пока нет отзывов','После полного прочтения здесь появятся рецензии.')}</section>`);
}

export function readerPage(){
  const w=workById(state.ui.selectedWorkId);
  if(!w||w.publicationStatus!=='published') return shell(empty('Нет произведения','Вернитесь в раздел «Читать».'));
  const anns=state.annotations[`${w.id}:full`]||state.annotations[w.id]||[];
  const completed=isIn('completed',w.id);
  const pct=Math.round(state.readingProgress?.[w.id]||0);
  const isBook=w.editorMode==='book'&&(w.bookPages||[]).length;
  if(isBook){
    const pages=w.bookPages||[];
    const start=Math.max(0,Math.min(pages.length-1,Number(state.ui.readerBookIndex||0)));
    const left=pages[start];
    const right=start===0?null:pages[start+1]||null;
    const renderReadPage=(pg,side)=>{
      if(!pg)return `<div class="reader-book-page reader-book-blank ${side}"></div>`;
      return `<article class="reader-book-page reader-book-content ${side} book-composed-page">${renderPageComposition(pg,w,{editable:false,variant:'reader'})}</article>`;
    };
    return shell(`<div class="reader-book-layout"><aside class="reader-side">${cover(w,'reader-cover')}<h2>${esc(w.title)}</h2><p>${esc(w.author)}</p><div>${w.genres.map(pill).join('')}</div><hr><div class="reader-progress-box"><b>${completed?'Прочитано':'Страница книги'}</b>${progress(completed?100:pct)}<small>${completed?100:pct}%</small></div><button data-action="work-details" data-id="${w.id}">О произведении</button></aside><section class="real-book-reader"><div class="reader-toolbar book-reader-toolbar"><button data-action="reader-book-prev" ${start<=0?'disabled':''}>←</button><span>${start+1}${right?`–${Math.min(pages.length,start+2)}`:''} / ${pages.length}</span><button data-action="reader-book-next" ${start>=pages.length-1?'disabled':''}>→</button><button data-action="open-review" data-id="${w.id}" data-mode="full" class="accent">${completed?'Изменить рецензию':'Завершить и оценить'}</button></div><div class="reader-book-scene" data-reader-book><div class="reader-book-spread ${start===0?'single-cover':''}">${renderReadPage(left,'left')}${right?renderReadPage(right,'right'):''}<div class="reader-book-gutter"></div></div><button class="book-hotzone book-hotzone-left" data-action="reader-book-prev" aria-label="Предыдущие страницы"></button><button class="book-hotzone book-hotzone-right" data-action="reader-book-next" aria-label="Следующие страницы"></button></div><div class="reader-book-hint">Листайте стрелками, кликом по краю книги или свайпом.</div></section></div>`);
  }
  return shell(`<div class="reader-layout"><aside class="reader-side">${cover(w,'reader-cover')}<h2>${esc(w.title)}</h2><p>${esc(w.author)}</p><div>${w.genres.map(pill).join('')}</div><hr><div class="reader-progress-box"><b>${completed?'Прочитано':'Прогресс чтения'}</b>${progress(completed?100:pct)}<small>${completed?100:pct}%</small></div><p class="muted">Полный режим чтения. Прогресс сохраняется автоматически, пока вы прокручиваете текст.</p><button data-action="work-details" data-id="${w.id}">О произведении</button><button data-action="toggle-later" data-id="${w.id}">${isIn('later',w.id)?'✓ В «читать позже»':'＋ Читать позже'}</button></aside>
    <section class="reader-sheet"><div class="reader-toolbar"><button data-action="font-down">A−</button><button data-action="font-up">A+</button><button data-action="toggle-reader-theme">Фон</button><button data-action="save-selection" class="accent">Отметить выделение</button></div><article id="readerText" class="reader-text scroll-reader" data-work="${w.id}"><h1>${esc(w.title)}</h1>${(w.documentPages||[]).length?(w.documentPages||[]).map(page=>`<section class="document-reader-page">${renderPageComposition(page,w,{variant:'reader'})}</section>`).join(''):w.content.split(/\n\n/).map(p=>`<p>${esc(p)}</p>`).join('')}</article><div class="reader-finish"><span>${anns.length} пометок · прогресс <b id="readerProgressValue">${pct}%</b></span><button class="primary" data-action="open-review" data-id="${w.id}" data-mode="full">${completed?'Изменить рецензию':'Завершить чтение и оценить'}</button></div></section>
    <aside class="reader-notes"><h3>Ваши пометки</h3>${anns.length?anns.map((a,i)=>`<div class="annotation"><b>${esc(a.label)}</b><q>${esc(a.quote)}</q>${a.comment?`<p>${esc(a.comment)}</p>`:''}<button data-action="delete-annotation" data-work="${w.id}" data-scope="full" data-index="${i}">Удалить</button></div>`).join(''):empty('Пока пусто','Выделите фразу в тексте и нажмите «Отметить выделение».')}</aside></div>`);
}

export function library(){
  const tabs=[['reading','Читаю'],['later','Читать позже'],['completed','Прочитанные']];
  return shell(`<div class="page-head"><div><h1>Библиотека</h1><p>Продолжить чтение, отложенные и завершённые произведения.</p></div></div><div class="library-columns">${tabs.map(([key,label])=>`<section class="card"><h2>${label}</h2>${state.library[key].length?state.library[key].map(id=>{const w=workById(id);return w?`<button class="library-item" data-action="open-work" data-id="${id}">${cover(w)}<span><b>${esc(w.title)}</b><small>${esc(w.author)}</small>${key==='reading'?progress(Math.round(state.readingProgress?.[id]||0)):''}<small class="library-cta">${key==='reading'?`Читать далее · ${Math.round(state.readingProgress?.[id]||0)}% →`:key==='later'?'Начать читать →':'Открыть →'}</small></span></button>`:''}).join(''):empty('Пусто',key==='later'?'Добавьте произведение из раздела «Читать».':'Здесь появятся произведения после чтения.')}</section>`).join('')}</div>`);
}

export function createPage(){
  if(me().role!=='author') return notesPage();
  const own=myWorks();
  const selected=state.ui.selectedStudioWorkId==='__new__'?null:(workById(state.ui.selectedStudioWorkId)||own[0]);
  const center=state.ui.selectedStudioWorkId==='__new__'?createWizard():selected?editor(selected):createWelcome();
  return shell(`<div class="studio-v2"><aside class="studio-projects"><div class="row spread"><div><span class="eyebrow">FRAKTUM Studio</span><h2>Проекты</h2></div><button class="primary small" data-action="new-work">+ Новый</button></div>${own.length?own.map(w=>`<button class="studio-work ${selected?.id===w.id?'active':''}" data-action="studio-select" data-id="${w.id}"><b>${esc(w.title||'Без названия')}</b><small>${w.creationType==='fragment'?'Фрагмент':w.editorMode==='book'?'Книга':'Документ'} · v${esc(w.version)}</small></button>`).join(''):empty('Нет проектов','Создайте первый текст.')}</aside><section class="studio-main">${center}</section></div>`);
}

function createWelcome(){
  return `<div class="studio-welcome"><span class="eyebrow">Создать</span><h1>Новый текст</h1><p>Выберите «+ Новый», чтобы создать произведение или отдельный отрывок для оценки.</p><button class="primary" data-action="new-work">+ Новый проект</button></div>`;
}

function createWizard(){
  const type=state.ui.createDraftType;
  if(!type) return `<div class="create-wizard"><span class="eyebrow">Создать</span><h1>Что вы хотите создать?</h1><div class="creation-choice-grid"><button class="creation-choice" data-action="set-create-type" data-type="work"><b>Произведение</b><span>Книга или рассказ для публикации и чтения.</span></button><button class="creation-choice" data-action="set-create-type" data-type="fragment"><b>Фрагмент</b><span>Публичный отрывок, который можно отправить на оценку.</span></button><button class="creation-choice" data-action="set-create-type" data-type="draft"><b>Черновик</b><span>Приватная работа, видимая только вам.</span></button><button class="creation-choice" data-action="open-post"><b>Пост</b><span>Короткая публикация в социальной ленте.</span></button></div></div>`;
  if(type==='fragment') return `<div class="create-wizard"><button class="text-btn" data-action="set-create-type" data-type="">← Назад</button><span class="eyebrow">Фрагмент</span><h1>Публичный отрывок</h1><p>После публикации фрагмент появится в каталоге оценки как отдельная сущность.</p><button class="primary big-action" data-action="start-create-project" data-type="fragment" data-mode="document">Открыть редактор →</button></div>`;
  if(type==='draft') return `<div class="create-wizard"><button class="text-btn" data-action="set-create-type" data-type="">← Назад</button><span class="eyebrow">Черновик</span><h1>Приватный проект</h1><p>Черновик не публикуется и не попадает в открытый каталог.</p><button class="primary big-action" data-action="start-create-project" data-type="draft" data-mode="document">Открыть редактор →</button></div>`;
  return `<div class="create-wizard"><button class="text-btn" data-action="set-create-type" data-type="">← Назад</button><span class="eyebrow">Произведение</span><h1>Выберите режим работы</h1><div class="creation-choice-grid"><button class="creation-choice" data-action="start-create-project" data-type="work" data-mode="document"><b>Документ</b><span>Страницы вертикально прокручиваются вниз. Подходит для быстрого написания и редактирования.</span></button><button class="creation-choice" data-action="start-create-project" data-type="work" data-mode="book"><b>Книга</b><span>Свободные страницы как в настоящем дневнике: текст, фото, фон, слои и произвольная композиция. Готовую книгу можно перелистывать.</span></button></div></div>`;
}

function wordRibbon(w){
  return `<div class="word-ribbon studio-ribbon-v2"><div class="word-tabs"><span class="active" aria-current="page">Главная</span><button type="button" data-action="studio-focus-media">Вставка</button><button type="button" data-action="studio-toggle-grid">Макет</button><span class="ribbon-hint">Ctrl/Cmd+B · I · U · S — сохранить Ctrl/Cmd+S</span></div><div class="word-tools">
    <select class="editor-tool-select" data-editor-tool="fontFamily" title="Шрифт"><option value="Georgia">Georgia</option><option value="Arial">Arial</option><option value="Times New Roman">Times New Roman</option><option value="Verdana">Verdana</option><option value="Trebuchet MS">Trebuchet</option><option value="Courier New">Courier New</option></select>
    <select class="editor-tool-select small-select" data-editor-tool="fontSize" title="Размер"><option value="12">12</option><option value="14">14</option><option value="16" selected>16</option><option value="18">18</option><option value="20">20</option><option value="24">24</option><option value="30">30</option><option value="36">36</option><option value="48">48</option></select>
    <select class="editor-tool-select line-select" data-editor-tool="lineHeight" title="Интервал"><option value="1.2">1.2</option><option value="1.4">1.4</option><option value="1.6" selected>1.6</option><option value="1.8">1.8</option><option value="2">2.0</option></select>
    <span class="tool-sep"></span>
    <button type="button" data-action="editor-cmd" data-cmd="bold" title="Жирный"><b>B</b></button><button type="button" data-action="editor-cmd" data-cmd="italic" title="Курсив"><i>I</i></button><button type="button" data-action="editor-cmd" data-cmd="underline" title="Подчёркивание"><u>U</u></button><button type="button" data-action="editor-cmd" data-cmd="strikeThrough" title="Зачёркивание"><s>S</s></button>
    <label class="editor-color-tool" title="Цвет текста">A<input type="color" data-editor-tool="color" value="#171717"></label><label class="editor-color-tool highlight" title="Выделение">▰<input type="color" data-editor-tool="backgroundColor" value="#fff2a8"></label>
    <span class="tool-sep"></span>
    <select class="editor-tool-select block-select" data-editor-tool="block"><option value="P">Обычный текст</option><option value="H1">Заголовок 1</option><option value="H2">Заголовок 2</option><option value="H3">Заголовок 3</option><option value="BLOCKQUOTE">Цитата</option></select>
    <button type="button" data-action="editor-cmd" data-cmd="justifyLeft" title="По левому краю">≡←</button><button type="button" data-action="editor-cmd" data-cmd="justifyCenter" title="По центру">≡</button><button type="button" data-action="editor-cmd" data-cmd="justifyRight" title="По правому краю">→≡</button><button type="button" data-action="editor-cmd" data-cmd="justifyFull" title="По ширине">☰</button>
    <button type="button" data-action="editor-cmd" data-cmd="insertUnorderedList">• список</button><button type="button" data-action="editor-cmd" data-cmd="insertOrderedList">1. список</button><button type="button" data-action="editor-cmd" data-cmd="outdent">⇤</button><button type="button" data-action="editor-cmd" data-cmd="indent">⇥</button>
    <span class="tool-sep"></span><button type="button" data-action="editor-link">🔗</button><button type="button" data-action="editor-cmd" data-cmd="undo">↶</button><button type="button" data-action="editor-cmd" data-cmd="redo">↷</button><button type="button" data-action="editor-cmd" data-cmd="removeFormat">Очистить</button>
  </div></div>`;
}


const PAGE_CANVAS_W=760;
const PAGE_CANVAS_H=1080;
const pct=(n,total)=>`${Math.max(-100,Math.min(200,(Number(n)||0)/total*100)).toFixed(4)}%`;
function pageCanvas(page,w){
  if(page){normalizePageMedia(page);return page.canvas;}
  return {background:{color:page?.type==='cover'?'#101d2d':'#f7f1e5',image:page?.image||'',fit:'cover',position:'center'},textColor:page?.type==='cover'?'#ffffff':'#191715',objects:[]};
}
function objectGeometryStyle(o){
  return `left:${pct(o.x,PAGE_CANVAS_W)};top:${pct(o.y,PAGE_CANVAS_H)};width:${pct(o.w,PAGE_CANVAS_W)};height:${pct(o.h,PAGE_CANVAS_H)};z-index:${Number(o.z)||1};transform:rotate(${Number(o.rotation)||0}deg)`;
}
function renderCanvasObject(o,page,{editable=false}={}){
  if(o.type==='image')o=normalizeMediaObject(o,o.pageId);
  const common=`data-object-id="${esc(o.id||'')}" data-object-type="${esc(o.type||'text')}" data-x="${Number(o.x)||0}" data-y="${Number(o.y)||0}" data-w="${Number(o.w)||100}" data-h="${Number(o.h)||100}" data-z="${Number(o.z)||1}" data-rotation="${Number(o.rotation)||0}" data-locked="${o.locked?'1':'0'}" style="${objectGeometryStyle(o)}"`;
  if(o.type==='image'){
    return `<div class="canvas-object canvas-image-object ${o.locked?'is-locked':''}" ${common} data-layout-mode="${esc(o.layoutMode)}" data-wrap-mode="${esc(o.wrapMode)}" data-caption="${esc(o.caption)}" data-wrap="${esc(o.wrap||'auto')}" data-gap="${Number(o.gap)||14}" data-fit="${esc(o.fit||'cover')}" data-radius="${Number(o.radius)||0}" data-opacity="${o.opacity==null?1:Number(o.opacity)}"><img src="${esc(o.src||'')}" alt="${esc(o.alt||'')}" draggable="false" style="object-fit:${esc(o.fit||'cover')};border-radius:${Number(o.radius)||0}px;opacity:${o.opacity==null?1:Number(o.opacity)}">${o.caption?`<span class="canvas-image-caption">${esc(o.caption)}</span>`:''}</div>`;
  }
  const st=o.style||{};
  const color=st.color||page?.textColor||'#191715';
  return `<div class="canvas-object canvas-text-object ${o.locked?'is-locked':''}" ${common} data-flow="${o.flow===false?'0':'1'}" data-role="${esc(o.role||'')}" data-font-family="${esc(st.fontFamily||'Georgia')}" data-font-size="${Number(st.fontSize)||18}" data-line-height="${Number(st.lineHeight)||1.55}" data-base-color="${esc(st.color||'')}" data-align="${esc(st.align||'left')}" data-bg="${esc(st.background||'transparent')}" data-padding="${Number(st.padding)||6}"><div class="canvas-text-content" ${editable?'contenteditable="true" spellcheck="true"':''} style="font-family:${esc(st.fontFamily||'Georgia')};--canvas-font-size:${Number(st.fontSize)||18};line-height:${Number(st.lineHeight)||1.55};color:${esc(color)};text-align:${esc(st.align||'left')};background:${esc(st.background||'transparent')};padding:${Number(st.padding)||6}px">${sanitizeHtml(o.html||'<p><br></p>')}</div></div>`;
}
function renderPageComposition(page,w,{editable=false,variant='preview'}={}){
  const c=pageCanvas(page,w); const bg=c.background||{};
  return `<div class="page-composition ${editable?'free-page-canvas':''} composition-${variant}" ${editable?'id="freePageCanvas"':''} data-page-id="${esc(page?.id||'')}" data-page-type="${esc(page?.type||'content')}" data-bg-color="${esc(bg.color||'#f7f1e5')}" data-bg-image="${esc(bg.image||'')}" data-bg-fit="${esc(bg.fit||'cover')}" data-text-color="${esc(c.textColor||'#191715')}" style="background-color:${esc(bg.color||'#f7f1e5')};color:${esc(c.textColor||'#191715')}">${bg.image?`<img class="page-background-image" src="${esc(bg.image)}" alt="" draggable="false" style="object-fit:${esc(bg.fit||'cover')}">`:''}<div class="canvas-center-guide guide-v"></div><div class="canvas-center-guide guide-h"></div>${(c.objects||[]).sort((a,b)=>(a.z||0)-(b.z||0)).map(o=>renderCanvasObject(o,c,{editable})).join('')}</div>`;
}
function projectOutline(w){
  if(w.editorMode==='book'){
    const idx=Math.max(0,Math.min((w.bookPages||[]).length-1,state.ui.bookPageIndex||0));
    return `<div class="outline-block"><div class="row spread"><b>Страницы книги</b><button type="button" class="small" data-action="add-book-page">+ Страница</button></div><p class="muted small-copy">Каждая страница — свободный холст. Текст и фотографии можно располагать независимо, накладывать слоями и оформлять как реальный дневник. Режим «Книга» показывает итоговый разворот.</p><div class="page-list">${(w.bookPages||[]).map((p,i)=>`<div class="page-list-row"><button type="button" class="page-list-item ${idx===i?'active':''}" data-action="book-page-select" data-index="${i}"><span>${i+1}</span><b>${p.type==='cover'?'Обложка':p.type==='title'?'Титульный лист':esc(p.label||`Страница ${i-1}`)}</b></button>${p.type==='content'?`<button type="button" class="page-delete" data-action="delete-book-page" data-index="${i}" title="Удалить страницу">×</button>`:''}</div>`).join('')}</div></div>`;
  }
  return `<div class="outline-block"><div class="row spread"><b>Листы документа</b><button type="button" class="small" data-action="add-document-page">+ Лист</button></div><p class="muted small-copy">Выберите лист. Текст и изображения сохраняются раздельно и восстанавливаются вместе.</p></div>`;
}

function renderBookPreviewPage(p,w,side='left'){
  if(!p)return `<div class="book-preview-page book-preview-blank ${side}"></div>`;
  return `<article class="book-preview-page book-preview-content ${side} book-composed-page">${renderPageComposition(p,w,{editable:false,variant:'preview'})}</article>`;
}

function bookSpread(w){
  const pages=w.bookPages||[];
  const start=Math.max(0,Math.min(pages.length-1,Number(state.ui.bookSpreadIndex||0)));
  const left=pages[start];
  const right=start===0?null:pages[start+1]||null;
  return `<div class="book-preview-shell"><div class="book-preview-top"><button type="button" data-action="book-spread-prev" ${start<=0?'disabled':''}>← Предыдущие</button><span>Разворот ${start+1}${right?`–${Math.min(pages.length,start+2)}`:''} из ${pages.length}</span><button type="button" data-action="book-spread-next" ${start>=pages.length-1?'disabled':''}>Следующие →</button></div><div class="book-preview-scene"><div class="book-preview-spread ${start===0?'single-cover':''}" data-book-spread>${renderBookPreviewPage(left,w,'left')}${right?renderBookPreviewPage(right,w,'right'):''}<div class="book-preview-gutter"></div></div><button type="button" class="book-corner prev" data-action="book-spread-prev" aria-label="Предыдущий разворот"></button><button type="button" class="book-corner next" data-action="book-spread-next" aria-label="Следующий разворот"></button></div><p class="book-preview-help">Это итоговый вид книги. Страницы листаются с 3D-анимацией; для редактирования вернитесь в режим «Редактор».</p></div>`;
}

function bookPage(w){
  const pages=workPages(w);
  const idx=Math.max(0,Math.min(pages.length-1,state.ui.bookPageIndex||0));
  const p=pages[idx]||{id:`page-${Date.now()}`,type:'content',canvas:{background:{color:'#f7f1e5',image:'',fit:'cover'},textColor:'#191715',objects:[]}};
  return `<div class="book-stage free-canvas-stage" data-page-type="${esc(p.type||'content')}"><div class="free-page-viewport">${renderPageComposition(p,w,{editable:true,variant:'editor'})}</div><div class="canvas-stage-hint"><span>Перетаскивайте объекты куда угодно.</span><span>Двойной клик по странице — новый текст.</span><span>Shift + стрелки — сдвиг на 10 px.</span></div></div>`;
}

function mediaPanel(w){
  const media=[...BUILTIN_MEDIA,...(w.mediaLibrary||[]).map(asset=>({...asset,src:normalizeMediaObject(asset).url}))];
  {
    const pages=workPages(w),page=pages[Math.max(0,Math.min(pages.length-1,state.ui.bookPageIndex||0))];
    const c=pageCanvas(page,w); const bg=c.background||{};
    return `<aside class="studio-media canvas-inspector" id="studioMediaPanel">
      <div class="row spread"><div><span class="eyebrow">Страница</span><h3>Свободный макет</h3></div><label class="upload-mini" title="Загрузить изображение">+<input id="mediaUpload" type="file" accept="image/*"></label></div>
      <p class="muted small-copy">Изображения сохраняются отдельно от текста. Выберите обтекание или свободное расположение; перетаскивайте и изменяйте размер на странице.</p>
      <div class="canvas-insert-actions"><button type="button" class="primary" data-action="canvas-add-text">＋ Текст</button><button type="button" data-action="canvas-add-note">＋ Заметка</button></div>
      <details open class="canvas-panel-section"><summary>Фон страницы</summary><label>Цвет страницы<input id="pageBackgroundColor" type="color" value="${esc(bg.color||'#f7f1e5')}"></label><label>Базовый цвет текста<input id="pageTextColor" type="color" value="${esc(c.textColor||'#191715')}"></label><label>Фото-фон<select id="pageBackgroundFit"><option value="cover" ${(bg.fit||'cover')==='cover'?'selected':''}>Заполнить страницу</option><option value="contain" ${bg.fit==='contain'?'selected':''}>Поместить целиком</option></select></label><button type="button" data-action="clear-page-background">Убрать фото-фон</button></details>
      <details open class="canvas-panel-section"><summary>Фото и элементы</summary><div class="media-grid canvas-media-grid">${media.map((m,i)=>`<div class="canvas-media-card"><img src="${esc(m.src)}" alt=""><span>${esc(m.name||`Изображение ${i+1}`)}</span><div><button type="button" data-action="insert-canvas-media" data-src="${esc(m.src)}" data-name="${esc(m.name||`Изображение ${i+1}`)}">На лист</button><button type="button" data-action="set-page-background" data-src="${esc(m.src)}">Фон</button></div></div>`).join('')}</div></details>
      <details open class="canvas-panel-section canvas-object-inspector"><summary>Выбранный объект</summary><div id="canvasObjectEmpty" class="muted small-copy">Нажмите на текст или фото на странице.</div><div id="canvasObjectControls" hidden><div class="object-kind" id="canvasObjectKind">Объект</div><label>Поворот <output id="canvasRotationOutput">0°</output><input id="canvasRotationSlider" type="range" min="-180" max="180" step="1" value="0"></label><div id="canvasImageControls"><label>Прозрачность <output id="canvasOpacityOutput">100%</output><input id="canvasOpacitySlider" type="range" min="10" max="100" step="1" value="100"></label><label>Скругление <output id="canvasRadiusOutput">0px</output><input id="canvasRadiusSlider" type="range" min="0" max="80" step="1" value="0"></label><label>Фото<select id="canvasImageFit"><option value="cover">Заполнить рамку</option><option value="contain">Поместить целиком</option></select></label><label>Расположение<select id="canvasImageLayout"><option value="free">Свободное</option><option value="flow">В потоке текста</option></select></label><label>Обтекание<select id="canvasImageWrap"><option value="around">Автоматически</option><option value="left">Слева</option><option value="right">Справа</option><option value="center">По центру</option><option value="full">На всю ширину</option><option value="none">Не обтекать</option></select></label><label>Подпись<input id="canvasImageCaption" maxlength="300"></label><label>Отступ от текста <output id="canvasWrapGapOutput">14px</output><input id="canvasWrapGapSlider" type="range" min="0" max="60" step="1" value="14"></label></div><div id="canvasTextControls"><label>Фон текстового блока<input id="canvasTextBgColor" type="color" value="#fff1a8"></label><label>Режим фона<select id="canvasTextBgMode"><option value="transparent">Прозрачный</option><option value="color">Цветной</option></select></label><label>Обтекание фотографий<select id="canvasTextFlow"><option value="1">Автоматически обтекать</option><option value="0">Текст поверх/под объектами</option></select></label></div><div class="layer-buttons"><button type="button" data-action="canvas-layer" data-layer="front">На передний план</button><button type="button" data-action="canvas-layer" data-layer="forward">Выше</button><button type="button" data-action="canvas-layer" data-layer="backward">Ниже</button><button type="button" data-action="canvas-layer" data-layer="back">На задний план</button></div><div class="wrap-buttons"><button type="button" data-action="canvas-duplicate">Дублировать</button><button type="button" data-action="canvas-lock" id="canvasLockButton">🔓 Зафиксировать</button></div><button type="button" class="danger-outline" data-action="canvas-delete">Удалить объект</button></div></details>
    </aside>`;
  }

}

function editor(w){
  const publication=w.publicationStatus||'draft';
  const evaluation=w.evaluationStatus||'closed';
  const isFragment=w.creationType==='fragment';
  const isBook=w.editorMode==='book';
  const bookPreview=isBook&&!!state.ui.bookViewMode;
  const pages=workPages(w);
  return `<form id="workEditor" data-id="${w.id}" class="word-editor-form">${hasLegacyRecovery(w)?`<section class="legacy-media-warning" role="status"><b>Нужно восстановить старые изображения</b><p>Исходный снимок на этом устройстве сохранён. Новые правки пока остаются в памяти: восстановите изображения до закрытия страницы.</p><button type="button" data-action="restore-legacy-media">Восстановить в облако</button><label>Заменить недоступный исходник<input id="legacyMediaUpload" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label></section>`:''}<div class="studio-editor-head"><div><span class="eyebrow">${isFragment?'Отрывок для оценки':isBook?'Книга':'Произведение · документ'}</span><h1>${esc(w.title||'Без названия')}</h1><small>v${esc(w.version)} · ${publication==='published'?'опубликовано':'черновик'} · оценка ${evaluation==='open'?'открыта':'закрыта'}</small></div><div class="actions">${isBook?`<div class="studio-mode-switch"><button type="button" data-action="studio-book-mode" data-mode="edit" class="${!bookPreview?'active':''}">✎ Редактор</button><button type="button" data-action="studio-book-mode" data-mode="book" class="${bookPreview?'active':''}">📖 Книга</button></div>`:''}<button type="button" data-action="save-work">Сохранить</button>${!isFragment?`<button type="button" data-action="new-version">Новая версия</button><button type="button" data-action="preview-work">Предпросмотр</button><button type="button" data-action="open-publish-checklist">${publication==='published'?'Обновить публикацию':'Опубликовать'}</button>`:''}<button type="button" class="primary" data-action="publish-evaluation">${evaluation==='open'?'Обновить оценку':(isFragment?'Отправить на оценку':'Оценить фрагмент')}</button>${evaluation==='open'?`<button type="button" data-action="close-evaluation">Закрыть оценку</button>`:''}</div></div>${bookPreview?'':wordRibbon(w)}<div class="word-workspace ${bookPreview?'book-preview-workspace':''}"><aside class="studio-outline">${projectOutline(w)}<details class="project-meta"><summary>Параметры проекта</summary><label>Название<input name="title" value="${esc(w.title||'')}"></label><label>Тип<select name="kind">${['Роман','Рассказ','Повесть','Стихотворение','Фрагмент'].map(k=>`<option ${w.kind===k?'selected':''}>${k}</option>`).join('')}</select></label><label>Формат<select name="formatId"><option value="">Не выбран</option>${(state.catalogs?.formats||[]).map(item=>`<option value="${item.id}" ${Number(w.formatId)===Number(item.id)?'selected':''}>${esc(item.name)}</option>`).join('')}</select></label><label>Жанры (до 3)</label>${taxonomyChoices('genres',w.genres||[])}<label>Аудитория</label>${taxonomyIdChoices('audienceIds',state.catalogs?.audiences||[],w.audienceIds||[])}<label>Теги и предупреждения (до 30)</label>${taxonomyIdChoices('tagIds',state.catalogs?.tags||[],w.tagIds||[])}<label>Описание<textarea name="summary" rows="4">${esc(w.summary||'')}</textarea></label><input type="hidden" name="targetType" value="${esc(w.targetType||'Фрагмент')}"><input type="hidden" name="evaluationTarget" value="${esc(w.evaluationTarget||'Фрагмент')}"></details><div class="save-state"><span class="status-pill ${publication}">${publication==='published'?'Опубликовано':'Черновик'}</span><span class="status-pill ${evaluation}">${evaluation==='open'?'Оценка открыта':'Оценка закрыта'}</span></div></aside><main class="word-canvas ${bookPreview?'book-preview-canvas':''}">${bookPreview?bookSpread(w):`<div class="book-controls"><button type="button" data-action="book-page-prev" ${(state.ui.bookPageIndex||0)<=0?'disabled':''}>←</button><span>${Math.min(pages.length,(state.ui.bookPageIndex||0)+1)} / ${pages.length}</span><button type="button" data-action="book-page-next" ${(state.ui.bookPageIndex||0)>=pages.length-1?'disabled':''}>→</button></div>${bookPage(w)}`}<div class="word-status"><span id="editorWordCount">0 слов</span><span>${bookPreview?'Режим настоящей книги':isBook?'Редактирование страницы':'Документный режим'}</span></div></main>${bookPreview?`<aside class="studio-media book-preview-info"><span class="eyebrow">Книжный режим</span><h3>Готовый разворот</h3><p>Так читатель будет видеть книгу. Перелистывайте страницы стрелками или нажимая на края разворота.</p><button type="button" class="primary wide" data-action="studio-book-mode" data-mode="edit">Вернуться к редактированию</button></aside>`:mediaPanel(w)}</div><input type="hidden" name="evaluationText" value="${esc(w.evaluationText||'')}">${!isFragment?`<fieldset class="feedback-mini"><legend>Категории обратной связи для отрывка</legend><div class="chip-checks">${FEEDBACK_CATEGORIES.map(c=>`<label><input type="checkbox" name="feedback" value="${c}" ${(w.feedbackWanted||[]).includes(c)?'checked':''}><span>${c}</span></label>`).join('')}</div></fieldset>`:`<div class="fragment-feedback"><fieldset><legend>Что хотите получить от читателей?</legend><div class="chip-checks">${FEEDBACK_CATEGORIES.map(c=>`<label><input type="checkbox" name="feedback" value="${c}" ${(w.feedbackWanted||[]).includes(c)?'checked':''}><span>${c}</span></label>`).join('')}</div></fieldset></div>`}</form>`;
}

export function notesPage(){
  return shell(`<div class="page-head"><div><h1>Мои заметки</h1><p>У читателя редактор работает как личный блокнот. Публиковать «Произведения» можно после перехода в роль автора.</p></div><button data-action="switch-role" class="primary">Стать автором</button></div><section class="card"><textarea id="privateNotes" class="manuscript" placeholder="Личные заметки...">${esc(state.privateNotes||'')}</textarea><div class="row spread"><small class="muted">Сохраняется локально.</small><button data-action="save-notes">Сохранить</button></div></section>`);
}


export function communitiesPage(){
  return shell(`<div class="page-head"><div><h1>Сообщества</h1><p>Просмотр ранее сохранённых на этом устройстве записей. Облачные сообщества появятся позже.</p></div><button class="primary" disabled title="Облачные сообщества пока недоступны">Создать · Скоро</button></div><div class="community-grid">${state.communities.map(c=>`<article class="card community"><span class="eyebrow">${esc(c.type)} · ${c.privacy==='public'?'открыто':'по заявке'}</span><h2>${esc(c.name)}</h2><p>${esc(c.description)}</p><b>${c.members.toLocaleString('ru-RU')} участников</b><div class="actions"><button data-action="open-community" data-id="${c.id}">Открыть</button><button disabled>Вступить · Скоро</button></div></article>`).join('')}</div>`);
}

export function communityDetail(){
  const c=state.communities.find(x=>x.id===state.ui.selectedCommunityId);
  if(!c) return communitiesPage();
  return shell(`<button class="text-btn" data-action="navigate" data-page="communities">← Сообщества</button><div class="page-head"><div><span class="eyebrow">${esc(c.type)}</span><h1>${esc(c.name)}</h1><p>${esc(c.description)}</p></div><button disabled>Участие · Скоро</button></div><div class="tabs"><button disabled>Лента · Скоро</button><button disabled>Обсуждения · Скоро</button><button disabled>Флуд · Скоро</button><button disabled>Работы участников · Скоро</button><button disabled>Участники · Скоро</button></div><section class="card"><p>Эта запись сохранена локально. Публикации и участники пока не синхронизируются.</p></section>`);
}

export function messagesPage(){ return shell(messagesContent(state)); }

export function profilePage(){ return shell(profileView()); }
export function feedbackPage(){ return shell(feedbackView()); }

export function adminPage(){
  const u=me();
  if(!u?.isAdmin) return home();
  const reports=state.moderationReports||[];
  const verification=state.verificationRequests||[];
  const open=reports.filter(r=>r.status==='open'||r.status==='reviewing');
  const pending=verification.filter(r=>r.status==='pending');
  return shell(`<div class="page-head"><div><span class="eyebrow">Closed Beta Control</span><h1>Админ-панель</h1><p>Минимальная рабочая модерация перед запуском: жалобы и ручная верификация авторов.</p></div><button data-action="refresh-admin">Обновить</button></div>
  <div class="admin-stats"><article class="card"><b>${open.length}</b><span>открытых жалоб</span></article><article class="card"><b>${pending.length}</b><span>заявок авторов</span></article><article class="card"><b>${reports.filter(r=>r.status==='resolved').length}</b><span>решено</span></article></div>
  <div class="admin-grid"><section class="card"><div class="row spread"><h2>Жалобы</h2><span>${reports.length}</span></div>${reports.length?reports.map(r=>`<article class="moderation-item"><div class="row spread"><b>${esc(r.target_type)} · ${esc(r.reason)}</b><span class="status-pill ${esc(r.status)}">${esc(r.status)}</span></div><p>${esc(r.details||'Без дополнительного комментария')}</p><small>${new Date(r.created_at).toLocaleString('ru-RU')}</small><div class="actions">${r.status!=='resolved'?`<button data-action="moderation-status" data-id="${r.id}" data-status="reviewing">В работу</button><button class="primary" data-action="moderation-status" data-id="${r.id}" data-status="resolved">Решено</button>`:''}<button data-action="moderation-status" data-id="${r.id}" data-status="dismissed">Отклонить</button></div></article>`).join(''):empty('Жалоб нет','Очередь модерации пуста.')}</section>
  <section class="card"><div class="row spread"><h2>Верификация авторов</h2><span>${pending.length}</span></div>${verification.length?verification.map(r=>`<article class="moderation-item"><div class="row spread"><b>Заявка ${esc(r.id.slice(0,8))}</b><span class="status-pill ${esc(r.status)}">${esc(r.status)}</span></div><p>${esc(r.note||'Пользователь хочет публиковать произведения.')}</p><small>${new Date(r.created_at).toLocaleString('ru-RU')}</small>${r.status==='pending'?`<div class="actions"><button class="primary" data-action="resolve-verification" data-id="${r.id}" data-status="approved">Подтвердить</button><button data-action="resolve-verification" data-id="${r.id}" data-status="rejected">Отклонить</button></div>`:''}</article>`).join(''):empty('Заявок нет','Новые заявки авторов появятся здесь.')}</section></div>`);
}

export function analyticsPage(){
  const w=workById(state.ui.selectedWorkId);
  if(!w||w.authorId!==me().id) return profilePage();
  const rs=reviewsFor(w.id,w.version);
  const cat={}; FEEDBACK_CATEGORIES.forEach(c=>cat[c]=avg(rs.map(r=>Number(r.categories?.[c]||0)).filter(Boolean)));
  const ann=rs.flatMap(r=>r.annotations||[]);
  const counts={}; ann.forEach(a=>counts[a.label]=(counts[a.label]||0)+1);
  const top=Object.entries(counts).sort((a,b)=>b[1]-a[1]);
  return shell(`<button class="text-btn" data-action="navigate" data-page="profile">← Профиль</button><div class="page-head"><div><h1>Аналитика: ${esc(w.title)}</h1><p>Текущая версия v${esc(w.version)}. Старые отзывы остаются у старых версий.</p></div><button class="primary" data-action="generate-summary" data-id="${w.id}">Сформировать сводку</button></div><div class="analytics-grid"><section class="card"><h2>${rs.length} рецензий · ${rs.length?avg(rs.map(r=>r.rating)).toFixed(1):'—'} / 5</h2>${FEEDBACK_CATEGORIES.map(c=>`<div class="metric"><span>${c}</span>${progress((cat[c]/5)*100)}<b>${cat[c]?cat[c].toFixed(1):'—'}</b></div>`).join('')}</section><section class="card"><h2>Чаще всего отмечали</h2>${top.length?top.map(([label,count])=>`<div class="count-row"><b>${count}</b><span>${esc(label)}</span></div>`).join(''):'<p class="muted">Пока недостаточно пометок.</p>'}</section></div><section class="card"><h2>Рецензии</h2>${rs.length?rs.map(reviewCard).join(''):empty('Нет данных','Отправьте произведение на оценку.')}</section>`);
}

function reviewCard(r){
  const w=workById(r.workId);
  const canReply=!!(w && me()?.role==='author' && w.authorId===me()?.id);
  return `<article class="review"><div class="row spread"><div><b>${r.anonymous?'Анонимный читатель':esc(r.author)}</b><small> · ${w?esc(w.title):''} · v${esc(r.version)} · ${(r.scope||'evaluation')==='full'?'полное чтение':'оценка отрывка'}</small></div>${stars(r.rating)}</div><p>${esc(r.comment)}</p>${r.annotations?.length?`<details><summary>${r.annotations.length} пометок в тексте</summary>${r.annotations.map(a=>`<blockquote><b>${esc(a.label)}</b> — “${esc(a.quote)}”${a.comment?`<br>${esc(a.comment)}`:''}</blockquote>`).join('')}</details>`:''}${r.authorReply?`<div class="author-reply"><b>Ответ автора</b><p>${esc(r.authorReply)}</p></div>`:''}<div class="reaction-bar"><button class="${r.myReaction==='helpful'?'active':''}" data-action="react-review" data-id="${r.id}" data-kind="helpful">👍 Полезно ${r.reactions.helpful}</button><button class="${r.myReaction==='disagree'?'active':''}" data-action="react-review" data-id="${r.id}" data-kind="disagree">≠ Не согласен ${r.reactions.disagree}</button><button class="${r.myReaction==='unhelpful'?'active':''}" data-action="react-review" data-id="${r.id}" data-kind="unhelpful">👎 Бесполезно ${r.reactions.unhelpful}</button>${canReply?`<button disabled title="Облачные ответы автора пока недоступны">Ответить · Скоро</button>`:''}<button data-action="report-content" data-target-type="review" data-target-id="${r.id}">Пожаловаться</button></div></article>`;
}
