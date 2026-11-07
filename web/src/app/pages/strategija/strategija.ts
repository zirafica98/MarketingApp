import { DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { KONEKTORI } from '../../../../../shared/konektori';
import type { Job } from '../../core/models';
import { stanjePosla } from '../../core/onboarding';
import { porukaGreske, Supabase } from '../../core/supabase';
import { WorkspaceState } from '../../core/workspace';

export interface Strategija {
  revizija: { stanje: string; jake_strane: string[]; slabosti: string[]; brojke: string[] };
  stubovi: { kljuc: string; naziv: string; opis: string; udeo: number; primeri: string[] }[];
  raspored: { dan: string; vreme: string; format: string; stub: string; kanali: string[] }[];
  eksperimenti: { kljuc: string; naziv: string; hipoteza: string; metrika: string; trajanje_nedelja: number; varijante: { kljuc: string; uputstvo: string }[] }[];
  napomene: string;
}

interface Red {
  id: string;
  status: 'predlog' | 'aktivna' | 'arhiva';
  content: Strategija;
  note: string | null;
  created_at: string;
  accepted_at: string | null;
}

export const DANI = [
  { k: 'pon', n: 'Ponedeljak' }, { k: 'uto', n: 'Utorak' }, { k: 'sre', n: 'Sreda' }, { k: 'cet', n: 'Četvrtak' },
  { k: 'pet', n: 'Petak' }, { k: 'sub', n: 'Subota' }, { k: 'ned', n: 'Nedelja' },
];
export const BOJE_STUBOVA = ['#d9677f', '#4b3fd1', '#3b8ac4', '#c48a00', '#1a6b43'];

@Component({
  selector: 'app-strategija',
  imports: [RouterLink, DatePipe],
  templateUrl: './strategija.html',
  styleUrl: './strategija.css',
})
export default class StrategijaStrana {
  private readonly sb = inject(Supabase).client;
  protected readonly ws = inject(WorkspaceState);
  readonly brandId = input.required<string>();

  protected readonly dani = DANI;
  protected readonly boje = BOJE_STUBOVA;
  protected readonly strategije = signal<Red[]>([]);
  protected readonly poslovi = signal<Job[]>([]);
  protected readonly ucitano = signal(false);
  protected readonly napomena = signal('');
  protected readonly greska = signal('');
  protected readonly poruka = signal('');
  private kanal: RealtimeChannel | null = null;

  protected readonly predlog = computed(() => this.strategije().find((s) => s.status === 'predlog') ?? null);
  protected readonly aktivna = computed(() => this.strategije().find((s) => s.status === 'aktivna') ?? null);
  /** Prikazuje se novi predlog ako postoji, inače aktivna. */
  protected readonly prikaz = computed(() => this.predlog() ?? this.aktivna());
  protected readonly posaoStrategije = computed(() => stanjePosla(this.poslovi().find((j) => j.type === 'brand.strategy')));
  protected readonly posaoNedelje = computed(() => stanjePosla(this.poslovi().find((j) => j.type === 'drafts.week')));

  constructor() {
    effect(() => {
      const id = this.brandId();
      untracked(() => void this.start(id));
    });
    inject(DestroyRef).onDestroy(() => this.kanal && void this.sb.removeChannel(this.kanal));
  }

  private async start(id: string): Promise<void> {
    if (this.kanal) await this.sb.removeChannel(this.kanal);
    await this.ucitaj(id);
    const f = `brand_id=eq.${id}`;
    this.kanal = this.sb.channel(`strategija-${id}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'strategies', filter: f }, () => void this.ucitaj(id))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: f }, () => void this.ucitaj(id))
      .subscribe();
  }

  private async ucitaj(id: string): Promise<void> {
    const [s, j] = await Promise.all([
      this.sb.from('strategies').select('id, status, content, note, created_at, accepted_at').eq('brand_id', id).order('created_at', { ascending: false }).limit(10),
      this.sb.from('jobs').select('id, brand_id, type, status, result, error, attempts, created_at, finished_at')
        .eq('brand_id', id).in('type', ['brand.strategy', 'drafts.week']).order('created_at', { ascending: false }).limit(10),
    ]);
    this.strategije.set((s.data ?? []) as Red[]);
    this.poslovi.set((j.data ?? []) as Job[]);
    this.ucitano.set(true);
  }

  protected stub(s: Strategija, kljuc: string) {
    const i = s.stubovi.findIndex((x) => x.kljuc === kljuc);
    return { naziv: s.stubovi[i]?.naziv ?? kljuc, boja: BOJE_STUBOVA[i % BOJE_STUBOVA.length] };
  }

  protected terminiDana(s: Strategija, dan: string) {
    return s.raspored.filter((r) => r.dan === dan).sort((a, b) => a.vreme.localeCompare(b.vreme));
  }

  protected nazivKanala(id: string): string {
    return KONEKTORI.find((k) => k.id === id)?.naziv ?? id;
  }

  protected async napravi(): Promise<void> {
    this.greska.set('');
    const p = this.napomena().trim() ? { napomena: this.napomena().trim() } : {};
    const { error } = await this.sb.rpc('enqueue_job', { p_brand: this.brandId(), p_type: 'brand.strategy', p_payload: p });
    if (error) return this.greska.set(porukaGreske(error));
    this.napomena.set('');
    await this.ucitaj(this.brandId());
  }

  protected async prihvati(id: string): Promise<void> {
    this.greska.set('');
    const { error } = await this.sb.rpc('accept_strategy', { p_strategy: id });
    if (error) return this.greska.set(porukaGreske(error));
    this.poruka.set('Strategija je prihvaćena. Nacrti za sledeću nedelju prave se sami od četvrtka; možeš i odmah.');
    await this.ucitaj(this.brandId());
  }

  protected async nacrtiNedelje(): Promise<void> {
    this.greska.set('');
    const { error } = await this.sb.rpc('enqueue_job', { p_brand: this.brandId(), p_type: 'drafts.week', p_payload: {} });
    if (error) return this.greska.set(porukaGreske(error));
    this.poruka.set('Pravim nacrte za sledeću nedelju. Stižu u „Za pregled“ jedan po jedan.');
  }
}
