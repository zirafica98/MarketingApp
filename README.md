# Marketing Pilot

Centralno mesto za marketing više brendova: onboarding, konektori za mreže, AI agenti, odobravanje i analitika.
Plan: [PLAN.md](PLAN.md) · Dizajn ekrana: [dizajn/index.html](dizajn/index.html)

## Stanje: Faza 0 (temelj) ✅

- Nalog (mejl + lozinka), radni prostori, **više brendova** i prebacivanje između njih
- Tim: pozivi linkom, uloge (vlasnik, admin, urednik, odobrava, posmatrač), ograničenje člana na pojedine brendove
- Pravila pristupa u bazi (RLS) + 30 automatskih testova (`npm run db:test`)
- Red poslova u bazi (`jobs`) + worker; AI sloj `ai-provider` (sada Claude Code sa tvojom pretplatom)
- Ekrani budućih delova (upitnik, konektori, analitika…) postoje u meniju sa oznakom faze

## Delovi

```
web/        Angular 22 (signali, Signal Forms), port 4300
worker/     Node 23+ (TypeScript bez build-a): uzima poslove iz reda, poziva agente
supabase/   migracije (šema, RLS, funkcije), testovi pristupa (pgTAP), lokalna konfiguracija (portovi 553xx)
dizajn/     statički klikabilan dizajn svih ekrana
```

## Pokretanje lokalno

Prvi put: `npm install` u korenu, u `web/` i u `worker/`, pa `cp .env.example .env.local`.

| Komanda (iz korena) | Šta radi |
|---|---|
| `npm run db:start` | lokalni Supabase (Docker), primeni migracije; Studio: http://127.0.0.1:55323 |
| `npm run db:test` | testovi pravila pristupa |
| `npm run db:reset` | obriši lokalnu bazu i primeni migracije ispočetka |
| `npm run web` | aplikacija na http://localhost:4300 |
| `npm run worker` | worker (mora da radi da bi se poslovi izvršavali) |
| `npm run db:stop` | ugasi lokalni Supabase |

Lokalni Supabase je na portovima **55321–55327**, da se ne sudara sa Rastemo bazom (54321…).
Mejlovi (npr. potvrde) se lokalno vide u Mailpit-u: http://127.0.0.1:55324.

### Lokalni test nalozi

Napravljeni ručno kroz aplikaciju pri proveri Faze 0 (postoje samo u lokalnoj bazi; `npm run db:reset` ih briše):

| Nalog | Lozinka | Uloga |
|---|---|---|
| mihajlo@test.local | `Proba-12345!` | vlasnik radnog prostora „Mihajlo Test“ (brendovi Dnevnik trudnoće i Korak Sneakers) |
| ana@test.local | `Proba-12345!` | odobrava, samo za Dnevnik trudnoće |

## AI

Worker poziva Claude preko `claude -p` (isti način kao AI News), sa JSON šemom na izlazu. Svaki poziv se upisuje u `agent_runs` (model, trajanje, trošak, greška).
Pretplata je lična: **samo za naše brendove i testiranje**. Za spoljne korisnike dolazi Anthropic API ključ (naš ili korisnikov) kao nova implementacija `AiProvider` (`worker/src/ai/`).

## Novi tip posla

1. Rukovalac u `worker/src/jobs/index.ts`
2. Tip u listi dozvoljenih u `public.enqueue_job` (nova migracija)
