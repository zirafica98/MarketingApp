import { Component, inject, input, signal } from '@angular/core';
import { email, form, FormField, required, submit } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { Auth } from '../../core/auth';
import { FieldErrors } from '../../core/field-errors';
import { porukaGreske } from '../../core/supabase';

@Component({
  selector: 'app-prijava',
  imports: [FormField, FieldErrors, RouterLink],
  template: `
    <div class="auth-wrap">
      <div class="card auth-card">
        <div class="logo"><i aria-hidden="true">✦</i> Marketing Pilot</div>
        <h1 style="margin-top:18px">Prijava</h1>
        <p class="sub" style="margin-bottom:18px">Centralno mesto za marketing svih tvojih brendova.</p>

        @if (greska()) {
          <div class="alert bad" role="alert">{{ greska() }}</div>
        }

        <form (submit)="posalji($event)" novalidate>
          <div class="field">
            <label for="email">Mejl</label>
            <input id="email" type="email" autocomplete="email" [formField]="f.email"
                   [attr.aria-invalid]="f.email().touched() && f.email().invalid()" aria-describedby="email-err" />
            <app-field-errors [field]="f.email" errId="email-err" />
          </div>
          <div class="field">
            <label for="lozinka">Lozinka</label>
            <input id="lozinka" type="password" autocomplete="current-password" [formField]="f.lozinka"
                   [attr.aria-invalid]="f.lozinka().touched() && f.lozinka().invalid()" aria-describedby="lozinka-err" />
            <app-field-errors [field]="f.lozinka" errId="lozinka-err" />
          </div>
          <button class="btn primary" type="submit" style="width:100%" [disabled]="f().submitting()">
            {{ f().submitting() ? 'Prijavljujem…' : 'Prijavi se' }}
          </button>
        </form>
        <p class="small" style="margin:16px 0 0">Nemaš nalog? <a routerLink="/registracija" [queryParams]="nazad() ? { nazad: nazad() } : {}">Otvori nalog</a></p>
      </div>
    </div>
  `,
})
export default class Prijava {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  /** Kuda posle prijave (npr. link poziva). */
  readonly nazad = input<string>();

  protected readonly greska = signal('');
  private readonly model = signal({ email: '', lozinka: '' });
  protected readonly f = form(this.model, (p) => {
    required(p.email, { message: 'Upiši mejl.' });
    email(p.email, { message: 'Mejl nije ispravan.' });
    required(p.lozinka, { message: 'Upiši lozinku.' });
  });

  protected async posalji(e: Event): Promise<void> {
    e.preventDefault();
    this.greska.set('');
    await submit(this.f, async () => {
      try {
        const { email: m, lozinka } = this.model();
        await this.auth.signIn(m.trim(), lozinka);
        await this.router.navigateByUrl(bezbednaPutanja(this.nazad()));
      } catch (err) {
        this.greska.set(porukaGreske(err));
      }
      return undefined;
    });
  }
}

/** Samo putanje unutar aplikacije (ne spoljni linkovi). */
export function bezbednaPutanja(p: string | undefined): string {
  return p && p.startsWith('/') && !p.startsWith('//') ? p : '/';
}
