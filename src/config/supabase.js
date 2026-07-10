const { createClient } = require('@supabase/supabase-js');
const config = require('./index');

/**
 * Client Supabase côté serveur (clé service_role : contourne la RLS).
 * Ne doit JAMAIS être exposé au frontend. Pas de session à persister ici.
 */
const supabase = createClient(config.supabase.url, config.supabase.serviceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

module.exports = supabase;
