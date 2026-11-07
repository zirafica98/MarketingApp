// Kontekst brenda koji čitaju svi agenti posle onboardinga: profil, potvrđene činjenice, knjiga pravila, brojke.

import type pg from 'pg';
import { deoDana, poGrupi, sazetak, type Grupa, type ObjavaBrojke } from '../../../shared/statistika.ts';
import { JobError } from './index.ts';

export interface Brend {
  id: string;
  workspace_id: string;
  name: string;
  website: string | null;
  instagram_handle: string | null;
  language: string;
  timezone: string;
  color: string;
}

export async function ucitajBrend(db: pg.Pool, id: string | null): Promise<Brend> {
  const { rows } = await db.query<Brend>(
    'select id, workspace_id, name, website, instagram_handle, language, timezone, color from public.brands where id = $1',
    [id],
  );
  if (!rows[0]) throw new JobError('Brend više ne postoji.');
  return rows[0];
}

export async function objaveSaBrojkama(db: pg.Pool, brandId: string, dana = 90): Promise<ObjavaBrojke[]> {
  const { rows } = await db.query<ObjavaBrojke>(
    `select p.id, p.format, p.published_at::text, p.tags, m.reach, m.views, m.likes, m.comments, m.saves, m.shares
       from public.channel_posts p
       left join lateral (select * from public.post_metrics x where x.post_id = p.id order by day desc limit 1) m on true
      where p.brand_id = $1 and p.published_at > now() - make_interval(days => $2)`,
    [brandId, dana],
  );
  return rows;
}

const red = (g: Grupa) =>
  `  - ${g.grupa}: ${g.n} objava, doseg ${g.odnosDosega.toFixed(2)}× prosek, čuvanja ${g.odnosCuvanja.toFixed(2)}×, angažovanje ${g.angazmanProcenat.toFixed(1)}%`;

/** Brojke za prompt (računa kod; agent tumači). */
export function brojkeTekst(objave: ObjavaBrojke[]): string {
  if (!objave.length) return '(još nema podataka sa kanala)';
  const s = sazetak(objave);
  const delovi = [
    `Ukupno ${s.objava} objava, prosečan doseg ${Math.round(s.prosekDosega)}, angažovanje ${s.angazmanProcenat.toFixed(1)}%.`,
    'Po formatu:', ...poGrupi(objave, (o) => o.format).map(red),
    'Po stubu:', ...poGrupi(objave, (o) => (o.tags['stub'] as string) ?? null).map(red),
    'Po delu dana:', ...poGrupi(objave, (o) => deoDana(o.tags['sat'])).map(red),
    'Po danu u nedelji:', ...poGrupi(objave, (o) => (o.tags['dan'] as string) ?? null).map(red),
  ];
  return delovi.join('\n');
}

export interface Kontekst {
  brend: Brend;
  profil: string;
  cinjenice: string;
  pravila: string;
  brojke: string;
  kanali: { provider: string; mode: string; account_name: string | null }[];
  odgovori: Record<string, unknown>;
}

export async function kontekst(db: pg.Pool, brandId: string | null): Promise<Kontekst> {
  const brend = await ucitajBrend(db, brandId);
  const [p, f, k] = await Promise.all([
    db.query<{ summary: Record<string, unknown> | null; summary_status: string; answers: Record<string, unknown> }>(
      'select summary, summary_status, answers from public.brand_profiles where brand_id = $1', [brend.id]),
    db.query<{ text: string }>(`select text from public.brand_facts where brand_id = $1 and status = 'potvrdjeno' order by created_at`, [brend.id]),
    db.query<{ provider: string; mode: string; account_name: string | null }>('select provider, mode, account_name from public.connections where brand_id = $1', [brend.id]),
  ]);
  const pravila = await db
    .query<{ statement: string; confidence: string; source: string; locked: boolean }>(
      `select statement, confidence, source, locked from public.brand_playbook_rules
        where brand_id = $1 and status = 'aktivno' and (confidence in ('sigurno', 'odluka') or locked) order by locked desc, updated_at desc limit 25`,
      [brend.id],
    )
    .then((r) => r.rows)
    .catch(() => []); // tabela stiže u Fazi 5

  const s = p.rows[0]?.summary;
  if (!s || p.rows[0]?.summary_status === 'nema') throw new JobError('Brend profil još nije sastavljen. Završi onboarding (upitnik, razgovor, profil).');
  return {
    brend,
    profil: JSON.stringify(s, null, 1),
    cinjenice: f.rows.length ? f.rows.map((x) => `- ${x.text}`).join('\n') : '(nema potvrđenih činjenica)',
    pravila: pravila.length ? pravila.map((r) => `- ${r.statement}${r.locked ? ' (zaključano: uvek važi)' : ''}`).join('\n') : '(knjiga pravila je još prazna)',
    brojke: brojkeTekst(await objaveSaBrojkama(db, brend.id)),
    kanali: k.rows,
    odgovori: p.rows[0]?.answers ?? {},
  };
}

export const PRAVILA_PISANJA = `Opšta pravila:
- Jezik: srpski latinica sa č, ć, š, ž, đ (osim ako brend piše na drugom jeziku).
- Tvrdnje o proizvodu samo iz potvrđenih činjenica i profila. Ništa ne izmišljaj (brojke, cene, funkcije, zdravstvene tvrdnje).
- Poštuj zabrane i pravila tona iz profila i knjige pravila brenda. Pravila brenda imaju prednost nad opštim savetima.
- Bez hajpa („revolucionarno“, „neverovatno“). Prva rečenica mora da zainteresuje sama za sebe.`;
