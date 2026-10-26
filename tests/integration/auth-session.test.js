import test from 'node:test';
import assert from 'node:assert/strict';

const expired = {access_token: 'test-access', refresh_token: 'test-refresh', expires_at: 1, user: {id: 'test-user'}};
async function client(name) {
  const stored = new Map([['d20-supabase-session-v1', JSON.stringify(expired)]]);
  globalThis.localStorage = {getItem: key => stored.get(key) || null, setItem: (key,value) => stored.set(key,value), removeItem: key => stored.delete(key)};
  globalThis.__FRAKTUM_CONFIG__ = {VITE_SUPABASE_URL: 'https://fixture.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_session_fixture'};
  return import(`../../src/cloud.js?session-case=${name}`);
}

test('concurrent session restoration shares a single token rotation', async () => {
  const cloud = await client('concurrent');
  let calls = 0, release;
  globalThis.fetch = async () => { calls++; await new Promise(resolve => release = resolve); return Response.json({...expired, access_token: 'rotated-access', expires_in: 3600}); };
  const first = cloud.ensureSession(), second = cloud.ensureSession();
  assert.equal(calls, 1);
  release();
  const sessions = await Promise.all([first, second]);
  assert.equal(sessions[0].access_token, 'rotated-access');
  assert.equal(sessions[0], sessions[1]);
});

test('network outage preserves the refresh token and a later restore retries', async () => {
  const cloud = await client('network');
  globalThis.fetch = async () => { throw new Error('network offline'); };
  await assert.rejects(cloud.ensureSession(), /network offline/);
  assert.equal(cloud.getSession().refresh_token, expired.refresh_token);
  globalThis.fetch = async () => Response.json({...expired, expires_in: 3600});
  assert.ok(await cloud.ensureSession());
});

test('invalid refresh tokens clear local authentication and expose the server failure', async () => {
  const cloud = await client('invalid');
  globalThis.fetch = async () => Response.json({message: 'Invalid Refresh Token'}, {status: 401});
  await assert.rejects(cloud.ensureSession(), /Invalid Refresh Token/);
  assert.equal(cloud.getSession(), null);
});

test('logout clears local authentication even when remote revocation fails visibly', async () => {
  const cloud = await client('logout');
  globalThis.fetch = async () => Response.json({message: 'temporarily unavailable'}, {status: 503});
  await assert.rejects(cloud.signOut(), /сервер не подтвердил отзыв сессии/);
  assert.equal(cloud.getSession(), null);
});

test('an in-flight token refresh cannot resurrect a session after logout', async () => {
  const cloud = await client('logout-race');
  let release;
  globalThis.fetch = async url => {
    if (String(url).includes('/logout')) return new Response(null, {status:204});
    await new Promise(resolve => release = resolve);
    return Response.json({...expired, expires_in:3600});
  };
  const restoring = cloud.ensureSession();
  await cloud.signOut();
  release(); await restoring;
  assert.equal(cloud.getSession(), null);
});
