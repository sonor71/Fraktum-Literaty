const runtime=globalThis.__FRAKTUM_CONFIG__;
if(!runtime||typeof runtime!=='object')throw new Error('[FRAKTUM] runtime-config.js was not loaded before the application');
const supabaseUrl=String(runtime.VITE_SUPABASE_URL||'').trim().replace(/\/$/,'');
const supabasePublishableKey=String(runtime.VITE_SUPABASE_PUBLISHABLE_KEY||'').trim();
if(!supabaseUrl)throw new Error('[FRAKTUM] Missing runtime configuration: VITE_SUPABASE_URL');
if(!supabasePublishableKey)throw new Error('[FRAKTUM] Missing runtime configuration: VITE_SUPABASE_PUBLISHABLE_KEY');
console.info('[FRAKTUM] Supabase URL configured:',Boolean(supabaseUrl));
console.info('[FRAKTUM] Supabase publishable key configured:',Boolean(supabasePublishableKey));
export const config=Object.freeze({
  supabaseUrl,
  supabasePublishableKey,
  pushPublicKey:String(runtime.VITE_PUSH_PUBLIC_KEY||'').trim(),
  demoEnabled:String(runtime.VITE_ENABLE_DEMO_DATA||'false').toLowerCase()==='true'
});
