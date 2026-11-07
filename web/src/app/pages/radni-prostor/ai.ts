import { DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { porukaGreske, Supabase } from '../../core/supabase';
import { WorkerApi } from '../../core/worker-api';
import { WorkspaceState } from '../../core/workspace';

const AGENTI = [
  { k: 'istrazivac', n: 'Istraživač', opis: 'Čita sajt i konkurente', pod: 'sonnet' },
  { k: 'intervjuer', n: 'Intervjuer', opis: 'Pita šta fali', pod: 'sonnet' },
  { k: 'strateg', n: 'Strateg', opis: 'Strategija, profil, kampanje', pod: 'opus' },
  { k: 'pisac', n: 'Pisac', opis: 'Tekst slajdova i opisa', pod: 'opus' },
  { k: 'urednik', n: 'Urednik', opis: 'Provera pre pregleda', pod: 'sonnet' },
  { k: 'ucitelj', n: 'Učitelj', opis: 'Uči iz brojki i odluka', pod: 'opus' },
];
const MODELI = [
  { k: 'opus', n: 'Claude Opus 5.5 — najbolji kvalitet' },
  { k: 'sonnet', n: 'Claude Sonnet 5.5 — brz i povoljan' },
  { k: 'haiku', n: 'Claude Haiku 5.5 — najjeftiniji' },
];

interface Poziv {
  agent: string;
  provider: string;
  model: string | null;
  cost_usd: number | null;
  error: string | null;
}

@Component({
  selector: 'app-ai',
  imports: [DecimalPipe],
  template: `
    <div class="page" style="max-width:900px">
      <div class="page-head"><div><h1>AI i agenti</h1><p class="sub">Ko daje model i koji model koristi koji agent, za radni prostor „{{ ws.current()?.name }}“.</p></div></div>
      @if (greska()) { <div class="alert bad" role="alert">{{ greska() }}</div> }
      @if (poruka()) { <div class="alert ok" role="status">{{ poruka() }}</div> }

      <section class="card" aria-labelledby="kljuc-h">
        <h2 id="kljuc-h">AI nalog</h2>
        @if (mod() === 'sopstveni') {
          <p>Koristiš <b>sopstveni Anthropic ključ</b> ({{ hint() }}). AI plaćaš direktno Anthropic-u, a broj nacrta nije ograničen planom.</p>
          @if (ws.isAdmin()) { <button class="btn danger" type="button" (click)="ukloni()" [disabled]="radi()">Ukloni ključ i vrati se na AI iz plana</button> }
        } @else {
          <p>AI je uključen u tvoj plan. Možeš da dodaš i sopstveni Anthropic ključ: tada nema ograničenja broja nacrta.</p>
          @if (ws.isAdmin()) {
            <form class="row" (submit)="sacuvaj($event)">
              <label for="kljuc" class="sr-only">Anthropic API ključ</label>
              <input id="kljuc" class="ulaz" type="password" autocomplete="off" placeholder="sk-ant-…" [value]="kljuc()" (input)="kljuc.set($any($event.target).value)" />
              <button class="btn primary" type="submit" [disabled]="!kljuc().trim() || radi()">{{ radi() ? 'Proveravam…' : 'Proveri i sačuvaj' }}</button>
            </form>
            <p class="small muted">Ključ praviš na console.anthropic.com → API Keys. Čuva se šifrovan; posle ga ne vidi niko, ni administrator. Proveravamo ga bez troška.</p>
          }
        }
      </section>

      <section class="card" style="margin-top:16px" aria-labelledby="ag-h">
        <h2 id="ag-h">Model po agentu</h2>
        <table class="tbl">
          <thead><tr><th scope="col">Agent</th><th scope="col">Model</th><th scope="col">Ovog meseca</th></tr></thead>
          <tbody>
            @for (a of agenti; track a.k) {
              <tr>
                <td><b>{{ a.n }}</b><br /><span class="small muted">{{ a.opis }}</span></td>
                <td>
                  <label class="sr-only" [for]="'m-' + a.k">Model za: {{ a.n }}</label>
                  <select [id]="'m-' + a.k" [disabled]="!ws.isAdmin()" (change)="postavi(a.k, $any($event.target).value)">
                    @for (m of modeli; track m.k) { <option [value]="m.k" [selected]="(izbor()[a.k] ?? a.pod) === m.k">{{ m.n }}{{ m.k === a.pod ? ' (preporuka)' : '' }}</option> }
                  </select>
                </td>
                <td class="small">{{ statistika()[a.k]?.n ?? 0 }} poziva · {{ statistika()[a.k]?.cena ?? 0 | number: '1.2-2' : 'sr' }} USD
                  @if (statistika()[a.k]?.greske) { <span class="pill bad">{{ statistika()[a.k]?.greske }} grešaka</span> }</td>
              </tr>
            }
          </tbody>
        </table>
        <p class="small muted">Na razvojnom serveru (naša Claude pretplata) model se bira isto, a trošak je procena.</p>
      </section>
    </div>
  `,
  styles: `.ulaz { flex: 1; min-width: 240px; border: 1px solid #cfcbc3; border-radius: 10px; padding: 9px 12px; min-height: 40px; } select { border: 1px solid #cfcbc3; border-radius: 8px; padding: 6px 8px; }`,
})
export default class AiStrana {
  private readonly sb = inject(Supabase).client;
  private readonly api = inject(WorkerApi);
  protected readonly ws = inject(WorkspaceState);

  protected readonly agenti = AGENTI;
  protected readonly modeli = MODELI;
  protected readonly mod = signal<'ukljuceno' | 'sopstveni'>('ukljuceno');
  protected readonly hint = signal('');
  protected readonly izbor = signal<Record<string, string>>({});
  protected readonly pozivi = signal<Poziv[]>([]);
  protected readonly kljuc = signal('');
  protected readonly greska = signal('');
  protected readonly poruka = signal('');
  protected readonly radi = signal(false);

  protected readonly statistika = computed(() => {
    const m: Record<string, { n: number; cena: number; greske: number }> = {};
    for (const p of this.pozivi()) {
      const k = p.agent.split('.')[0]!;
      const x = (m[k] ??= { n: 0, cena: 0, greske: 0 });
      x.n++;
      x.cena += Number(p.cost_usd ?? 0);
      if (p.error) x.greske++;
    }
    return m;
  });

  constructor() {
    effect(() => {
      const ws = this.ws.current()?.id;
      if (ws) untracked(() => void this.ucitaj(ws));
    });
  }

  private async ucitaj(ws: string): Promise<void> {
    const od = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const [s, r] = await Promise.all([
      this.sb.from('workspace_ai_settings').select('mode, key_hint, agent_models').eq('workspace_id', ws).maybeSingle(),
      this.sb.from('agent_runs').select('agent, provider, model, cost_usd, error').eq('workspace_id', ws).gte('created_at', od).limit(5000),
    ]);
    this.mod.set((s.data?.mode as 'ukljuceno' | 'sopstveni') ?? 'ukljuceno');
    this.hint.set(s.data?.key_hint ?? '');
    this.izbor.set((s.data?.agent_models as Record<string, string>) ?? {});
    this.pozivi.set((r.data ?? []) as Poziv[]);
  }

  protected async postavi(agent: string, model: string): Promise<void> {
    this.greska.set('');
    const novo = { ...this.izbor(), [agent]: model };
    const { error } = await this.sb.rpc('set_agent_models', { p_workspace: this.ws.current()?.id, p_models: novo });
    if (error) return this.greska.set(porukaGreske(error));
    this.izbor.set(novo);
    this.poruka.set('Sačuvano. Važi od sledećeg posla.');
  }

  protected async sacuvaj(e: Event): Promise<void> {
    e.preventDefault();
    this.greska.set('');
    this.radi.set(true);
    try {
      const r = await this.api.post<{ key_hint: string }>('/ai/kljuc', { workspace_id: this.ws.current()?.id, api_key: this.kljuc() });
      this.kljuc.set('');
      this.poruka.set(`Ključ ${r.key_hint} je proveren i sačuvan.`);
      await this.ucitaj(this.ws.current()!.id);
    } catch (err) {
      this.greska.set(porukaGreske(err));
    } finally {
      this.radi.set(false);
    }
  }

  protected async ukloni(): Promise<void> {
    if (!confirm('Ukloniti sopstveni ključ? AI se vraća na plan (sa ograničenjem broja nacrta).')) return;
    this.radi.set(true);
    try {
      await this.api.post('/ai/kljuc/obrisi', { workspace_id: this.ws.current()?.id });
      this.poruka.set('Ključ je uklonjen.');
      await this.ucitaj(this.ws.current()!.id);
    } catch (err) {
      this.greska.set(porukaGreske(err));
    } finally {
      this.radi.set(false);
    }
  }
}
