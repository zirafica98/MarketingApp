import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { email, form, FormField, required, submit } from '@angular/forms/signals';
import { Auth } from '../../core/auth';
import { FieldErrors } from '../../core/field-errors';
import { ROLE_LABEL, ROLE_OPIS, type Invitation, type Member, type Role } from '../../core/models';
import { porukaGreske, Supabase } from '../../core/supabase';
import { WorkspaceState } from '../../core/workspace';

const ULOGE_ZA_POZIV: Role[] = ['admin', 'editor', 'approver', 'viewer'];

@Component({
  selector: 'app-tim',
  imports: [FormField, FieldErrors, DatePipe],
  templateUrl: './tim.html',
  styles: `
    .brendovi { display: flex; flex-wrap: wrap; gap: 4px 16px; }
    fieldset { border: 1px solid var(--line); border-radius: 12px; padding: 10px 14px; margin: 0 0 14px; }
    legend { font-weight: 600; padding: 0 4px; }
    .uloge { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; }
    .uloga { display: flex; gap: 8px; border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; cursor: pointer; }
    .uloga:has(input:checked) { border-color: var(--accent); background: var(--accent-soft); }
    .uloga input { accent-color: var(--accent); margin-top: 3px; }
  `,
})
export default class Tim {
  protected readonly ws = inject(WorkspaceState);
  private readonly sb = inject(Supabase).client;
  protected readonly auth = inject(Auth);

  protected readonly roleLabel = ROLE_LABEL;
  protected readonly roleOpis = ROLE_OPIS;
  protected readonly uloge = ULOGE_ZA_POZIV;

  protected readonly clanovi = signal<Member[]>([]);
  protected readonly pozivi = signal<Invitation[]>([]);
  protected readonly poruka = signal('');
  protected readonly greska = signal('');
  protected readonly noviLink = signal('');
  protected readonly izmena = signal<{ userId: string; role: Role; svi: boolean; brandIds: string[] } | null>(null);

  protected readonly otvoreniPozivi = computed(() => this.pozivi().filter((p) => !p.accepted_at));

  // poziv
  private readonly model = signal({ email: '', role: 'editor' as Role, svi: true });
  protected readonly izabraniBrendovi = signal<string[]>([]);
  protected readonly f = form(this.model, (p) => {
    required(p.email, { message: 'Upiši mejl.' });
    email(p.email, { message: 'Mejl nije ispravan.' });
  });

  constructor() {
    effect(() => {
      const ws = this.ws.current();
      if (ws) void this.ucitaj(ws.id);
    });
  }

  private async ucitaj(wsId: string): Promise<void> {
    const [m, i] = await Promise.all([
      this.sb
        .from('workspace_members')
        .select('user_id, role, brand_ids, created_at, profile:profiles(full_name, email)')
        .eq('workspace_id', wsId)
        .order('created_at'),
      this.ws.isAdmin()
        ? this.sb.from('invitations').select('*').eq('workspace_id', wsId).order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (m.error) this.greska.set(porukaGreske(m.error));
    this.clanovi.set((m.data ?? []) as unknown as Member[]);
    this.pozivi.set((i.data ?? []) as Invitation[]);
  }

  protected brendoviClana(ids: string[] | null): string {
    if (!ids) return 'svi brendovi';
    const imena = ids.map((id) => this.ws.brand(id)?.name).filter(Boolean);
    return imena.length ? imena.join(', ') : '—';
  }

  protected link(token: string): string {
    return `${location.origin}/poziv/${token}`;
  }

  protected prebaci(lista: string[], id: string, on: boolean): string[] {
    return on ? [...new Set([...lista, id])] : lista.filter((x) => x !== id);
  }

  protected postaviUlogu(r: Role): void {
    this.model.update((m) => ({ ...m, role: r, svi: r === 'admin' ? true : m.svi }));
  }
  protected postaviSve(svi: boolean): void {
    this.model.update((m) => ({ ...m, svi }));
  }
  protected uloga(): Role {
    return this.model().role;
  }
  protected svi(): boolean {
    return this.model().svi;
  }

  protected async pozovi(e: Event): Promise<void> {
    e.preventDefault();
    this.greska.set('');
    this.noviLink.set('');
    const ws = this.ws.current();
    if (!ws) return;
    const { email: m, role, svi } = this.model();
    if (!svi && this.izabraniBrendovi().length === 0) {
      this.greska.set('Izaberi bar jedan brend ili „Svi brendovi“.');
      return;
    }
    await submit(this.f, async () => {
      const { data, error } = await this.sb.rpc('invite_member', {
        p_workspace: ws.id,
        p_email: m.trim(),
        p_role: role,
        p_brand_ids: svi || role === 'admin' ? null : this.izabraniBrendovi(),
      });
      if (error) {
        this.greska.set(porukaGreske(error));
        return undefined;
      }
      this.noviLink.set(this.link(data as string));
      this.model.set({ email: '', role: 'editor', svi: true });
      this.f().reset();
      this.izabraniBrendovi.set([]);
      await this.ucitaj(ws.id);
      return undefined;
    });
  }

  protected async kopiraj(t: string): Promise<void> {
    await navigator.clipboard.writeText(t);
    this.poruka.set('Link je kopiran.');
    setTimeout(() => this.poruka.set(''), 2500);
  }

  protected async otkaziPoziv(id: string): Promise<void> {
    const { error } = await this.sb.from('invitations').delete().eq('id', id);
    if (error) this.greska.set(porukaGreske(error));
    const ws = this.ws.current();
    if (ws) await this.ucitaj(ws.id);
  }

  protected zapocniIzmenu(c: Member): void {
    this.izmena.set({ userId: c.user_id, role: c.role, svi: !c.brand_ids, brandIds: c.brand_ids ?? [] });
  }

  protected async sacuvajIzmenu(): Promise<void> {
    const iz = this.izmena();
    const ws = this.ws.current();
    if (!iz || !ws) return;
    if (!iz.svi && iz.role !== 'admin' && iz.brandIds.length === 0) {
      this.greska.set('Izaberi bar jedan brend ili „Svi brendovi“.');
      return;
    }
    const { error } = await this.sb.rpc('update_member', {
      p_workspace: ws.id,
      p_user: iz.userId,
      p_role: iz.role,
      p_brand_ids: iz.svi || iz.role === 'admin' ? null : iz.brandIds,
    });
    if (error) {
      this.greska.set(porukaGreske(error));
      return;
    }
    this.izmena.set(null);
    this.greska.set('');
    await this.ucitaj(ws.id);
  }

  protected async ukloni(c: Member): Promise<void> {
    const ws = this.ws.current();
    if (!ws) return;
    if (!confirm(`Ukloniti ${c.profile?.full_name || c.profile?.email} iz radnog prostora?`)) return;
    const { error } = await this.sb.rpc('remove_member', { p_workspace: ws.id, p_user: c.user_id });
    if (error) this.greska.set(porukaGreske(error));
    else await this.ucitaj(ws.id);
  }

  protected mozeIzmenu(c: Member): boolean {
    if (!this.ws.isAdmin() || c.role === 'owner' || c.user_id === this.auth.userId()) return false;
    return c.role !== 'admin' || this.ws.role() === 'owner';
  }
}
