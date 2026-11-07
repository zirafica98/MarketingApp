import { DatePipe, JsonPipe } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { Job, JobStatus } from '../../core/models';
import { porukaGreske, Supabase } from '../../core/supabase';
import { WorkspaceState } from '../../core/workspace';
import { MODULI } from './moduli';

const STATUS: Record<JobStatus, { tekst: string; klasa: string }> = {
  queued: { tekst: 'čeka u redu', klasa: '' },
  running: { tekst: 'radi…', klasa: 'ac' },
  done: { tekst: 'gotovo', klasa: 'ok' },
  failed: { tekst: 'nije uspelo', klasa: 'bad' },
  canceled: { tekst: 'otkazano', klasa: '' },
};

const NAZIV_POSLA: Record<string, string> = {
  'system.ping': 'Provera reda poslova',
  'ai.test': 'Probni AI poziv',
};

@Component({
  selector: 'app-brend-pregled',
  imports: [RouterLink, DatePipe, JsonPipe],
  template: `
    @if (brand(); as b) {
      <div class="page">
        <div class="page-head">
          <div class="row" style="gap:14px">
            <span class="bav" [style.background]="b.color" aria-hidden="true" style="width:52px;height:52px;font-size:18px">{{ b.name[0] }}</span>
            <div>
              <h1>{{ b.name }}</h1>
              <p class="sub">
                @if (b.website) { <a [href]="b.website" target="_blank" rel="noopener">{{ b.website }}</a> · }
                @if (b.instagram_handle) { Instagram &#64;{{ b.instagram_handle }} · }
                jezik {{ b.language }}
              </p>
            </div>
          </div>
          @if (ws.isAdmin()) {
            <a class="btn" [routerLink]="['/b', b.id, 'podesavanja']">Podešavanja</a>
          }
        </div>

        <div class="grid g2">
          <section class="card" aria-labelledby="sledece">
            <h2 id="sledece">Šta sledi za ovaj brend</h2>
            <ol class="koraci">
              <li class="gotovo"><span aria-hidden="true">✓</span> Brend napravljen</li>
              @for (m of moduli; track m.slug) {
                <li><a [routerLink]="['/b', b.id, m.slug]">{{ m.naziv }}</a> <span class="pill">{{ m.faza }}</span></li>
              }
            </ol>
          </section>

          <section class="card" aria-labelledby="provera">
            <h2 id="provera">Provera sistema</h2>
            <p class="small muted">Pokreće posao u redu; worker ga uzima i vraća rezultat. Status se menja uživo.</p>
            @if (greska()) {
              <div class="alert bad" role="alert">{{ greska() }}</div>
            }
            @if (ws.canEdit()) {
              <div class="row">
                <button class="btn" type="button" (click)="pokreni('system.ping')" [disabled]="salje()">Proveri red poslova</button>
                <button class="btn primary" type="button" (click)="pokreni('ai.test')" [disabled]="salje()">Probni AI poziv</button>
              </div>
            } @else {
              <p class="small">Poslove pokreću vlasnik, admin i urednik.</p>
            }

            <h3 style="margin-top:18px">Poslednji poslovi</h3>
            @if (poslovi().length === 0) {
              <p class="small muted">Još nema poslova.</p>
            } @else {
              <ul class="poslovi" aria-live="polite">
                @for (j of poslovi(); track j.id) {
                  <li>
                    <div class="row between">
                      <b>{{ naziv(j.type) }}</b>
                      <span class="pill" [class]="'pill ' + status(j.status).klasa">{{ status(j.status).tekst }}</span>
                    </div>
                    <div class="small muted">{{ j.created_at | date: 'd. M. HH:mm:ss' }} · pokušaj {{ j.attempts }}</div>
                    @if (j.status === 'done' && j.result) {
                      @if (j.type === 'ai.test') {
                        <div class="ai small">
                          <p><b>Pozdrav:</b> {{ $any(j.result).pozdrav }}</p>
                          <p><b>Ideja:</b> {{ $any(j.result).ideja }}</p>
                          <p class="muted">{{ $any(j.result).model }} · {{ sekunde($any(j.result).trajanje_ms) }} s</p>
                        </div>
                      } @else {
                        <code class="copy">{{ j.result | json }}</code>
                      }
                    }
                    @if (j.error) {
                      <div class="small" style="color:var(--bad)">{{ j.error }}</div>
                    }
                  </li>
                }
              </ul>
            }
          </section>
        </div>
      </div>
    }
  `,
  styles: `
    .koraci { margin: 0; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }
    .koraci li { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
    .koraci .gotovo { color: var(--ok); font-weight: 600; justify-content: flex-start; }
    .poslovi { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
    .poslovi li { border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; }
    .ai p { margin: 6px 0 0; }
  `,
})
export default class BrendPregled {
  protected readonly ws = inject(WorkspaceState);
  private readonly sb = inject(Supabase).client;
  readonly brandId = input.required<string>();

  protected readonly moduli = MODULI;
  protected readonly brand = computed(() => this.ws.brand(this.brandId()));
  protected readonly poslovi = signal<Job[]>([]);
  protected readonly greska = signal('');
  protected readonly salje = signal(false);
  private kanal: RealtimeChannel | null = null;

  constructor() {
    effect((onCleanup) => {
      const id = this.brandId();
      void this.ucitaj(id);
      this.kanal = this.sb
        .channel(`jobs-${id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: `brand_id=eq.${id}` }, () => void this.ucitaj(id))
        .subscribe();
      onCleanup(() => {
        if (this.kanal) void this.sb.removeChannel(this.kanal);
        this.kanal = null;
      });
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.kanal) void this.sb.removeChannel(this.kanal);
    });
  }

  private async ucitaj(id: string): Promise<void> {
    const { data, error } = await this.sb
      .from('jobs')
      .select('id, brand_id, type, status, result, error, attempts, created_at, finished_at')
      .eq('brand_id', id)
      .order('created_at', { ascending: false })
      .limit(5);
    if (!error && id === this.brandId()) this.poslovi.set((data ?? []) as Job[]);
  }

  protected async pokreni(tip: string): Promise<void> {
    this.greska.set('');
    this.salje.set(true);
    const { error } = await this.sb.rpc('enqueue_job', { p_brand: this.brandId(), p_type: tip, p_payload: {} });
    this.salje.set(false);
    if (error) this.greska.set(porukaGreske(error));
    else await this.ucitaj(this.brandId());
  }

  protected status(s: JobStatus) {
    return STATUS[s];
  }
  protected naziv(t: string): string {
    return NAZIV_POSLA[t] ?? t;
  }
  protected sekunde(ms: number | undefined): string {
    return ms ? (ms / 1000).toFixed(1) : '?';
  }
}
