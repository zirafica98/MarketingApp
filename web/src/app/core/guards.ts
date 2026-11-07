import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { Auth } from './auth';
import { WorkspaceState } from './workspace';

/** Samo prijavljeni; ostale šalje na prijavu i pamti kuda su krenuli. */
export const authGuard: CanActivateFn = async (_r, state) => {
  const auth = inject(Auth);
  const router = inject(Router);
  await auth.init;
  return auth.user() ? true : router.createUrlTree(['/prijava'], { queryParams: { nazad: state.url } });
};

/** Prijavljeni bez radnog prostora idu na početak. */
export const workspaceGuard: CanActivateFn = async () => {
  const ws = inject(WorkspaceState);
  const router = inject(Router);
  await ws.ensureLoaded();
  return ws.current() ? true : router.createUrlTree(['/pocetak']);
};

/** Već prijavljeni ne treba da vide ekran za prijavu. */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(Auth);
  const router = inject(Router);
  await auth.init;
  return auth.user() ? router.createUrlTree(['/']) : true;
};

/** Brend mora da postoji u izabranom radnom prostoru i korisnik mora da ga vidi. */
export const brandGuard: CanActivateFn = async (route) => {
  const ws = inject(WorkspaceState);
  const router = inject(Router);
  await ws.ensureLoaded();
  const id = route.paramMap.get('brandId');
  if (ws.brand(id)) return true;
  // Možda je brend iz drugog radnog prostora korisnika.
  for (const w of ws.workspaces()) {
    if (w.id === ws.current()?.id) continue;
    await ws.select(w.id);
    if (ws.brand(id)) return true;
  }
  return router.createUrlTree(['/brendovi']);
};
