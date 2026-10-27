export const esc=(s='')=>String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
export const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
export const fmtDate=(d)=>new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short'}).format(new Date(d));
export const stars=(n=0)=>`<span class="stars" aria-label="${n} из 5">${[1,2,3,4,5].map(i=>`<span class="${i<=Math.round(n)?'on':''}">★</span>`).join('')}</span>`;
export const pill=(x)=>`<span class="pill">${esc(x)}</span>`;
export const cover=(w,cls='')=>`<img class="cover ${esc(cls)}" src="${esc(w.cover||'/assets/home/reading-cover.png')}" alt="">`;
export const progress=(value)=>`<div class="progress"><i style="width:${clamp(value,0,100)}%"></i></div>`;
export function toast(text){ return `<div class="toast">${esc(text)}</div>`; }
export function empty(title,text){ return `<div class="empty"><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`; }
export function modal(content,size='normal'){ return `<div class="modal-backdrop" data-action="close-modal"><section class="modal ${size}" role="dialog" aria-modal="true" aria-label="Диалог FRAKTUM" data-stop>${content}</section></div>`; }
