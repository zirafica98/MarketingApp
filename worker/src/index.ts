// Worker: sluša NOTIFY 'jobs' (odmah) i proverava red svakih 10 s (rezerva), uzima jedan po jedan posao.
// Pokretanje: npm start  (čita ../.env.local ako postoji)

import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { claimJob, createPool, failJob, finishJob, requeueStale } from './db.ts';
import { JobError, runJob } from './jobs/index.ts';
import { pokreniHttp } from './http.ts';
import { rutaNaplate } from './naplata.ts';
import { otkucaj } from './scheduler.ts';

const envFile = fileURLToPath(new URL('../../.env.local', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const DATABASE_URL = process.env['DATABASE_URL'];
if (!DATABASE_URL) {
  console.error('Nedostaje DATABASE_URL (vidi .env.example).');
  process.exit(1);
}
const CONCURRENCY = Math.max(1, Number(process.env['WORKER_CONCURRENCY'] ?? 2));
const WORKER_ID = `${hostname()}:${process.pid}`;

const db = createPool(DATABASE_URL);
let active = 0;
let stopping = false;
let wake: (() => void) | null = null;

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

async function drain(): Promise<void> {
  while (!stopping && active < CONCURRENCY) {
    const job = await claimJob(db, WORKER_ID);
    if (!job) return;
    active++;
    log(`▶ ${job.type} ${job.id} (pokušaj ${job.attempts}/${job.max_attempts})`);
    void (async () => {
      try {
        const result = await runJob(db, job);
        await finishJob(db, job.id, result);
        log(`✓ ${job.type} ${job.id}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const retryable = e instanceof JobError ? e.retryable : true;
        await failJob(db, job.id, msg, retryable).catch((err) => log('! upis greške nije uspeo', err));
        log(`✗ ${job.type} ${job.id}: ${msg}`);
      } finally {
        active--;
        wake?.();
      }
    })();
  }
}

async function listen(): Promise<void> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  client.on('notification', () => wake?.());
  client.on('error', (e) => {
    log('! LISTEN veza pukla, ponovo za 5 s', e.message);
    setTimeout(() => void listen().catch(() => {}), 5000);
  });
  await client.connect();
  await client.query('listen jobs');
}

async function main(): Promise<void> {
  await listen();
  rutaNaplate(db);
  pokreniHttp(db);
  const raspored = () => void otkucaj(db).catch((e) => log('! raspoređivač', e));
  raspored();
  setInterval(raspored, 60_000);
  const n = await requeueStale(db);
  if (n) log(`↺ vraćeno u red ${n} poslova koji su visili`);
  log(`Worker ${WORKER_ID} radi (najviše ${CONCURRENCY} posla odjednom).`);

  let ticks = 0;
  while (!stopping) {
    await drain().catch((e) => log('! greška pri uzimanju posla', e));
    await new Promise<void>((r) => {
      wake = r;
      setTimeout(r, 10_000);
    });
    wake = null;
    if (++ticks % 60 === 0) await requeueStale(db).catch(() => {});
  }
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    stopping = true;
    wake?.();
    log(`Gašenje… čekam ${active} posla.`);
    while (active > 0) await new Promise((r) => setTimeout(r, 200));
    await db.end();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
