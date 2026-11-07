import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { stanjeGrupe, UPITNIK, type Odgovori, type Odgovor } from '../../../../shared/upitnik';
import type { Job } from './models';
import { Supabase } from './supabase';

export interface Predlog {
  vrednost: Odgovor;
  razlog?: string;
  izvor?: string;
  vrsta_izvora?: string;
}

export interface Sazetak {
  opis_sa_sajta?: string;
  jedna_recenica?: string;
  publika?: string;
  problem_i_resenje?: string;
  pozicioniranje?: string;
  ton?: { opis: string; pravila: string[] };
  kljucne_poruke?: string[];
  zabrane?: string[];
  ciljevi?: string[];
  otvorena_pitanja?: string[];
}

export interface BrandProfile {
  brand_id: string;
  answers: Odgovori;
  suggestions: Record<string, Predlog>;
  skipped_groups: string[];
  summary: Sazetak | null;
  summary_status: 'nema' | 'predlog' | 'potvrdjen';
  version: number;
  updated_at: string;
}

export interface Fact {
  id: string;
  text: string;
  category: string;
  source_kind: 'sajt' | 'konkurent' | 'korisnik' | 'razgovor';
  source_url: string | null;
  status: 'predlog' | 'potvrdjeno' | 'odbaceno';
}

export interface Competitor {
  id: string;
  url: string;
  name: string | null;
  analysis: {
    naziv: string; opis: string; ponuda: string; publika: string; ton: string; cene: string;
    jake_strane: string[]; razlike: string[];
  } | null;
  analyzed_at: string | null;
}

export interface Question {
  id: string;
  question: string;
  why: string | null;
  options: string[];
  field_key: string | null;
  answer: string | null;
  status: 'otvoreno' | 'odgovoreno' | 'preskoceno';
  position: number;
}

export type Korak = { kljuc: string; naziv: string; gotovo: boolean; link: string[]; opis: string };

/**
 * Sve podatke onboardinga za jedan brend drži na jednom mestu i osvežava ih uživo (Supabase Realtime).
 * Pravi se po komponenti: providers: [BrandOnboarding].
 */
@Injectable()
export class BrandOnboarding {
  private readonly sb = inject(Supabase).client;
  private kanal: RealtimeChannel | null = null;
  private brandId: string | null = null;

  readonly profile = signal<BrandProfile | null>(null);
  readonly facts = signal<Fact[]>([]);
  readonly competitors = signal<Competitor[]>([]);
  readonly questions = signal<Question[]>([]);
  readonly jobs = signal<Job[]>([]);
  readonly loaded = signal(false);

  /** Poslednji posao svakog tipa (i za konkurente po competitor_id). */
  readonly lastJob = computed(() => {
    const m = new Map<string, Job>();
    for (const j of this.jobs()) {
      const k = j.type === 'brand.competitor' ? `${j.type}:${String(j.payload?.['competitor_id'])}` : j.type;
      if (!m.has(k)) m.set(k, j);
    }
    return m;
  });

  readonly koraci = computed<Korak[]>(() => {
    const p = this.profile();
    const odg = p?.answers ?? {};
    const preskocene = new Set(p?.skipped_groups ?? []);
    const grupeGotove = UPITNIK.every((g) => {
      if (preskocene.has(g.kljuc)) return true;
      const s = stanjeGrupe(g, odg);
      return s.popunjeno === s.ukupno && (g.kljuc !== 'konkurencija' || this.competitors().length > 0);
    });
    const istrazivanje = this.lastJob().get('brand.research');
    const id = this.brandId ?? '';
    return [
      { kljuc: 'sajt', naziv: 'Agent je pročitao sajt', gotovo: istrazivanje?.status === 'done', link: ['/b', id, 'upitnik'],
        opis: 'Činjenice i predlozi odgovora sa sajta brenda.' },
      { kljuc: 'upitnik', naziv: 'Upitnik o poslovanju', gotovo: grupeGotove, link: ['/b', id, 'upitnik'],
        opis: 'Sve obavezne grupe popunjene ili namerno preskočene.' },
      { kljuc: 'cinjenice', naziv: 'Činjenice pregledane', gotovo: this.facts().length > 0 && !this.facts().some((f) => f.status === 'predlog'),
        link: ['/b', id, 'profil'], opis: 'Svaka činjenica sa sajta potvrđena ili odbačena.' },
      { kljuc: 'razgovor', naziv: 'Razgovor sa agentom', gotovo: this.questions().length > 0 && !this.questions().some((q) => q.status === 'otvoreno'),
        link: ['/b', id, 'razgovor'], opis: 'Odgovori na pitanja koja agent nije mogao sam da zaključi.' },
      { kljuc: 'profil', naziv: 'Brend profil potvrđen', gotovo: p?.summary_status === 'potvrdjen', link: ['/b', id, 'profil'],
        opis: 'Sažetak koji čitaju svi agenti: publika, ton, poruke, zabrane.' },
    ];
  });

  readonly procenat = computed(() => {
    const k = this.koraci();
    return Math.round((k.filter((x) => x.gotovo).length / k.length) * 100);
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.ugasiKanal());
  }

