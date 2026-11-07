import { Component, inject, input, signal } from '@angular/core';
import { email, form, FormField, minLength, required, submit } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { Auth } from '../../core/auth';
import { FieldErrors } from '../../core/field-errors';
import { porukaGreske } from '../../core/supabase';
import { bezbednaPutanja } from './prijava';

@Component({
  selector: 'app-registracija',
  imports: [FormField, FieldErrors, RouterLink],
  template: `
    <div class="auth-wrap">
      <div class="card auth-card">
        <div class="logo"><i aria-hidden="true">✦</i> Marketing Pilot</div>
        <h1 style="margin-top:18px">Otvori nalog</h1>
        <p class="sub" style="margin-bottom:18px">Za minut: posle ovoga praviš radni prostor i prvi brend.</p>

        @if (greska()) {
          <div class="alert bad" role="alert">{{ greska() }}</div>
        }
        @if (potvrda()) {
          <div class="alert ok" role="status">Poslali smo ti mejl. Klikni na link u njemu, pa se prijavi.</div>
        } @else {
          <form (submit)="posalji($event)" novalidate>
            <div class="field">
              <label for="ime">Ime i prezime</label>
              <input id="ime" autocomplete="name" [formField]="f.ime" aria-describedby="ime-err"
                     [attr.aria-invalid]="f.ime().touched() && f.ime().invalid()" />
              <app-field-errors [field]="f.ime" errId="ime-err" />
            </div>
            <div class="field">
              <label for="email">Mejl</label>
              <input id="email" type="email" autocomplete="email" [formField]="f.email" aria-describedby="email-err"
                     [attr.aria-invalid]="f.email().touched() && f.email().invalid()" />
              <app-field-errors [field]="f.email" errId="email-err" />
            </div>
            <div class="field">
              <label for="lozinka">Lozinka</label>
              <input id="lozinka" type="password" autocomplete="new-password" [formField]="f.lozinka" aria-describedby="lozinka-hint lozinka-err"
                     [attr.aria-invalid]="f.lozinka().touched() && f.lozinka().invalid()" />
              <span class="hint" id="lozinka-hint">Najmanje 8 znakova.</span>
              <app-field-errors [field]="f.lozinka" errId="lozinka-err" />
            </div>
            <button class="btn primary" type="submit" style="width:100%" [disabled]="f().submitting()">
              {{ f().submitting() ? 'Pravim nalog…' : 'Otvori nalog' }}
            </button>
          </form>
        }
        <p class="small" style="margin:16px 0 0">Već imaš nalog? <a routerLink="/prijava" [queryParams]="nazad() ? { nazad: nazad() } : {}">Prijavi se</a></p>
      </div>
    </div>
  `,
})
export default class Registracija {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  readonly nazad = input<string>();

  protected readonly greska = signal('');
  protected readonly potvrda = signal(false);
  private readonly model = signal({ ime: '', email: '', lozinka: '' });
  protected readonly f = form(this.model, (p) => {
    required(p.ime, { message: 'Upiši ime.' });
    required(p.email, { message: 'Upiši mejl.' });
    email(p.email, { message: 'Mejl nije ispravan.' });
    required(p.lozinka, { message: 'Upiši lozinku.' });
    minLength(p.lozinka, 8, { message: 'Lozinka mora imati bar 8 znakova.' });
  });

  protected async posalji(e: Event): Promise<void> {
    e.preventDefault();
    this.greska.set('');
    await submit(this.f, async () => {
      try {
        const { ime, email: m, lozinka } = this.model();
        const { needsConfirmation } = await this.auth.signUp(ime.trim(), m.trim(), lozinka);
        if (needsConfirmation) this.potvrda.set(true);
        else await this.router.navigateByUrl(bezbednaPutanja(this.nazad()));
      } catch (err) {
        this.greska.set(porukaGreske(err));
      }
      return undefined;
    });
  }
}
