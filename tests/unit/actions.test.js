import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const app=fs.readFileSync('src/app.js','utf8');const pages=fs.readFileSync('src/pages.js','utf8');
test('every static UI action has a dispatcher branch',()=>{
 const actions=new Set([...pages.matchAll(/data-action="([\w-]+)"/g)].map(x=>x[1]));
 const handled=new Set([...app.matchAll(/action==='([\w-]+)'/g)].map(x=>x[1]));
 assert.deepEqual([...actions].filter(action=>!handled.has(action)),[]);
});
test('known runtime actions have concrete functions',()=>{
 for(const name of ['saveNotes','joinCommunity','communityDialog','submitCommunity','generateSummary'])assert.match(app,new RegExp(`function\\s+${name}\\s*\\(`));
});
test('Studio connection actions and TCG removal remain wired deliberately',()=>{
 const renderer=fs.readFileSync('src/editor/ConnectionRenderer.js','utf8');
 for(const action of [...renderer.matchAll(/button\('(connection-[\w-]+)'/g)].map(match=>match[1]))assert.ok(app.includes(`action==='${action}'`),action);
 assert.doesNotMatch(app,/launch-game|openFraktumGame/);assert.doesNotMatch(pages,/launch-game|game-launch/);
 assert.doesNotMatch(fs.readFileSync('src/style.css','utf8'),/\.game-launch/);
});
