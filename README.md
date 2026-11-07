# Marketing Pilot

Centralno mesto za marketing više brendova: onboarding, konektori za mreže, AI agenti, odobravanje, objava, analitika i učenje.
Plan: [PLAN.md](PLAN.md) · Dizajn ekrana: [dizajn/index.html](dizajn/index.html)

## Stanje: faze 0–7 urađene u kodu, provereno lokalno

| Faza | Šta radi | Provereno |
|---|---|---|
| 0. Temelj | nalog, radni prostori, više brendova, tim i uloge (ograničenje po brendu), red poslova, worker | pregledač + testovi |
| 1. Onboarding | brzi početak, upitnik (8 grupa) sa predlozima agenta, Istraživač sajta i konkurenata, razgovor, brend profil, „Šta još fali“ | na dnevniktrudnoce.com |
| 2. Konektori i analitika | katalog sa uputstvima; Instagram i Threads (OAuth), Telegram (token), ručni režim za ostale; šifrovani tokeni; dnevna sinhronizacija; ekran Analitika | ručni režim i Telegram provera uživo; Instagram/Threads samo testovima (nema Meta aplikacije); analitika na demo podacima |
| 3. Strategija i nacrti | Strateg (revizija, stubovi, raspored, A/B eksperimenti), nacrti nedelje (Pisac → Urednik → slike 1080×1350), Za pregled, kalendar brenda i svih brendova | pregledač, pravi Claude |
| 4. Objava | raspoređivač objavljuje zakazano, jedan red po kanalu (bez duplikata), ručni režim sa obaveštenjem, „Objavljeno“, greške i ponovni pokušaj, zvonce | ručni tok i greška uživo; automatska objava samo testom (nema Meta aplikacije) |
| 5. Učenje | Učitelj: brojke računa kod, pravila sa dokazom i sigurnošću (iz analitike i iz tvojih odluka), nedeljni izveštaj, predlog izmene strategije; zaključaj/izmeni/obriši/dodaj pravilo | pregledač, pravi Claude |
| 6. Prodaja i kampanje | Shopify i WooCommerce (katalog proizvoda), kampanje (plan objava po fazama, proizvodi u fokusu) | kampanja uživo; prodavnice samo testovima |
| 7. Za spoljne korisnike | planovi i ograničenja u bazi, Plan i potrošnja, Stripe (checkout + webhook), sopstveni Anthropic ključ, model po agentu, privatnost i uslovi (nacrt) | pregledač; Stripe samo testom potpisa |

Testovi: `npm run db:test` (90 testova pravila pristupa) i `npm test` u `worker/` (15).

### Šta traži spoljne naloge (ne može lokalno)

1. **Meta aplikacija** (Instagram + Threads): `INSTAGRAM_APP_ID/SECRET`, `THREADS_APP_ID/SECRET`, redirect `WORKER_PUBLIC_URL/oauth/<kanal>/povratak`, pa **App Review** za tuđe naloge. Instagram preuzima slike sa javnog URL-a, pa automatska objava radi tek sa javnim Supabase-om (ne sa localhost-a).
2. **Anthropic API ključ** (`ANTHROPIC_API_KEY`) za planove; pretplata (`AI_PROVIDER=claude-code`) samo za naše brendove.
3. **Stripe**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, cene `STRIPE_PRICE_PRO/AGENCIJA`.
4. **Server**: worker na serveru (Fly.io/Railway) sa Chromium-om (`CHROME_BIN`), Supabase u oblaku, veb na Vercel-u (`web/src/app/core/config.ts` preko fileReplacements).
5. **Pravnik**: privatnost i uslovi su nacrt. TikTok, YouTube, LinkedIn, Pinterest, Google: ručni režim dok platforme ne odobre aplikaciju.

## Delovi

```
web/        Angular 22 (signali, Signal Forms), port 4300
worker/     Node 23+ (TypeScript bez build-a): red poslova, agenti, raspoređivač, HTTP (OAuth, tokeni, AI ključ, Stripe) na 8787
shared/     definicije koje dele web i worker (upitnik, konektori, statistika)
supabase/   migracije, testovi pristupa (pgTAP), demo/ (lokalni demo podaci za analitiku)
dizajn/     statički klikabilan dizajn svih ekrana
```

## Pokretanje lokalno

Prvi put: `npm install` u korenu, u `web/` i u `worker/`, pa `cp .env.example .env.local` i popuni (vidi komentare u fajlu).

| Komanda (iz korena) | Šta radi |
|---|---|
| `npm run db:start` | lokalni Supabase (Docker), primeni migracije; Studio: http://127.0.0.1:55323 |
| `npm run db:test` | testovi pravila pristupa |
| `npm run db:reset` | obriši lokalnu bazu i primeni migracije ispočetka |
| `npm run web` | aplikacija na http://localhost:4300 |
| `npm run worker` | worker: poslovi, raspoređivač (svaki minut), HTTP na 8787 |
| `npm run db:stop` | ugasi lokalni Supabase |

Lokalni Supabase je na portovima **55321–55327**, da se ne sudara sa Rastemo bazom (54321…). Mejlovi: Mailpit http://127.0.0.1:55324.
Demo analitika (izmišljeni podaci, samo lokalno): `psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -f supabase/demo/analitika_demo.sql`.

### Lokalni test nalozi

Napravljeni ručno kroz aplikaciju (postoje samo u lokalnoj bazi; `npm run db:reset` ih briše):

| Nalog | Lozinka | Uloga |
|---|---|---|
| mihajlo@test.local | `Proba-12345!` | vlasnik radnog prostora „Mihajlo Test“ (brendovi Dnevnik trudnoće i Korak Sneakers) |
| ana@test.local | `Proba-12345!` | odobrava, samo za Dnevnik trudnoće |

## AI

Svi agenti idu kroz `worker/src/ai/`: jedan interfejs, tri izvora (redom): sopstveni ključ radnog prostora → naš `ANTHROPIC_API_KEY` → Claude Code pretplata (razvoj).
API put koristi Claude Opus 5.5 / Sonnet 5.5 / Haiku 5.5 sa strukturisanim izlazom i `fallbacks: "default"` (odbijen zahtev ide na rezervni model).
Svaki poziv se upisuje u `agent_runs` (model, tokeni, trošak, greška).

## Novi tip posla

1. Rukovalac u `worker/src/jobs/` i registracija u `worker/src/jobs/index.ts`
2. Ako ga pokreće korisnik: tip u listi dozvoljenih u `public.enqueue_job` (nova migracija); ako je periodičan: korak u `worker/src/scheduler.ts`
