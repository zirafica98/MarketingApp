// Faza 3 — nacrti: plan nedelje iz aktivne strategije, pa za svaki termin Pisac → Urednik → slike.

import type pg from 'pg';
import { obrisiSlike, sacuvajSliku, uSlike } from '../render/render.ts';
import { slajdHtml, type Slajd } from '../render/sablon.ts';
import { JobError, type JobContext } from './index.ts';
import { obavestiLimit, preostaloNacrta } from '../naplata.ts';
import { kontekst, PRAVILA_PISANJA, type Kontekst } from './kontekst.ts';
import { DANI, type Strategija } from './strategy.ts';

/** Datum + „HH:MM“ u zoni brenda → UTC trenutak. */
export function uZoni(datum: string, vreme: string, tz: string): Date {
  const [h, m] = vreme.split(':').map(Number) as [number, number];
  const kaoUtc = Date.UTC(+datum.slice(0, 4), +datum.slice(5, 7) - 1, +datum.slice(8, 10), h, m);
  // pomeraj zone za taj trenutak
  const delovi = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(kaoUtc));
  const g = (t: string) => Number(delovi.find((p) => p.type === t)!.value);
  const lokalnoKaoUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'));
  return new Date(kaoUtc - (lokalnoKaoUtc - kaoUtc));
}

/** Sledeći ponedeljak (u zoni brenda) kao YYYY-MM-DD. */
export function sledeciPonedeljak(tz: string, od = new Date()): string {
  const danas = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(od);
  const d = new Date(`${danas}T00:00:00Z`);
  const isoDan = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + (8 - isoDan));
  return d.toISOString().slice(0, 10);
}

export async function draftsWeek({ db, job }: JobContext): Promise<unknown> {
  const { rows: br } = await db.query<{ id: string; workspace_id: string; timezone: string }>(
    'select id, workspace_id, timezone from public.brands where id = $1', [job.brand_id]);
  const b = br[0];
  if (!b) throw new JobError('Brend više ne postoji.');
  const { rows: st } = await db.query<{ id: string; content: Strategija }>(
    `select id, content from public.strategies where brand_id = $1 and status = 'aktivna'`, [b.id]);
  const s = st[0];
  if (!s) throw new JobError('Brend nema prihvaćenu strategiju.');

  const od = String(job.payload['od'] ?? sledeciPonedeljak(b.timezone));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(od)) throw new JobError('Neispravan datum.');
  // aktivni eksperimenti: naizmenično A/B po terminima
  const eksperiment = s.content.eksperimenti?.[0];
  const { rows: brojac } = await db.query<{ n: number }>(
    'select count(*)::int as n from public.drafts where brand_id = $1 and experiment_key = $2', [b.id, eksperiment?.kljuc ?? '']);
  let i = brojac[0]?.n ?? 0;

  let napravljeno = 0;
  let preostalo = await preostaloNacrta(db, b.workspace_id);
  const sada = Date.now();
  for (const t of [...s.content.raspored].sort((x, y) => DANI.indexOf(x.dan) - DANI.indexOf(y.dan) || x.vreme.localeCompare(y.vreme))) {
    const d = new Date(`${od}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + DANI.indexOf(t.dan));
    const kada = uZoni(d.toISOString().slice(0, 10), t.vreme, b.timezone);
    if (kada.getTime() < sada + 30 * 60_000) continue; // prošlo ili prekasno za pregled
    const { rows: postoji } = await db.query(
      `select 1 from public.drafts where brand_id = $1 and scheduled_at = $2 and status <> 'odbijen'`, [b.id, kada]);
    if (postoji.length) continue;
    if (preostalo <= 0) {
      await obavestiLimit(db, b.id);
      break;
    }
    preostalo--;
    const varijanta = eksperiment ? (i++ % 2 === 0 ? 'A' : 'B') : null;
    const { rows } = await db.query<{ id: string }>(
      `insert into public.drafts (brand_id, strategy_id, format, pillar, channels, scheduled_at, experiment_key, experiment_variant)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [b.id, s.id, t.format, t.stub, t.kanali, kada, eksperiment?.kljuc ?? null, varijanta],
    );
    await db.query(
      `insert into public.jobs (workspace_id, brand_id, type, payload) values ($1, $2, 'draft.generate', jsonb_build_object('draft_id', $3::text))`,
      [b.workspace_id, b.id, rows[0]!.id],
    );
    napravljeno++;
  }
  if (napravljeno) await db.query(`select pg_notify('jobs', 'nacrti')`);
  return { nedelja: od, nacrta: napravljeno };
}

