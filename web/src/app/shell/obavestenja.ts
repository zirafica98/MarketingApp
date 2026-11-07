import { DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { Auth } from '../core/auth';
import { Supabase } from '../core/supabase';
import { WorkspaceState } from '../core/workspace';

interface Obavestenje {
  id: string;
  brand_id: string | null;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
}

/** Zvonce u meniju: ručne objave, greške objave, pukle veze, nedeljni izveštaji. */
@Component({
  selector: 'app-obavestenja',
  imports: [DatePipe],
  template: `
    <button class="btn small zvono" type="button" (click)="otvori()" [attr.aria-expanded]="otvoreno()" aria-controls="obav-panel"
            [attr.aria-label]="'Obaveštenja, nepročitanih: ' + neprocitano()">
      🔔 @if (neprocitano()) { <span class="broj">{{ neprocitano() }}</span> }
    </button>
    @if (otvoreno()) {
      <div id="obav-panel" class="panel" role="dialog" aria-label="Obaveštenja">
        <div class="row between"><b>Obaveštenja</b><button class="btn small ghost" type="button" (click)="otvoreno.set(false)">Zatvori</button></div>
        <ul>
          @for (o of lista(); track o.id) {
            <li [class.novo]="!procitana().has(o.id)">
              <button type="button" (click)="idi(o)">
                <b>{{ o.title }}</b>
                @if (o.body) { <span class="small">{{ o.body }}</span> }
                <span class="small muted">{{ o.created_at | date: 'd. M. HH:mm' }}@if (o.brand_id) { · {{ ws.brand(o.brand_id)?.name }} }</span>
              </button>
            </li>
          } @empty {
            <li class="small muted" style="padding:10px">Nema obaveštenja.</li>
          }
        </ul>
      </div>
    }
  `,
  styles: `
    :host { position: relative; display: block; }
    .zvono { position: relative; }
    .broj { background: var(--bad); color: #fff; border-radius: 99px; font-size: 11px; padding: 0 6px; margin-left: 4px; }
    .panel { position: absolute; z-index: 20; left: 0; top: 40px; width: 330px; max-height: 70vh; overflow: auto; background: #fff; border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 10px 30px rgba(0,0,0,.12); padding: 10px; }
    ul { list-style: none; padding: 0; margin: 8px 0 0; }
    li button { all: unset; box-sizing: border-box; width: 100%; display: flex; flex-direction: column; gap: 2px; padding: 8px; border-radius: 10px; cursor: pointer; }
    li button:hover, li button:focus-visible { background: #f5f3ef; outline: 2px solid var(--accent); }
    li.novo button { background: var(--accent-soft); }
  `,
})
export class Obavestenja {
  private readonly sb = inject(Supabase).client;
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  protected readonly ws = inject(WorkspaceState);

  protected readonly lista = signal<Obavestenje[]>([]);
  protected readonly procitana = signal<Set<string>>(new Set());
  protected readonly otvoreno = signal(false);
  protected readonly neprocitano = computed(() => this.lista().filter((o) => !this.procitana().has(o.id)).length);
  private kanal: RealtimeChannel | null = null;

  constructor() {
    effect(() => {
      const ws = this.ws.current()?.id;
      untracked(() => void this.start(ws));
    });
    inject(DestroyRef).onDestroy(() => this.kanal && void this.sb.removeChannel(this.kanal));
  }

  private async start(ws: string | undefined): Promise<void> {
    if (this.kanal) await this.sb.removeChannel(this.kanal);
    this.kanal = null;
    if (!ws) return;
    await this.ucitaj(ws);
    this.kanal = this.sb.channel(`obavestenja-${ws}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `workspace_id=eq.${ws}` }, () => void this.ucitaj(ws))
      .subscribe();
  }

  private async ucitaj(ws: string): Promise<void> {
    const [n, r] = await Promise.all([
      this.sb.from('notifications').select('id, brand_id, kind, title, body, link, created_at').eq('workspace_id', ws).order('created_at', { ascending: false }).limit(30),
      this.sb.from('notification_reads').select('notification_id').eq('user_id', this.auth.userId()),
    ]);
    this.lista.set((n.data ?? []) as Obavestenje[]);
    this.procitana.set(new Set((r.data ?? []).map((x) => x.notification_id as string)));
  }

  protected async otvori(): Promise<void> {
    this.otvoreno.update((x) => !x);
    if (!this.otvoreno()) return;
    const nove = this.lista().filter((o) => !this.procitana().has(o.id)).map((o) => o.id);
    if (nove.length) {
      await this.sb.rpc('mark_notifications_read', { p_ids: nove });
      // ostaju istaknuta dok je panel otvoren; broj se gasi
      setTimeout(() => this.procitana.update((s) => new Set([...s, ...nove])), 4000);
    }
  }

  protected async idi(o: Obavestenje): Promise<void> {
    this.otvoreno.set(false);
    if (o.link) await this.router.navigateByUrl(o.link);
  }
}
