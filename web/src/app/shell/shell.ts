import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { Auth } from '../core/auth';
import { ROLE_LABEL } from '../core/models';
import { WorkspaceState } from '../core/workspace';
import { MODULI } from '../pages/brend/moduli';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
  host: { '[class.menu-open]': 'menuOpen()' },
})
export default class Shell {
  protected readonly ws = inject(WorkspaceState);
  protected readonly auth = inject(Auth);
  private readonly router = inject(Router);

  protected readonly roleLabel = ROLE_LABEL;
  protected readonly moduli = MODULI;
  protected readonly menuOpen = signal(false);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  protected readonly brandId = computed(() => /^\/b\/([^/?#]+)/.exec(this.url())?.[1] ?? null);
  protected readonly brand = computed(() => this.ws.brand(this.brandId()));
  protected readonly displayName = computed(() => {
    const u = this.auth.user();
    return (u?.user_metadata?.['full_name'] as string | undefined) || u?.email || '';
  });

  constructor() {
    // posle navigacije na telefonu zatvori meni
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => this.menuOpen.set(false));
  }

  protected inicijali(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('');
  }

  protected async promeniRadniProstor(id: string): Promise<void> {
    await this.ws.select(id);
    await this.router.navigate(['/brendovi']);
  }

  protected async promeniBrend(id: string): Promise<void> {
    await this.router.navigate(id ? ['/b', id] : ['/brendovi']);
  }

  protected async odjava(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigate(['/prijava']);
  }
}
