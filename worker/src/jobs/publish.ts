// Faza 4 — objava odobrenog nacrta na sve njegove kanale.
//  * Objavljuje SAMO nacrt u stanju „objavljuje_se“ (raspoređivač ga prebacuje iz „zakazan“ kad dođe vreme).
//  * Jedan red u publications po kanalu (unique): ponovno pokretanje ne pravi duplikat.
//    Ako je prethodni pokušaj pao usred objave, prvo se proveri da li je objava ipak na kanalu.
//  * Jedan kanal ne obara druge. Ručni kanali dobijaju obaveštenje „vreme je za objavu“.

import { kanal, nalogIzVeze, tajna, type Veza } from '../channels/index.ts';
import { KONEKTORI } from '../../../shared/konektori.ts';
import { obavesti, satIDan } from './channels.ts';
import { JobError, type JobContext } from './index.ts';

interface Nacrt {
  id: string;
  brand_id: string;
  status: string;
  format: string;
  pillar: string | null;
  topic: string | null;
  channels: string[];
  experiment_key: string | null;
  experiment_variant: string | null;
  campaign_id: string | null;
}

const naziv = (id: string) => KONEKTORI.find((k) => k.id === id)?.naziv ?? id;

export function tekstObjave(caption: string, hashtagovi: string[]): string {
  const h = hashtagovi.filter((x) => !caption.includes(x));
  return h.length ? `${caption.trim()}\n\n${h.join(' ')}` : caption.trim();
}

export async function publishDraft({ db, job }: JobContext): Promise<unknown> {
  const { rows } = await db.query<Nacrt>('select * from public.drafts where id = $1', [String(job.payload['draft_id'] ?? '')]);
  const n = rows[0];
  if (!n) throw new JobError('Nacrt više ne postoji.');
  if (n.status !== 'objavljuje_se') return { preskoceno: `nacrt je u stanju ${n.status}` };
  const { rows: br } = await db.query<{ timezone: string }>('select timezone from public.brands where id = $1', [n.brand_id]);
  const tz = br[0]?.timezone ?? 'Europe/Belgrade';

  const rezultat: Record<string, string> = {};
  let greske = 0;
  let rucno = 0;

  for (const ch of n.channels) {
    const { rows: vv } = await db.query<{ caption: string; hashtags: string[]; media: { url: string }[] }>(
      'select caption, hashtags, media from public.draft_variants where draft_id = $1 and channel = $2', [n.id, ch]);
    const v = vv[0];
    if (!v) { rezultat[ch] = 'nema teksta'; greske++; continue; }
    const { rows: cc } = await db.query<Veza>('select * from public.connections where brand_id = $1 and provider = $2', [n.brand_id, ch]);
    const veza = cc[0];
    const k = kanal(ch);
    const auto = veza && veza.mode === 'auto' && veza.status !== 'greska' && k?.objavi;

    // red objave (idempotentno): jedan po kanalu; svaki pokušaj ponovo bira auto/ručno prema trenutnom stanju kanala
    const { rows: staro } = await db.query<{ status: string }>('select status from public.publications where draft_id = $1 and channel = $2', [n.id, ch]);
    const bilo = staro[0]?.status;
    if (bilo === 'objavljeno') { rezultat[ch] = 'objavljeno'; continue; }
    const { rows: pp } = await db.query<{ id: string; attempts: number }>(
      `insert into public.publications (draft_id, brand_id, channel, connection_id, mode, status)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (draft_id, channel) do update set attempts = public.publications.attempts + 1, connection_id = excluded.connection_id,
         mode = excluded.mode, status = excluded.status, error = null
       returning id, attempts`,
      [n.id, n.brand_id, ch, veza?.id ?? null, auto ? 'auto' : 'rucno', auto ? 'objavljuje_se' : 'ceka_rucno'],
    );
    const pub = pp[0]!;
    if (!auto) {
      rucno++;
      if (bilo !== 'ceka_rucno') {
        await obavesti(db, n.brand_id, 'rucna_objava', `Vreme je za objavu na kanalu ${naziv(ch)}`,
          `„${n.topic ?? 'Objava'}“ je spremna: preuzmi slike, kopiraj tekst i objavi. Posle klikni „Objavljeno“.`,
          `/b/${n.brand_id}/za-pregled?nacrt=${n.id}`);
      }
      rezultat[ch] = 'ceka_rucno';
      continue;
    }

    try {
      const t = await tajna(db, veza!.id);
      const nalog = nalogIzVeze(veza!);
      const tekst = tekstObjave(v.caption, v.hashtags);
      // pad usred prethodnog pokušaja: možda je objava već na kanalu
      let objavljeno = bilo === 'objavljuje_se' && k!.vecObjavljeno ? await k!.vecObjavljeno(t, nalog, tekst).catch(() => null) : null;
      objavljeno ??= await k!.objavi!(t, nalog, { slike: v.media.map((m) => m.url), tekst });
      await db.query(
        `update public.publications set status = 'objavljeno', external_id = $2, permalink = $3, published_at = now(), error = null where id = $1`,
        [pub.id, objavljeno.external_id, objavljeno.permalink],
      );
      // poveži sa analitikom: objava nosi oznake nacrta (stub, eksperiment…) za učenje
      const sada = new Date().toISOString();
      await db.query(
        `insert into public.channel_posts (brand_id, connection_id, provider, external_id, permalink, caption, format, published_at, tags, draft_id)
         values ($1,$2,$3,$4,$5,$6,$7,now(),$8,$9)
         on conflict (connection_id, external_id) do update set draft_id = excluded.draft_id, tags = public.channel_posts.tags || excluded.tags`,
        [n.brand_id, veza!.id, ch, objavljeno.external_id, objavljeno.permalink, tekst, n.format === 'tekst' ? 'tekst' : n.format,
          JSON.stringify({ ...satIDan(sada, tz), stub: n.pillar, format: n.format, eksperiment: n.experiment_key, varijanta: n.experiment_variant,
            kampanja: n.campaign_id, duzina: tekst.length }),
          n.id],
      );
      rezultat[ch] = 'objavljeno';
    } catch (e) {
      greske++;
      const poruka = e instanceof Error ? e.message : String(e);
      await db.query(`update public.publications set status = 'greska', error = $2 where id = $1`, [pub.id, poruka]);
      await obavesti(db, n.brand_id, 'greska_objave', `Objava na kanalu ${naziv(ch)} nije uspela`, poruka, `/b/${n.brand_id}/za-pregled?nacrt=${n.id}`);
      rezultat[ch] = `greška: ${poruka}`;
    }
  }

  const status = greske ? 'greska' : rucno ? 'objavljuje_se' : 'objavljen';
  await db.query(
    `update public.drafts set status = $2, error = $3, updated_at = now() where id = $1`,
    [n.id, status, greske ? Object.entries(rezultat).filter(([, r]) => r.startsWith('greška') || r === 'nema teksta').map(([c, r]) => `${naziv(c)}: ${r}`).join(' · ') : null],
  );
  return rezultat;
}
