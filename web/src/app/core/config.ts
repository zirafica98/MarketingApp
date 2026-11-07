// Lokalni Supabase (npm run db:start u korenu projekta). Za produkciju se ovaj fajl menja preko fileReplacements.
// Javni (publishable) ključ sme da bude u pregledaču; sve zaštite su u bazi (RLS).
export const CONFIG = {
  supabaseUrl: 'http://127.0.0.1:55321',
  /** HTTP deo workera: OAuth povratci, unos tokena (tajne nikad ne idu kroz Supabase iz pregledača). */
  workerUrl: 'http://localhost:8787',
  supabaseKey: 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH',
};
