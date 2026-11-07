import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { polje, popunjeno } from '../../../../../shared/upitnik';
import { Auth } from '../../core/auth';
import { BrandOnboarding, stanjePosla, type Question } from '../../core/onboarding';
import { porukaGreske } from '../../core/supabase';
import { WorkspaceState } from '../../core/workspace';

@Component({
  selector: 'app-razgovor',
  imports: [RouterLink],
  providers: [BrandOnboarding],
  template: `
    <div class="page" style="max-width:820px">
      <div class="page-head">
        <div>
          <h1>Razgovor sa agentom</h1>
          <p class="sub">Agent pita samo ono što nije mogao da zaključi iz sajta, upitnika i konkurencije.</p>
        </div>
        @if (ws.canEdit() && ob.questions().length && !intervju().radi) {
          <button class="btn" type="button" (click)="novaPitanja()">Nova pitanja</button>
        }
      </div>

      @if (greska()) {
        <div class="alert bad" role="alert">{{ greska() }}</div>
      }

      <ol class="chat" aria-live="polite">
        <li class="msg agent">
          <div class="who">Intervjuer</div>
          @if (!ob.questions().length) {
            Pre nego što sastavim profil brenda, imam nekoliko pitanja. Što više popuniš <a [routerLink]="['/b', brandId(), 'upitnik']">upitnik</a> i
            dodaš konkurenata, manje ću pitati.
          } @else {
            Imam {{ ob.questions().length }} {{ ob.questions().length === 1 ? 'pitanje' : 'pitanja' }}. Odgovori kratko, a ako ne znaš, preskoči.
          }
        </li>

        @for (q of ob.questions(); track q.id) {
          @if (q.status !== 'otvoreno' || q === trenutno()) {
            <li class="msg agent">
              <div class="who">Intervjuer</div>
              <div>{{ q.question }}</div>
              @if (q.why) {
                <div class="small muted zasto">{{ q.why }}</div>
              }
              @if (q === trenutno() && ws.canEdit()) {
                @if (q.options.length) {
                  <div class="chips">
                    @for (o of q.options; track o) {
                      <button class="chip" type="button" (click)="odgovori(q, o)">{{ o }}</button>
                    }
                  </div>
                }
              }
            </li>
            @if (q.status === 'odgovoreno') {
              <li class="msg ja"><span class="sr-only">Tvoj odgovor: </span>{{ q.answer }}</li>
            } @else if (q.status === 'preskoceno') {
              <li class="msg ja preskoceno">Preskočeno</li>
            }
          }
        }

        @if (intervju().radi) {
          <li class="msg agent"><div class="who">Intervjuer</div>Smišljam pitanja… (obično pola minuta)</li>
        }
      </ol>

      @if (ws.canEdit()) {
        @if (trenutno(); as q) {
          <form class="composer" (submit)="posalji($event, q)">
            <label for="odgovor" class="sr-only">Tvoj odgovor na: {{ q.question }}</label>
            <textarea id="odgovor" rows="2" placeholder="Napiši odgovor…" [value]="tekst()" (input)="tekst.set($any($event.target).value)"
                      (keydown.enter)="enter($event, q)"></textarea>
            <div class="row">
              <button class="btn primary" type="submit" [disabled]="!tekst().trim()">Pošalji</button>
              <button class="btn ghost" type="button" (click)="preskoci(q)">Preskoči</button>
            </div>
          </form>
        } @else if (!ob.questions().length) {
          <button class="btn primary" type="button" (click)="novaPitanja()" [disabled]="intervju().radi">Postavi mi pitanja</button>
        } @else if (!intervju().radi) {
          <div class="card gotovo">
            <h2>Hvala, to je sve za sada.</h2>
            <p class="small">Sledeći korak: agent od svega sastavlja <b>brend profil</b> koji ćeš pregledati i potvrditi.</p>
            <div class="row">
              <button class="btn primary" type="button" (click)="sastaviProfil()" [disabled]="profilPosao().radi">
                {{ profilPosao().radi ? 'Sastavlja…' : 'Sastavi brend profil' }}
              </button>
              <a class="btn ghost" [routerLink]="['/b', brandId(), 'profil']">Pogledaj profil</a>
            </div>
          </div>
        }
      } @else {
        <p class="small muted">Na pitanja odgovaraju vlasnik, admin i urednik.</p>
      }
    </div>
  `,
  styles: `
    .chat { list-style: none; padding: 0; margin: 0 0 16px; display: flex; flex-direction: column; gap: 10px; }
    .msg { max-width: 80%; padding: 12px 14px; border-radius: 14px; background: #fff; border: 1px solid var(--line); }
    .msg.ja { align-self: flex-end; background: var(--accent); border-color: var(--accent); color: #fff; white-space: pre-wrap; }
    .msg.ja.preskoceno { background: #f0eee9; border-color: var(--line); color: var(--muted); font-style: italic; }
    .who { font-size: 12px; font-weight: 700; color: var(--accent-ink); margin-bottom: 4px; }
    .zasto { margin-top: 6px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .chip { border: 1px solid #cfcbc3; background: #faf9f7; border-radius: 99px; padding: 6px 12px; font-size: 14px; cursor: pointer; }
    .chip:hover { border-color: var(--accent); }
    .composer { display: flex; flex-direction: column; gap: 8px; }
    .composer textarea { border: 1px solid #cfcbc3; border-radius: 12px; padding: 12px 14px; resize: vertical; }
    .gotovo h2 { margin-bottom: 6px; }
    @media (max-width: 700px) { .msg { max-width: 95%; } }
  `,
})
export default class Razgovor {
  protected readonly ob = inject(BrandOnboarding);
  protected readonly ws = inject(WorkspaceState);
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  readonly brandId = input.required<string>();

