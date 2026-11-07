import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { Supabase } from './supabase';

export type StatusNacrta = 'pravi_se' | 'za_pregled' | 'popravlja_se' | 'odobren' | 'zakazan' | 'objavljuje_se' | 'objavljen' | 'greska' | 'odbijen';

export interface Varijanta {
  draft_id: string;
  channel: string;
  caption: string;
  hashtags: string[];
  media: { url: string; path: string }[];
}

export interface Objava {
  id: string;
  draft_id: string;
  channel: string;
  mode: 'auto' | 'rucno';
  status: 'objavljuje_se' | 'ceka_rucno' | 'objavljeno' | 'greska';
  permalink: string | null;
  error: string | null;
  published_at: string | null;
}

export interface Nacrt {
  id: string;
  brand_id: string;
  status: StatusNacrta;
  format: 'slika' | 'karusel' | 'tekst';
  pillar: string | null;
  topic: string | null;
  channels: string[];
  scheduled_at: string | null;
  slides: { naslov: string; tekst: string }[];
  check_result: { prosao: boolean; stavke: { ok: boolean; tekst: string }[] } | null;
  experiment_key: string | null;
  experiment_variant: string | null;
  campaign_id: string | null;
  error: string | null;
  revision_note: string | null;
  created_at: string;
  draft_variants: Varijanta[];
  publications: Objava[];
}

export const STATUS_NACRTA: Record<StatusNacrta, { tekst: string; klasa: string }> = {
  pravi_se: { tekst: 'Pravi se…', klasa: 'ac' },
  za_pregled: { tekst: 'Za pregled', klasa: 'warn' },
  popravlja_se: { tekst: 'Popravlja se…', klasa: 'ac' },
  odobren: { tekst: 'Odobren', klasa: 'ok' },
  zakazan: { tekst: 'Zakazan', klasa: 'ok' },
  objavljuje_se: { tekst: 'Objavljuje se', klasa: 'ac' },
  objavljen: { tekst: 'Objavljen', klasa: 'ok' },
  greska: { tekst: 'Greška', klasa: 'bad' },
  odbijen: { tekst: 'Odbijen', klasa: '' },
};

/** Nacrti brenda (ili svih brendova radnog prostora) sa tekstovima i objavama, osveženi uživo. */
@Injectable()
export class NacrtiStore {
  private readonly sb = inject(Supabase).client;
  private kanal: RealtimeChannel | null = null;
  private filter: { brandIds: string[]; od?: string; do?: string } = { brandIds: [] };
  private tajmer: ReturnType<typeof setTimeout> | null = null;

  readonly nacrti = signal<Nacrt[]>([]);
  readonly ucitano = signal(false);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.ugasi());
  }

  async start(brandIds: string[], od?: string, doDatum?: string): Promise<void> {
    this.filter = { brandIds, od, do: doDatum };
    await this.ucitaj();
    if (this.kanal) return;
    const osvezi = () => {
      // više promena odjednom (worker upisuje nacrt pa varijante) → jedno učitavanje
      if (this.tajmer) clearTimeout(this.tajmer);
      this.tajmer = setTimeout(() => void this.ucitaj(), 300);
    };
    this.kanal = this.sb.channel(`nacrti-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'drafts' }, osvezi)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'draft_variants' }, osvezi)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'publications' }, osvezi)
      .subscribe();
  }

  async ucitaj(): Promise<void> {
    if (!this.filter.brandIds.length) {
      this.nacrti.set([]);
      this.ucitano.set(true);
      return;
    }
    let q = this.sb.from('drafts')
      .select('*, draft_variants(draft_id, channel, caption, hashtags, media), publications(id, draft_id, channel, mode, status, permalink, error, published_at)')
      .in('brand_id', this.filter.brandIds);
    if (this.filter.od) q = q.gte('scheduled_at', this.filter.od);
    if (this.filter.do) q = q.lt('scheduled_at', this.filter.do);
    const { data } = await q.order('scheduled_at', { ascending: true, nullsFirst: false }).limit(300);
    this.nacrti.set((data ?? []) as Nacrt[]);
    this.ucitano.set(true);
  }

  private ugasi(): void {
    if (this.kanal) void this.sb.removeChannel(this.kanal);
    this.kanal = null;
  }

  async radnja(id: string, akcija: string, opts: { razlog?: string; komentar?: string; vreme?: string | null } = {}): Promise<string> {
    const { data, error } = await this.sb.rpc('review_draft', {
      p_draft: id, p_action: akcija, p_reason: opts.razlog ?? null, p_comment: opts.komentar ?? null, p_scheduled_at: opts.vreme ?? null,
    });
    if (error) throw error;
    await this.ucitaj();
    return data as string;
  }

  async izmeniTekst(id: string, kanal: string, tekst: string, hashtagovi: string[]): Promise<void> {
    const { error } = await this.sb.rpc('edit_variant', { p_draft: id, p_channel: kanal, p_caption: tekst, p_hashtags: hashtagovi });
    if (error) throw error;
    await this.ucitaj();
  }

  async objavljenoRucno(pubId: string, link: string | null): Promise<void> {
    const { error } = await this.sb.rpc('mark_manual_published', { p_publication: pubId, p_permalink: link });
    if (error) throw error;
    await this.ucitaj();
  }
}
