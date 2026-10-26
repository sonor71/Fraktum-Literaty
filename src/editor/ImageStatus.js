/** Visible failure UI without inline handlers (the production CSP forbids them). */
export function attachEditorImageStatus(root=document){
  root.querySelectorAll('.canvas-image-object > img,.canvas-media-card > img,.page-background-image').forEach(image=>{
    if(image.dataset.statusBound)return;image.dataset.statusBound='1';
    const failed=()=>{
      image.hidden=true;const holder=image.parentElement;
      if(holder.querySelector(':scope > .media-load-error'))return;
      const message=document.createElement('span');message.className='media-load-error';message.setAttribute('role','status');
      message.textContent='Изображение недоступно. Загрузите его повторно.';holder.appendChild(message);
    };
    image.addEventListener('error',failed);
    image.addEventListener('load',()=>{image.hidden=false;image.parentElement.querySelector(':scope > .media-load-error')?.remove();});
    if(!image.getAttribute('src')||(image.complete&&image.naturalWidth===0))failed();
  });
}
