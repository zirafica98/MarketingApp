import { Service } from '@angular/core';
import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js';
import { CONFIG } from './config';

@Service()
export class Supabase {
  readonly client: SupabaseClient = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
}

/** Poruka greške za korisnika, na srpskom. Poruke iz naših SQL funkcija su već na srpskom. */
export function porukaGreske(e: unknown): string {
  const err = e as Partial<PostgrestError> & { message?: string; status?: number; code?: string };
  const m = err?.message ?? String(e);
  const prevodi: [RegExp, string][] = [
    [/Invalid login credentials/i, 'Pogrešan mejl ili lozinka.'],
    [/User already registered/i, 'Nalog sa ovim mejlom već postoji. Prijavi se.'],
    [/Password should be at least/i, 'Lozinka mora imati bar 8 znakova.'],
    [/Unable to validate email address/i, 'Mejl adresa nije ispravna.'],
    [/Email not confirmed/i, 'Mejl još nije potvrđen. Proveri poštu.'],
    [/rate limit/i, 'Previše pokušaja. Sačekaj minut pa probaj ponovo.'],
    [/Failed to fetch|NetworkError/i, 'Nema veze sa serverom. Proveri internet.'],
    [/row-level security|permission denied/i, 'Nemaš dozvolu za ovo.'],
  ];
  for (const [re, txt] of prevodi) if (re.test(m)) return txt;
  return m;
}
