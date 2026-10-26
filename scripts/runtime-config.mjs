import fs from 'node:fs';
import path from 'node:path';

export const PUBLIC_RUNTIME_KEYS = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'VITE_PUSH_PUBLIC_KEY',
  'VITE_FRAKTUM_GAME_URL',
  'VITE_ENABLE_DEMO_DATA',
  'VITE_TURN_URL',
  'VITE_TURN_USERNAME',
  'VITE_TURN_CREDENTIAL',
  'VITE_RTC_DEBUG'
];

function cleanValue(value) {
  const trimmed = String(value ?? '').trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function parseEnvFile(contents) {
  const values = {};
  for (const rawLine of String(contents).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    values[match[1]] = cleanValue(match[2]);
  }
  return values;
}

export function loadEnvironment(root, processEnvironment = process.env) {
  const fileEnvironment = {};
  for (const filename of ['.env', '.env.local']) {
    const filenamePath = path.join(root, filename);
    if (fs.existsSync(filenamePath)) Object.assign(fileEnvironment, parseEnvFile(fs.readFileSync(filenamePath, 'utf8')));
  }
  return {...fileEnvironment, ...processEnvironment};
}

function isServiceRoleKey(key) {
  if (/^sb_secret_/i.test(key)) return true;
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
}

export function createRuntimeConfig(environment) {
  const config = Object.fromEntries(PUBLIC_RUNTIME_KEYS.map(key => [key, cleanValue(environment[key])]));
  for (const key of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY']) {
    if (!config[key]) throw new Error(`Missing required environment variable: ${key}`);
  }
  let url;
  try { url = new URL(config.VITE_SUPABASE_URL); } catch { throw new Error('Invalid VITE_SUPABASE_URL: expected an absolute http(s) URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid VITE_SUPABASE_URL: expected an http(s) URL');
  config.VITE_SUPABASE_URL = url.href.replace(/\/$/, '');
  if (isServiceRoleKey(config.VITE_SUPABASE_PUBLISHABLE_KEY)) {
    throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY must not contain a service-role or secret key');
  }
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.VITE_SUPABASE_PUBLISHABLE_KEY) && !/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(config.VITE_SUPABASE_PUBLISHABLE_KEY)) {
    throw new Error('Invalid VITE_SUPABASE_PUBLISHABLE_KEY: expected an sb_publishable_ key or legacy anon JWT');
  }
  config.VITE_ENABLE_DEMO_DATA = String(config.VITE_ENABLE_DEMO_DATA).toLowerCase() === 'true' ? 'true' : 'false';
  config.VITE_RTC_DEBUG = String(config.VITE_RTC_DEBUG).toLowerCase() === 'true' ? 'true' : 'false';
  const turnConfigured=['VITE_TURN_URL','VITE_TURN_USERNAME','VITE_TURN_CREDENTIAL'].some(key=>config[key]);
  if(turnConfigured){
    for(const key of ['VITE_TURN_URL','VITE_TURN_USERNAME','VITE_TURN_CREDENTIAL']){
      if(!config[key])throw new Error(`Missing required TURN environment variable: ${key}`);
    }
    if(config.VITE_TURN_URL.split(/[\s,]+/).filter(Boolean).some(url=>!/^turns?:[^\s/?]+(?::\d+)?(?:\?transport=(?:udp|tcp))?$/i.test(url))){
      throw new Error('Invalid VITE_TURN_URL: expected turn: or turns: URLs');
    }
  }
  return config;
}

export function serializeRuntimeConfig(config) {
  const json = JSON.stringify(config).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `globalThis.__FRAKTUM_CONFIG__ = Object.freeze(${json});\n`;
}
