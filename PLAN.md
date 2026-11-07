# Marketing Pilot — plan

> Radni naziv. **Centralno mesto za marketing bilo kog brenda.** Korisnik otvori nalog, doda jedan ili više brendova,
> kroz našu aplikaciju poveže sve svoje kanale (mreže, prodavnicu, sajt, mejl, analitiku), a alat prouči brend, predloži
> strategiju, pravi sadržaj i kampanje i, **tek kad korisnik odobri**, objavi ih. Sve na jednom mestu, bez tehničkog znanja.

**Primer korisnika:** Pera Perić ima brend patika „Korak“: Shopify prodavnica, Instagram, TikTok, Facebook stranica. Ne zna šta je API.
Otvori nalog, odgovori na pitanja, klikne „Poveži“ pored svake mreže, i za 15 minuta dobije plan i prve nacrte za nedelju.

**Prvi pravi korisnik (test):** Dnevnik trudnoće (dnevniktrudnoce.com + Instagram). Ali alat se pravi za Peru od prvog dana, ne za nas.

---

## 1. Odakle krećemo (šta već imamo)

| Projekat | Šta nosimo odatle |
|---|---|
| **News (AI Morning Brief)** | Claude sa JSON šemom na izlazu i proverom (`scripts/claude.mjs`), objava na Instagram/Threads/YouTube/Telegram, **oznake protiv duplih objava**, produžavanje Meta tokena, nedeljni izveštaj „koji format prolazi“, iskustvo sa YouTube auditom (`youtube-audit/`). |
| **ContentStudio** | Profil brenda (publika, ton, raspored, funkcije), teme po danima, HTML šabloni → PNG, pravila pisanja (`prompts/pravila.md`), pamćenje stanja. |
| **Rastemo** | Kod Dnevnika trudnoće, prvi „izvor sadržaja“ za test. |

Razlika u odnosu na oba: **ništa se ne objavljuje bez odobrenja**, sve se podešava **kroz aplikaciju** (bez JSON fajlova i terminala), i radi za **bilo koga i bilo koliko brendova**.

---

## 2. Nalog, timovi i više brendova

```
Korisnik (Pera)
  └── Radni prostor „Pera Perić“            ← plan i naplata, AI podešavanja
        ├── članovi: Pera (vlasnik), Ana (urednik), agencija (odobrava samo za „Korak“)
        ├── Brend „Korak Sneakers“          ← svoji kanali, profil, strategija, kalendar
        ├── Brend „Korak Kids“
        └── Brend „Perina kafeterija“
```

- Jedan korisnik može da bude u više radnih prostora (npr. agencija koja vodi 10 klijenata).
- Sve u aplikaciji je vezano za **trenutni brend** (prebacivanje u levom meniju, kao Slack radni prostori).
- Početna stranica posle prijave: **Moji brendovi**: za svaki brend broj nacrta za pregled, sledeća objava, zdravlje konektora, učinak nedelje.
- **Uloge** (po radnom prostoru, uz opciono ograničenje na pojedine brendove):

| Uloga | Sme |
|---|---|
| Vlasnik | sve, uključujući naplatu, AI ključeve i brisanje |
| Admin | brendovi, konektori, članovi |
| Urednik | pravi i menja nacrte, strategiju |
| Odobrava | odobrava/odbija i zakazuje (npr. klijent agencije) |
| Posmatrač | samo čita kalendar i statistiku |

Pravila pristupa su u bazi (Supabase RLS), ne samo u interfejsu.

---

## 3. Onboarding (sve kroz aplikaciju)

Cilj: posle 10–15 minuta korisnik ima profil brenda, povezane kanale i prvi predlog. Svaki korak može da se preskoči i završi kasnije; na početnoj stoji lista „Šta još fali“ sa procentom.

### Korak 1 — Nalog
Mejl + lozinka ili Google prijava. Ime radnog prostora. Jezik i vremenska zona.