// ───────────────────────── Pisac i Urednik ─────────────────────────

interface Nacrt {
  id: string;
  brand_id: string;
  status: string;
  format: 'slika' | 'karusel' | 'tekst';
  pillar: string | null;
  topic: string | null;
  channels: string[];
  scheduled_at: Date | null;
  slides: Slajd[];
  strategy_id: string | null;
  experiment_key: string | null;
  experiment_variant: string | null;
  campaign_id: string | null;
  product_id: string | null;
}

interface PisacIzlaz {
  tema: string;
  slajdovi: Slajd[];
  opisi: { kanal: string; tekst: string; hashtagovi: string[] }[];
}

interface UrednikIzlaz {
  prosao: boolean;
  stavke: { ok: boolean; tekst: string }[];
  popravka: string;
}

const PRAVILA_KANALA: Record<string, string> = {
  instagram: 'Instagram: do 2200 znakova, prva rečenica kuka; 3–8 hashtagova (srpski i engleski po potrebi); poziv na akciju „link u bio“.',
  threads: 'Threads: do 450 znakova, razgovorno, bez hashtagova ili najviše jedan.',
  facebook: 'Facebook: do 600 znakova, toplije i informativnije; bez hashtagova ili 1–2.',
  telegram: 'Telegram: kratko, jasno, bez hashtagova.',
  tiktok: 'TikTok: do 300 znakova, 3–5 hashtagova.',
  x: 'X: do 270 znakova ukupno, najviše 1 hashtag.',
  linkedin: 'LinkedIn: profesionalno, do 1200 znakova, bez emodžija, 2–3 hashtaga.',
  pinterest: 'Pinterest: opis do 400 znakova sa ključnim rečima.',
  youtube: 'YouTube: opis do 500 znakova.',
};

function brojSlajdova(format: Nacrt['format']): string {
  return format === 'slika' ? 'tačno 1 slajd' : format === 'karusel' ? '4–7 slajdova (prvi: kuka, poslednji: zaključak i poziv na akciju)' : '0 slajdova (samo tekst)';
}

async function pisi(ctx: JobContext, k: Kontekst, n: Nacrt, uputstvo: { stub: string; eksperiment: string; teme: string; proizvod: string; kampanja: string; napomena: string; prethodno: string; popravka: string }): Promise<PisacIzlaz> {
  const res = await ctx.ask<PisacIzlaz>({
    agent: 'pisac',
    model: 'opus',
    prompt: `Ti si Pisac u alatu za marketing. Pišeš JEDNU objavu za brend „${k.brend.name}“.

${PRAVILA_PISANJA}

Objava:
- Format: ${n.format} → ${brojSlajdova(n.format)}. Naslov slajda do 60 znakova, tekst slajda do 220 (kratko, jedna misao po slajdu).
- „tema“: kratak naziv teme za ljude (do 80 znakova), bez tehničkih oznaka (format, eksperiment, varijanta).
- Stub sadržaja: ${uputstvo.stub}
- Kanali (za svaki poseban opis): ${n.channels.join(', ')}
${n.channels.map((c) => `  ${PRAVILA_KANALA[c] ?? c}`).join('\n')}
${uputstvo.eksperiment}${uputstvo.proizvod}${uputstvo.kampanja}
Ne ponavljaj teme poslednjih objava:
${uputstvo.teme}
${uputstvo.prethodno}${uputstvo.napomena}${uputstvo.popravka}
PROFIL BRENDA:
${k.profil}

POTVRĐENE ČINJENICE (jedine tvrdnje o proizvodu koje smeš da koristiš):
${k.cinjenice}

KNJIGA PRAVILA BRENDA:
${k.pravila}

Sajt: ${k.brend.website ?? '—'} · Instagram: ${k.brend.instagram_handle ? '@' + k.brend.instagram_handle : '—'}`,
    schema: {
      type: 'object', additionalProperties: false, required: ['tema', 'slajdovi', 'opisi'],
      properties: {
        tema: { type: 'string', maxLength: 120 },
        slajdovi: {
          type: 'array', maxItems: 8,
          items: { type: 'object', additionalProperties: false, required: ['naslov', 'tekst'],
            properties: { naslov: { type: 'string', maxLength: 80 }, tekst: { type: 'string', maxLength: 260 } } },
        },
        opisi: {
          type: 'array', minItems: 1,
          items: { type: 'object', additionalProperties: false, required: ['kanal', 'tekst', 'hashtagovi'],
            properties: {
              kanal: { type: 'string', enum: n.channels }, tekst: { type: 'string', maxLength: 2200 },
              hashtagovi: { type: 'array', items: { type: 'string', pattern: '^#[\\p{L}\\p{N}_]+$' }, maxItems: 10 },
            } },
        },
      },
    },
  });
  return res.output;
}

