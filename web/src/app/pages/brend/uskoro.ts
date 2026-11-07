import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MODULI } from './moduli';

@Component({
  selector: 'app-uskoro',
  imports: [RouterLink],
  template: `
    <div class="page" style="max-width:760px">
      @if (m(); as m) {
        <div class="page-head"><div><h1>{{ m.ikona }} {{ m.naziv }}</h1><p class="sub">Dolazi u: <b>{{ m.faza }}</b></p></div></div>
        <div class="card">
          <p style="margin-top:0">{{ m.opis }}</p>
          <p class="small muted">Izgled ovog ekrana je u dizajnu (dizajn/index.html). Plan i redosled su u PLAN.md.</p>
          <a class="btn" [routerLink]="['/b', brandId()]">← Nazad na pregled brenda</a>
        </div>
      } @else {
        <h1>Ova stranica ne postoji</h1>
        <a class="btn" [routerLink]="['/b', brandId()]">← Nazad na pregled brenda</a>
      }
    </div>
  `,
})
export default class Uskoro {
  readonly brandId = input.required<string>();
  readonly modul = input.required<string>();
  protected readonly m = computed(() => MODULI.find((x) => x.slug === this.modul()) ?? null);
}
