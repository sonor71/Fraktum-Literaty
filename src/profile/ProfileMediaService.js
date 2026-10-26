const TYPES=new Set(['image/jpeg','image/png','image/webp']);
export function validateProfileImage(file,maxBytes=8_000_000){
  if(!file||!TYPES.has(file.type))throw new TypeError('Выберите JPEG, PNG или WebP');
  if(file.size<=0||file.size>maxBytes)throw new TypeError(`Изображение должно быть не больше ${Math.round(maxBytes/1_000_000)} МБ`);
  return file;
}
export async function cropProfileImage(file,{aspect=1,width=512,height=Math.round(512/aspect)}={}){
  validateProfileImage(file);const url=URL.createObjectURL(file);
  try{
    const image=new Image();image.decoding='async';await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new TypeError('Файл не является изображением'));image.src=url;});
    const sourceAspect=image.naturalWidth/image.naturalHeight;let sw=image.naturalWidth,sh=image.naturalHeight,sx=0,sy=0;
    if(sourceAspect>aspect){sw=sh*aspect;sx=(image.naturalWidth-sw)/2;}else{sh=sw/aspect;sy=(image.naturalHeight-sh)/2;}
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d');if(!context)throw new Error('Canvas недоступен');
    context.drawImage(image,sx,sy,sw,sh,0,0,width,height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.86));if(!blob)throw new Error('Не удалось подготовить изображение');
    return new File([blob],`${crypto.randomUUID()}.webp`,{type:'image/webp'});
  }finally{URL.revokeObjectURL(url);}
}
