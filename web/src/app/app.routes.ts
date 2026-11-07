import type { Routes } from '@angular/router';
import { authGuard, brandGuard, guestGuard, workspaceGuard } from './core/guards';

export const routes: Routes = [
  { path: 'prijava', canActivate: [guestGuard], title: 'Prijava · Marketing Pilot', loadComponent: () => import('./pages/auth/prijava') },
  { path: 'registracija', canActivate: [guestGuard], title: 'Nalog · Marketing Pilot', loadComponent: () => import('./pages/auth/registracija') },
  { path: 'poziv/:token', canActivate: [authGuard], title: 'Poziv · Marketing Pilot', loadComponent: () => import('./pages/poziv/poziv') },
  { path: 'privatnost', title: 'Politika privatnosti · Marketing Pilot', data: { vrsta: 'privatnost' }, loadComponent: () => import('./pages/pravno/pravno') },
  { path: 'uslovi', title: 'Uslovi korišćenja · Marketing Pilot', data: { vrsta: 'uslovi' }, loadComponent: () => import('./pages/pravno/pravno') },
  { path: 'pocetak', canActivate: [authGuard], title: 'Početak · Marketing Pilot', loadComponent: () => import('./pages/pocetak/pocetak') },
  {
    path: '',
    canActivate: [authGuard, workspaceGuard],
    loadComponent: () => import('./shell/shell'),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'brendovi' },
      { path: 'brendovi', title: 'Moji brendovi · Marketing Pilot', loadComponent: () => import('./pages/brendovi/brendovi') },
      { path: 'brendovi/novi', title: 'Novi brend · Marketing Pilot', loadComponent: () => import('./pages/brendovi/novi-brend') },
      { path: 'kalendar', title: 'Kalendar svih brendova · Marketing Pilot', loadComponent: () => import('./pages/kalendar/kalendar') },
      { path: 'plan', title: 'Plan i potrošnja · Marketing Pilot', loadComponent: () => import('./pages/radni-prostor/plan') },
      { path: 'ai', title: 'AI i agenti · Marketing Pilot', loadComponent: () => import('./pages/radni-prostor/ai') },
      { path: 'tim', title: 'Tim i uloge · Marketing Pilot', loadComponent: () => import('./pages/tim/tim') },
      {
        path: 'b/:brandId',
        canActivate: [brandGuard],
        children: [
          { path: '', pathMatch: 'full', title: 'Brend · Marketing Pilot', loadComponent: () => import('./pages/brend/pregled') },
          { path: 'podesavanja', title: 'Podešavanja brenda · Marketing Pilot', loadComponent: () => import('./pages/brend/podesavanja') },
          { path: 'upitnik', title: 'Upitnik · Marketing Pilot', loadComponent: () => import('./pages/onboarding/upitnik') },
          { path: 'razgovor', title: 'Razgovor sa agentom · Marketing Pilot', loadComponent: () => import('./pages/onboarding/razgovor') },
          { path: 'konektori', title: 'Konektori · Marketing Pilot', loadComponent: () => import('./pages/konektori/konektori') },
          { path: 'analitika', title: 'Analitika · Marketing Pilot', loadComponent: () => import('./pages/analitika/analitika') },
          { path: 'strategija', title: 'Strategija · Marketing Pilot', loadComponent: () => import('./pages/strategija/strategija') },
          { path: 'za-pregled', title: 'Za pregled · Marketing Pilot', loadComponent: () => import('./pages/pregled/za-pregled') },
          { path: 'kalendar', title: 'Kalendar · Marketing Pilot', loadComponent: () => import('./pages/kalendar/kalendar') },
          { path: 'sta-radi', title: 'Šta radi za ovaj brend · Marketing Pilot', loadComponent: () => import('./pages/ucenje/sta-radi') },
          { path: 'kampanje', title: 'Kampanje · Marketing Pilot', loadComponent: () => import('./pages/kampanje/kampanje') },
          { path: 'profil', title: 'Brend profil · Marketing Pilot', loadComponent: () => import('./pages/onboarding/profil') },
          { path: ':modul', title: 'Uskoro · Marketing Pilot', loadComponent: () => import('./pages/brend/uskoro') },
        ],
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
