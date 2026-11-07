import { Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { porukaGreske, Supabase } from '../../core/supabase';
import { WorkspaceState } from '../../core/workspace';
import { BrandForm, normalizujInstagram, normalizujSajt, type BrandInput } from '../brendovi/brand-form';

@Component({
  selector: 'app-podesavanja-brenda',
  imports: [BrandForm],
  template: `
    <div class="page" style="max-width:760px">
      <div class="page-head"><div><h1>Podešavanja brenda</h1><p class="sub">{{ brand()?.name }}</p></div></div>
      @if (poruka()) {
        <div class="alert" [class.bad]="greska()" [class.ok]="!greska()" role="status">{{ poruka() }}</div>
      }
      @if (!ws.isAdmin()) {
        <div class="alert info">Podešavanja brenda menja vlasnik ili admin.</div>
      } @else {
        <div class="card">
          <app-brand-form [pocetno]="brand()" [sacuvaj]="sacuvaj" />
        </div>
        @if (ws.role() === 'owner') {
          <div class="card" style="margin-top:16px; border-color:#f0c9c5">
            <h2>Brisanje brenda</h2>
            <p class="small muted">Briše brend i sve što je vezano za njega. Ne može da se vrati.</p>
            @if (!potvrdaBrisanja()) {
              <button class="btn danger" type="button" (click)="potvrdaBrisanja.set(true)">Obriši brend…</button>
            } @else {
              <p><b>Sigurno brišeš „{{ brand()?.name }}“?</b></p>
              <div class="row">
                <button class="btn danger" type="button" (click)="obrisi()">Da, obriši zauvek</button>
                <button class="btn ghost" type="button" (click)="potvrdaBrisanja.set(false)">Odustani</button>
              </div>
            }
          </div>
        }
      }
    </div>
  `,
})
export default class PodesavanjaBrenda {
  protected readonly ws = inject(WorkspaceState);
  private readonly sb = inject(Supabase).client;
  private readonly router = inject(Router);
  readonly brandId = input.required<string>();

  protected readonly brand = computed(() => this.ws.brand(this.brandId()));
  protected readonly poruka = signal('');
  protected readonly greska = signal(false);
  protected readonly potvrdaBrisanja = signal(false);

  protected readonly sacuvaj = async (v: BrandInput): Promise<void> => {
    const { error } = await this.sb
      .from('brands')
      .update({
        name: v.name.trim(),
        website: normalizujSajt(v.website),
        instagram_handle: normalizujInstagram(v.instagram),
        language: v.language,
        timezone: v.timezone,
        color: v.color,
      })
      .eq('id', this.brandId());
    this.greska.set(!!error);
    this.poruka.set(error ? porukaGreske(error) : 'Sačuvano.');
    if (!error) await this.ws.loadBrands();
  };

  protected async obrisi(): Promise<void> {
    const { error } = await this.sb.from('brands').delete().eq('id', this.brandId());
    if (error) {
      this.greska.set(true);
      this.poruka.set(porukaGreske(error));
      return;
    }
    await this.ws.loadBrands();
    await this.router.navigate(['/brendovi']);
  }
}
