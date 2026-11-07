import { DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { porukaGreske, Supabase } from '../../core/supabase';
import { WorkerApi } from '../../core/worker-api';
import { WorkspaceState } from '../../core/workspace';

interface Plan {
  id: string;
  name: string;
  max_brands: number;
  max_members: number;
  max_drafts_month: number;
  price_eur: number;
  sort: number;
}

interface Potrosnja {
  brands: number;
  members: number;
  drafts_month: number;
  ai_cost_month: number;
  ai_runs_month: number;
}

@Component({
  selector: 'app-plan',
  imports: [DecimalPipe],
  template: `
    <div class="page">
      <div class="page-head"><div><h1>Plan i potrošnja</h1><p class="sub">Radni prostor „{{ ws.current()?.name }}“</p></div></div>
      @if (uspeh()) { <div class="alert ok" role="status">Hvala! Plan će biti promenjen čim plaćanje bude potvrđeno (obično za par sekundi).</div> }
      @if (greska()) { <div class="alert bad" role="alert">{{ greska() }}</div> }

      @if (trenutni(); as t) {
        <section class="card" aria-labelledby="pot-h">
          <div class="row between"><h2 id="pot-h" style="margin:0">Trenutni plan: {{ t.name }}</h2>
            @if (aiSopstveni()) { <span class="pill ac">Sopstveni AI ključ: nacrti bez ograničenja</span> }</div>
          <div class="grid g3" style="margin-top:14px">
            @for (r of redovi(); track r.naziv) {
              <div>
                <div class="row between small"><b>{{ r.naziv }}</b><span>{{ r.n }} / {{ r.max === null ? '∞' : r.max }}</span></div>
                <div class="traka" role="progressbar" [attr.aria-label]="r.naziv" [attr.aria-valuenow]="r.n" aria-valuemin="0" [attr.aria-valuemax]="r.max ?? r.n">
                  <i [style.width.%]="r.max ? Math.min(100, (r.n / r.max) * 100) : 5" [class.pun]="r.max !== null && r.n >= r.max"></i>
                </div>
              </div>
            }
          </div>
          <p class="small muted">AI ovog meseca: {{ p()?.ai_runs_month ?? 0 }} poziva agenata, procenjen trošak {{ (p()?.ai_cost_month ?? 0) | number: '1.2-2' : 'sr' }} USD.</p>
        </section>
      }

      <div class="grid g3" style="margin-top:16px">
        @for (pl of planovi(); track pl.id) {
          <section class="card plan" [class.sel]="pl.id === ws.current()?.plan" [attr.aria-label]="pl.name">
            <h2>{{ pl.name }}</h2>
            <p class="cena">{{ pl.price_eur | number: '1.0-0' : 'sr' }} € <span class="small muted">/ mesec</span></p>
            <ul>
              <li>{{ pl.max_brands }} {{ pl.max_brands === 1 ? 'brend' : 'brendova' }}</li>
              <li>{{ pl.max_members }} članova tima</li>
              <li>{{ pl.max_drafts_month }} nacrta mesečno (AI uključen)</li>
              <li>Svi konektori, analitika i učenje</li>
            </ul>
            @if (pl.id === ws.current()?.plan) {
              <span class="pill ok">Tvoj plan</span>
            } @else if (pl.price_eur > 0 && ws.role() === 'owner') {
              <button class="btn primary" type="button" (click)="nadogradi(pl.id)" [disabled]="!naplataUkljucena() || radi()">Izaberi {{ pl.name }}</button>
              @if (!naplataUkljucena()) { <p class="small muted">Plaćanje još nije uključeno na ovom serveru.</p> }
            }
          </section>
        }
      </div>
      <p class="small muted" style="margin-top:12px">Sa sopstvenim Anthropic ključem (AI i agenti) plaćaš AI direktno Anthropic-u, a broj nacrta nije ograničen.</p>
    </div>
  `,
  styles: `
    .traka { height: 8px; background: #eceae5; border-radius: 9px; overflow: hidden; margin-top: 6px; }
    .traka i { display: block; height: 100%; background: var(--accent); }
    .traka i.pun { background: var(--bad); }
    .plan.sel { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    .cena { font-size: 26px; font-weight: 700; margin: 0 0 8px; }
    ul { padding-left: 18px; font-size: 14px; }
  `,
})
export default class PlanStrana {
  private readonly sb = inject(Supabase).client;
  private readonly api = inject(WorkerApi);
  protected readonly ws = inject(WorkspaceState);
  readonly uspeh = input<string>();

  protected readonly Math = Math;
  protected readonly planovi = signal<Plan[]>([]);
  protected readonly p = signal<Potrosnja | null>(null);
  protected readonly aiSopstveni = signal(false);
  protected readonly naplataUkljucena = signal(false);
  protected readonly greska = signal('');
  protected readonly radi = signal(false);

  protected readonly trenutni = computed(() => this.planovi().find((x) => x.id === this.ws.current()?.plan) ?? null);
  protected readonly redovi = computed(() => {
    const t = this.trenutni();
    const p = this.p();
    if (!t || !p) return [];
    return [
      { naziv: 'Brendovi', n: p.brands, max: t.max_brands },
      { naziv: 'Članovi', n: p.members, max: t.max_members },
      { naziv: 'Nacrti ovog meseca', n: p.drafts_month, max: this.aiSopstveni() ? null : t.max_drafts_month },
    ];
  });

  constructor() {
    effect(() => {
      const ws = this.ws.current()?.id;
      if (ws) untracked(() => void this.ucitaj(ws));
    });
    void this.api.get<{ ukljuceno: boolean }>('/naplata/stanje').then((r) => this.naplataUkljucena.set(r.ukljuceno)).catch(() => {});
  }

  private async ucitaj(ws: string): Promise<void> {
    const [pl, u, ai] = await Promise.all([
      this.sb.from('plans').select('*').order('sort'),
      this.sb.rpc('workspace_usage', { p_workspace: ws }),
      this.sb.from('workspace_ai_settings').select('mode').eq('workspace_id', ws).maybeSingle(),
    ]);
    this.planovi.set((pl.data ?? []) as Plan[]);
    this.p.set(((u.data ?? []) as Potrosnja[])[0] ?? null);
    this.aiSopstveni.set(ai.data?.mode === 'sopstveni');
  }

  protected async nadogradi(plan: string): Promise<void> {
    this.greska.set('');
    this.radi.set(true);
    try {
      const r = await this.api.post<{ url: string }>('/naplata/checkout', { workspace_id: this.ws.current()?.id, plan });
      location.href = r.url;
    } catch (e) {
      this.greska.set(porukaGreske(e));
    } finally {
      this.radi.set(false);
    }
  }
}
