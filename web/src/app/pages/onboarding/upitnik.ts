import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { popunjeno, stanjeGrupe, UPITNIK, type Grupa, type Odgovor, type Odgovori, type Polje } from '../../../../../shared/upitnik';
import { Auth } from '../../core/auth';
import { BrandOnboarding, stanjePosla, type Predlog } from '../../core/onboarding';
import { porukaGreske } from '../../core/supabase';
import { WorkspaceState } from '../../core/workspace';
import { normalizujSajt } from '../brendovi/brand-form';

@Component({
  selector: 'app-upitnik',
  imports: [RouterLink],
  providers: [BrandOnboarding],
  templateUrl: './upitnik.html',
  styleUrl: './upitnik.css',
})
export default class Upitnik {
  protected readonly ob = inject(BrandOnboarding);
  protected readonly ws = inject(WorkspaceState);
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);

  readonly brandId = input.required<string>();
  /** ?grupa=kupci */
  readonly grupa = input<string>();

  protected readonly grupe = UPITNIK;
  protected readonly brand = computed(() => this.ws.brand(this.brandId()));
  protected readonly trenutna = computed<Grupa>(() => UPITNIK.find((g) => g.kljuc === this.grupa()) ?? UPITNIK[0]!);
  protected readonly indeks = computed(() => UPITNIK.indexOf(this.trenutna()));

  /** Radna kopija odgovora; čuva se sama posle kratke pauze. */
  protected readonly odgovori = signal<Odgovori>({});
  protected readonly cuvanje = signal<'' | 'cuva' | 'sacuvano' | 'greska'>('');
  protected readonly greska = signal('');
  protected readonly noviKonkurent = signal('');
  private tajmer: ReturnType<typeof setTimeout> | null = null;
  private ucitanoZa: string | null = null;

  protected readonly istrazivanje = computed(() => this.ob.lastJob().get('brand.research'));
  protected readonly stanjeIstrazivanja = computed(() => stanjePosla(this.istrazivanje()));
  protected readonly predlozi = computed(() => this.ob.profile()?.suggestions ?? {});
  protected readonly preskocene = computed(() => new Set(this.ob.profile()?.skipped_groups ?? []));

  protected readonly predloziGrupe = computed(() =>
    this.trenutna().polja.filter((p) => this.predlogZa(p) !== null),
  );

  constructor() {
    effect(() => {
      const id = this.brandId();
      untracked(() => void this.ob.start(id));
    });
    // kad stigne profil (prvi put za brend), napuni radnu kopiju
    effect(() => {
      const p = this.ob.profile();
      if (p && this.ucitanoZa !== p.brand_id) {
        this.ucitanoZa = p.brand_id;
        untracked(() => this.odgovori.set({ ...p.answers }));
      }
    });
  }

  protected stanje(g: Grupa) {
    const s = stanjeGrupe(g, this.odgovori());
    const konk = g.kljuc === 'konkurencija' ? this.ob.competitors().length > 0 : true;
    return { ...s, gotovo: s.popunjeno === s.ukupno && konk, preskoceno: this.preskocene().has(g.kljuc) };
  }

  protected vrednost(p: Polje): Odgovor {
    return this.odgovori()[p.kljuc] ?? (p.vrsta === 'vise_izbora' ? [] : '');
  }
  protected tekst(p: Polje): string {
    const v = this.vrednost(p);
    return Array.isArray(v) ? v.join(', ') : v;
  }
  protected izabrano(p: Polje, o: string): boolean {
    const v = this.vrednost(p);
    return Array.isArray(v) ? v.includes(o) : v === o;
  }

  protected postavi(kljuc: string, v: Odgovor): void {
    this.odgovori.update((o) => ({ ...o, [kljuc]: v }));
    this.zakaziCuvanje();
  }
  protected prebaciIzbor(p: Polje, o: string, on: boolean): void {
    const v = this.vrednost(p);
    const lista = Array.isArray(v) ? v : [];
    this.postavi(p.kljuc, on ? [...lista, o] : lista.filter((x) => x !== o));
  }

  /** Predlog prikazujemo samo ako postoji i razlikuje se od odgovora. */
  protected predlogZa(p: Polje): Predlog | null {
    const s = this.predlozi()[p.kljuc];
    if (!s) return null;
    const a = this.odgovori()[p.kljuc];
    if (popunjeno(a) && JSON.stringify(a) === JSON.stringify(s.vrednost)) return null;
    return s;
  }
  protected popunjenoPolje(p: Polje): boolean {
    return popunjeno(this.odgovori()[p.kljuc]);
  }
  protected prikazPredloga(s: Predlog): string {
    return Array.isArray(s.vrednost) ? s.vrednost.join(', ') : s.vrednost;
  }
  protected prihvati(p: Polje): void {
    const s = this.predlogZa(p);
    if (s) this.postavi(p.kljuc, s.vrednost);
  }
  protected prihvatiSve(): void {
    for (const p of this.predloziGrupe()) {
      if (!popunjeno(this.odgovori()[p.kljuc])) this.prihvati(p);
    }
  }

  private zakaziCuvanje(): void {
    this.cuvanje.set('cuva');
    if (this.tajmer) clearTimeout(this.tajmer);
    this.tajmer = setTimeout(() => void this.sacuvaj(), 700);
  }

  protected async sacuvaj(): Promise<void> {
    if (this.tajmer) clearTimeout(this.tajmer);
    this.tajmer = null;
    if (!this.ws.canEdit()) return;
    try {
      await this.ob.sacuvajOdgovore(this.odgovori());
      this.cuvanje.set('sacuvano');
    } catch (e) {
      this.cuvanje.set('greska');
      this.greska.set(porukaGreske(e));
    }
  }

  protected async idi(g: Grupa | undefined): Promise<void> {
    if (this.tajmer) await this.sacuvaj();
    if (!g) {
      await this.router.navigate(['/b', this.brandId(), 'razgovor']);
      return;
    }
    await this.router.navigate([], { queryParams: { grupa: g.kljuc } });
    document.getElementById('grupa-naslov')?.focus();
  }

  protected async preskoci(): Promise<void> {
    const g = this.trenutna();
    const s = new Set(this.preskocene());
    s.add(g.kljuc);
    try {
      await this.ob.postaviPreskocene([...s]);
    } catch (e) {
      this.greska.set(porukaGreske(e));
      return;
    }
    await this.idi(UPITNIK[this.indeks() + 1]);
  }

  protected async vratiPreskoceno(): Promise<void> {
    const s = new Set(this.preskocene());
    s.delete(this.trenutna().kljuc);
    await this.ob.postaviPreskocene([...s]).catch((e) => this.greska.set(porukaGreske(e)));
  }

  protected async procitajSajt(): Promise<void> {
    this.greska.set('');
    try {
      await this.ob.pokreni('brand.research');
    } catch (e) {
      this.greska.set(porukaGreske(e));
    }
  }

  protected async dodajKonkurenta(e: Event): Promise<void> {
    e.preventDefault();
    this.greska.set('');
    const url = normalizujSajt(this.noviKonkurent());
    if (!url || !/^https?:\/\/[^\s/]+\.[^\s]{2,}/i.test(url)) {
      this.greska.set('Upiši adresu sajta konkurenta, npr. sportvision.rs');
      return;
    }
    try {
      await this.ob.dodajKonkurenta(url, this.auth.userId()!);
      this.noviKonkurent.set('');
    } catch (err) {
      this.greska.set(porukaGreske(err).includes('duplicate') ? 'Taj konkurent je već dodat.' : porukaGreske(err));
    }
  }

  protected stanjeKonkurenta(id: string) {
    return stanjePosla(this.ob.lastJob().get(`brand.competitor:${id}`));
  }

  protected domen(url: string | null | undefined): string {
    try {
      return url ? new URL(url).hostname.replace(/^www\./, '') : '';
    } catch {
      return url ?? '';
    }
  }
}
