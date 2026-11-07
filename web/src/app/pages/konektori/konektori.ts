import { DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { KONEKTORI, NAZIV_GRUPE, type Grupa, type Konektor } from '../../../../../shared/konektori';
import { porukaGreske, Supabase } from '../../core/supabase';
import { WorkerApi } from '../../core/worker-api';
import { WorkspaceState } from '../../core/workspace';

interface Veza {
  id: string;
  provider: string;
  mode: 'auto' | 'rucno';
  status: 'povezano' | 'istice' | 'greska' | 'rucno';
  account_name: string | null;
  account_meta: Record<string, unknown>;
  token_expires_at: string | null;
  last_sync_at: string | null;
  last_error: string | null;
}

@Component({
  selector: 'app-konektori',
  imports: [DatePipe],
  templateUrl: './konektori.html',
  styleUrl: './konektori.css',
})
export default class Konektori {
  private readonly sb = inject(Supabase).client;
  private readonly api = inject(WorkerApi);
  protected readonly ws = inject(WorkspaceState);

  readonly brandId = input.required<string>();
  readonly povezano = input<string>();
  readonly greska = input<string>();

  protected readonly grupe = (['mreze', 'prodaja', 'analitika'] as Grupa[]).map((g) => ({
    kljuc: g, naziv: NAZIV_GRUPE[g], konektori: KONEKTORI.filter((k) => k.grupa === g),
  }));
  protected readonly veze = signal<Veza[]>([]);
  protected readonly izabran = signal<Konektor>(KONEKTORI[0]!);
  protected readonly podeseno = signal<Record<string, boolean>>({});
  protected readonly serverRadi = signal(true);
  protected readonly polja = signal<Record<string, string>>({});
  protected readonly imeRucno = signal('');
  protected readonly poruka = signal('');
  protected readonly greskaLok = signal('');
  protected readonly radi = signal(false);
  protected readonly filter = signal<'sve' | 'povezano'>('sve');
  private kanal: RealtimeChannel | null = null;

  protected readonly veza = computed(() => this.veze().find((v) => v.provider === this.izabran().id) ?? null);

  constructor() {
    effect(() => {
      const id = this.brandId();
      untracked(() => void this.start(id));
    });
    effect(() => {
      const p = this.povezano();
      if (p) untracked(() => {
        this.poruka.set(`Povezano: ${KONEKTORI.find((k) => k.id === p)?.naziv ?? p}. Uvlačimo objave i statistiku.`);
        const k = KONEKTORI.find((x) => x.id === p);
        if (k) this.izabran.set(k);
      });
    });
    void this.api.get<Record<string, boolean>>('/konektori/stanje').then((s) => this.podeseno.set(s)).catch(() => this.serverRadi.set(false));
    inject(DestroyRef).onDestroy(() => this.kanal && void this.sb.removeChannel(this.kanal));
  }

  private async start(id: string): Promise<void> {
    if (this.kanal) await this.sb.removeChannel(this.kanal);
    await this.ucitaj(id);
    this.kanal = this.sb
      .channel(`konektori-${id}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'connections', filter: `brand_id=eq.${id}` }, () => void this.ucitaj(id))
      .subscribe();
  }

  private async ucitaj(id: string): Promise<void> {
    const { data } = await this.sb.from('connections')
      .select('id, provider, mode, status, account_name, account_meta, token_expires_at, last_sync_at, last_error').eq('brand_id', id);
    this.veze.set((data ?? []) as Veza[]);
  }

  protected vezaZa(k: Konektor): Veza | undefined {
    return this.veze().find((v) => v.provider === k.id);
  }

  protected vidljivi(lista: Konektor[]): Konektor[] {
    return this.filter() === 'sve' ? lista : lista.filter((k) => this.vezaZa(k));
  }

  protected izaberi(k: Konektor): void {
    this.izabran.set(k);
    this.polja.set({});
    this.greskaLok.set('');
    this.poruka.set('');
    queueMicrotask(() => document.getElementById('uputstvo-naslov')?.focus());
  }

  protected oznaka(v: Veza | undefined): { tekst: string; klasa: string } {
    if (!v) return { tekst: 'Nije povezano', klasa: '' };
    switch (v.status) {
      case 'povezano': return { tekst: `Povezano${v.account_name ? ' · ' + v.account_name : ''}`, klasa: 'ok' };
      case 'istice': return { tekst: 'Pristup uskoro ističe', klasa: 'warn' };
      case 'greska': return { tekst: 'Veza je pukla', klasa: 'bad' };
      default: return { tekst: `Ručni režim${v.account_name ? ' · ' + v.account_name : ''}`, klasa: '' };
    }
  }

  protected async poveziOAuth(k: Konektor): Promise<void> {
    this.greskaLok.set('');
    const { data, error } = await this.sb.rpc('start_oauth', { p_brand: this.brandId(), p_provider: k.id, p_return_to: `/b/${this.brandId()}/konektori` });
    if (error) return this.greskaLok.set(porukaGreske(error));
    location.href = this.api.url(`/oauth/${k.id}/start?state=${encodeURIComponent(String(data))}`);
  }

  protected async poveziTokenom(e: Event, k: Konektor): Promise<void> {
    e.preventDefault();
    this.greskaLok.set('');
    this.poruka.set('');
    const nedostaje = (k.tokenPolja ?? []).filter((p) => !this.polja()[p.kljuc]?.trim());
    if (nedostaje.length) return this.greskaLok.set(`Popuni: ${nedostaje.map((p) => p.naziv).join(', ')}.`);
    this.radi.set(true);
    try {
      const r = await this.api.post<{ account_name: string }>('/veze/token', { brand_id: this.brandId(), provider: k.id, polja: this.polja() });
      this.poruka.set(`Povezano: ${r.account_name}.`);
      this.polja.set({});
      await this.ucitaj(this.brandId());
    } catch (err) {
      this.greskaLok.set(porukaGreske(err));
    } finally {
      this.radi.set(false);
    }
  }

  protected async rucno(k: Konektor): Promise<void> {
    this.greskaLok.set('');
    const { error } = await this.sb.rpc('set_manual_channel', { p_brand: this.brandId(), p_provider: k.id, p_account_name: this.imeRucno() });
    if (error) return this.greskaLok.set(porukaGreske(error));
    this.poruka.set(`${k.naziv}: ručni režim. Alat pripremi objavu i podseti te u zakazano vreme.`);
    this.imeRucno.set('');
    await this.ucitaj(this.brandId());
  }

  protected async prekini(v: Veza, k: Konektor): Promise<void> {
    if (!confirm(`Prekinuti vezu sa kanalom ${k.naziv}? Uvezena statistika se briše.`)) return;
    const { error } = await this.sb.from('connections').delete().eq('id', v.id);
    if (error) return this.greskaLok.set(porukaGreske(error));
    this.poruka.set(`Veza sa kanalom ${k.naziv} je prekinuta.`);
    await this.ucitaj(this.brandId());
  }

  protected async osvezi(v: Veza): Promise<void> {
    const { error } = await this.sb.rpc('enqueue_job', { p_brand: this.brandId(), p_type: 'channel.sync', p_payload: { connection_id: v.id } });
    if (error) return this.greskaLok.set(porukaGreske(error));
    this.poruka.set('Osvežavanje je pokrenuto. Traje do par minuta.');
  }

  protected postaviPolje(k: string, v: string): void {
    this.polja.update((p) => ({ ...p, [k]: v }));
  }

  protected brojDana(iso: string | null): number | null {
    return iso ? Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000) : null;
  }
}
