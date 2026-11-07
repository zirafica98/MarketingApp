import { computed, inject, Service, signal } from '@angular/core';
import { Auth } from './auth';
import type { Brand, Role, Workspace } from './models';
import { Supabase } from './supabase';

const KEY_WS = 'mp.workspace';

/** Radni prostori korisnika, izabrani radni prostor i njegovi brendovi (samo oni koje korisnik sme da vidi). */
@Service()
export class WorkspaceState {
  private readonly sb = inject(Supabase).client;
  private readonly auth = inject(Auth);

  readonly workspaces = signal<Workspace[]>([]);
  readonly brands = signal<Brand[]>([]);
  readonly loaded = signal(false);
  private readonly selectedId = signal<string | null>(localStorage.getItem(KEY_WS));

  readonly current = computed<Workspace | null>(() => {
    const all = this.workspaces();
    return all.find((w) => w.id === this.selectedId()) ?? all[0] ?? null;
  });
  readonly role = computed<Role | null>(() => this.current()?.role ?? null);
  readonly isAdmin = computed(() => this.role() === 'owner' || this.role() === 'admin');
  readonly canEdit = computed(() => this.isAdmin() || this.role() === 'editor');

  private loading: Promise<void> | null = null;
  private loadedFor: string | null = null;

  /** Učitava jednom po prijavljenom korisniku (ili ponovo sa force). */
  async ensureLoaded(force = false): Promise<void> {
    // Guard-ovi rade istovremeno: sesija mora biti pročitana pre nego što znamo ko je korisnik.
    await this.auth.init;
    const uid = this.auth.userId();
    if (uid !== this.loadedFor) {
      // drugi korisnik (ili odjava): zaboravi sve
      this.workspaces.set([]);
      this.brands.set([]);
      this.loaded.set(false);
      this.loading = null;
      this.loadedFor = uid;
    }
    if (!force && this.loading) return this.loading;
    this.loading = this.load().catch((e) => {
      this.loading = null;
      throw e;
    });
    return this.loading;
  }

  private async load(): Promise<void> {
    const uid = this.auth.userId();
    if (!uid) return;
    const { data, error } = await this.sb
      .from('workspace_members')
      .select('role, brand_ids, workspace:workspaces(id, name)')
      .eq('user_id', uid);
    if (error) throw error;
    const list = (data ?? [])
      .map((r) => {
        const ws = r.workspace as unknown as { id: string; name: string } | null;
        return ws ? { id: ws.id, name: ws.name, role: r.role as Role, brand_ids: r.brand_ids as string[] | null } : null;
      })
      .filter((w): w is Workspace => !!w)
      .sort((a, b) => a.name.localeCompare(b.name, 'sr'));
    this.workspaces.set(list);
    await this.loadBrands();
    this.loaded.set(true);
  }

  async loadBrands(): Promise<void> {
    const ws = this.current();
    if (!ws) {
      this.brands.set([]);
      return;
    }
    const { data, error } = await this.sb
      .from('brands')
      .select('id, workspace_id, name, website, instagram_handle, language, timezone, color, created_at')
      .eq('workspace_id', ws.id)
      .order('created_at');
    if (error) throw error;
    this.brands.set((data ?? []) as Brand[]);
  }

  async select(workspaceId: string): Promise<void> {
    this.selectedId.set(workspaceId);
    localStorage.setItem(KEY_WS, workspaceId);
    await this.loadBrands();
  }

  async create(name: string): Promise<string> {
    const { data, error } = await this.sb.rpc('create_workspace', { p_name: name });
    if (error) throw error;
    const id = data as string;
    this.selectedId.set(id);
    localStorage.setItem(KEY_WS, id);
    await this.ensureLoaded(true);
    return id;
  }

  brand(id: string | null | undefined): Brand | null {
    return this.brands().find((b) => b.id === id) ?? null;
  }
}
