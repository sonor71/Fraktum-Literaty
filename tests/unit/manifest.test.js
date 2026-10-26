import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('manifest advertises the actual square PNG dimensions and MIME type',()=>{
  const manifest=JSON.parse(fs.readFileSync('public/manifest.webmanifest','utf8'));
  assert.deepEqual(manifest.icons.map(icon=>icon.sizes),['192x192','512x512']);
  for(const icon of manifest.icons){
    const png=fs.readFileSync(`public${icon.src}`);
    assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.equal(icon.type,'image/png');
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`,icon.sizes);
  }
});

test('favicon and Apple touch icon point to correctly sized PNG assets',()=>{
  const html=fs.readFileSync('index.html','utf8');
  for(const [file,size] of [['favicon-32.png',32],['apple-touch-icon.png',180]]){
    assert.ok(html.includes(`/icons/${file}`));
    const png=fs.readFileSync(`public/icons/${file}`);
    assert.equal(png.readUInt32BE(16),size);
    assert.equal(png.readUInt32BE(20),size);
  }
});
