// Raspoređivač: jednom u minuti dodaje poslove koje niko ne pokreće ručno
// (dnevna sinhronizacija kanala; kasnije: objava zakazanih, nedeljni nacrti, učenje).
// Svaki korak je jedan SQL koji ne pravi duplikate (proverava posao koji već čeka ili radi).

import type pg from 'pg';

export type Korak = { naziv: string; sql: string };

const koraci: Korak[] = [
  {
    naziv: 'dnevna sinhronizacija kanala',
    sql: `insert into public.jobs (workspace_id, brand_id, type, payload)
          select b.workspace_id, c.brand_id, 'channel.sync', jsonb_build_object('connection_id', c.id::text)
            from public.connections c join public.brands b on b.id = c.brand_id
           where c.mode = 'auto' and c.status <> 'greska'
             and (c.last_sync_at is null or c.last_sync_at < now() - interval '20 hours')
             and not exists (select 1 from public.jobs j where j.type = 'channel.sync' and j.status in ('queued', 'running')
                               and j.payload ->> 'connection_id' = c.id::text)
             and not exists (select 1 from public.jobs j where j.type = 'channel.sync' and j.status = 'failed'
                               and j.payload ->> 'connection_id' = c.id::text and j.finished_at > now() - interval '6 hours')`,
  },
  {
    naziv: 'objava zakazanih nacrta',
    sql: `with due as (
            update public.drafts set status = 'objavljuje_se', updated_at = now()
             where status = 'zakazan' and scheduled_at <= now()
            returning id, brand_id)
          insert into public.jobs (workspace_id, brand_id, type, payload, max_attempts)
          select b.workspace_id, due.brand_id, 'publish.draft', jsonb_build_object('draft_id', due.id::text), 3
            from due join public.brands b on b.id = due.brand_id`,
  },
  {
    // od četvrtka (u zoni brenda) pravi nacrte za sledeću nedelju, ako ih još nema
    naziv: 'nedeljni nacrti',
    sql: `insert into public.jobs (workspace_id, brand_id, type, payload)
          select b.workspace_id, b.id, 'drafts.week',
                 jsonb_build_object('od', to_char((date_trunc('week', now() at time zone b.timezone) + interval '7 days')::date, 'YYYY-MM-DD'))
            from public.brands b join public.strategies s on s.brand_id = b.id and s.status = 'aktivna'
           where extract(isodow from now() at time zone b.timezone) >= 4
             and not exists (select 1 from public.drafts d where d.brand_id = b.id
                              and (d.scheduled_at at time zone b.timezone) >= date_trunc('week', now() at time zone b.timezone) + interval '7 days')
             and not exists (select 1 from public.jobs j where j.brand_id = b.id and j.type = 'drafts.week' and j.created_at > now() - interval '12 hours')`,
  },
  {
    // ponedeljkom od 7h (u zoni brenda): nedeljno učenje i izveštaj, za brendove koji imaju objave ili odluke
    naziv: 'nedeljno učenje',
    sql: `insert into public.jobs (workspace_id, brand_id, type, payload)
          select b.workspace_id, b.id, 'brand.learn', '{}'::jsonb
            from public.brands b
           where extract(isodow from now() at time zone b.timezone) = 1
             and extract(hour from now() at time zone b.timezone) >= 7
             and (exists (select 1 from public.channel_posts p where p.brand_id = b.id)
                  or exists (select 1 from public.review_events e where e.brand_id = b.id))
             and not exists (select 1 from public.learning_reports r where r.brand_id = b.id and r.created_at > now() - interval '6 days')
             and not exists (select 1 from public.jobs j where j.brand_id = b.id and j.type = 'brand.learn' and j.created_at > now() - interval '20 hours')`,
  },
];

export function dodajKorak(k: Korak): void {
  koraci.push(k);
}

export async function otkucaj(db: pg.Pool): Promise<number> {
  let ukupno = 0;
  for (const k of koraci) {
    try {
      const r = await db.query(k.sql);
      ukupno += r.rowCount ?? 0;
    } catch (e) {
      console.error(new Date().toISOString(), `! raspoređivač (${k.naziv}):`, e instanceof Error ? e.message : e);
    }
  }
  if (ukupno) await db.query(`select pg_notify('jobs', 'raspored')`);
  return ukupno;
}