async function proveri(ctx: JobContext, k: Kontekst, n: Nacrt, p: PisacIzlaz, teme: string): Promise<UrednikIzlaz> {
  const res = await ctx.ask<UrednikIzlaz>({
    agent: 'urednik',
    model: 'sonnet',
    prompt: `Ti si Urednik. Proveravaš nacrt objave za brend „${k.brend.name}“ pre nego što ga vidi čovek. Budi strog, ali pravedan.

Proveri, svaku stavku posebno (ok: true/false, tekst: kratko obrazloženje):
1. Svaka tvrdnja o proizvodu postoji u potvrđenim činjenicama ili profilu (nema izmišljenih brojki, cena, funkcija, zdravstvenih tvrdnji).
2. Nema zabranjenih tema ni tvrdnji iz profila i knjige pravila.
3. Ton i obraćanje odgovaraju profilu; broj emodžija po pravilima.
4. Pravila kanala (dužina, hashtagovi) i format (${n.format}: ${brojSlajdova(n.format)}).
5. Nije ponavljanje skorašnjih tema.
„prosao“ = true samo ako su stavke 1 i 2 u redu i nema ozbiljnih problema u 3–5.
„popravka“: konkretno uputstvo Piscu šta da promeni (prazno ako je prošao).

PROFIL:
${k.profil}

POTVRĐENE ČINJENICE:
${k.cinjenice}

KNJIGA PRAVILA:
${k.pravila}

Skorašnje teme:
${teme}

NACRT:
${JSON.stringify(p, null, 1)}`,
    schema: {
      type: 'object', additionalProperties: false, required: ['prosao', 'stavke', 'popravka'],
      properties: {
        prosao: { type: 'boolean' },
        stavke: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['ok', 'tekst'],
          properties: { ok: { type: 'boolean' }, tekst: { type: 'string', maxLength: 300 } } } },
        popravka: { type: 'string', maxLength: 600 },
      },
    },
  });
  return res.output;
}

async function opisZaUputstvo(db: pg.Pool, n: Nacrt): Promise<{ stub: string; eksperiment: string; proizvod: string; kampanja: string }> {
  let stub = n.pillar ?? 'po izboru, u skladu sa profilom';
  let eksperiment = '';
  if (n.strategy_id) {
    const { rows } = await db.query<{ content: Strategija }>('select content from public.strategies where id = $1', [n.strategy_id]);
    const s = rows[0]?.content;
    const st = s?.stubovi.find((x) => x.kljuc === n.pillar);
    if (st) stub = `${st.naziv} — ${st.opis}${st.primeri.length ? ` (primeri: ${st.primeri.join('; ')})` : ''}`;
    const e = s?.eksperimenti.find((x) => x.kljuc === n.experiment_key);
    const v = e?.varijante.find((x) => x.kljuc === n.experiment_variant);
    if (e && v) eksperiment = `- Eksperiment „${e.naziv}“, varijanta ${v.kljuc}: ${v.uputstvo}\n`;
  }
  let proizvod = '';
  if (n.product_id) {
    const { rows } = await db
      .query<{ name: string; price: string | null; url: string | null; description: string | null }>(
        'select name, price::text, url, description from public.products where id = $1', [n.product_id])
      .catch(() => ({ rows: [] as { name: string; price: string | null; url: string | null; description: string | null }[] }));
    const p = rows[0];
    if (p) proizvod = `- Proizvod u fokusu: ${p.name}${p.price ? `, cena ${p.price}` : ''}${p.url ? `, link ${p.url}` : ''}. Opis iz prodavnice: ${(p.description ?? '').slice(0, 400)}\n`;
  }
  let kampanja = '';
  if (n.campaign_id) {
    const { rows } = await db
      .query<{ name: string; goal: string; notes: string | null }>('select name, goal, notes from public.campaigns where id = $1', [n.campaign_id])
      .catch(() => ({ rows: [] as { name: string; goal: string; notes: string | null }[] }));
    const c = rows[0];
    if (c) kampanja = `- Deo kampanje „${c.name}“ (cilj: ${c.goal}). ${c.notes ?? ''}${n.topic ? ` Tema ove objave u kampanji: ${n.topic}.` : ''}\n`;
  }
  return { stub, eksperiment, proizvod, kampanja };
}

