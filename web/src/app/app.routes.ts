import type { Routes } from '@angular/router';
import { authGuard, brandGuard, guestGuard, workspaceGuard } from './core/guards';

export const routes: Routes = [
  { path: 'prijava', canActivate: [guestGuard], title: 'Prijava · Marketing Pilot', loadComponent: () => import('./pages/auth/prijava') },
  { path: 'registracija', canActivate: [guestGuard], title: 'Nalog · Marketing Pilot', loadComponent: () => import('./pages/auth/registracija') },
  { path: 'poziv/:token', canActivate: [authGuard], title: 'Poziv · Marketing Pilot', loadComponent: () => import('./pages/poziv/poziv') },
  { path: 'pocetak', canActivate: [authGuard], title: 'Početak · Marketing Pilot', loadComponent: () => import('./pages/pocetak/pocetak') },
  {
    path: '',
    canActivate: [authGuard, workspaceGuard],
    loadComponent: () => import('./shell/shell'),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'brendovi' },
      { path: 'brendovi', title: 'Moji brendovi · Marketing Pilot', loadComponent: () => import('./pages/brendovi/brendovi') },
      { path: 'brendovi/novi', title: 'Novi brend · Marketing Pilot', loadComponent: () => import('./pages/brendovi/novi-brend') },
      { path: 'tim', title: 'Tim i uloge · Marketing Pilot', loadComponent: () => import('./pages/tim/tim') },
      {
        path: 'b/:brandId',
        canActivate: [brandGuard],
        children: [
          { path: '', pathMatch: 'full', title: 'Brend · Marketing Pilot', loadComponent: () => import('./pages/brend/pregled') },
          { path: 'podesavanja', title: 'Podešavanja brenda · Marketing Pilot', loadComponent: () => import('./pages/brend/podesavanja') },
          { path: ':modul', title: 'Uskoro · Marketing Pilot', loadComponent: () => import('./pages/brend/uskoro') },
        ],
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
