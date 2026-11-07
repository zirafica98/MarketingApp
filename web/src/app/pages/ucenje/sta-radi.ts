import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { Job } from '../../core/models';
import { stanjePosla } from '../../core/onboarding';
import { porukaGreske, Supabase } from '../../core/supabase';
import { WorkspaceState } from '../../core/workspace';
import type { Strategija } from '../strategija/strategija';

interface Pravilo {
  id: string;
  key: string;
  statement: string;
  evidence: string | null;
  confidence: 'sigurno' | 'proverava_se' | 'odbaceno' | 'odluka';
  source: 'analitika' | 'odluka' | 'korisnik';
  status: 'aktivno' | 'obrisano';
  locked: boolean;
  updated_at: string;
}

interface Izvestaj {
  id: string;
  period_start: string;
  period_end: string;
  strategy_proposed: boolean;
  created_at: string;
  content: { radilo: string[]; nije: string[]; predlog: string; eksperimenti: { kljuc: string; zakljucak: string }[]; objava_7_dana: number };
}

const SIGURNOST: Record<Pravilo['confidence'], { tekst: string; klasa: string }> = {
  sigurno: { tekst: 'sigurno', klasa: 'ok' },
  proverava_se: { tekst: 'proverava se', klasa: 'warn' },
  odbaceno: { tekst: 'odbačeno', klasa: 'bad' },
  odluka: { tekst: 'tvoja odluka', klasa: 'ac' },
};

type Filter = 'sve' | 'sigurno' | 'proverava_se' | 'odluke' | 'obrisano';

@Component({
  selector: 'app-sta-radi',
  imports: [DatePipe, DecimalPipe, RouterLink],
  templateUrl: './sta-radi.html',
  styleUrl: './sta-radi.css',
})
export default class StaRadi {
  private readonly sb = inject(Supabase).client;
  protected readonly ws = inject(WorkspaceState);
  readonly brandId = input.required<string>();

  protected readonly sigurnost = SIGURNOST;
  protected readonly pravila = signal<Pravilo[]>([]);
  protected readonly izvestaji = signal<Izvestaj[]>([]);
  protected readonly strategija = signal<Strategija | null>(null);
  protected readonly predlogStrategije = signal(false);
  protected readonly eksp = signal<Record<string, { varijanta: string; n: number; doseg: number; cuvanja: number }[]>>({});
  protected readonly posao = signal<Job | null>(null);
  protected readonly filter = signal<Filter>('sve');
  protected readonly izmena = signal<{ id: string; tekst: string } | null>(null);
  protected readonly novo = signal('');
  protected readonly greska = signal('');
  protected readonly poruka = signal('');
  private kanal: RealtimeChannel | null = null;

  protected readonly stanje = computed(() => stanjePosla(this.posao() ?? undefined));
  protected readonly izvestaj = computed<Izvestaj | null>(() => this.izvestaji()[0] ?? null);
  protected readonly zakljucci = computed(() => this.izvestaji()[0]?.content.eksperimenti ?? []);
  protected readonly vidljiva = computed(() => {
    const f = this.filter();
    return this.pravila().filter((p) => {
      if (f === 'obrisano') return p.status === 'obrisano';
      if (p.status === 'obrisano') return false;
      if (f === 'sigurno') return p.confidence === 'sigurno';
      if (f === 'proverava_se') return p.confidence === 'proverava_se';
      if (f === 'odluke') return p.source !== 'analitika';
      return true;
    });
  });
  protected readonly broj = computed(() => ({
    sve: this.pravila().filter((p) => p.status === 'aktivno').length,
    sigurno: this.pravila().filter((p) => p.status === 'aktivno' && p.confidence === 'sigurno').length,
  }));

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
    this.kanal = this.sb.channel(`ucenje-${id}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'brand_playbook_rules', filter: f }, () => void this.ucitaj(id))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'learning_reports', filter: f }, () => void this.ucitaj(id))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: f }, () => void this.ucitaj(id))
      .subscribe();
  }

  private async ucitaj(id: string): Promise<void> {
    const [p, r, s, j, posts] = await Promise.all([
      this.sb.from('brand_playbook_rules').select('*').eq('brand_id', id).order('locked', { ascending: false }).order('updated_at', { ascending: false }),
      this.sb.from('learning_reports').select('*').eq('brand_id', id).order('created_at', { ascending: false }).limit(5),
      this.sb.from('strategies').select('status, content').eq('brand_id', id).in('status', ['aktivna', 'predlog']),
      this.sb.from('jobs').select('id, brand_id, type, status, result, error, attempts, created_at, finished_at').eq('brand_id', id).eq('type', 'brand.learn')
        .order('created_at', { ascending: false }).limit(1),
      this.sb.from('channel_posts').select('tags, post_metrics(day, reach, saves)').eq('brand_id', id).not('tags->>eksperiment', 'is', null),
    ]);
    this.pravila.set((p.data ?? []) as Pravilo[]);
    this.izvestaji.set((r.data ?? []) as Izvestaj[]);
    const strat = (s.data ?? []) as { status: string; content: Strategija }[];
    this.strategija.set(strat.find((x) => x.status === 'aktivna')?.content ?? null);
    this.predlogStrategije.set(strat.some((x) => x.status === 'predlog'));
    this.posao.set(((j.data ?? []) as Job[])[0] ?? null);
    // A/B uživo (zbir po varijanti, poslednji snimak)
    const m: Record<string, Record<string, { n: number; doseg: number; cuvanja: number }>> = {};
    for (const o of (posts.data ?? []) as { tags: Record<string, string>; post_metrics: { day: string; reach: number | null; saves: number | null }[] }[]) {
      const z = [...o.post_metrics].sort((a, b) => b.day.localeCompare(a.day))[0];
      const e = (m[o.tags['eksperiment']!] ??= {});
      const v = (e[o.tags['varijanta'] ?? '?'] ??= { n: 0, doseg: 0, cuvanja: 0 });
      v.n++;
      v.doseg += z?.reach ?? 0;
      v.cuvanja += z?.saves ?? 0;
    }
    this.eksp.set(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Object.entries(v).map(([varijanta, x]) => ({ varijanta, ...x }))])));
  }

  protected async akcija(p: Pravilo, a: string, tekst?: string): Promise<void> {
    this.greska.set('');
    const { error } = await this.sb.rpc('rule_action', { p_rule: p.id, p_action: a, p_statement: tekst ?? null });
    if (error) return this.greska.set(porukaGreske(error));
    this.izmena.set(null);
    await this.ucitaj(this.brandId());
  }

  protected async dodaj(e: Event): Promise<void> {
    e.preventDefault();
    this.greska.set('');
    const { error } = await this.sb.rpc('rule_add', { p_brand: this.brandId(), p_statement: this.novo() });
    if (error) return this.greska.set(porukaGreske(error));
    this.novo.set('');
    await this.ucitaj(this.brandId());
  }

  protected async uci(): Promise<void> {
    this.greska.set('');
    const { error } = await this.sb.rpc('enqueue_job', { p_brand: this.brandId(), p_type: 'brand.learn', p_payload: {} });
    if (error) return this.greska.set(porukaGreske(error));
    this.poruka.set('Učitelj analizira brojke i tvoje odluke (1–2 minuta)…');
    await this.ucitaj(this.brandId());
  }

  protected maxDoseg(redovi: { n: number; doseg: number }[]): number {
    return Math.max(1, ...redovi.map((r) => r.doseg / r.n));
  }
}
