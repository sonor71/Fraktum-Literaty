const ALLOWED_TAGS=new Set(['P','BR','DIV','SPAN','STRONG','B','EM','I','U','S','H1','H2','H3','UL','OL','LI','BLOCKQUOTE','A','FIGURE','FIGCAPTION','IMG']);
const SAFE_STYLE=new Set(['font-family','font-size','font-weight','font-style','text-decoration','text-decoration-line','line-height','color','background-color','text-align','width','max-width','margin','margin-left','margin-right','float','shape-outside','object-fit','object-position']);
export function safeUrl(value,{image=false}={}){const raw=String(value||'').trim();if(!raw)return '';if(image&&raw.startsWith('blob:'))return raw;try{const url=new URL(raw,location.origin);if(!['http:','https:'].includes(url.protocol))return '';return url.href;}catch{return '';}}
function cleanStyle(value){return String(value||'').split(';').map(rule=>rule.split(':')).filter(([property,...parts])=>SAFE_STYLE.has(property?.trim().toLowerCase())&&parts.length&& !/url\s*\(|expression\s*\(|javascript:/i.test(parts.join(':'))).map(([property,...parts])=>`${property.trim()}:${parts.join(':').trim()}`).join(';');}
export function sanitizeHtml(html){
  const template=document.createElement('template');template.innerHTML=String(html||'');const nodes=[...template.content.querySelectorAll('*')];
  for(const node of nodes){if(!ALLOWED_TAGS.has(node.tagName)){node.replaceWith(...node.childNodes);continue;}for(const attribute of [...node.attributes]){const name=attribute.name.toLowerCase();if(name.startsWith('on')||!['href','src','alt','title','class','style'].includes(name))node.removeAttribute(attribute.name);}
    if(node.hasAttribute('href')){const value=safeUrl(node.getAttribute('href'));if(value){node.setAttribute('href',value);node.setAttribute('rel','noopener noreferrer');}else node.removeAttribute('href');}
    if(node.hasAttribute('src')){const value=safeUrl(node.getAttribute('src'),{image:true});if(value)node.setAttribute('src',value);else node.removeAttribute('src');}
    if(node.hasAttribute('style')){const value=cleanStyle(node.getAttribute('style'));if(value)node.setAttribute('style',value);else node.removeAttribute('style');}
    if(node.hasAttribute('class'))node.setAttribute('class',node.className.replace(/[^a-zA-Z0-9 _-]/g,''));
  }return template.innerHTML;
}
export function sanitizePaste(event){const html=event.clipboardData?.getData('text/html');if(!html)return false;event.preventDefault();const safe=sanitizeHtml(html),selection=window.getSelection();if(!selection?.rangeCount)return true;const range=selection.getRangeAt(0);range.deleteContents();const fragment=range.createContextualFragment(safe);range.insertNode(fragment);selection.collapseToEnd();return true;}