export async function draftGenerate(ctx: JobContext): Promise<unknown> {
  const { db, job } = ctx;
  const { rows } = await db.query<Nacrt>('select * from public.drafts where id = $1', [String(job.payload['draft_id'] ?? '')]);
  const n = rows[0];
  if (!n) throw new JobError('Nacrt više ne postoji.');
  if (!['pravi_se', 'popravlja_se', 'greska'].includes(n.status)) return { preskoceno: `nacrt je u stanju ${n.status}` };

  try {
    const k = await kontekst(db, n.brand_id);
    const { rows: skore } = await db.query<{ topic: string }>(
      `select topic from public.drafts where brand_id = $1 and id <> $2 and topic is not null and status <> 'odbijen'
        order by created_at desc limit 20`, [n.brand_id, n.id]);
    const teme = skore.length ? skore.map((r) => `- ${r.topic}`).join('\n') : '(nema)';
    const opis = await opisZaUputstvo(db, n);
    const napomena = String(job.payload['napomena'] ?? '').trim();
    let prethodno = '';
    if (napomena) {
      const { rows: v } = await db.query<{ channel: string; caption: string }>('select channel, caption from public.draft_variants where draft_id = $1', [n.id]);
      prethodno = `\nPRETHODNA VERZIJA (zadrži šta je dobro):\nTema: ${n.topic}\nSlajdovi: ${JSON.stringify(n.slides)}\nOpisi: ${JSON.stringify(v)}\n`;
    }
    const uputstvo = { ...opis, teme, prethodno, napomena: napomena ? `\nKORISNIK TRAŽI IZMENU: ${napomena}\n` : '', popravka: '' };

    let p = await pisi(ctx, k, n, uputstvo);
    let provera = await proveri(ctx, k, n, p, teme);
    if (!provera.prosao && provera.popravka) {
      p = await pisi(ctx, k, n, { ...uputstvo, popravka: `\nUREDNIK JE VRATIO PRETHODNI POKUŠAJ. Popravi: ${provera.popravka}\nPrethodni pokušaj: ${JSON.stringify(p)}\n` });
      provera = await proveri(ctx, k, n, p, teme);
    }

    // slajdovi po formatu
    const slajdovi = n.format === 'tekst' ? [] : n.format === 'slika' ? p.slajdovi.slice(0, 1) : p.slajdovi.slice(0, 7);
    if (n.format !== 'tekst' && !slajdovi.length) throw new JobError('Pisac nije vratio slajdove.', true);
    const potpis = k.brend.instagram_handle ? `@${k.brend.instagram_handle}` : (k.brend.website ?? '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
    const prefiks = `${n.brand_id}/${n.id}`;
    await obrisiSlike(prefiks).catch(() => {});
    const png = await uSlike(slajdovi.map((s, i) => slajdHtml(s, i, slajdovi.length, { boja: k.brend.color, brend: k.brend.name, potpis })));
    const media: { url: string; path: string }[] = [];
    for (const [i, slika] of png.entries()) {
      const path = `${prefiks}/slajd-${i + 1}.png`;
      media.push({ url: await sacuvajSliku(path, slika), path });
    }

    const c = await db.connect();
    try {
      await c.query('begin');
      await c.query(
        `update public.drafts set topic = $2, slides = $3, check_result = $4, status = 'za_pregled', error = null, revision_note = null, updated_at = now() where id = $1`,
        [n.id, p.tema, JSON.stringify(slajdovi), JSON.stringify({ prosao: provera.prosao, stavke: provera.stavke })],
      );
      for (const kanal of n.channels) {
        const o = p.opisi.find((x) => x.kanal === kanal) ?? p.opisi[0]!;
        await c.query(
          `insert into public.draft_variants (draft_id, brand_id, channel, caption, hashtags, media) values ($1,$2,$3,$4,$5,$6)
           on conflict (draft_id, channel) do update set caption = excluded.caption, hashtags = excluded.hashtags, media = excluded.media, updated_at = now()`,
          [n.id, n.brand_id, kanal, o.tekst, o.hashtagovi, JSON.stringify(media)],
        );
      }
      await c.query('commit');
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
    return { tema: p.tema, slajdova: slajdovi.length, prosao: provera.prosao };
  } catch (e) {
    const poruka = e instanceof Error ? e.message : String(e);
    const ponovo = e instanceof JobError ? e.retryable : true;
    if (!ponovo || job.attempts >= job.max_attempts) {
      await db.query(`update public.drafts set status = 'greska', error = $2, updated_at = now() where id = $1`, [n.id, poruka]);
    }
    throw e;
  }
}