### Korak 2 — Novi brend: brzi početak
Jedno polje: **„Unesi adresu sajta ili Instagram profil“**. Agent u pozadini odmah krene da čita, a dok korisnik popunjava sledeće korake, polja se sama popunjavaju predlozima („Ovo smo našli na sajtu — tačno?“).

### Korak 3 — Upitnik o poslovanju
Pitanja u grupama, sa predlozima koje je agent već izvukao. Jedno pitanje po ekranu na telefonu, grupa po ekranu na računaru.

| Grupa | Pitanja |
|---|---|
| **Posao** | Šta prodaješ (proizvodi, usluga, aplikacija, lokal)? Industrija. Gde prodaješ (online, radnja, oba)? Kojim tržištima/gradovima? Raspon cena. Glavni proizvodi/usluge (uvoz iz prodavnice ili ručno). |
| **Kupci** | Ko kupuje (godine, pol, interesovanja, gde žive)? Koji problem im rešavaš? Zašto kupuju baš kod tebe? Najčešće zamerke/pitanja kupaca? |
| **Konkurencija** | 2–5 konkurenata (sajt ili profil) — agent ih sam prouči. Po čemu si drugačiji? |
| **Glas brenda** | Ton (izbor kartica: zabavan/stručan/topao/luksuzan/direktan…), „ti“ ili „vi“, jezici objava, emodžiji da/ne, primeri objava koje voliš (svoje ili tuđe). |
| **Vizuelni identitet** | Logo, boje (izvlače se sa sajta), fontovi, fotografije proizvoda (upload ili iz prodavnice), šta nikad ne sme na slici. |
| **Ciljevi** | Glavni cilj za 3 meseca (prodaja, pratioci, posete radnji, prijave na listu, preuzimanja app-a), merljiva meta, važni datumi (lansiranja, akcije, praznici, Black Friday). |
| **Pravila i zabrane** | Teme koje se ne pominju, tvrdnje koje se ne smeju davati (zdravlje, garancije), pravne napomene (npr. „cene sa PDV-om“). |
| **Resursi** | Koliko objava nedeljno realno želiš? Ko odobrava i koliko često (svaki dan / jednom nedeljno)? Imaš li budžet za reklame (sada ili kasnije)? Snimaš li sam video? |

Odgovori se čuvaju kao **brend profil** (verzionisan). Sve što je agent zaključio, a korisnik nije potvrdio, ima oznaku „pretpostavka“.

### Korak 4 — Povezivanje kanala
Katalog konektora (poglavlje 4). Kod svakog: dugme **„Poveži“** → prijava na mrežu u novom prozoru (OAuth) → nazad u app, zeleno.
Kad mreža traži nešto unapred (npr. Instagram mora biti poslovni nalog vezan za Facebook stranicu), **uputstvo u koracima sa slikama je u samoj aplikaciji**, u bočnom panelu, i app **sama proverava** svaki korak („✓ Nalog je poslovni“, „✗ Nije vezan za stranicu — evo kako“).

### Korak 5 — Proučavanje i razgovor
Agent pročita sajt, prodavnicu, objave i statistiku sa mreža, konkurente. Onda u razgovoru pita **samo ono što i dalje fali** (obično 3–7 pitanja).

### Korak 6 — Revizija i strategija
„Šta je sada stanje“ po kanalu + predlog: stubovi sadržaja, nedeljni raspored po kanalu, kampanje za važne datume, eksperimenti. Korisnik prihvati ili traži izmene.

### Korak 7 — Prvi nacrti
Nacrti za prvu nedelju stižu u „Za pregled“. Kratak vodič (3 balončića) objašnjava odobri / izmeni / popravi / odbij.

---

## 4. Konektori

