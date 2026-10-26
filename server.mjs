import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRuntimeConfig,loadEnvironment,serializeRuntimeConfig} from './scripts/runtime-config.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const environment=loadEnvironment(root);
const runtimeConfig=createRuntimeConfig(environment);
const port=Number(environment.PORT||5173);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/manifest+json','.ico':'image/x-icon'};
http.createServer((req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('Permissions-Policy','camera=(self), microphone=(self), geolocation=()');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: blob:; media-src 'self' https: blob:; connect-src 'self' https: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  let rel;
  try{rel=decodeURIComponent(new URL(req.url||'/',`http://${req.headers.host}`).pathname);}
  catch{res.writeHead(400,{'Content-Type':'text/plain; charset=utf-8'});res.end('Invalid URL');return;}
  if(rel==='/runtime-config.js'){
    res.setHeader('Content-Type','text/javascript; charset=utf-8');res.setHeader('Cache-Control','no-store, max-age=0');res.end(serializeRuntimeConfig(runtimeConfig));return;
  }
  if(rel.includes('\0')||rel.includes('\\')||rel.split('/').some(segment=>segment==='..'||segment.startsWith('.'))){
    res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('Not found');return;
  }
  // Only application modules and public assets are web resources. The checkout
  // also holds environment files, Git metadata and development-only documents.
  const publicRoot=path.join(root,'public');
  const publicCandidate=path.resolve(publicRoot,`.${rel}`);
  const sourceCandidate=path.resolve(root,`.${rel}`);
  let file;
  if(publicCandidate.startsWith(`${publicRoot}${path.sep}`)&&fs.existsSync(publicCandidate)&&fs.statSync(publicCandidate).isFile())file=publicCandidate;
  else if((rel.startsWith('/src/')||['/index.html','/test-editor.html'].includes(rel))&&sourceCandidate.startsWith(`${root}${path.sep}`)&&fs.existsSync(sourceCandidate)&&fs.statSync(sourceCandidate).isFile())file=sourceCandidate;
  else if(rel==='/'||(!path.extname(rel)&&!rel.startsWith('/src/')&&!rel.startsWith('/assets/')&&!rel.startsWith('/icons/')))file=path.join(root,'index.html');
  else{res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('Not found');return;}
  const ext=path.extname(file).toLowerCase();
  res.setHeader('Content-Type',types[ext]||'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(port,()=>console.log(`D20 is running on http://localhost:${port}`));
