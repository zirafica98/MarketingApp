/** Delovi brenda u levom meniju. Oni bez `gotovo` vode na ekran „Uskoro“ sa opisom i fazom. */
export interface Modul {
  slug: string;
  ikona: string;
  naziv: string;
  faza: string;
  opis: string;
  sekcija: 'postavka' | 'svaki-dan';
}

export const MODULI: Modul[] = [
  { slug: 'upitnik', ikona: '📝', naziv: 'Upitnik o poslovanju', faza: 'Faza 1', sekcija: 'postavka',
    opis: 'Pitanja o poslu, kupcima, konkurenciji, glasu brenda i ciljevima. Agent unapred popunjava predloge sa sajta i mreža.' },
  { slug: 'konektori', ikona: '🔗', naziv: 'Konektori', faza: 'Faza 2', sekcija: 'postavka',
    opis: 'Povezivanje Instagrama, Facebooka, TikToka, prodavnice, analitike i ostalih kanala, sa uputstvom u koracima.' },
  { slug: 'strategija', ikona: '🧭', naziv: 'Strategija', faza: 'Faza 3', sekcija: 'postavka',
    opis: 'Revizija kanala, stubovi sadržaja, nedeljni raspored i eksperimenti.' },
  { slug: 'za-pregled', ikona: '✅', naziv: 'Za pregled', faza: 'Faza 3', sekcija: 'svaki-dan',
    opis: 'Nacrti objava koje odobravaš, menjaš ili odbijaš. Ništa ne ide javno bez odobrenja.' },
  { slug: 'kalendar', ikona: '🗓', naziv: 'Kalendar', faza: 'Faza 3', sekcija: 'svaki-dan',
    opis: 'Sve zakazane i objavljene objave ovog brenda na svim kanalima.' },
  { slug: 'analitika', ikona: '📈', naziv: 'Analitika', faza: 'Faza 2', sekcija: 'svaki-dan',
    opis: 'Brojke sa svih kanala na jednom mestu, po objavi, formatu i temi.' },
  { slug: 'sta-radi', ikona: '🧠', naziv: 'Šta radi za ovaj brend', faza: 'Faza 5', sekcija: 'svaki-dan',
    opis: 'Knjiga pravila koju agent Učitelj piše iz analitike ovog brenda i tvojih odluka.' },
];
