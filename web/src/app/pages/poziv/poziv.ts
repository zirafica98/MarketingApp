import { Component, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Auth } from '../../core/auth';
import { ROLE_LABEL, ROLE_OPIS, type Role } from '../../core/models';
import { porukaGreske, Supabase } from '../../core/supabase';
import { WorkspaceState } from '../../core/workspace';

interface Pregled {
  workspace_name: string;
  role: Role;
  email: string;
  brand_names: string[] | null;
  expired: boolean;
  accepted: boolean;
}

@Component({
  selector: 'app-poziv',
  template: `
    <div class="auth-wrap">
      <div class="card auth-card">
        <div class="logo"><i aria-hidden="true">✦</i> Marketing Pilot</div>
        @if (greska()) {
          <div class="alert bad" role="alert" style="margin-top:18px">{{ greska() }}</div>
        }
        @if (pregled(); as p) {
          <h1 style="margin-top:18px">Poziv u „{{ p.workspace_name }}“</h1>
          <p>Uloga: <b>{{ roleLabel[p.role] }}</b> <span class="muted small">({{ roleOpis[p.role] }})</span></p>
          <p>Brendovi: <b>{{ p.brand_names?.join(', ') || 'svi' }}</b></p>
          @if (p.accepted) {
            <div class="alert info">Ovaj poziv je već iskorišćen.</div>
          } @else if (p.expired) {
            <div class="alert bad">Poziv je istekao. Zatraži novi.</div>
          } @else if (p.email !== mojMejl()) {
            <div class="alert bad">Poziv je poslat na <b>{{ p.email }}</b>, a ti si prijavljen kao <b>{{ mojMejl() }}</b>. Odjavi se i prijavi sa tom adresom.</div>
            <button class="btn" type="button" (click)="odjava()">Odjavi se</button>
          } @else {
            <button class="btn primary" type="button" style="width:100%" (click)="prihvati()" [disabled]="radi()">Prihvati poziv</button>
          }
        } @else if (!greska()) {
          <p style="margin-top:18px" class="muted">Učitavam poziv…</p>
        }
      </div>
    </div>
  `,
})
export default class Poziv {
  private readonly sb = inject(Supabase).client;
  private readonly auth = inject(Auth);
  private readonly ws = inject(WorkspaceState);
  private readonly router = inject(Router);
  readonly token = input.required<string>();

  protected readonly roleLabel = ROLE_LABEL;
  protected readonly roleOpis = ROLE_OPIS;
  protected readonly pregled = signal<Pregled | null>(null);
  protected readonly greska = signal('');
  protected readonly radi = signal(false);

  constructor() {
    effect(() => void this.ucitaj(this.token()));
  }

  protected mojMejl(): string {
    return (this.auth.user()?.email ?? '').toLowerCase();
  }

  private async ucitaj(token: string): Promise<void> {
    const { data, error } = await this.sb.rpc('invitation_preview', { p_token: token });
    if (error) return this.greska.set(porukaGreske(error));
    const p = (data as Pregled[] | null)?.[0];
    if (!p) return this.greska.set('Poziv ne postoji. Proveri link.');
    this.pregled.set(p);
  }

  protected async prihvati(): Promise<void> {
    this.radi.set(true);
    const { data, error } = await this.sb.rpc('accept_invitation', { p_token: this.token() });
    this.radi.set(false);
    if (error) return this.greska.set(porukaGreske(error));
    await this.ws.ensureLoaded(true);
    await this.ws.select(data as string);
    await this.router.navigate(['/brendovi']);
  }

  protected async odjava(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigate(['/prijava'], { queryParams: { nazad: `/poziv/${this.token()}` } });
  }
}
