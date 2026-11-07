import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { KONEKTORI } from '../../../../../shared/konektori';
import { NacrtiStore, STATUS_NACRTA, type Nacrt, type Objava, type StatusNacrta } from '../../core/nacrti';
import { porukaGreske } from '../../core/supabase';
import { WorkspaceState } from '../../core/workspace';

type Filter = 'pregled' | 'zakazano' | 'objavljeno' | 'odbijeno' | 'sve';

const FILTERI: { k: Filter; n: string; statusi: StatusNacrta[] | null }[] = [
  { k: 'pregled', n: 'Za pregled', statusi: ['pravi_se', 'za_pregled', 'popravlja_se', 'greska'] },
  { k: 'zakazano', n: 'Zakazano', statusi: ['odobren', 'zakazan', 'objavljuje_se'] },
  { k: 'objavljeno', n: 'Objavljeno', statusi: ['objavljen'] },
  { k: 'odbijeno', n: 'Odbijeno', statusi: ['odbijen'] },
  { k: 'sve', n: 'Sve', statusi: null },
];

export const RAZLOZI = ['Pogrešan ton', 'Netačno', 'Dosadno', 'Ne odgovara brendu', 'Ponavlja se', 'Loš vizual', 'Drugo'];

@Component({
  selector: 'app-za-pregled',
  imports: [DatePipe, RouterLink],
  providers: [NacrtiStore],
  templateUrl: './za-pregled.html',
  styleUrl: './za-pregled.css',
})
export default class ZaPregled {
  protected readonly store = inject(NacrtiStore);
  protected readonly ws = inject(WorkspaceState);
  private readonly router = inject(Router);

  readonly brandId = input.required<string>();
  readonly nacrt = input<string>();

  protected readonly filteri = FILTERI;
  protected readonly razlozi = RAZLOZI;
  protected readonly statusi = STATUS_NACRTA;
  protected readonly filter = signal<Filter>('pregled');
  protected readonly slajd = signal(0);
  protected readonly kanal = signal<string>('');
  protected readonly tekst = signal('');
  protected readonly hashtagovi = signal('');
  protected readonly vreme = signal('');
  protected readonly popravka = signal('');
  protected readonly razlog = signal('');
  protected readonly komentar = signal('');
  protected readonly odbijanje = signal(false);
  protected readonly greska = signal('');
  protected readonly poruka = signal('');
  protected readonly radi = signal(false);
  protected readonly linkRucno = signal<Record<string, string>>({});
  private obradjenLink: string | undefined;

  protected readonly lista = computed(() => {
    const f = FILTERI.find((x) => x.k === this.filter())!;
    const l = this.store.nacrti().filter((n) => !f.statusi || f.statusi.includes(n.status));
    return f.k === 'objavljeno' || f.k === 'odbijeno' ? [...l].reverse() : l;
  });
  protected readonly broj = computed(() => {
    const m: Record<string, number> = {};
    for (const f of FILTERI) m[f.k] = this.store.nacrti().filter((n) => !f.statusi || f.statusi.includes(n.status)).length;
    return m;
  });
  protected readonly izabran = computed<Nacrt | null>(() => {
    const id = this.nacrt();
    return this.store.nacrti().find((n) => n.id === id) ?? this.lista()[0] ?? null;
  });
  protected readonly varijanta = computed(() => this.izabran()?.draft_variants.find((v) => v.channel === this.kanal()) ?? this.izabran()?.draft_variants[0] ?? null);
  protected readonly slike = computed(() => this.izabran()?.draft_variants[0]?.media ?? []);
  protected readonly prosliOdobrene = computed(() => this.lista().filter((n) => n.status === 'za_pregled' && n.check_result?.prosao));
  protected readonly izmenjenTekst = computed(() => {
    const v = this.varijanta();
    return !!v && (v.caption !== this.tekst() || v.hashtags.join(' ') !== this.hashtagovi().trim());
  });
  protected readonly mozeOdobri = computed(() => ['owner', 'admin', 'editor', 'approver'].includes(this.ws.role() ?? ''));

  constructor() {
    effect(() => {
      const id = this.brandId();
      untracked(() => void this.store.start([id]));
    });
    // novi izabrani nacrt → radne kopije
    effect(() => {
      const n = this.izabran();
      untracked(() => {
        this.slajd.set(0);
        this.odbijanje.set(false);
        this.popravka.set('');
        const k = n?.draft_variants.find((v) => v.channel === this.kanal()) ? this.kanal() : n?.draft_variants[0]?.channel ?? '';
        this.kanal.set(k);
        this.vreme.set(n?.scheduled_at ? this.zaPolje(n.scheduled_at) : '');
      });
    });
    effect(() => {
      const v = this.varijanta();
      untracked(() => {
        this.tekst.set(v?.caption ?? '');
        this.hashtagovi.set(v?.hashtags.join(' ') ?? '');
      });
    });
    // nacrt iz linka (obaveštenje, kalendar) iz drugog filtera: prebaci filter, ali samo prvi put za taj link
    effect(() => {
      const id = this.nacrt();
      const n = this.store.nacrti().find((x) => x.id === id);
      if (!n || this.obradjenLink === id) return;
      untracked(() => {
        this.obradjenLink = id;
        if (this.lista().some((x) => x.id === id)) return;
        const f = FILTERI.find((x) => x.statusi?.includes(n.status));
        if (f) this.filter.set(f.k);
      });
    });
  }