Jedan **sistem konektora** sa istim oblikom za sve: `poveži (OAuth) · proveri zdravlje · osveži token · čitaj (profil, objave, statistiku) · objavi · prekini vezu`.
Konektor zna šta podržava (`može: objava slike / karusela / videa / priče; čitanje statistike; komentari`), pa app sama nudi samo moguće formate.

### Katalog

| Grupa | Konektor | Čita | Objavljuje | Odobrenje kod platforme |
|---|---|---|---|---|
| **Mreže** | Instagram (poslovni/kreator) | objave, statistika, komentari | slika, karusel, Reel, priča | Meta App Review |
| | Facebook stranica | isto | post, slike, video, Reel | Meta App Review (ista app) |
| | Threads | objave, statistika | tekst, slike, karusel | Meta App Review |
| | TikTok | video, statistika | video, foto karusel | **Audit** — do tada samo privatne objave |
| | YouTube | kanal, statistika | Shorts, video | Google verifikacija + audit kvote (već prošli za News) |
| | LinkedIn (stranica firme) | objave, statistika | post, slike, dokument | LinkedIn Community Management API — prijava |
| | Pinterest | pinovi, statistika | pin | prijava za Standard pristup |
| | X | — | post | API se plaća — **ručni režim** dok se ne isplati |
| | Telegram kanal | — | poruka, album | bot, bez odobrenja |
| | Google Business Profile | recenzije, pregledi | objave, ponude | prijava za API pristup |
| **Prodaja** | Shopify | proizvodi, slike, cene, porudžbine (zbirno) | — | javna Shopify app |
| | WooCommerce | proizvodi, porudžbine | — | API ključ (vodič u app-u) |
| | Sajt (bilo koji) | sadržaj, boje, logo | — | — |
| | GitHub repo | funkcije app-a, sadržaj | — | GitHub App |
| **Analitika** | Google Analytics 4 | posete i konverzije sa mreža | — | Google OAuth |
| | Search Console | pretrage, SEO | — | Google OAuth |
| **Mejl** | Mailchimp / Brevo | liste, učinak | kampanje (nacrti) | OAuth / API ključ |
| **Fajlovi** | Google Drive / Dropbox / upload | fotografije i video brenda | — | OAuth |
| **Reklame (kasnije)** | Meta Ads, Google Ads, TikTok Ads | potrošnja, rezultati | predlog kampanje (uvek odobrava čovek) | posebna odobrenja |

### Važno o odobrenjima
Da bi Pera mogao da klikne „Poveži Instagram“, **naša** Meta aplikacija mora da prođe App Review; isto važi za TikTok, LinkedIn, Pinterest, Google. To je posao koji traje nedeljama po platformi i traži: politiku privatnosti, uslove korišćenja, video demonstraciju, proveru firme (Meta Business Verification). Zato:
1. Konektori se puštaju redom po težini odobrenja (poglavlje 9).
2. Dok konektor nije odobren, radi **ručni režim**: app pripremi sve (slike, tekst, hashtagove), pošalje obaveštenje u zakazano vreme, korisnik na telefonu klikne „Preuzmi i kopiraj“, objavi, pa „Objavljeno ✓“. Tako svaka mreža radi od prvog dana, samo jedna automatski, druga u dva klika.

### Zdravlje konektora
Na stranici kanala i na „Moji brendovi“: zeleno / žuto (token ističe za < 7 dana, ograničenja) / crveno (veza pukla). Tokeni se produžavaju sami (kao u News-u). Kad ne može, mejl + obaveštenje u app-u sa dugmetom „Poveži ponovo“.

---

## 5. Šta sve može da se radi (moduli)

