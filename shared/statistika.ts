// Računanje statistike objava — isti kod za ekran Analitika i za agenta Učitelja.
// Brojke računa kod, agent ih samo tumači (da AI ne „izmišlja“ statistiku).
// Sve je u odnosu na prosek ISTOG brenda, nikad drugih.

export interface ObjavaBrojke {
  id: string;
  format: string | null;
  published_at: string | null;
  tags: Record<string, unknown>;
  reach: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
}

export interface Grupa {
  grupa: string;
  n: number;
  prosekDosega: number;
  sacuvanjaNa1000: number;
  angazmanProcenat: number;
  /** prosečan doseg grupe / prosečan doseg svih objava */
  odnosDosega: number;
  /** čuvanja na 1000 dosega u odnosu na prosek brenda */
  odnosCuvanja: number;
}

export interface Sazetak {
  objava: number;
  doseg: number;
  prosekDosega: number;
  cuvanja: number;
  angazman: number;
  angazmanProcenat: number;
}

const n0 = (x: number | null | undefined) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
export const angazman = (o: ObjavaBrojke) => n0(o.likes) + n0(o.comments) + n0(o.saves) + n0(o.shares);

export function sazetak(objave: ObjavaBrojke[]): Sazetak {
  const doseg = objave.reduce((s, o) => s + n0(o.reach), 0);
  const ang = objave.reduce((s, o) => s + angazman(o), 0);
  return {
    objava: objave.length,
    doseg,
    prosekDosega: objave.length ? doseg / objave.length : 0,
    cuvanja: objave.reduce((s, o) => s + n0(o.saves), 0),
    angazman: ang,
    angazmanProcenat: doseg ? (ang / doseg) * 100 : 0,
  };
}

export function poGrupi(objave: ObjavaBrojke[], kljuc: (o: ObjavaBrojke) => string | null | undefined, minN = 1): Grupa[] {
  const ukupno = sazetak(objave);
  const cuvanjaBrenda = ukupno.doseg ? (ukupno.cuvanja / ukupno.doseg) * 1000 : 0;
  const mape = new Map<string, ObjavaBrojke[]>();
  for (const o of objave) {
    const k = kljuc(o);
    if (k === null || k === undefined || k === '') continue;
    const l = mape.get(k) ?? [];
    l.push(o);
    mape.set(k, l);
  }
  return [...mape.entries()]
    .filter(([, l]) => l.length >= minN)
    .map(([grupa, l]) => {
      const s = sazetak(l);
      const cuv = s.doseg ? (s.cuvanja / s.doseg) * 1000 : 0;
      return {
        grupa,
        n: l.length,
        prosekDosega: s.prosekDosega,
        sacuvanjaNa1000: cuv,
        angazmanProcenat: s.angazmanProcenat,
        odnosDosega: ukupno.prosekDosega ? s.prosekDosega / ukupno.prosekDosega : 0,
        odnosCuvanja: cuvanjaBrenda ? cuv / cuvanjaBrenda : 0,
      };
    })
    .sort((a, b) => b.odnosDosega - a.odnosDosega);
}

/** Vremenski prozori za „kada objaviti“. */
export function deoDana(sat: unknown): string | null {
  if (typeof sat !== 'number') return null;
  if (sat < 6) return 'noć (0–6h)';
  if (sat < 11) return 'jutro (6–11h)';
  if (sat < 15) return 'podne (11–15h)';
  if (sat < 19) return 'popodne (15–19h)';
  return 'veče (19–24h)';
}

/** Sigurnost zaključka po broju objava u manjoj grupi. */
export function sigurnost(n: number): 'sigurno' | 'proverava_se' | 'malo_podataka' {
  if (n >= 8) return 'sigurno';
  if (n >= 4) return 'proverava_se';
  return 'malo_podataka';
}