  async start(brandId: string): Promise<void> {
    if (this.brandId === brandId && this.kanal) return;
    this.ugasiKanal();
    this.brandId = brandId;
    this.loaded.set(false);
    await this.reload();
    this.loaded.set(true);
    const f = `brand_id=eq.${brandId}`;
    this.kanal = this.sb
      .channel(`onboarding-${brandId}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'brand_profiles', filter: f }, () => void this.ucitajProfil())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'brand_facts', filter: f }, () => void this.ucitajCinjenice())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'competitors', filter: f }, () => void this.ucitajKonkurente())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'brand_questions', filter: f }, () => void this.ucitajPitanja())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: f }, () => void this.ucitajPoslove())
      .subscribe();
  }

  private ugasiKanal(): void {
    if (this.kanal) void this.sb.removeChannel(this.kanal);
    this.kanal = null;
  }

  async reload(): Promise<void> {
    await Promise.all([this.ucitajProfil(), this.ucitajCinjenice(), this.ucitajKonkurente(), this.ucitajPitanja(), this.ucitajPoslove()]);
  }

  private async ucitajProfil(): Promise<void> {
    const { data } = await this.sb.from('brand_profiles').select('*').eq('brand_id', this.brandId).maybeSingle();
    this.profile.set((data as BrandProfile | null) ?? null);
  }
  private async ucitajCinjenice(): Promise<void> {
    const { data } = await this.sb.from('brand_facts').select('id, text, category, source_kind, source_url, status')
      .eq('brand_id', this.brandId).order('created_at');
    this.facts.set((data ?? []) as Fact[]);
  }
  private async ucitajKonkurente(): Promise<void> {
    const { data } = await this.sb.from('competitors').select('id, url, name, analysis, analyzed_at').eq('brand_id', this.brandId).order('created_at');
    this.competitors.set((data ?? []) as Competitor[]);
  }
  private async ucitajPitanja(): Promise<void> {
    const { data } = await this.sb.from('brand_questions').select('id, question, why, options, field_key, answer, status, position')
      .eq('brand_id', this.brandId).order('position');
    this.questions.set((data ?? []) as Question[]);
  }
  private async ucitajPoslove(): Promise<void> {
    const { data } = await this.sb.from('jobs').select('id, brand_id, type, status, result, error, attempts, created_at, finished_at, payload')
      .eq('brand_id', this.brandId).like('type', 'brand.%').order('created_at', { ascending: false }).limit(40);
    this.jobs.set((data ?? []) as Job[]);
  }

  // ───── izmene ─────

  async sacuvajOdgovore(answers: Odgovori): Promise<void> {
    const { error } = await this.sb.from('brand_profiles').update({ answers }).eq('brand_id', this.brandId);
    if (error) throw error;
    this.profile.update((p) => (p ? { ...p, answers } : p));
  }

  async postaviPreskocene(skipped: string[]): Promise<void> {
    const { error } = await this.sb.from('brand_profiles').update({ skipped_groups: skipped }).eq('brand_id', this.brandId);
    if (error) throw error;
    this.profile.update((p) => (p ? { ...p, skipped_groups: skipped } : p));
  }

  async pokreni(tip: string, payload: Record<string, unknown> = {}): Promise<void> {
    const { error } = await this.sb.rpc('enqueue_job', { p_brand: this.brandId, p_type: tip, p_payload: payload });
    if (error) throw error;
    await this.ucitajPoslove();
  }

  async dodajKonkurenta(url: string, userId: string): Promise<void> {
    const { data, error } = await this.sb.from('competitors').insert({ brand_id: this.brandId, url, created_by: userId }).select('id').single();
    if (error) throw error;
    await this.ucitajKonkurente();
    await this.pokreni('brand.competitor', { competitor_id: data.id });
  }

  async ukloniKonkurenta(id: string): Promise<void> {
    const { error } = await this.sb.from('competitors').delete().eq('id', id);
    if (error) throw error;
    await this.ucitajKonkurente();
  }

  async oceniCinjenicu(id: string, status: Fact['status'], userId: string): Promise<void> {
    const { error } = await this.sb.from('brand_facts')
      .update({ status, reviewed_by: userId, reviewed_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    this.facts.update((l) => l.map((f) => (f.id === id ? { ...f, status } : f)));
  }

  async dodajCinjenicu(text: string): Promise<void> {
    const { error } = await this.sb.from('brand_facts')
      .insert({ brand_id: this.brandId, text, category: 'ostalo', source_kind: 'korisnik', status: 'potvrdjeno' });
    if (error) throw error;
    await this.ucitajCinjenice();
  }

  async odgovori(q: Question, answer: string | null, userId: string): Promise<void> {
    const status = answer === null ? 'preskoceno' : 'odgovoreno';
    const { error } = await this.sb.from('brand_questions')
      .update({ answer, status, answered_by: userId, answered_at: new Date().toISOString() }).eq('id', q.id);
    if (error) throw error;
    this.questions.update((l) => l.map((x) => (x.id === q.id ? { ...x, answer, status } : x)));
  }

  async sacuvajSazetak(summary: Sazetak, status: BrandProfile['summary_status']): Promise<void> {
    const { error } = await this.sb.from('brand_profiles').update({ summary, summary_status: status }).eq('brand_id', this.brandId);
    if (error) throw error;
    this.profile.update((p) => (p ? { ...p, summary, summary_status: status } : p));
  }
}

/** Kratak opis stanja posla za prikaz. */
export function stanjePosla(j: Job | undefined): { tekst: string; klasa: string; radi: boolean } {
  if (!j) return { tekst: 'nije pokrenuto', klasa: '', radi: false };
  switch (j.status) {
    case 'queued': return { tekst: 'čeka u redu', klasa: 'ac', radi: true };
    case 'running': return { tekst: 'radi…', klasa: 'ac', radi: true };
    case 'done': return { tekst: 'gotovo', klasa: 'ok', radi: false };
    case 'failed': return { tekst: 'nije uspelo', klasa: 'bad', radi: false };
    default: return { tekst: j.status, klasa: '', radi: false };
  }
}