| Modul | Šta | Kada |
|---|---|---|
| **Sadržaj za mreže** | nacrti po rasporedu, prilagođeni svakoj mreži (format, dužina, hashtagovi) | MVP |
| **Pregled i odobravanje** | odobri / izmeni / „popravi ovo“ / odbij sa razlogom; odobri više odjednom | MVP |
| **Kalendar** | svi kanali svih brendova, prevlačenje, filteri | MVP |
| **Biblioteka medija** | fotografije proizvoda, logo, šabloni u bojama brenda | MVP |
| **Kampanje** | lansiranje, akcija, praznik: cilj, period, kanali → paket objava za sve kanale odjednom | v2 |
| **Analitika i učenje** | sve brojke sa svih kanala na jednom mestu + agent koji uči šta radi baš za ovaj brend (poglavlje 6a) | **MVP** |
| **Inbox** | komentari i poruke sa svih mreža na jednom mestu, predlog odgovora (šalje čovek) | v3 |
| **Mejl i blog/SEO** | nacrti newslettera i članaka iz istog plana | v3 |
| **Reklame** | predlog kampanje i budžeta, praćenje rezultata | kasnije |
| **Video** | Reels/Shorts/TikTok iz fotografija proizvoda (Remotion + glas iz News-a) | kasnije |

---

## 6. Agenti

Svaki agent = uputstvo + alati + JSON šema izlaza + provera (obrazac iz News-a). Kasnije korisnik bira model/provajdera po agentu.

| Agent | Radi |
|---|---|
| **Istraživač** | čita sajt, prodavnicu, repo, mreže, konkurente → činjenice sa izvorom |
| **Intervjuer** | postavlja pitanja koja fale, upisuje odgovore u profil |
| **Strateg** | revizija, stubovi, raspored, kampanje, eksperimenti |
| **Pisac** | tekstovi po mreži i jeziku |
| **Dizajner** | bira šablon, fotografiju i raspored (render radi kod) |
| **Urednik** | proverava činjenice prema izvorima, zabrane, ponavljanja, pravila mreže |
| **Analitičar** | skuplja i čisti brojke, nedeljni izveštaj, objašnjava „zašto“ |
| **Učitelj (učenje brenda)** | iz analitike i odluka korisnika piše i održava **knjigu pravila brenda**; vodi eksperimente; svi ostali agenti je čitaju pre rada |

**Pravilo:** činjenice (cene, karakteristike proizvoda, medicinske tvrdnje) dolaze iz izvora korisnika, ne iz „znanja“ modela. Urednik odbija nacrt koji to prekrši.

---

## 6a. Analitika i učenje — svaki brend na svoju foru

Pera sa patikama i Dnevnik trudnoće ne smeju da dobiju isti recept. Kod Pere možda prolaze Reels sa proizvodom na nozi u 18h i popust od 15%,
kod Dnevnika karuseli „nedelja po nedelja“ u 21h koje mame čuvaju. To ne znamo unapred — **to se uči iz brojki svakog brenda posebno.**

### Šta se skuplja (po brendu, po kanalu, svaki dan)

| Nivo | Brojke |
|---|---|
| **Objava** | doseg, prikazi, lajkovi, komentari, čuvanja, deljenja, gledanost videa (prosečno vreme, % do kraja), klikovi, novi pratioci |
| **Nalog** | pratioci (rast/pad), doseg, posete profilu, klikovi na link u biju, kada je publika aktivna, demografija |
| **Posao** | posete sajtu sa mreža (GA4 + UTM linkovi koje app sama dodaje), porudžbine i prihod iz prodavnice (Shopify/Woo), prijave/preuzimanja app-a |
| **Odluke korisnika** | šta je odobreno bez izmena, šta izmenjeno (i kako), šta odbijeno i zašto |

Svaka objava u bazi ima **oznake**: kanal, format, stub, tema, vreme, dužina teksta, ima li lice/proizvod/cenu, poziv na akciju, kampanja, eksperiment.
Tako se brojke porede „karusel vs Reel“, „sa cenom vs bez“, „18h vs 21h“ — za taj brend.

### Agent Učitelj i knjiga pravila brenda

Svaki brend ima svoju **knjigu pravila** (`brand_playbook`): kratke tvrdnje sa dokazom i sigurnošću.

