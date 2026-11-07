import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Auth } from '../../core/auth';
import { BrandOnboarding, stanjePosla, type Fact, type Sazetak } from '../../core/onboarding';
import { porukaGreske } from '../../core/supabase';
import { WorkspaceState } from '../../core/workspace';

/** Polja sažetka koja korisnik menja; liste se uređuju kao jedan red = jedna stavka. */
const POLJA: { kljuc: keyof Sazetak | 'ton_opis' | 'ton_pravila'; naziv: string; lista?: boolean; pomoc?: string }[] = [
  { kljuc: 'jedna_recenica', naziv: 'Brend u jednoj rečenici' },
  { kljuc: 'publika', naziv: 'Publika' },
  { kljuc: 'problem_i_resenje', naziv: 'Problem i rešenje' },
  { kljuc: 'pozicioniranje', naziv: 'Pozicioniranje', pomoc: 'Po čemu se razlikuješ od konkurencije.' },
  { kljuc: 'ton_opis', naziv: 'Ton' },
  { kljuc: 'ton_pravila', naziv: 'Pravila pisanja', lista: true },
  { kljuc: 'kljucne_poruke', naziv: 'Ključne poruke', lista: true },
  { kljuc: 'zabrane', naziv: 'Zabrane', lista: true, pomoc: 'Urednik odbija svaki nacrt koji ovo prekrši.' },
  { kljuc: 'ciljevi', naziv: 'Ciljevi', lista: true },
];

const KATEGORIJE: Record<string, string> = {
  proizvod: 'Proizvod', usluga: 'Usluga', funkcija: 'Funkcija', cena: 'Cena', publika: 'Publika', prednost: 'Prednost',
  dostava: 'Dostava', kontakt: 'Kontakt', kompanija: 'Kompanija', ostalo: 'Ostalo',
};

@Component({
  selector: 'app-profil',
  imports: [RouterLink],
  providers: [BrandOnboarding],
  templateUrl: './profil.html',
  styles: `
    .polja { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 16px; }
    .polja .siroko { grid-column: 1 / -1; }
    textarea { resize: vertical; }
    .fact { display: flex; gap: 12px; align-items: flex-start; padding: 10px 0; border-bottom: 1px solid var(--line); }
    .fact:last-child { border-bottom: 0; }
    .fact .t { flex: 1; min-width: 0; }
    .fact.odbaceno .t > span:first-child { text-decoration: line-through; color: var(--muted); }
    .izvor { font-size: 12px; word-break: break-all; }
    .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: #fff; }
    .seg button { border: 0; background: transparent; padding: 6px 12px; font-weight: 600; color: var(--muted); cursor: pointer; }
    .seg button[aria-pressed="true"] { background: #f0eee9; color: var(--ink); }
    @media (max-width: 900px) { .polja { grid-template-columns: 1fr; } }
  `,
})
export default class Profil {
  protected readonly ob = inject(BrandOnboarding);
  protected readonly ws = inject(WorkspaceState);
  private readonly auth = inject(Auth);
  readonly brandId = input.required<string>();

  protected readonly polja = POLJA;
  protected readonly kategorije = KATEGORIJE;
  protected readonly brand = computed(() => this.ws.brand(this.brandId()));
  protected readonly posao = computed(() => stanjePosla(this.ob.lastJob().get('brand.profile')));
  protected readonly sazetak = computed(() => this.ob.profile()?.summary ?? null);
  protected readonly imaSazetak = computed(() => !!this.sazetak()?.jedna_recenica);
  protected readonly status = computed(() => this.ob.profile()?.summary_status ?? 'nema');

  /** Radna kopija za uređivanje (tekst po polju). */
  protected readonly nacrt = signal<Record<string, string>>({});
  protected readonly izmenjeno = signal(false);
  protected readonly poruka = signal('');
  protected readonly greska = signal('');
  protected readonly filter = signal<'sve' | 'predlog' | 'potvrdjeno' | 'odbaceno'>('sve');
  protected readonly novaCinjenica = signal('');
  private ucitanaVerzija = -1;

