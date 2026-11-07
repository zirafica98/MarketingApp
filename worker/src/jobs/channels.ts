// Faza 2 — sinhronizacija kanala: produženje tokena, podaci naloga, uvoz objava i dnevni snimak brojki.

import { kanal, KanalGreska, nalogIzVeze, tajna, veza, zameniTajnu } from '../channels/index.ts';
import { JobError, type JobContext } from './index.ts';

/** Sat i dan u nedelji u vremenskoj zoni brenda (za poređenje „kada objaviti“). */
export function satIDan(iso: string, tz: string): { sat: number; dan: string } {
  const d = new Date(iso);
  const sat = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(d));
  const dan = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short' }).format(d).toLowerCase();
  const SR: Record<string, string> = { mon: 'pon', tue: 'uto', wed: 'sre', thu: 'cet', fri: 'pet', sat: 'sub', sun: 'ned' };
  return { sat, dan: SR[dan] ?? dan };
}

export async function channelSync({ db, job }: JobContext): Promise<unknown> {
  const v = await veza(db, String(job.payload['connection_id'] ?? ''));
  if (!v) throw new JobError('Kanal više ne postoji.');
  if (v.mode === 'rucno') return { preskoceno: 'ručni režim' };
  const k = kanal(v.provider);
  if (!k) throw new JobError(`Nepoznat kanal: ${v.provider}`);

  const { rows: br } = await db.query<{ timezone: string }>('select timezone from public.brands where id = $1', [v.brand_id]);
  const tz = br[0]?.timezone ?? 'Europe/Belgrade';

  try {
    let t = await tajna(db, v.id);
    // produženje tokena 15 dana pre isteka
    if (k.refresh && v.token_expires_at && v.token_expires_at.getTime() - Date.now() < 15 * 86_400_000) {
      const novo = await k.refresh(t);
      if (novo) {
        await zameniTajnu(db, v.id, novo.tajna, novo.expires_at);
        t = novo.tajna;
      }
    }

    const nalog = await k.nalog(t);
    await db.query('update public.connections set account_name = $2, account_meta = $3 where id = $1', [v.id, nalog.account_name, JSON.stringify(nalog.meta)]);

    let uvezeno = 0;
    if (k.uvezi) {
      const od = new Date(Date.now() - (v.last_sync_at ? 45 : 180) * 86_400_000);
      const objave = await k.uvezi(t, od);
      for (const o of objave) {
        const tags = o.published_at
          ? { ...satIDan(o.published_at, tz), duzina: (o.caption ?? '').length, format: o.format }
          : { format: o.format };
        const { rows } = await db.query<{ id: string }>(
          `insert into public.channel_posts (brand_id, connection_id, provider, external_id, permalink, caption, media_type, format, thumbnail_url, published_at, tags)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           on conflict (connection_id, external_id) do update set permalink = excluded.permalink, caption = excluded.caption,
             thumbnail_url = coalesce(excluded.thumbnail_url, public.channel_posts.thumbnail_url),
             tags = excluded.tags || public.channel_posts.tags
           returning id`,
          [v.brand_id, v.id, v.provider, o.external_id, o.permalink, o.caption, o.media_type, o.format, o.thumbnail_url, o.published_at, JSON.stringify(tags)],
        );
        const m = o.metrics;
        await db.query(
          `insert into public.post_metrics (post_id, brand_id, day, reach, views, likes, comments, saves, shares)
           values ($1,$2,current_date,$3,$4,$5,$6,$7,$8)
           on conflict (post_id, day) do update set reach = excluded.reach, views = excluded.views, likes = excluded.likes,
             comments = excluded.comments, saves = excluded.saves, shares = excluded.shares`,
          [rows[0]!.id, v.brand_id, m.reach, m.views, m.likes, m.comments, m.saves, m.shares],
        );
        uvezeno++;
      }
    }

    let proizvoda = 0;
    if (k.proizvodi) {
      const lista = await k.proizvodi(t);
      for (const p of lista) {
        await db.query(
          `insert into public.products (brand_id, connection_id, external_id, name, price, currency, url, image_url, description, in_stock, updated_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
           on conflict (connection_id, external_id) do update set name = excluded.name, price = excluded.price, currency = excluded.currency,
             url = excluded.url, image_url = excluded.image_url, description = excluded.description, in_stock = excluded.in_stock, updated_at = now()`,
          [v.brand_id, v.id, p.external_id, p.name, p.price, p.currency, p.url, p.image_url, p.description, p.in_stock],
        );
        proizvoda++;
      }
      // proizvodi kojih više nema u prodavnici
      await db.query('delete from public.products where connection_id = $1 and not (external_id = any($2))', [v.id, lista.map((p) => p.external_id)]);
    }

    if (k.brojkeNaloga) {
      const b = await k.brojkeNaloga(t);
      await db.query(
        `insert into public.account_metrics (connection_id, brand_id, day, followers, reach, profile_views, website_clicks)
         values ($1,$2,current_date,$3,$4,$5,$6)
         on conflict (connection_id, day) do update set followers = excluded.followers, reach = excluded.reach,
           profile_views = excluded.profile_views, website_clicks = excluded.website_clicks`,
        [v.id, v.brand_id, b.followers ?? null, b.reach ?? null, b.profile_views ?? null, b.website_clicks ?? null],
      );
    }

    await db.query(
      `update public.connections set last_sync_at = now(), last_error = null,
         status = case when token_expires_at is not null and token_expires_at < now() + interval '7 days' then 'istice' else 'povezano' end
       where id = $1`,
      [v.id],
    );
    return { nalog: nalogIzVeze({ ...v, account_name: nalog.account_name }).account_name, objava: uvezeno, proizvoda };
  } catch (e) {
    const poruka = e instanceof Error ? e.message : String(e);
    const trajna = e instanceof KanalGreska && e.trajna;
    await db.query('update public.connections set last_error = $2, status = case when $3 then \'greska\' else status end where id = $1', [v.id, poruka, trajna]);
    if (trajna) await obavesti(db, v.brand_id, 'kanal', `Veza sa kanalom ${v.provider} je pukla`, `${poruka} Poveži kanal ponovo.`, `/b/${v.brand_id}/konektori`);
    throw new JobError(poruka, !trajna);
  }
}

/** Obaveštenje za sve članove koji vide brend (tabela se pravi u Fazi 4; do tada se tiho preskače). */
export async function obavesti(
  db: import('pg').Pool, brandId: string, vrsta: string, naslov: string, tekst: string, link: string,
): Promise<void> {
  await db
    .query(
      `insert into public.notifications (workspace_id, brand_id, kind, title, body, link)
       select workspace_id, id, $2, $3, $4, $5 from public.brands where id = $1`,
      [brandId, vrsta, naslov, tekst, link],
    )
    .catch(() => {});
}
