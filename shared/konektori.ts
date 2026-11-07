// Katalog konektora — jedna definicija za aplikaciju (kartice, uputstva) i worker (šta kanal ume).
// Bez importa i bez TypeScript sintakse koja ne može samo da se obriše.

export type Nacin =
  | 'oauth' // dugme „Poveži“ → prijava na mrežu → nazad (treba nam odobrena aplikacija kod platforme)
  | 'token' // korisnik nalepi ključ/token iz svog naloga (Telegram bot, Shopify, WooCommerce)
  | 'rucno'; // nema API veze: alat pripremi, čovek objavi u dva klika

export type Grupa = 'mreze' | 'prodaja' | 'analitika' | 'sadrzaj';
export type Format = 'slika' | 'karusel' | 'tekst' | 'reel' | 'prica' | 'video';

export interface PoljeTokena {
  kljuc: string;
  naziv: string;
  tajno?: boolean;
  primer?: string;
}

export interface Konektor {
  id: string;
  naziv: string;
  grupa: Grupa;
  inicijali: string;
  boja: string;
  opis: string;
  nacini: Nacin[];
  /** formati koje alat ume da objavi automatski */
  objava: Format[];
  statistika: boolean;
  /** promenljive okruženja koje worker mora da ima za OAuth */
  env?: string[];
  /** polja za način 'token' */
  tokenPolja?: PoljeTokena[];
  /** šta treba pre povezivanja (prikazuje se kao koraci) */
  uputstvo: string[];
  /** stanje odobrenja kod platforme (za korisnika) */
  odobrenje?: string;
}

