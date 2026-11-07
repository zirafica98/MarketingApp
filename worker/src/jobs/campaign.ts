// Faza 6 — kampanja: Strateg pravi plan objava za period (najava → glavni deo → podsetnik → poslednja šansa),
// a za svaku objavu nastaje nacrt koji ide kroz Pisca i Urednika kao i svaki drugi.

import type { JobContext } from './index.ts';
import { JobError } from './index.ts';
import { kontekst, PRAVILA_PISANJA } from './kontekst.ts';
import { uZoni } from './drafts.ts';
import { obavestiLimit, preostaloNacrta } from '../naplata.ts';

interface Plan {
  objave: { datum: string; vreme: string; format: 'slika' | 'karusel' | 'tekst'; kanali: string[]; tema: string; faza: string; proizvod: string | null }[];
}

export async function campaignPlan(ctx: JobContext): Promise<unknown> {
  const { db, job, ask } = ctx;
  const { rows } = await db.query<{ id: string; brand_id: string; name: string; goal: string; starts_on: string; ends_on: string;
    channels: string[]; product_ids: string[]; notes: string | null; posts_target: number }>(
    `select id, brand_id, name, goal, starts_on::text, ends_on::text, channels, product_ids, notes, posts_target from public.campaigns where id = $1`,
    [String(job.payload['campaign_id'] ?? '')]);
  const c = rows[0];
  if (!c) throw new JobError('Kampanja više ne postoji.');
  try {
    const k = await kontekst(db, c.brand_id);
    const { rows: proizvodi } = await db.query<{ id: string; name: string; price: string | null; description: string | null }>(
      'select id, name, price::text, description from public.products where id = any($1)', [c.product_ids]);

    const res = await ask<Plan>({
      agent: 'strateg.kampanja',
      model: 'opus',
      prompt: `Ti si Strateg. Planiraš kampanju „${c.name}“ za brend „${k.brend.name}“.
Cilj: ${c.goal}. Period: ${c.starts_on} – ${c.ends_on} (vremenska zona ${k.brend.timezone}). Kanali: ${c.channels.join(', ')}.
Broj objava: oko ${c.posts_target}. ${c.notes ? `Napomena korisnika: ${c.notes}` : ''}

${PRAVILA_PISANJA}
- Raspodeli objave kroz faze: najava, glavni deo, podsetnik, poslednja šansa (ako period to dozvoljava).
- Datumi samo unutar perioda; vreme HH:MM, u skladu sa knjigom pravila (najbolja vremena) ako ih ima.
- „tema“: šta tačno ta objava kaže (jedna rečenica). „proizvod“: id proizvoda iz liste ili null.
- Kanali svake objave samo od: ${c.channels.join(', ')}.

Proizvodi u kampanji:
${proizvodi.map((p) => `- [${p.id}] ${p.name}${p.price ? `, ${p.price}` : ''}: ${(p.description ?? '').slice(0, 200)}`).join('\n') || '(bez posebnih proizvoda)'}

PROFIL:
${k.profil}

KNJIGA PRAVILA:
${k.pravila}

BROJKE:
${k.brojke}`,
      schema: {
        type: 'object', additionalProperties: false, required: ['objave'],
        properties: {
          objave: {
            type: 'array', minItems: 1, maxItems: 20,
            items: {
              type: 'object', additionalProperties: false, required: ['datum', 'vreme', 'format', 'kanali', 'tema', 'faza', 'proizvod'],
              properties: {
                datum: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, vreme: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' },
                format: { type: 'string', enum: ['slika', 'karusel', 'tekst'] },
                kanali: { type: 'array', items: { type: 'string', enum: c.channels }, minItems: 1 },
                tema: { type: 'string', maxLength: 200 }, faza: { type: 'string', maxLength: 40 },
                proizvod: proizvodi.length ? { anyOf: [{ type: 'string', enum: proizvodi.map((p) => p.id) }, { type: 'null' }] } : { type: 'null' },
              },
            },
          },
        },
      },
    });

    let n = 0;
    let preostalo = await preostaloNacrta(db, k.brend.workspace_id);
    for (const o of res.output.objave) {
      if (preostalo <= 0) {
        await obavestiLimit(db, c.brand_id);
        break;
      }
      if (o.datum < c.starts_on || o.datum > c.ends_on) continue;
      const kada = uZoni(o.datum, o.vreme, k.brend.timezone);
      if (kada.getTime() < Date.now() + 30 * 60_000) continue;
      const { rows: d } = await db.query<{ id: string }>(
        `insert into public.drafts (brand_id, campaign_id, format, pillar, topic, channels, scheduled_at, product_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [c.brand_id, c.id, o.format, `kampanja: ${o.faza}`, o.tema, o.kanali, kada, o.proizvod],
      );
      await db.query(
        `insert into public.jobs (workspace_id, brand_id, type, payload) values ($1, $2, 'draft.generate', jsonb_build_object('draft_id', $3::text))`,
        [k.brend.workspace_id, c.brand_id, d[0]!.id]);
      n++;
      preostalo--;
    }
    await db.query(`update public.campaigns set status = 'spremna', error = null where id = $1`, [c.id]);
    await db.query(`select pg_notify('jobs', 'kampanja')`);
    return { objava: n };
  } catch (e) {
    await db.query(`update public.campaigns set status = 'greska', error = $2 where id = $1`, [c.id, e instanceof Error ? e.message : String(e)]);
    throw e;
  }
}
