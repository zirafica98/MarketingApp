import { computed, inject, Service, signal } from '@angular/core';
import type { Session } from '@supabase/supabase-js';
import { Supabase } from './supabase';

@Service()
export class Auth {
  private readonly sb = inject(Supabase).client;
  private readonly _session = signal<Session | null>(null);
  private readonly _ready = signal(false);

  readonly session = this._session.asReadonly();
  readonly ready = this._ready.asReadonly();
  readonly user = computed(() => this._session()?.user ?? null);
  readonly userId = computed(() => this.user()?.id ?? null);

  /** Rezultat prvog čitanja sesije; guard-ovi čekaju na njega. */
  readonly init: Promise<void>;

  constructor() {
    this.init = this.sb.auth.getSession().then(({ data }) => {
      this._session.set(data.session);
      this._ready.set(true);
    });
    this.sb.auth.onAuthStateChange((_e, s) => this._session.set(s));
  }

  async signIn(email: string, password: string): Promise<void> {
    const { error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async signUp(fullName: string, email: string, password: string): Promise<{ needsConfirmation: boolean }> {
    const { data, error } = await this.sb.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName }, emailRedirectTo: `${location.origin}/` },
    });
    if (error) throw error;
    return { needsConfirmation: !data.session };
  }

  async signOut(): Promise<void> {
    await this.sb.auth.signOut();
  }
}