export const KONEKTORI: Konektor[] = [
  {
    id: 'instagram', naziv: 'Instagram', grupa: 'mreze', inicijali: 'IG', boja: 'linear-gradient(45deg,#f9a03f,#d62976,#7b2fbf)',
    opis: 'Objave, karuseli i priče · statistika objava i naloga',
    nacini: ['oauth', 'rucno'], objava: ['slika', 'karusel'], statistika: true,
    env: ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET'],
    uputstvo: [
      'Instagram nalog mora biti poslovni ili kreatorski: Instagram → Podešavanja → Tip naloga i alati → Prebaci na profesionalni nalog.',
      'Klikni „Poveži“ i prijavi se na Instagram nalog brenda.',
      'Dozvoli objavljivanje, statistiku i komentare. Bez toga alat može samo da pripremi objave.',
      'Posle povezivanja uvlačimo poslednjih 6 meseci objava i statistike, da Učitelj vidi šta je prolazilo.',
    ],
    odobrenje: 'Za naloge van našeg tima Meta mora da odobri aplikaciju (App Review). Do tada: ručni režim.',
  },
  {
    id: 'threads', naziv: 'Threads', grupa: 'mreze', inicijali: '@', boja: '#000',
    opis: 'Tekst, slike i karuseli',
    nacini: ['oauth', 'rucno'], objava: ['tekst', 'slika', 'karusel'], statistika: false,
    env: ['THREADS_APP_ID', 'THREADS_APP_SECRET'],
    uputstvo: ['Threads profil mora biti povezan sa Instagram nalogom.', 'Klikni „Poveži“ i prijavi se.'],
    odobrenje: 'Isto kao Instagram: Meta App Review za spoljne naloge.',
  },
  {
    id: 'facebook', naziv: 'Facebook stranica', grupa: 'mreze', inicijali: 'f', boja: '#1877f2',
    opis: 'Postovi i slike na stranici',
    nacini: ['rucno'], objava: [], statistika: false,
    uputstvo: ['Automatska objava stiže sa Meta odobrenjem. Do tada alat pripremi objavu, a ti je objaviš u dva klika.'],
    odobrenje: 'Čeka Meta App Review (pages_manage_posts).',
  },
  {
    id: 'telegram', naziv: 'Telegram kanal', grupa: 'mreze', inicijali: '✈', boja: '#229ed9',
    opis: 'Poruke i albumi u kanalu',
    nacini: ['token', 'rucno'], objava: ['tekst', 'slika', 'karusel'], statistika: false,
    tokenPolja: [
      { kljuc: 'bot_token', naziv: 'Token bota', tajno: true, primer: '123456:ABC-DEF…' },
      { kljuc: 'chat', naziv: 'Kanal', primer: '@mojkanal' },
    ],
    uputstvo: [
      'U Telegramu otvori @BotFather, pošalji /newbot i sačuvaj token koji dobiješ.',
      'Dodaj bota u svoj kanal kao administratora sa pravom objavljivanja.',
      'Upiši token i ime kanala (npr. @mojkanal). Proveravamo da bot može da piše u kanal.',
    ],
  },
  {
    id: 'tiktok', naziv: 'TikTok', grupa: 'mreze', inicijali: '♪', boja: '#111',
    opis: 'Video i foto karuseli',
    nacini: ['rucno'], objava: [], statistika: false,
    uputstvo: ['Dok TikTok ne odobri našu aplikaciju (audit), alat pripremi objavu i podseti te u zakazano vreme.'],
    odobrenje: 'Čeka TikTok audit; pre toga API dozvoljava samo privatne objave.',
  },
  {
    id: 'youtube', naziv: 'YouTube', grupa: 'mreze', inicijali: '▶', boja: '#ff0000',
    opis: 'Shorts i video', nacini: ['rucno'], objava: [], statistika: false,
    uputstvo: ['Automatska objava stiže sa Google verifikacijom aplikacije. Do tada: ručni režim.'],
    odobrenje: 'Čeka Google verifikaciju.',
  },
  {
    id: 'linkedin', naziv: 'LinkedIn stranica', grupa: 'mreze', inicijali: 'in', boja: '#0a66c2',
    opis: 'Postovi stranice firme', nacini: ['rucno'], objava: [], statistika: false,
    uputstvo: ['Automatska objava stiže sa odobrenjem LinkedIn Community Management API-ja. Do tada: ručni režim.'],
    odobrenje: 'Čeka LinkedIn odobrenje.',
  },
  {
    id: 'pinterest', naziv: 'Pinterest', grupa: 'mreze', inicijali: 'P', boja: '#e60023',
    opis: 'Pinovi', nacini: ['rucno'], objava: [], statistika: false,
    uputstvo: ['Automatska objava stiže sa Pinterest Standard pristupom. Do tada: ručni režim.'],
    odobrenje: 'Čeka Pinterest odobrenje.',
  },
  {
    id: 'x', naziv: 'X', grupa: 'mreze', inicijali: 'X', boja: '#000',
    opis: 'Postovi', nacini: ['rucno'], objava: [], statistika: false,
    uputstvo: ['X API se plaća, pa za sada alat pripremi objavu, a ti je objaviš u dva klika.'],
  },
  {
    id: 'shopify', naziv: 'Shopify', grupa: 'prodaja', inicijali: 'S', boja: '#5e8e3e',
    opis: 'Proizvodi, cene i slike za objave', nacini: ['token'], objava: [], statistika: false,
    tokenPolja: [
      { kljuc: 'shop', naziv: 'Adresa prodavnice', primer: 'korak.myshopify.com' },
      { kljuc: 'access_token', naziv: 'Admin API token', tajno: true, primer: 'shpat_…' },
    ],
    uputstvo: [
      'U Shopify adminu: Settings → Apps and sales channels → Develop apps → Create an app.',
      'U Configuration uključi samo „read_products“ i instaliraj aplikaciju.',
      'Kopiraj „Admin API access token“ i upiši ga ovde zajedno sa adresom prodavnice.',
    ],
  },
  {
    id: 'woocommerce', naziv: 'WooCommerce', grupa: 'prodaja', inicijali: 'W', boja: '#7f54b3',
    opis: 'Proizvodi iz WordPress prodavnice', nacini: ['token'], objava: [], statistika: false,
    tokenPolja: [
      { kljuc: 'site', naziv: 'Adresa sajta', primer: 'https://korak.rs' },
      { kljuc: 'consumer_key', naziv: 'Consumer key', tajno: true, primer: 'ck_…' },
      { kljuc: 'consumer_secret', naziv: 'Consumer secret', tajno: true, primer: 'cs_…' },
    ],
    uputstvo: [
      'U WordPress-u: WooCommerce → Settings → Advanced → REST API → Add key.',
      'Dozvola: samo „Read“. Kopiraj Consumer key i Consumer secret.',
    ],
  },
  {
    id: 'ga4', naziv: 'Google Analytics 4', grupa: 'analitika', inicijali: 'GA', boja: '#e37400',
    opis: 'Posete i prodaja sa mreža', nacini: ['rucno'], objava: [], statistika: false,
    uputstvo: ['Povezivanje stiže sa Google verifikacijom. Do tada: alat dodaje UTM oznake na linkove, pa posete sa mreža vidiš u svom GA4.'],
    odobrenje: 'Čeka Google verifikaciju.',
  },
];

export function konektor(id: string): Konektor | undefined {
  return KONEKTORI.find((k) => k.id === id);
}

export const NAZIV_GRUPE: Record<Grupa, string> = {
  mreze: 'Društvene mreže',
  prodaja: 'Prodaja',
  analitika: 'Analitika',
  sadrzaj: 'Sadržaj',
};
