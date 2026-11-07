import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { deoDana, poGrupi, sazetak, type ObjavaBrojke } from '../../../../../shared/statistika';
import { Supabase } from '../../core/supabase';
import { WorkspaceState } from '../../core/workspace';

interface Objava extends ObjavaBrojke {
  provider: string;
  permalink: string | null;
  caption: string | null;
  thumbnail_url: string | null;
}

interface RedNaloga {
  day: string;
  followers: number | null;
}

const NAZIV_FORMATA: Record<string, string> = { slika: 'Slika', karusel: 'Karusel', reel: 'Reel', prica: 'Priča', tekst: 'Tekst', video: 'Video' };

@Component({
  selector: 'app-analitika',
  imports: [RouterLink, DatePipe, DecimalPipe],
  templateUrl: './analitika.html',
  styleUrl: './analitika.css',
})
export default class Analitika {
  private readonly sb = inject(Supabase).client;
  protected readonly ws = inject(WorkspaceState);
  readonly brandId = input.required<string>();

  protected readonly dani = signal<7 | 28 | 90>(28);
  protected readonly kanal = signal<string>('sve');
  protected readonly sortiraj = signal<'datum' | 'doseg' | 'cuvanja'>('datum');
  protected readonly ucitano = signal(false);
  protected readonly sve = signal<Objava[]>([]);
  protected readonly nalog = signal<RedNaloga[]>([]);
  protected readonly kanali = signal<string[]>([]);
  protected readonly nazivFormata = NAZIV_FORMATA;

  private readonly odDatum = computed(() => Date.now() - this.dani() * 86_400_000);
  private readonly filtrirane = computed(() => this.sve().filter((o) => this.kanal() === 'sve' || o.provider === this.kanal()));
  protected readonly objave = computed(() => this.filtrirane().filter((o) => o.published_at && new Date(o.published_at).getTime() >= this.odDatum()));
  private readonly prethodne = computed(() =>
    this.filtrirane().filter((o) => {
      const t = o.published_at ? new Date(o.published_at).getTime() : 0;
      return t < this.odDatum() && t >= this.odDatum() - this.dani() * 86_400_000;
    }),
  );
  protected readonly s = computed(() => sazetak(this.objave()));
  protected readonly sPre = computed(() => sazetak(this.prethodne()));

  protected readonly pratioci = computed(() => {
    const r = this.nalog();
    if (!r.length) return null;
    const sada = r.at(-1)!.followers ?? 0;
    const od = new Date(this.odDatum()).toISOString().slice(0, 10);
    const pocetak = r.find((x) => x.day >= od)?.followers ?? r[0]!.followers ?? sada;
    return { sada, promena: sada - pocetak };
  });

  /** Podloga za učenje: poređenja unutar brenda (svih objava iz perioda). */
  protected readonly poFormatu = computed(() => poGrupi(this.objave(), (o) => o.format));
  protected readonly poStubu = computed(() => poGrupi(this.objave(), (o) => (o.tags['stub'] as string) ?? null));
  protected readonly poVremenu = computed(() => poGrupi(this.objave(), (o) => deoDana(o.tags['sat'])));
  protected readonly maxOdnos = computed(() => Math.max(1, ...this.poFormatu().map((g) => g.odnosCuvanja), ...this.poFormatu().map((g) => g.odnosDosega)));

  protected readonly tabela = computed(() => {
    const prosek = this.s().prosekDosega || 1;
    const l = this.objave().map((o) => ({ ...o, odnos: (o.reach ?? 0) / prosek }));
    const k = this.sortiraj();
    return l.sort((a, b) =>
      k === 'doseg' ? (b.reach ?? 0) - (a.reach ?? 0)
        : k === 'cuvanja' ? (b.saves ?? 0) - (a.saves ?? 0)
        : (b.published_at ?? '').localeCompare(a.published_at ?? ''),
    );
  });

  /** Doseg po danu objave (zbir), za grafik. */
  protected readonly graf = computed(() => {
    const dani = this.dani();
    const pocetak = new Date(this.odDatum());
    const kofe = Array.from({ length: dani }, (_, i) => {
      const d = new Date(pocetak.getTime() + (i + 1) * 86_400_000);
      return { dan: d.toISOString().slice(0, 10), doseg: 0 };
    });
    const idx = new Map(kofe.map((k, i) => [k.dan, i]));
    for (const o of this.objave()) {
      const i = idx.get(o.published_at!.slice(0, 10));
      if (i !== undefined) kofe[i]!.doseg += o.reach ?? 0;
    }
    const max = Math.max(1, ...kofe.map((k) => k.doseg));
    const w = 600, h = 150;
    const tacke = kofe.map((k, i) => `${((i / Math.max(1, kofe.length - 1)) * w).toFixed(1)},${(h - (k.doseg / max) * (h - 10)).toFixed(1)}`);
    return { tacke: tacke.join(' '), max, kofe };
  });

  constructor() {
    effect(() => {
      const id = this.brandId();
      untracked(() => void this.ucitaj(id));
    });
  }

  private async ucitaj(id: string): Promise<void> {
    this.ucitano.set(false);
    const od = new Date(Date.now() - 180 * 86_400_000).toISOString();
    const [p, n] = await Promise.all([
      this.sb.from('channel_posts')
        .select('id, provider, format, published_at, tags, permalink, caption, thumbnail_url, post_metrics(day, reach, views, likes, comments, saves, shares)')
        .eq('brand_id', id).gte('published_at', od).order('published_at', { ascending: false }).limit(500),
      this.sb.from('account_metrics').select('day, followers').eq('brand_id', id).order('day'),
    ]);
    type Red = Omit<Objava, 'reach' | 'views' | 'likes' | 'comments' | 'saves' | 'shares'> & {
      post_metrics: { day: string; reach: number | null; views: number | null; likes: number | null; comments: number | null; saves: number | null; shares: number | null }[];
    };
    const redovi = ((p.data ?? []) as unknown as Red[]).map((r) => {
      // poslednji dnevni snimak = trenutne brojke
      const m = [...r.post_metrics].sort((a, b) => b.day.localeCompare(a.day))[0];
      const { post_metrics: _, ...ostalo } = r;
      return { ...ostalo, reach: m?.reach ?? null, views: m?.views ?? null, likes: m?.likes ?? null, comments: m?.comments ?? null, saves: m?.saves ?? null, shares: m?.shares ?? null };
    });
    this.sve.set(redovi);
    this.kanali.set([...new Set(redovi.map((r) => r.provider))]);
    this.nalog.set((n.data ?? []) as RedNaloga[]);
    this.ucitano.set(true);
  }

  protected promena(sada: number, pre: number): { tekst: string; klasa: string } | null {
    if (!pre) return null;
    const p = ((sada - pre) / pre) * 100;
    return { tekst: `${p >= 0 ? '▲ +' : '▼ '}${p.toFixed(0)}% u odnosu na prethodni period`, klasa: p >= 0 ? 'up' : 'down' };
  }

  protected skrati(t: string | null, n = 70): string {
    if (!t) return '—';
    const prvi = t.split('\n')[0]!;
    return prvi.length > n ? prvi.slice(0, n - 1) + '…' : prvi;
  }
}
