import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Auth } from '../../core/auth';
import { porukaGreske, Supabase } from '../../core/supabase';
import { WorkspaceState } from '../../core/workspace';
import { BrandForm, normalizujInstagram, normalizujSajt, type BrandInput } from './brand-form';

@Component({
  selector: 'app-novi-brend',
  imports: [BrandForm, RouterLink],
  template: `
    <div class="page" style="max-width:760px">
      <div class="page-head">
        <div>
          <h1>Novi brend</h1>
          <p class="sub">Radni prostor „{{ ws.current()?.name }}“. Ostalo (upitnik, mreže, prodavnica) popunjavamo u sledećim koracima.</p>
        </div>
      </div>
      @if (!ws.isAdmin()) {
        <div class="alert info">Brendove dodaje vlasnik ili admin radnog prostora.</div>
      } @else {
        @if (greska()) {
          <div class="alert bad" role="alert">{{ greska() }}</div>
        }
        <div class="card">
          <app-brand-form dugme="Napravi brend" [sacuvaj]="sacuvaj">
            <a class="btn ghost" routerLink="/brendovi">Odustani</a>
          </app-brand-form>
        </div>
      }
    </div>
  `,
})
export default class NoviBrend {
  protected readonly ws = inject(WorkspaceState);
  private readonly sb = inject(Supabase).client;
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  protected readonly greska = signal('');

  protected readonly sacuvaj = async (v: BrandInput): Promise<void> => {
    this.greska.set('');
    const ws = this.ws.current();
    if (!ws) return;
    const { data, error } = await this.sb
      .from('brands')
      .insert({
        workspace_id: ws.id,
        name: v.name.trim(),
        website: normalizujSajt(v.website),
        instagram_handle: normalizujInstagram(v.instagram),
        language: v.language,
        timezone: v.timezone,
        color: v.color,
        created_by: this.auth.userId(),
      })
      .select('id')
      .single();
    if (error) {
      this.greska.set(porukaGreske(error));
      return;
    }
    await this.ws.loadBrands();
    await this.router.navigate(['/b', data.id]);
  };
}