```
✓ Reels sa proizvodom na nozi: 2,8× više čuvanja od fotografija na beloj pozadini   (12 objava, sigurno)
✓ Najbolje vreme: radnim danom 18–19h                                                (8 nedelja, sigurno)
~ Cena u prvom slajdu povećava klikove, ali smanjuje doseg                           (5 objava, proverava se)
✗ Hashtagovi na engleskom ne donose ništa za ovaj brend                              (odbačeno, 10 objava)
✎ Pera nikad ne želi reč „jeftino“                                                   (iz 3 izmene)
```

- **Kada radi:** posle svakog uvlačenja statistike (dnevno) ažurira brojke; jednom nedeljno i posle svake kampanje piše zaključke.
- **Kako radi:** brojke računa **kod** (proseci, poređenja po oznakama, u odnosu na prosek tog brenda — ne drugih brendova); agent dobija gotove tabele, tumači ih, piše pravila i predlaže sledeće eksperimente. Tako AI ne „izmišlja“ statistiku.
- **Sigurnost pravila:** pravilo sa malo podataka je „proverava se“ i pretvara se u **eksperiment** (npr. 2 nedelje pola objava sa cenom, pola bez). Tek posle dovoljno objava postaje „sigurno“ ili se odbacuje.
- **Ko ga koristi:** Strateg, Pisac, Dizajner i Urednik pre svakog posla čitaju knjigu pravila tog brenda. Zato se nacrti iz nedelje u nedelju menjaju.
- **Korisnik ima kontrolu:** knjiga pravila je vidljiva u app-u; svako pravilo može da se potvrdi, izmeni, zaključa („uvek tako“) ili obriše. Promene strategije koje Učitelj predloži stižu kao predlog, ne primenjuju se same.
- **Početak bez podataka:** odmah se uvuče istorija sa povezanih naloga (poslednjih 3–6 meseci). Dok je nema dovoljno, koriste se opšte smernice za tu industriju i kanal, jasno označene kao „opšte, nije provereno za tvoj brend“.
- **Odvojeno po brendu:** podaci i pravila jednog brenda nikad ne ulaze u drugi. (Kasnije, opciono i anonimno: „brendovi slični tvom“ kao početna pretpostavka.)

### Ekrani

- **Pregled:** ključne brojke svih kanala za period, poređenje sa prethodnim, cilj iz onboardinga i koliko smo blizu.
- **Po kanalu / po objavi:** tabela objava sa oznakama, filteri; klik na objavu = sve brojke + „zašto je prošla / nije prošla“ od agenta.
- **Šta radi za tvoj brend:** knjiga pravila, eksperimenti u toku i rezultati.
- **Nedeljni izveštaj:** u app-u + mejl: 3 stvari koje su radile, 1 koja nije, predlog za sledeću nedelju (dugme „Primeni“).
- **Svi brendovi:** uporedni pregled za korisnika sa više brendova (svaki u odnosu na svoj prosek).

---

## 7. Arhitektura

```
┌──────────── Angular 22 + Tailwind (veb, radi i na telefonu kao PWA) ────────────┐
│ Moji brendovi · Onboarding · Konektori · Za pregled · Kalendar · Kampanje · …    │
└───────────────────────────────┬─────────────────────────────────────────────────┘
                                │ Supabase: Auth, Postgres + RLS, Storage, Realtime
     ┌──────────────────────────┼───────────────────────────────┐
┌────▼─────────────┐   ┌────────▼────────┐          ┌───────────▼──────────────┐
│ API (Vercel)     │   │ Worker (Node 22)│          │ Raspoređivač (Cron 1 min)│
│ OAuth povratci,  │   │ red poslova     │          │ odobreno + vreme stiglo  │
│ webhook-ovi,     │   │ (pg-boss):      │          │ → posao „objavi“ po      │
│ šifrovanje       │   │ agenti, render, │          │   konektoru              │
│ tokena           │   │ objava, sync    │          │ osvežavanje tokena       │
└──────────────────┘   └─────────────────┘          └──────────────────────────┘
```

