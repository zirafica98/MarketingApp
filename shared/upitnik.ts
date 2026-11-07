// Upitnik o poslovanju — jedna definicija za aplikaciju (polja, redosled) i za agente (koja polja predlažu, koji izbori postoje).
// Pravila: bez importa i bez TypeScript sintakse koja ne može samo da se obriše (Node je izvršava direktno u workeru).

export type VrstaPolja = 'tekst' | 'dugi_tekst' | 'izbor' | 'vise_izbora';

export interface Polje {
  kljuc: string;
  pitanje: string;
  vrsta: VrstaPolja;
  obavezno?: boolean;
  pomoc?: string;
  primer?: string;
  opcije?: string[];
  /** Agent sme da predloži odgovor iz sajta/konkurencije. */
  predlog?: boolean;
}

export interface Grupa {
  kljuc: string;
  naziv: string;
  naslov: string;
  opis: string;
  polja: Polje[];
}

export const UPITNIK: Grupa[] = [
  {
    kljuc: 'posao',
    naziv: 'Posao',
    naslov: 'Šta radiš i gde prodaješ?',
    opis: 'Osnova za sve ostalo: šta nudiš, kome i gde.',
    polja: [
      { kljuc: 'sta_prodajes', pitanje: 'Šta prodaješ ili nudiš?', vrsta: 'dugi_tekst', obavezno: true, predlog: true,
        primer: 'Originalne limitirane patike, dostava za 24h po celoj Srbiji.' },
      { kljuc: 'vrsta_posla', pitanje: 'Šta je to najviše?', vrsta: 'izbor', obavezno: true, predlog: true,
        opcije: ['Fizički proizvodi', 'Usluga', 'Aplikacija ili softver', 'Lokal ili radnja', 'Sadržaj ili mediji', 'Nešto drugo'] },
      { kljuc: 'industrija', pitanje: 'Industrija', vrsta: 'tekst', predlog: true, primer: 'Moda i obuća' },
      { kljuc: 'gde_prodajes', pitanje: 'Gde kupci kupuju?', vrsta: 'vise_izbora', predlog: true,
        opcije: ['Online prodavnica', 'Sajt ili aplikacija', 'Fizička radnja', 'Preko društvenih mreža', 'Kod drugih prodavaca', 'Telefonom ili porukom'] },
      { kljuc: 'trzista', pitanje: 'Na kojim tržištima ili u kojim gradovima?', vrsta: 'tekst', obavezno: true, predlog: true,
        primer: 'Cela Srbija, najviše Beograd i Novi Sad' },
      { kljuc: 'cene', pitanje: 'Raspon cena', vrsta: 'tekst', predlog: true, primer: '8.000 – 25.000 din' },
      { kljuc: 'glavni_proizvodi', pitanje: 'Glavni proizvodi ili usluge', vrsta: 'dugi_tekst', predlog: true,
        pomoc: 'Po jedan u redu. Kasnije se uvozi i iz prodavnice.' },
    ],
  },
  {
    kljuc: 'kupci',
    naziv: 'Kupci',
    naslov: 'Ko kupuje kod tebe?',
    opis: 'Što preciznije, to objave bolje pogađaju.',
    polja: [
      { kljuc: 'ko_kupuje', pitanje: 'Opiši tipičnog kupca', vrsta: 'dugi_tekst', obavezno: true, predlog: true,
        primer: 'Momci i devojke 18–30, prate sneaker scenu, kupuju online.' },
      { kljuc: 'godine', pitanje: 'Godine kupaca', vrsta: 'vise_izbora', predlog: true,
        opcije: ['do 18', '18–24', '25–34', '35–44', '45–54', '55+'] },
      { kljuc: 'pol', pitanje: 'Pol kupaca', vrsta: 'izbor', predlog: true,
        opcije: ['Uglavnom žene', 'Uglavnom muškarci', 'Podjednako'] },
      { kljuc: 'problem', pitanje: 'Koji problem im rešavaš?', vrsta: 'dugi_tekst', obavezno: true, predlog: true },
      { kljuc: 'zasto_ti', pitanje: 'Zašto kupuju baš kod tebe, a ne kod drugih?', vrsta: 'dugi_tekst', obavezno: true, predlog: true },
      { kljuc: 'pitanja_kupaca', pitanje: 'Najčešća pitanja ili zamerke kupaca', vrsta: 'dugi_tekst',
        pomoc: 'Šta te najčešće pitaju u porukama i komentarima?' },
    ],
  },
  {
    kljuc: 'konkurencija',
    naziv: 'Konkurencija',
    naslov: 'Ko su ti konkurenti?',
    opis: 'Dodaj sajtove 2–5 konkurenata. Agent ih sam prouči.',
    polja: [
      { kljuc: 'razlika', pitanje: 'Po čemu si drugačiji od njih?', vrsta: 'dugi_tekst', obavezno: true, predlog: true },
    ],
  },
  {
    kljuc: 'glas',
    naziv: 'Glas brenda',
    naslov: 'Kako brend zvuči?',
    opis: 'Ton, obraćanje i stil teksta u objavama.',
    polja: [
      { kljuc: 'ton', pitanje: 'Ton (izaberi do 3)', vrsta: 'vise_izbora', obavezno: true, predlog: true,
        opcije: ['Topao', 'Zabavan', 'Stručan', 'Direktan', 'Luksuzan', 'Opušten', 'Smiren', 'Inspirativan', 'Mladalački', 'Ozbiljan'] },
      { kljuc: 'obracanje', pitanje: 'Kako se obraćaš publici?', vrsta: 'izbor', obavezno: true, predlog: true,
        opcije: ['Ti (muški rod)', 'Ti (ženski rod)', 'Ti (bez roda gde može)', 'Vi'] },
      { kljuc: 'emodziji', pitanje: 'Emodžiji', vrsta: 'izbor',
        opcije: ['Bez emodžija', 'Umereno (do 3)', 'Slobodno'] },
      { kljuc: 'primeri', pitanje: 'Primeri objava koje voliš (svoje ili tuđe)', vrsta: 'dugi_tekst',
        pomoc: 'Linkovi ili opis. Pomaže agentu da pogodi stil.' },
    ],
  },
  {
    kljuc: 'vizuelno',
    naziv: 'Vizuelni identitet',
    naslov: 'Kako brend izgleda?',
    opis: 'Boja brenda je u podešavanjima brenda. Logo i fotografije stižu sa bibliotekom medija.',
    polja: [
      { kljuc: 'stil', pitanje: 'Vizuelni stil', vrsta: 'tekst', predlog: true, primer: 'Čist, beli prostor, mnogo fotografija proizvoda' },
      { kljuc: 'fotografije', pitanje: 'Fotografije proizvoda', vrsta: 'izbor',
        opcije: ['Imam profesionalne', 'Snimam telefonom', 'Nemam, treba mi pomoć'] },
      { kljuc: 'nikad_na_slici', pitanje: 'Šta nikad ne sme na slici?', vrsta: 'dugi_tekst' },
    ],
  },
  {
    kljuc: 'ciljevi',
    naziv: 'Ciljevi i datumi',
    naslov: 'Šta želiš da postigneš?',
    opis: 'Prema cilju merimo da li marketing radi.',
    polja: [
      { kljuc: 'glavni_cilj', pitanje: 'Glavni cilj za sledeća 3 meseca', vrsta: 'izbor', obavezno: true,
        opcije: ['Više prodaje', 'Više pratilaca', 'Više poseta radnji', 'Više prijava ili registracija', 'Više preuzimanja aplikacije', 'Poverenje i zajednica'] },
      { kljuc: 'meta', pitanje: 'Merljiva meta', vrsta: 'tekst', primer: '100 porudžbina mesečno sa Instagrama' },
      { kljuc: 'datumi', pitanje: 'Važni datumi (lansiranja, akcije, praznici)', vrsta: 'dugi_tekst', primer: '28. 11. Black Friday, 15. 12. nova kolekcija' },
    ],
  },
  {
    kljuc: 'pravila',
    naziv: 'Pravila i zabrane',
    naslov: 'Šta se nikad ne objavljuje?',
    opis: 'Urednik odbija svaki nacrt koji prekrši ova pravila.',
    polja: [
      { kljuc: 'zabranjene_teme', pitanje: 'Teme koje se ne pominju', vrsta: 'dugi_tekst', primer: 'Politika, konkurencija po imenu' },
      { kljuc: 'zabranjene_tvrdnje', pitanje: 'Tvrdnje koje se ne smeju davati', vrsta: 'dugi_tekst', primer: 'Medicinski saveti, garancije koje nemamo' },
      { kljuc: 'pravne_napomene', pitanje: 'Pravne napomene', vrsta: 'tekst', primer: 'Cene su sa PDV-om' },
    ],
  },
  {
    kljuc: 'resursi',
    naziv: 'Resursi i odobravanje',
    naslov: 'Koliko vremena i ko odobrava?',
    opis: 'Da plan bude realan.',
    polja: [
      { kljuc: 'objava_nedeljno', pitanje: 'Koliko objava nedeljno želiš?', vrsta: 'izbor', obavezno: true,
        opcije: ['1–2', '3–4', '5–7', 'Više od 7'] },
      { kljuc: 'odobravanje', pitanje: 'Koliko često možeš da odobravaš?', vrsta: 'izbor', obavezno: true,
        opcije: ['Svaki dan', '2–3 puta nedeljno', 'Jednom nedeljno, sve odjednom'] },
      { kljuc: 'budzet', pitanje: 'Budžet za plaćene reklame', vrsta: 'izbor',
        opcije: ['Nemam', 'Mali (do 100 € mesečno)', 'Srednji (100–500 €)', 'Veći (500 €+)', 'Kasnije'] },
      { kljuc: 'video', pitanje: 'Snimaš li video?', vrsta: 'izbor',
        opcije: ['Da, redovno', 'Ponekad', 'Ne, ali bih', 'Ne'] },
    ],
  },
];