  protected readonly tekst = signal('');
  protected readonly greska = signal('');
  protected readonly trenutno = computed<Question | null>(() => this.ob.questions().find((q) => q.status === 'otvoreno') ?? null);
  protected readonly intervju = computed(() => stanjePosla(this.ob.lastJob().get('brand.interview')));
  protected readonly profilPosao = computed(() => stanjePosla(this.ob.lastJob().get('brand.profile')));

  constructor() {
    effect(() => {
      const id = this.brandId();
      untracked(() => void this.ob.start(id));
    });
  }

  protected enter(e: Event, q: Question): void {
    const k = e as KeyboardEvent;
    if (k.shiftKey) return;
    k.preventDefault();
    if (this.tekst().trim()) void this.odgovori(q, this.tekst().trim());
  }

  protected async posalji(e: Event, q: Question): Promise<void> {
    e.preventDefault();
    if (this.tekst().trim()) await this.odgovori(q, this.tekst().trim());
  }

  protected async odgovori(q: Question, odgovor: string): Promise<void> {
    this.greska.set('');
    try {
      await this.ob.odgovori(q, odgovor, this.auth.userId()!);
      this.tekst.set('');
      await this.upisiUUpitnik(q, odgovor);
      document.getElementById('odgovor')?.focus();
    } catch (e) {
      this.greska.set(porukaGreske(e));
    }
  }

  /** Ako se pitanje odnosi na prazno polje upitnika, odgovor ide i tamo. */
  private async upisiUUpitnik(q: Question, odgovor: string): Promise<void> {
    const def = q.field_key ? polje(q.field_key) : undefined;
    const p = this.ob.profile();
    if (!def || !p || popunjeno(p.answers[def.kljuc])) return;
    let v: string | string[] | null = odgovor;
    if (def.vrsta === 'izbor') v = def.opcije?.includes(odgovor) ? odgovor : null;
    if (def.vrsta === 'vise_izbora') v = def.opcije?.includes(odgovor) ? [odgovor] : null;
    if (v !== null) await this.ob.sacuvajOdgovore({ ...p.answers, [def.kljuc]: v });
  }

  protected async preskoci(q: Question): Promise<void> {
    try {
      await this.ob.odgovori(q, null, this.auth.userId()!);
    } catch (e) {
      this.greska.set(porukaGreske(e));
    }
  }

  protected async novaPitanja(): Promise<void> {
    this.greska.set('');
    await this.ob.pokreni('brand.interview').catch((e) => this.greska.set(porukaGreske(e)));
  }

  protected async sastaviProfil(): Promise<void> {
    this.greska.set('');
    try {
      await this.ob.pokreni('brand.profile');
      await this.router.navigate(['/b', this.brandId(), 'profil']);
    } catch (e) {
      this.greska.set(porukaGreske(e));
    }
  }
}
