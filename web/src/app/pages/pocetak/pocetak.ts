import { Component, computed, inject, signal } from '@angular/core';
import { form, FormField, maxLength, required, submit } from '@angular/forms/signals';
import { Router } from '@angular/router';
import { Auth } from '../../core/auth';
import { FieldErrors } from '../../core/field-errors';
import { porukaGreske } from '../../core/supabase';
import { WorkspaceState } from '../../core/workspace';

@Component({
  selector: 'app-pocetak',
  imports: [FormField, FieldErrors],
  template: `
    <div class="auth-wrap">
      <div class="card auth-card">
        <div class="logo"><i aria-hidden="true">✦</i> Marketing Pilot</div>
        <h1 style="margin-top:18px">Zdravo{{ ime() ? ', ' + ime() : '' }}!</h1>
        <p class="sub" style="margin-bottom:18px">
          Prvo pravimo <b>radni prostor</b>: u njemu su svi tvoji brendovi i ljudi sa kojima radiš.
          Ako vodiš brendove za klijente, nazovi ga po agenciji.
        </p>
        @if (greska()) {
          <div class="alert bad" role="alert">{{ greska() }}</div>
        }
        <form (submit)="posalji($event)" novalidate>
          <div class="field">
            <label for="naziv">Naziv radnog prostora</label>
            <input id="naziv" [formField]="f.naziv" aria-describedby="naziv-hint naziv-err"
                   [attr.aria-invalid]="f.naziv().touched() && f.naziv().invalid()" />
            <span class="hint" id="naziv-hint">Na primer: „Pera Perić“ ili „Agencija Korak“. Može da se promeni kasnije.</span>
            <app-field-errors [field]="f.naziv" errId="naziv-err" />
          </div>
          <button class="btn primary" type="submit" style="width:100%" [disabled]="f().submitting()">
            {{ f().submitting() ? 'Pravim…' : 'Napravi radni prostor' }}
          </button>
        </form>
        <p class="small muted" style="margin:16px 0 0">Dobio si poziv od nekog? Otvori link iz poziva, ne moraš da praviš svoj prostor.</p>
      </div>
    </div>
  `,
})
export default class Pocetak {
  private readonly ws = inject(WorkspaceState);
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);

  protected readonly ime = computed(() => ((this.auth.user()?.user_metadata?.['full_name'] as string) ?? '').split(' ')[0]);
  protected readonly greska = signal('');
  private readonly model = signal({ naziv: (this.auth.user()?.user_metadata?.['full_name'] as string) ?? '' });
  protected readonly f = form(this.model, (p) => {
    required(p.naziv, { message: 'Upiši naziv.' });
    maxLength(p.naziv, 80, { message: 'Najviše 80 znakova.' });
  });

  protected async posalji(e: Event): Promise<void> {
    e.preventDefault();
    this.greska.set('');
    await submit(this.f, async () => {
      try {
        await this.ws.create(this.model().naziv.trim());
        await this.router.navigate(['/brendovi/novi']);
      } catch (err) {
        this.greska.set(porukaGreske(err));
      }
      return undefined;
    });
  }
}
