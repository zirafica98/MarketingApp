import { Component, input } from '@angular/core';
import type { FieldTree } from '@angular/forms/signals';

/** Greške polja, prikazane tek kad korisnik napusti polje ili pokuša slanje. */
@Component({
  selector: 'app-field-errors',
  template: `
    @let s = field()();
    @if (s.touched() && s.invalid()) {
      <span class="err" [id]="errId()" role="alert">
        @for (e of s.errors(); track e.kind) {
          {{ e.message }}
        }
      </span>
    }
  `,
  host: { style: 'display: contents' },
})
export class FieldErrors {
  readonly field = input.required<FieldTree<unknown>>();
  readonly errId = input<string | null>(null);
}