  private zaPolje(iso: string): string {
    const d = new Date(iso);
    const p = (x: number) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  protected izaberi(n: Nacrt): void {
    void this.router.navigate([], { queryParams: { nacrt: n.id }, replaceUrl: true });
    this.greska.set('');
    this.poruka.set('');
  }

  protected nazivKanala(id: string): string {
    return KONEKTORI.find((k) => k.id === id)?.naziv ?? id;
  }

  /** Posle odluke koja izbacuje nacrt iz liste, otvori sledeći iz iste liste (ostaješ u istom filteru). */
  private async izvrsi(posao: () => Promise<unknown>, uspeh: string, dalje = false): Promise<void> {
    this.greska.set('');
    this.poruka.set('');
    this.radi.set(true);
    const l = this.lista();
    const i = l.findIndex((x) => x.id === this.izabran()?.id);
    const sledeci = dalje ? (l[i + 1] ?? l[i - 1] ?? null) : null;
    try {
      await posao();
      this.poruka.set(uspeh);
      if (sledeci && !this.lista().some((x) => x.id === this.izabran()?.id)) {
        this.obradjenLink = sledeci.id;
        await this.router.navigate([], { queryParams: { nacrt: sledeci.id }, replaceUrl: true });
      }
    } catch (e) {
      this.greska.set(porukaGreske(e));
    } finally {
      this.radi.set(false);
    }
  }

  protected sacuvajTekst(n: Nacrt): Promise<void> {
    const h = this.hashtagovi().split(/[\s,]+/).map((x) => x.trim()).filter(Boolean).map((x) => (x.startsWith('#') ? x : `#${x}`));
    return this.izvrsi(() => this.store.izmeniTekst(n.id, this.kanal(), this.tekst(), h), 'Tekst je sačuvan. Agenti pamte tvoje izmene.');
  }

  protected async odobri(n: Nacrt): Promise<void> {
    if (this.izmenjenTekst()) await this.sacuvajTekst(n);
    const vreme = this.vreme() ? new Date(this.vreme()).toISOString() : null;
    await this.izvrsi(() => this.store.radnja(n.id, 'odobri', { vreme }), vreme ? 'Odobreno i zakazano.' : 'Odobreno. Vreme objave možeš da dodaš kasnije.', true);
  }

  protected objaviOdmah(n: Nacrt): Promise<void> {
    return this.izvrsi(() => this.store.radnja(n.id, 'objavi_odmah'), 'Objavljuje se u narednom minutu.', true);
  }
  protected vrati(n: Nacrt): Promise<void> {
    return this.izvrsi(() => this.store.radnja(n.id, 'vrati'), 'Vraćeno u pregled.');
  }
  protected async trazi(n: Nacrt): Promise<void> {
    await this.izvrsi(() => this.store.radnja(n.id, 'popravi', { komentar: this.popravka() }), 'Pisac popravlja nacrt prema tvom uputstvu.');
    this.popravka.set('');
  }
  protected async odbij(n: Nacrt): Promise<void> {
    await this.izvrsi(() => this.store.radnja(n.id, 'odbij', { razlog: this.razlog(), komentar: this.komentar() }), 'Odbijeno. Razlog pamti Učitelj.', true);
    this.odbijanje.set(false);
    this.razlog.set('');
    this.komentar.set('');
  }

  protected async odobriSve(): Promise<void> {
    const l = this.prosliOdobrene();
    await this.izvrsi(async () => {
      for (const n of l) await this.store.radnja(n.id, 'odobri');
    }, `Odobreno i zakazano: ${l.length}.`, true);
  }

  protected kopiraj(t: string): void {
    void navigator.clipboard.writeText(t);
    this.poruka.set('Tekst je kopiran.');
  }

  protected tekstZaObjavu(n: Nacrt, kanal: string): string {
    const v = n.draft_variants.find((x) => x.channel === kanal);
    if (!v) return '';
    const h = v.hashtags.filter((x) => !v.caption.includes(x));
    return h.length ? `${v.caption}\n\n${h.join(' ')}` : v.caption;
  }

  protected objavljenoRucno(p: Objava): Promise<void> {
    const link = this.linkRucno()[p.id]?.trim() || null;
    return this.izvrsi(() => this.store.objavljenoRucno(p.id, link), 'Označeno kao objavljeno.');
  }

  protected postaviLink(id: string, v: string): void {
    this.linkRucno.update((m) => ({ ...m, [id]: v }));
  }
}
