import { Component, input, output, signal, effect } from '@angular/core';
import { form, FormField, maxLength, pattern, required, submit, validate } from '@angular/forms/signals';
import { FieldErrors } from '../../core/field-errors';
import type { Brand } from '../../core/models';

export interface BrandInput {
  name: string;
  website: string;
  instagram: string;
  language: string;
  timezone: string;
  color: string;
}

export const JEZICI = [
  { kod: 'sr', naziv: 'Srpski (latinica)' },
  { kod: 'sr-Cyrl', naziv: 'Srpski (ćirilica)' },
  { kod: 'hr', naziv: 'Hrvatski' },
  { kod: 'en', naziv: 'Engleski' },
  { kod: 'de', naziv: 'Nemački' },
];
export const ZONE = ['Europe/Belgrade', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles'];

/** „dnevniktrudnoce.com“ → „https://dnevniktrudnoce.com“; prazno ostaje prazno. */
export function normalizujSajt(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

/** „@korak.sneakers“ ili link na profil → „korak.sneakers“. */
export function normalizujInstagram(v: string): string | null {
  const t = v.trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/\/.*$/, '');
  return t || null;
}

@Component({
  selector: 'app-brand-form',
  imports: [FormField, FieldErrors],
  template: `
    <form (submit)="posalji($event)" novalidate>
      <div class="field">
        <label for="b-name">Naziv brenda</label>
        <input id="b-name" [formField]="f.name" aria-describedby="b-name-err" [attr.aria-invalid]="f.name().touched() && f.name().invalid()" />
        <app-field-errors [field]="f.name" errId="b-name-err" />
      </div>
      <div class="grid g2" style="gap:0 16px">
        <div class="field">
          <label for="b-site">Sajt ili prodavnica</label>
          <input id="b-site" inputmode="url" placeholder="korak.rs" [formField]="f.website" aria-describedby="b-site-hint b-site-err"
                 [attr.aria-invalid]="f.website().touched() && f.website().invalid()" />
          <span class="hint" id="b-site-hint">Opciono. Agent će ga pročitati u Fazi 1.</span>
          <app-field-errors [field]="f.website" errId="b-site-err" />
        </div>
        <div class="field">
          <label for="b-ig">Instagram profil</label>
          <input id="b-ig" placeholder="@korak.sneakers" [formField]="f.instagram" aria-describedby="b-ig-err"
                 [attr.aria-invalid]="f.instagram().touched() && f.instagram().invalid()" />
          <app-field-errors [field]="f.instagram" errId="b-ig-err" />
        </div>
        <div class="field">
          <label for="b-lang">Jezik objava</label>
          <select id="b-lang" [formField]="f.language">
            @for (j of jezici; track j.kod) {
              <option [value]="j.kod">{{ j.naziv }}</option>
            }
          </select>
        </div>
        <div class="field">
          <label for="b-tz">Vremenska zona</label>
          <select id="b-tz" [formField]="f.timezone">
            @for (z of zone; track z) {
              <option [value]="z">{{ z }}</option>
            }
          </select>
        </div>
        <div class="field">
          <label for="b-color">Boja brenda</label>
          <input id="b-color" type="color" [formField]="f.color" style="padding:4px; width:80px" />
        </div>
      </div>
      <div class="row" style="margin-top:6px">
        <button class="btn primary" type="submit" [disabled]="f().submitting()">{{ f().submitting() ? 'Čuvam…' : dugme() }}</button>
        <ng-content />
      </div>
    </form>
  `,
})
export class BrandForm {
  readonly pocetno = input<Brand | null>(null);
  readonly dugme = input('Sačuvaj');
  /** Roditelj čuva u bazi; vraća poruku greške ili null. */
  readonly sacuvaj = input.required<(v: BrandInput) => Promise<void>>();

  protected readonly jezici = JEZICI;
  protected readonly zone = ZONE;

  private readonly model = signal<BrandInput>({
    name: '', website: '', instagram: '', language: 'sr', timezone: 'Europe/Belgrade', color: '#4b3fd1',
  });
  protected readonly f = form(this.model, (p) => {
    required(p.name, { message: 'Upiši naziv brenda.' });
    maxLength(p.name, 80, { message: 'Najviše 80 znakova.' });
    validate(p.website, ({ value }) => {
      const v = value().trim();
      if (!v) return undefined;
      return /^(https?:\/\/)?[^\s/]+\.[^\s]{2,}$/i.test(v) ? undefined : { kind: 'url', message: 'Upiši adresu sajta, npr. korak.rs' };
    });
    pattern(p.instagram, /^\s*(@?[A-Za-z0-9._]{1,30}|https?:\/\/(www\.)?instagram\.com\/[A-Za-z0-9._]{1,30}\/?)?\s*$/, {
      message: 'Upiši korisničko ime, npr. @korak.sneakers',
    });
  });

  constructor() {
    effect(() => {
      const b = this.pocetno();
      if (b) {
        this.model.set({
          name: b.name,
          website: b.website ?? '',
          instagram: b.instagram_handle ? `@${b.instagram_handle}` : '',
          language: b.language,
          timezone: b.timezone,
          color: b.color,
        });
      }
    });
  }

  protected async posalji(e: Event): Promise<void> {
    e.preventDefault();
    await submit(this.f, async () => {
      await this.sacuvaj()(this.model());
      return undefined;
    });
  }
}
