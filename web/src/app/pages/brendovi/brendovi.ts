import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { WorkspaceState } from '../../core/workspace';

@Component({
  selector: 'app-brendovi',
  imports: [RouterLink],
  template: `
    <div class="page">
      <div class="page-head">
        <div>
          <h1>Moji brendovi</h1>
          <p class="sub">Radni prostor „{{ ws.current()?.name }}“ · {{ ws.brands().length }} {{ broj(ws.brands().length) }}</p>
        </div>
        @if (ws.isAdmin()) {
          <a class="btn primary" routerLink="/brendovi/novi">+ Novi brend</a>
        }
      </div>

      @if (ws.brands().length === 0) {
        <div class="empty">
          <p style="font-size:28px; margin:0" aria-hidden="true">✦</p>
          @if (ws.isAdmin()) {
            <p><b>Još nema brendova.</b><br />Dodaj prvi: naziv, sajt i Instagram. Ostalo popunjavamo zajedno.</p>
            <a class="btn primary" routerLink="/brendovi/novi">Dodaj prvi brend</a>
          } @else {
            <p><b>Nemaš pristup nijednom brendu u ovom radnom prostoru.</b><br />Javi se vlasniku da ti dodeli brend.</p>
          }
        </div>
      } @else {
        <ul class="grid g3 lista" role="list">
          @for (b of ws.brands(); track b.id) {
            <li class="card bcard">
              <a class="naslov" [routerLink]="['/b', b.id]">
                <span class="bav" [style.background]="b.color" aria-hidden="true">{{ inicijali(b.name) }}</span>
                <span><b>{{ b.name }}</b><br /><span class="small muted">{{ b.website ? domen(b.website) : 'bez sajta' }}</span></span>
              </a>
              <div class="row small">
                @if (b.instagram_handle) {
                  <span class="pill">Instagram @{{ b.instagram_handle }}</span>
                }
                <span class="pill warn">Konektori: Faza 2</span>
              </div>
              <div class="small muted">Onboarding: počinje u Fazi 1 (upitnik i proučavanje)</div>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    .lista { list-style: none; padding: 0; margin: 0; }
    .bcard { display: flex; flex-direction: column; gap: 12px; }
    .naslov { display: flex; gap: 12px; align-items: center; text-decoration: none; color: inherit; }
    .naslov:hover b { color: var(--accent); }
  `,
})
export default class Brendovi {
  protected readonly ws = inject(WorkspaceState);

  protected broj(n: number): string {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'brend';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'brenda';
    return 'brendova';
  }

  protected inicijali(name: string): string {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
  }

  protected domen(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }
}
