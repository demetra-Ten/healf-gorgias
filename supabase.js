const SUPABASE_URL = 'https://imtapqvlfjcnyrsmpatg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Da1eZE_zJ7FimcLHJmqU8g_FHDjJZ1M';

// The signed-in session is what actually unlocks the database — RLS means the
// public key on its own returns nothing. Persisting it to localStorage and
// letting the client refresh the token in the background is what stops everyone
// re-typing a password on every page load: the session now survives a refresh,
// a new tab and a browser restart, and only ends on an explicit sign out.
// These are the supabase-js defaults; they are written out so that a future
// change to them is a deliberate decision rather than an accident.
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: window.localStorage
  }
});
