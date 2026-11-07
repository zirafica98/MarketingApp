import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { KONEKTORI } from '../../../../../shared/konektori';
import { STATUS_NACRTA, type StatusNacrta } from '../../core/nacrti';
import { porukaGreske, Supabase } from '../../core/supabase';
import { WorkspaceState } from '../../core/workspace';

interface Kampanja {
  id: string;
  name: string;
  goal: string;
  starts_on: string;
  ends_on: string;
  channels: string[];
  product_ids: string[];
  notes: string | null;
  status: 'planira_se' | 'spremna' | 'greska';
  error: string | null;
  drafts: { id: string; status: StatusNacrta; topic: string | null; scheduled_at: string | null }[];
}

interface Proizvod {
  id: string;
  name: string;
  price: number | null;
  currency: string | null;
  image_url: string | null;
  url: string | null;
  in_stock: boolean | null;
}

const CILJEVI = ['Prodaja (akcija ili popust)', 'Lansiranje novog proizvoda', 'Praznik ili sezona', 'Više registracija', 'Događaj ili otvaranje', 'Prepoznatljivost brenda'];

@Component({
  selector: 'app-kampanje',
  imports: [DatePipe, DecimalPipe, RouterLink],
  templateUrl: './kampanje.html',
  styleUrl: './kampanje.css',
})
export default class Kampanje {
  private readonly sb = inject(Supabase).client;
  protected readonly ws = inject(WorkspaceState);
  readonly brandId = input.required<string>();

  protected readonly ciljevi = CILJEVI;
  protected readonly statusi = STATUS_NACRTA;
  protected readonly kampanje = signal<Kampanja[]>([]);
  protected readonly proizvodi = signal<Proizvod[]>([]);
  protected readonly kanaliBrenda = signal<string[]>([]);
  protected readonly forma = signal(false);
  protected readonly greska = signal('');
  protected readonly poruka = signal('');
  protected readonly radi = signal(false);
  protected readonly f = signal({ ime: '', cilj: CILJEVI[0]!, od: '', do: '', kanali: [] as string[], proizvodi: [] as string[], napomena: '', broj: 6 });
  private kanal: RealtimeChannel | null = null;

  protected readonly danas = new Date().toISOString().slice(0, 10);
  protected readonly mogucaKanali = computed(() => {
    const mreze = KONEKTORI.filter((k) => k.grupa === 'mreze').map((k) => k.id);
    const l = this.kanaliBrenda().filter((k) => mreze.includes(k));
    return l.length ? l : ['instagram'];
  });

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
    this.kanal = this.sb.channel(`kampanje-${id}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'campaigns', filter: f }, () => void this.ucitaj(id))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'drafts', filter: f }, () => void this.ucitaj(id))
      .subscribe();
  }

  private async ucitaj(id: string): Promise<void> {
    const [k, p, c] = await Promise.all([
      this.sb.from('campaigns').select('*, drafts(id, status, topic, scheduled_at)').eq('brand_id', id).order('starts_on', { ascending: false }),
      this.sb.from('products').select('id, name, price, currency, image_url, url, in_stock').eq('brand_id', id).order('name').limit(500),
      this.sb.from('connections').select('provider').eq('brand_id', id),
    ]);
    this.kampanje.set(((k.data ?? []) as Kampanja[]).map((x) => ({ ...x, drafts: [...x.drafts].sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? '')) })));
    this.proizvodi.set((p.data ?? []) as Proizvod[]);
    this.kanaliBrenda.set((c.data ?? []).map((x) => x.provider as string));
  }

  protected otvoriFormu(): void {
    const sutra = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const kraj = new Date(Date.now() + 8 * 86_400_000).toISOString().slice(0, 10);
    this.f.set({ ime: '', cilj: CILJEVI[0]!, od: sutra, do: kraj, kanali: [...this.mogucaKanali()], proizvodi: [], napomena: '', broj: 6 });
    this.forma.set(true);
    queueMicrotask(() => document.getElementById('k-ime')?.focus());
  }

  protected postavi<K extends keyof ReturnType<typeof this.f>>(k: K, v: ReturnType<typeof this.f>[K]): void {
    this.f.update((x) => ({ ...x, [k]: v }));
  }

  protected prebaci(lista: 'kanali' | 'proizvodi', id: string, on: boolean): void {
    this.f.update((x) => ({ ...x, [lista]: on ? [...new Set([...x[lista], id])] : x[lista].filter((y) => y !== id) }));
  }

  protected async napravi(e: Event): Promise<void> {
    e.preventDefault();
    const x = this.f();
    this.greska.set('');
    if (x.ime.trim().length < 2) return this.greska.set('Upiši naziv kampanje.');
    if (!x.kanali.length) return this.greska.set('Izaberi bar jedan kanal.');
    this.radi.set(true);
    const { error } = await this.sb.rpc('create_campaign', {
      p_brand: this.brandId(), p_name: x.ime, p_goal: x.cilj, p_starts: x.od, p_ends: x.do, p_channels: x.kanali,
      p_products: x.proizvodi, p_notes: x.napomena || null, p_posts: x.broj,
    });
    this.radi.set(false);
    if (error) return this.greska.set(porukaGreske(error));
    this.forma.set(false);
    this.poruka.set('Kampanja je napravljena. Strateg pravi plan, a nacrti stižu u „Za pregled“.');
    await this.ucitaj(this.brandId());
  }

  protected async obrisi(k: Kampanja): Promise<void> {
    if (!confirm(`Obrisati kampanju „${k.name}“? Nacrti ostaju, ali bez oznake kampanje.`)) return;
    const { error } = await this.sb.from('campaigns').delete().eq('id', k.id);
    if (error) this.greska.set(porukaGreske(error));
    await this.ucitaj(this.brandId());
  }

  protected nazivKanala(id: string): string {
    return KONEKTORI.find((k) => k.id === id)?.naziv ?? id;
  }
  protected nazivProizvoda(id: string): string {
    return this.proizvodi().find((p) => p.id === id)?.name ?? '';
  }
}
