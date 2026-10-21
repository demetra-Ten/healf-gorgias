const SUPABASE_URL = 'https://imtapqvlfjcnyrsmpatg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Da1eZE_zJ7FimcLHJmqU8g_FHDjJZ1M';

// The signed-in session is what actually unlocks the database — RLS means the
// public key on its own returns nothing. Persisting it to localStorage and
// letting the client refresh the token in the background is what stops everyone
// re-typing a password on every page load: the session now survives a refresh,
// a new tab and a browser restart, and only ends on an explicit sign out.
// These are the supabase-js defaults; they are written out so that a future
// change to them is a deliberate decision rather than an accident.
// The admin panel keeps its sign-in under its own key (window.SUPABASE_STORAGE_KEY, set by
// admin.html and by admin ticket previews before this file loads). Sharing one stored session
// meant a trainee sign-in on any simulator logged the admin out, and an admin sign-in logged
// the simulators out. Pages that set nothing keep the default key, so trainees are unaffected.
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: Object.assign({
    persistSession: true,
    autoRefreshToken: true,
    storage: window.localStorage
  }, window.SUPABASE_STORAGE_KEY ? { storageKey: window.SUPABASE_STORAGE_KEY } : {})
});