export const SVA_POLJA: Polje[] = UPITNIK.flatMap((g) => g.polja);

export function polje(kljuc: string): Polje | undefined {
  return SVA_POLJA.find((p) => p.kljuc === kljuc);
}

export type Odgovor = string | string[];
export type Odgovori = Record<string, Odgovor>;

export function popunjeno(v: Odgovor | undefined): boolean {
  return Array.isArray(v) ? v.length > 0 : !!v && v.trim().length > 0;
}

/** Koliko je obaveznih polja u grupi popunjeno (konkurencija se računa i po broju konkurenata). */
export function stanjeGrupe(g: Grupa, odgovori: Odgovori): { popunjeno: number; ukupno: number } {
  const obavezna = g.polja.filter((p) => p.obavezno);
  return { popunjeno: obavezna.filter((p) => popunjeno(odgovori[p.kljuc])).length, ukupno: obavezna.length };
}

/** Predlog agenta usklađen sa vrstom polja (izbori samo iz ponuđenih opcija). Vraća null ako ništa ne ostane. */
export function ocistiPredlog(p: Polje, vrednost: string[]): Odgovor | null {
  const v = vrednost.map((x) => x.trim()).filter(Boolean);
  if (p.vrsta === 'izbor' || p.vrsta === 'vise_izbora') {
    const ok = v.filter((x) => p.opcije?.includes(x));
    if (!ok.length) return null;
    return p.vrsta === 'izbor' ? ok[0]! : [...new Set(ok)];
  }
  if (!v.length) return null;
  return v.join(p.vrsta === 'dugi_tekst' ? '\n' : ', ');
}