  protected readonly cinjenice = computed(() => {
    const f = this.filter();
    const red: Record<Fact['status'], number> = { predlog: 0, potvrdjeno: 1, odbaceno: 2 };
    return this.ob.facts()
      .filter((x) => f === 'sve' || x.status === f)
      .sort((a, b) => red[a.status] - red[b.status]);
  });
  protected readonly brojPredloga = computed(() => this.ob.facts().filter((f) => f.status === 'predlog').length);

  constructor() {
    effect(() => {
      const id = this.brandId();
      untracked(() => void this.ob.start(id));
    });
    // nova verzija sažetka (npr. agent je sastavio) puni radnu kopiju, osim ako korisnik baš uređuje
    effect(() => {
      const p = this.ob.profile();
      if (!p || p.version === this.ucitanaVerzija) return;
      untracked(() => {
        if (this.izmenjeno()) return;
        this.ucitanaVerzija = p.version;
        this.nacrt.set(this.uTekst(p.summary));
      });
    });
  }

  private uTekst(s: Sazetak | null): Record<string, string> {
    const o: Record<string, string> = {};
    if (!s) return o;
    for (const p of POLJA) {
      const v =
        p.kljuc === 'ton_opis' ? s.ton?.opis : p.kljuc === 'ton_pravila' ? s.ton?.pravila : (s[p.kljuc as keyof Sazetak] as unknown);
      o[p.kljuc] = Array.isArray(v) ? v.join('\n') : typeof v === 'string' ? v : '';
    }
    return o;
  }

  private izTeksta(): Sazetak {
    const n = this.nacrt();
    const lista = (k: string) => (n[k] ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
    return {
      ...(this.sazetak() ?? {}),
      jedna_recenica: n['jedna_recenica'] ?? '',
      publika: n['publika'] ?? '',
      problem_i_resenje: n['problem_i_resenje'] ?? '',
      pozicioniranje: n['pozicioniranje'] ?? '',
      ton: { opis: n['ton_opis'] ?? '', pravila: lista('ton_pravila') },
      kljucne_poruke: lista('kljucne_poruke'),
      zabrane: lista('zabrane'),
      ciljevi: lista('ciljevi'),
    };
  }

  protected promeni(k: string, v: string): void {
    this.nacrt.update((n) => ({ ...n, [k]: v }));
    this.izmenjeno.set(true);
    this.poruka.set('');
  }

  protected async sacuvaj(potvrdi: boolean): Promise<void> {
    this.greska.set('');
    try {
      const status = potvrdi ? 'potvrdjen' : this.status() === 'potvrdjen' ? 'potvrdjen' : 'predlog';
      await this.ob.sacuvajSazetak(this.izTeksta(), status);
      this.izmenjeno.set(false);
      this.poruka.set(potvrdi ? 'Profil je potvrđen. Agenti ga od sada koriste u svakom poslu.' : 'Izmene su sačuvane.');
    } catch (e) {
      this.greska.set(porukaGreske(e));
    }
  }

  protected async sastavi(): Promise<void> {
    this.greska.set('');
    this.izmenjeno.set(false);
    await this.ob.pokreni('brand.profile').catch((e) => this.greska.set(porukaGreske(e)));
  }

  protected async oceni(f: Fact, status: Fact['status']): Promise<void> {
    await this.ob.oceniCinjenicu(f.id, status, this.auth.userId()!).catch((e) => this.greska.set(porukaGreske(e)));
  }

  protected async potvrdiSve(): Promise<void> {
    for (const f of this.ob.facts().filter((x) => x.status === 'predlog')) await this.oceni(f, 'potvrdjeno');
  }

  protected async dodaj(e: Event): Promise<void> {
    e.preventDefault();
    const t = this.novaCinjenica().trim();
    if (t.length < 3) return;
    try {
      await this.ob.dodajCinjenicu(t);
      this.novaCinjenica.set('');
    } catch (err) {
      this.greska.set(porukaGreske(err));
    }
  }

  protected domen(url: string | null): string {
    try {
      return url ? new URL(url).pathname.replace(/\/$/, '') || '/' : '';
    } catch {
      return url ?? '';
    }
  }
}
