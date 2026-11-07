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
  { slug: 'upitnik', ikona: '📝', naziv: 'Upitnik o poslovanju', faza: 'Postavka', sekcija: 'postavka',
    opis: 'Pitanja o poslu, kupcima, konkurenciji, glasu brenda i ciljevima. Agent unapred popunjava predloge sa sajta.' },
  { slug: 'razgovor', ikona: '💬', naziv: 'Razgovor sa agentom', faza: 'Postavka', sekcija: 'postavka',
    opis: 'Agent pita samo ono što nije mogao sam da zaključi.' },
  { slug: 'profil', ikona: '🪪', naziv: 'Brend profil', faza: 'Postavka', sekcija: 'postavka',
    opis: 'Sažetak brenda i činjenice sa izvorom; čitaju ga svi agenti.' },
  { slug: 'konektori', ikona: '🔗', naziv: 'Konektori', faza: 'Spremno', sekcija: 'postavka',
    opis: 'Povezivanje Instagrama, Facebooka, TikToka, prodavnice, analitike i ostalih kanala, sa uputstvom u koracima.' },
  { slug: 'strategija', ikona: '🧭', naziv: 'Strategija', faza: 'Spremno', sekcija: 'postavka',
    opis: 'Revizija kanala, stubovi sadržaja, nedeljni raspored i eksperimenti.' },
  { slug: 'za-pregled', ikona: '✅', naziv: 'Za pregled', faza: 'Spremno', sekcija: 'svaki-dan',
    opis: 'Nacrti objava koje odobravaš, menjaš ili odbijaš. Ništa ne ide javno bez odobrenja.' },
  { slug: 'kampanje', ikona: '🎯', naziv: 'Kampanje', faza: 'Spremno', sekcija: 'svaki-dan',
    opis: 'Akcije, lansiranja i praznici: plan objava za sve kanale odjednom, sa proizvodima iz prodavnice.' },
  { slug: 'kalendar', ikona: '🗓', naziv: 'Kalendar', faza: 'Spremno', sekcija: 'svaki-dan',
    opis: 'Sve zakazane i objavljene objave ovog brenda na svim kanalima.' },
  { slug: 'analitika', ikona: '📈', naziv: 'Analitika', faza: 'Spremno', sekcija: 'svaki-dan',
    opis: 'Brojke sa svih kanala na jednom mestu, po objavi, formatu i temi.' },
  { slug: 'sta-radi', ikona: '🧠', naziv: 'Šta radi za ovaj brend', faza: 'Spremno', sekcija: 'svaki-dan',
    opis: 'Knjiga pravila koju agent Učitelj piše iz analitike ovog brenda i tvojih odluka.' },
];