| Odluka | Izbor | Zašto |
|---|---|---|
| Baza, prijava, fajlovi | **Supabase** | koristiš ga već; RLS za radne prostore i brendove |
| AI | **Claude Agent SDK** iza sloja `ai-provider` | jedan interfejs za sve agente; menja se provajder bez prepisivanja |
| Teški poslovi | **Worker na serveru** (Fly.io/Railway) od Faze 1 | više korisnika = ne može na tvom Mac-u |
| Tokeni mreža | šifrovani (pgsodium/Vault), čita ih samo worker | nikad u pregledaču, URL-u ni logu |
| Mediji | Supabase Storage sa javnim (potpisanim) URL-om | mreže preuzimaju sliku sa URL-a |
| Slike | HTML šabloni → PNG (Playwright), u bojama brenda | proveren put iz ContentStudio-a |

### Glavne tabele

```
profile                korisnik
workspace              radni prostor: plan, AI podešavanja (sopstveni ključ, šifrovan)
workspace_member       korisnik + uloga (+ opciono spisak brendova)
invitation             pozivi članova
brand                  pripada radnom prostoru: naziv, link, jezici, vremenska zona, boje, logo
brand_profile          odgovori iz upitnika + zaključci agenta (verzije, „pretpostavka“/„potvrđeno“)
brand_fact             činjenica + izvor
competitor             konkurent + šta je agent našao
connector_type         katalog: instagram, tiktok, shopify… + šta podržava + status odobrenja
connection             brend + konektor: nalog, šifrovan token, ističe, zdravlje, poslednja greška
product                uvoz iz prodavnice (naziv, cena, slike, link)
media_asset            fotografije, logo, video
strategy               stubovi, raspored po kanalu, eksperimenti (predlog/aktivna)
campaign               cilj, period, kanali
draft                  nacrt: brend, kanal(i), stub/kampanja, status, zakazano vreme
draft_variant          tekst i mediji po kanalu
review_event           odobri / izmeni / popravi / odbij + razlog
publication            objavljeno: kanal, oznaka (protiv duplikata), link, ručno/automatski
metric_post            dnevni snimak statistike po objavi (vremenska serija)
metric_account         dnevni snimak po nalogu/kanalu (pratioci, doseg, publika)
metric_business        posete, porudžbine, prihod, konverzije (GA4, prodavnica)
post_tag               oznake objave: format, stub, tema, vreme, cena da/ne, CTA, eksperiment
experiment             hipoteza, varijante, period, rezultat
brand_playbook_rule    pravilo brenda: tvrdnja, dokaz, sigurnost, izvor (analitika/odluka), zaključano
onboarding_progress    koji koraci su završeni po brendu
agent_run              svaki poziv agenta: model, trajanje, cena, greška
```

**Statusi nacrta:** `pravi_se → za_pregled → (popravlja_se) → odobren → zakazan → objavljuje_se → objavljen | greška`, ili `odbijen`.
Objaviti sme samo `odobren/zakazan`, a to proverava worker, ne interfejs.

---

## 8. AI nalog i troškovi

- **Testiranje (Faza 0–1, samo mi):** Claude Code OAuth token, kao u AI News.
- **Pravi korisnici:** pretplata (Pro/Max) je lična i po Anthropic uslovima ne sme da pokreće uslugu za druge ljude. Zato od prvog spoljnog korisnika:
  - **Uključeno u plan:** koristimo naš Anthropic **API ključ**; plan alata ima mesečni limit (npr. broj nacrta), a `agent_run` beleži trošak po brendu.
  - **Sopstveni ključ:** korisnik ubaci svoj Anthropic (kasnije i drugi) ključ i bira modele po agentu, bez limita.
- Zbog toga je `ai-provider` sloj obavezan od prvog dana.

