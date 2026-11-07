import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NacrtiStore, STATUS_NACRTA, type Nacrt } from '../../core/nacrti';
import { WorkspaceState } from '../../core/workspace';

/** Kalendar jednog brenda (ruta /b/:id/kalendar) ili svih brendova radnog prostora (/kalendar). */
@Component({
  selector: 'app-kalendar',
  imports: [DatePipe, RouterLink],
  providers: [NacrtiStore],
  template: `
    <div class="page wide">
      <div class="page-head">
        <div>
          <h1>Kalendar</h1>
          <p class="sub">{{ brandId() ? ws.brand(brandId())?.name : 'Svi brendovi · ' + ws.current()?.name }} ·
            {{ dani()[0] | date: 'd. M.' }} – {{ dani()[6] | date: 'd. M. y.' }}</p>
        </div>
        <div class="row">
          <button class="btn" type="button" (click)="pomeri(-1)">← Prethodna</button>
          <button class="btn ghost" type="button" (click)="pomak.set(0)">Ova nedelja</button>
          <button class="btn" type="button" (click)="pomeri(1)">Sledeća →</button>
        </div>
      </div>
      <p class="small legenda">
        <span class="pill warn">za pregled</span> <span class="pill ok">zakazano / objavljeno</span> <span class="pill bad">greška</span> <span class="pill">odbijeno</span>
      </p>
      <div class="nedelja">
        @for (d of dani(); track d.toISOString(); let i = $index) {
          <section class="dan" [class.danas]="jeDanas(d)" [attr.aria-label]="(d | date: 'EEEE d. M.') ?? ''">
            <h2>{{ d | date: 'EEE d.' }}</h2>
            @for (n of naDan(d); track n.id) {
              <a class="objava" [class]="'objava s-' + n.status" [routerLink]="['/b', n.brand_id, 'za-pregled']" [queryParams]="{ nacrt: n.id }">
                @if (n.draft_variants[0]?.media?.[0]; as m) { <img [src]="m.url" alt="" loading="lazy" /> }
                <span>
                  <b>{{ n.scheduled_at | date: 'HH:mm' }}</b>
                  @if (!brandId()) { <span class="brend" [style.color]="ws.brand(n.brand_id)?.color">{{ ws.brand(n.brand_id)?.name }}</span> }
                  <span class="tema">{{ n.topic ?? '…' }}</span>
                  <span class="muted">{{ statusi[n.status].tekst }}</span>
                </span>
              </a>
            } @empty {
              <span class="small muted">—</span>
            }
          </section>
        }
      </div>
    </div>
  `,
  styles: `
    .wide { max-width: 1400px; }
    .legenda { display: flex; gap: 6px; flex-wrap: wrap; }
    .nedelja { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; }
    .dan { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 10px; min-height: 260px; display: flex; flex-direction: column; gap: 8px; }
    .dan.danas { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
    .dan h2 { font-size: 13px; color: var(--muted); margin: 0; text-transform: capitalize; }
    .objava { display: flex; gap: 8px; text-decoration: none; color: inherit; border: 1px solid var(--line); border-left: 4px solid #cfcbc3; border-radius: 9px; padding: 6px; font-size: 12.5px; }
    .objava:hover { background: #faf9f7; }
    .objava img { width: 32px; height: 40px; object-fit: cover; border-radius: 5px; flex: none; }
    .objava > span { display: flex; flex-direction: column; min-width: 0; }
    .tema { overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .brend { font-weight: 700; }
    .s-za_pregled, .s-pravi_se, .s-popravlja_se { border-left-color: #c48a00; }
    .s-zakazan, .s-odobren, .s-objavljen, .s-objavljuje_se { border-left-color: var(--ok); }
    .s-greska { border-left-color: var(--bad); }
    .s-odbijen { opacity: .55; }
    @media (max-width: 1000px) { .nedelja { grid-template-columns: 1fr; } .dan { min-height: 0; } }
  `,
})
export default class Kalendar {
  private readonly store = inject(NacrtiStore);
  protected readonly ws = inject(WorkspaceState);
  readonly brandId = input<string>();

  protected readonly statusi = STATUS_NACRTA;
  protected readonly pomak = signal(0);

  protected readonly dani = computed(() => {
    const d = new Date();
    const pon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7) + this.pomak() * 7);
    return Array.from({ length: 7 }, (_, i) => new Date(pon.getFullYear(), pon.getMonth(), pon.getDate() + i));
  });

  constructor() {
    effect(() => {
      const ids = this.brandId() ? [this.brandId()!] : this.ws.brands().map((b) => b.id);
      const od = this.dani()[0]!;
      const doD = new Date(od.getFullYear(), od.getMonth(), od.getDate() + 7);
      untracked(() => void this.store.start(ids, od.toISOString(), doD.toISOString()));
    });
  }

  protected pomeri(n: number): void {
    this.pomak.update((x) => x + n);
  }

  protected naDan(d: Date): Nacrt[] {
    const k = d.toDateString();
    return this.store.nacrti().filter((n) => n.scheduled_at && new Date(n.scheduled_at).toDateString() === k);
  }

  protected jeDanas(d: Date): boolean {
    return d.toDateString() === new Date().toDateString();
  }
}
