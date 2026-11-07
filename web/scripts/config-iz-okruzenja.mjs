// Pre produkcionog build-a (Vercel): upisuje adrese servera u src/app/core/config.ts iz promenljivih okruženja.
// Lokalno se ne pokreće, pa config.ts ostaje podešen na lokalni Supabase.
//
// Vercel → Project → Settings → Environment Variables:
//   MP_SUPABASE_URL   https://<projekat>.supabase.co
//   MP_SUPABASE_KEY   publishable (anon) ključ projekta — javni, sme u pregledač; zaštita je u RLS
//   MP_WORKER_URL     javna adresa workera (OAuth, tokeni, AI ključ, naplata), npr. https://mp-worker.fly.dev

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const potrebno = ['MP_SUPABASE_URL', 'MP_SUPABASE_KEY', 'MP_WORKER_URL'];
const fali = potrebno.filter((k) => !process.env[k]?.trim());
if (fali.length) {
  console.error(`\n✗ Nedostaju promenljive okruženja: ${fali.join(', ')}`);
  console.error('  Dodaj ih u Vercel → Settings → Environment Variables (vidi web/scripts/config-iz-okruzenja.mjs), pa ponovi deploy.\n');
  process.exit(1);
}

const url = process.env.MP_SUPABASE_URL.trim().replace(/\/$/, '');
const worker = process.env.MP_WORKER_URL.trim().replace(/\/$/, '');
const kljuc = process.env.MP_SUPABASE_KEY.trim();
for (const [ime, v] of [['MP_SUPABASE_URL', url], ['MP_WORKER_URL', worker]]) {
  if (!/^https:\/\//.test(v)) {
    console.error(`✗ ${ime} mora da počinje sa https:// (dobijeno: ${v})`);
    process.exit(1);
  }
}
if (/^sb_secret_|service_role/.test(kljuc)) {
  console.error('✗ MP_SUPABASE_KEY je TAJNI ključ. U pregledač ide samo publishable (anon) ključ.');
  process.exit(1);
}

const izlaz = fileURLToPath(new URL('../src/app/core/config.ts', import.meta.url));
writeFileSync(
  izlaz,
  `// Napravljeno pri build-u iz promenljivih okruženja (web/scripts/config-iz-okruzenja.mjs). Ne menjati ručno.
export const CONFIG = {
  supabaseUrl: ${JSON.stringify(url)},
  workerUrl: ${JSON.stringify(worker)},
  supabaseKey: ${JSON.stringify(kljuc)},
};
`,
);
console.log(`✓ config.ts: Supabase ${url}, worker ${worker}`);