---

## 9. Faze

| Faza | Šta | Gotovo kad… |
|---|---|---|
| **0. Temelj** | Angular, Supabase (šema, RLS), prijava, radni prostori, članovi i uloge, **više brendova** i prebacivanje, worker + red poslova, `ai-provider` (OAuth token) | napraviš dva brenda, pozoveš suprugu kao „odobrava“ i ona vidi samo svoje |
| **1. Onboarding** | brzi početak (URL), upitnik po grupama sa predlozima agenta, Istraživač (sajt, konkurenti), razgovor, brend profil, „Šta još fali“ | Dnevnik trudnoće i izmišljeni „Korak Sneakers“ prođu ceo onboarding bez terminala |
| **2. Konektori I + analitika** | sistem konektora, **Instagram + Facebook + Threads** (jedna Meta app), Sajt, GitHub, upload medija, ručni režim za ostale mreže, zdravlje i produženje tokena. **Uvlačenje istorije i dnevne statistike**, oznake objava, ekran Analitika. **Odmah poslati Meta App Review.** | @dnevniktrudnoce povezan kroz app, vidi se 6 meseci istorije i šta je prolazilo |
| **3. Strategija + nacrti + pregled** | Učitelj napravi prvu knjigu pravila iz istorije; Strateg, Pisac, Dizajner, Urednik je čitaju; šabloni u bojama brenda; Za pregled; kalendar svih brendova | supruga nedelju dana radi samo kroz alat, a strategija se poziva na brojke Dnevnika |
| **4. Objava** | raspoređivač, objava preko konektora, oznake protiv duplikata, obaveštenja o greškama, ručni režim sa obaveštenjem na telefon | odobren nacrt se sam pojavi na Instagramu i Facebooku |
| **5. Učenje** | Učitelj radi stalno: dnevno ažurira, nedeljni izveštaj, eksperimenti (A/B), pravila iz odbijanja i izmena, predlozi izmene strategije | posle 4 nedelje knjiga pravila ima ≥5 „sigurnih“ pravila i manje je odbijenih nacrta |
| **6. Konektori II + prodaja + kampanje** | Shopify, WooCommerce, GA4 (posete i prodaja sa mreža, UTM), TikTok, YouTube, LinkedIn, Pinterest, Google Business; kampanje za datume | „Korak“ pravi objave iz kataloga, a analitika pokazuje prodaju po objavi |
| **7. Javno lansiranje** | registracija za sve, planovi i naplata, API ključ / sopstveni ključ, politika privatnosti i uslovi, pomoć u app-u | prvi spoljni korisnik prođe sve sam |
| Kasnije | Inbox, mejl i blog, reklame, video | — |

Paralelno od Faze 2: prijave za odobrenja platformi (Meta → Google → TikTok → LinkedIn → Pinterest), jer traju duže od pisanja koda.

---

## 10. Pravila koja nosimo iz AI News / ContentStudio

- Svaki izlaz AI-ja kroz JSON šemu i proveru; ako ne prođe 2 puta, ide u pregled sa oznakom „nije prošlo proveru“.
- Svaka objava ima oznaku → ponovno pokretanje ne pravi duplikat.
- Jedna mreža ne obara druge.
- Tokeni šifrovani, nikad u URL-u, logu ni pregledaču.
- Korisnik uvek vidi **odakle** je tvrdnja.
- Bez hajpa, prva rečenica stoji sama za sebe, emodžiji po pravilima brenda.

## 11. Otvorena pitanja

1. Naziv alata i domen (treba nam za Meta/Google prijave i politiku privatnosti).
2. Firma na koju se vode aplikacije kod Meta/Google/TikTok (Business Verification traži registrovanu firmu).
3. Ciljno tržište na početku: Srbija/region (srpski) ili odmah i engleski?
4. Model naplate: mesečno po radnom prostoru sa limitom brendova, ili po brendu?
