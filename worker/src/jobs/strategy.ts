// Faza 3 — Strateg: revizija, stubovi sadržaja, nedeljni raspored po kanalu, eksperimenti.

import { KONEKTORI } from '../../../shared/konektori.ts';
import type { JobContext } from './index.ts';
import { kontekst, PRAVILA_PISANJA } from './kontekst.ts';

export const DANI = ['pon', 'uto', 'sre', 'cet', 'pet', 'sub', 'ned'] as const;
export const FORMATI = ['slika', 'karusel', 'tekst'] as const;

export interface Strategija {
  revizija: { stanje: string; jake_strane: string[]; slabosti: string[]; brojke: string[] };
  stubovi: { kljuc: string; naziv: string; opis: string; udeo: number; primeri: string[] }[];
  raspored: { dan: (typeof DANI)[number]; vreme: string; format: (typeof FORMATI)[number]; stub: string; kanali: string[] }[];
  eksperimenti: {
    kljuc: string; naziv: string; hipoteza: string; metrika: string; trajanje_nedelja: number;
    varijante: { kljuc: string; uputstvo: string }[];
  }[];
  napomene: string;
}

/** Kanali za raspored: povezani (auto ili ručno); bez ijednog, Instagram u ručnom režimu. */
export function kanaliZaRaspored(kanali: { provider: string }[]): string[] {
  const mreze = new Set(KONEKTORI.filter((k) => k.grupa === 'mreze').map((k) => k.id));
  const l = kanali.map((k) => k.provider).filter((p) => mreze.has(p));
  return l.length ? [...new Set(l)] : ['instagram'];
}

export async function brandStrategy({ db, job, ask }: JobContext): Promise<unknown> {
  const k = await kontekst(db, job.brand_id);
  const kanali = kanaliZaRaspored(k.kanali);
  const napomena = String(job.payload['napomena'] ?? '').trim();
  const { rows: prethodna } = await db.query<{ content: unknown }>(
    `select content from public.strategies where brand_id = $1 and status = 'aktivna' limit 1`, [k.brend.id],
  );
  const zeljeno = String(k.odgovori['objava_nedeljno'] ?? '3–4');

  const res = await ask<Strategija>({
    agent: 'strateg',
    model: 'opus',
    prompt: `Ti si Strateg u alatu za marketing. Praviš marketinšku strategiju za društvene mreže brenda „${k.brend.name}“.

${PRAVILA_PISANJA}
- Strategija mora da se oslanja na brojke OVOG brenda (ispod). Gde podataka nema, reci to i predloži eksperiment umesto pretpostavke.
- Kada brojke pokazuju nešto jasno (npr. format ili vreme koje bolje prolazi), raspored to mora da prati.
- Realno: korisnik želi ${zeljeno} objava nedeljno. Raspored ne sme imati više termina od toga (gornja granica).
- „raspored.kanali“ samo od: ${kanali.join(', ')}. „vreme“ u formatu HH:MM, u vremenskoj zoni brenda (${k.brend.timezone}).
- „stub“ u rasporedu je „kljuc“ jednog od stubova. Udeli stubova u zbiru 100.
- 1–3 eksperimenta, svaki sa dve varijante (A i B) i jasnim uputstvom piscu šta je drugačije.
- „revizija.brojke“: 2–5 najvažnijih brojki sa kratkim tumačenjem (samo iz datih podataka).
${napomena ? `\nKorisnik traži izmenu: ${napomena}\n` : ''}${prethodna[0] ? `\nTrenutna strategija (menjaj samo ono što ima razloga):\n${JSON.stringify(prethodna[0].content)}\n` : ''}
PROFIL BRENDA:
${k.profil}

POTVRĐENE ČINJENICE:
${k.cinjenice}

KNJIGA PRAVILA BRENDA (šta je dokazano da radi):
${k.pravila}

BROJKE SA KANALA (poslednjih 90 dana; računao kod, u odnosu na prosek brenda):
${k.brojke}`,
    schema: {
      type: 'object', additionalProperties: false,
      required: ['revizija', 'stubovi', 'raspored', 'eksperimenti', 'napomene'],
      properties: {
        revizija: {
          type: 'object', additionalProperties: false, required: ['stanje', 'jake_strane', 'slabosti', 'brojke'],
          properties: {
            stanje: { type: 'string', maxLength: 600 },
            jake_strane: { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 5 },
            slabosti: { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 5 },
            brojke: { type: 'array', items: { type: 'string', maxLength: 220 }, maxItems: 5 },
          },
        },
        stubovi: {
          type: 'array', minItems: 2, maxItems: 5,
          items: {
            type: 'object', additionalProperties: false, required: ['kljuc', 'naziv', 'opis', 'udeo', 'primeri'],
            properties: {
              kljuc: { type: 'string', pattern: '^[a-z0-9-]{2,30}$' }, naziv: { type: 'string', maxLength: 60 },
              opis: { type: 'string', maxLength: 300 }, udeo: { type: 'integer', minimum: 5, maximum: 80 },
              primeri: { type: 'array', items: { type: 'string', maxLength: 150 }, maxItems: 4 },
            },
          },
        },
        raspored: {
          type: 'array', minItems: 1, maxItems: 10,
          items: {
            type: 'object', additionalProperties: false, required: ['dan', 'vreme', 'format', 'stub', 'kanali'],
            properties: {
              dan: { type: 'string', enum: [...DANI] }, vreme: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' },
              format: { type: 'string', enum: [...FORMATI] }, stub: { type: 'string' },
              kanali: { type: 'array', items: { type: 'string', enum: kanali }, minItems: 1 },
            },
          },
        },
        eksperimenti: {
          type: 'array', maxItems: 3,
          items: {
            type: 'object', additionalProperties: false, required: ['kljuc', 'naziv', 'hipoteza', 'metrika', 'trajanje_nedelja', 'varijante'],
            properties: {
              kljuc: { type: 'string', pattern: '^[a-z0-9-]{2,30}$' }, naziv: { type: 'string', maxLength: 80 },
              hipoteza: { type: 'string', maxLength: 250 }, metrika: { type: 'string', maxLength: 120 },
              trajanje_nedelja: { type: 'integer', minimum: 1, maximum: 8 },
              varijante: {
                type: 'array', minItems: 2, maxItems: 2,
                items: { type: 'object', additionalProperties: false, required: ['kljuc', 'uputstvo'],
                  properties: { kljuc: { type: 'string', enum: ['A', 'B'] }, uputstvo: { type: 'string', maxLength: 250 } } },
              },
            },
          },
        },
        napomene: { type: 'string', maxLength: 600 },
      },
    },
  });

  const s = res.output;
  const stubovi = new Set(s.stubovi.map((x) => x.kljuc));
  s.raspored = s.raspored.filter((r) => stubovi.has(r.stub)).map((r) => ({ ...r, kanali: r.kanali.filter((c) => kanali.includes(c)) }));
  const { rows } = await db.query<{ id: string }>(
    `insert into public.strategies (brand_id, content, note, job_id) values ($1, $2, $3, $4) returning id`,
    [k.brend.id, JSON.stringify(s), napomena || null, job.id],
  );
  return { strategija: rows[0]!.id, termina: s.raspored.length, stubova: s.stubovi.length };
}
