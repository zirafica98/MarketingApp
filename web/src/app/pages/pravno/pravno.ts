import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Politika privatnosti i uslovi korišćenja. NACRT: pre javnog lansiranja proveriti sa pravnikom (i za Meta/Google prijave). */
@Component({
  selector: 'app-pravno',
  imports: [RouterLink],
  template: `
    <div class="page" style="max-width:760px">
      <p><a routerLink="/">← Marketing Pilot</a></p>
      <div class="alert info">Nacrt dokumenta. Pre javnog lansiranja ga proverava pravnik.</div>
      @if (vrsta() === 'privatnost') {
        <h1>Politika privatnosti</h1>
        <h2>Ko obrađuje podatke</h2>
        <p>Marketing Pilot (u daljem tekstu: „mi“) obrađuje podatke koje unesete i podatke sa kanala koje povežete, isključivo da bismo vam pružili uslugu.</p>
        <h2>Koje podatke čuvamo</h2>
        <ul>
          <li>Nalog: ime, mejl, lozinka (u šifrovanom obliku, kod pružaoca prijave).</li>
          <li>Podaci o brendu: odgovori iz upitnika, činjenice, strategija, nacrti, odluke (odobrenja, izmene, odbijanja).</li>
          <li>Povezani kanali: pristupni tokeni (šifrovani, nedostupni iz aplikacije), objave i statistika objava i naloga.</li>
          <li>Prodavnica: katalog proizvoda (naziv, cena, slika, link). Ne pristupamo porudžbinama ni kupcima.</li>
        </ul>
        <h2>Kako koristimo podatke</h2>
        <p>Za pravljenje i objavu sadržaja koji vi odobrite i za analitiku i učenje vašeg brenda. Podaci jednog brenda se ne koriste za druge brendove. Ne prodajemo podatke i ne koristimo ih za oglašavanje.</p>
        <h2>AI</h2>
        <p>Tekst i podatke potrebne za zadatak šaljemo modelima kompanije Anthropic (Claude) preko njihovog API-ja. Ako koristite sopstveni ključ, obrada ide preko vašeg Anthropic naloga.</p>
        <h2>Brisanje</h2>
        <p>Prekidom veze sa kanalom brišemo njegov token i uvezenu statistiku. Brisanjem brenda brišu se svi njegovi podaci. Za brisanje naloga pišite nam.</p>
        <h2>Brisanje podataka sa Meta platformi</h2>
        <p>Ako uklonite našu aplikaciju u podešavanjima Instagrama ili Facebooka, brišemo sačuvan pristup i podatke tog naloga u roku od 30 dana.</p>
      } @else {
        <h1>Uslovi korišćenja</h1>
        <h2>Usluga</h2>
        <p>Marketing Pilot pomaže u planiranju, pravljenju i objavi marketinškog sadržaja. Ništa se ne objavljuje bez odobrenja korisnika sa odgovarajućom ulogom.</p>
        <h2>Odgovornost za sadržaj</h2>
        <p>Sadržaj predlaže AI, a za objavljen sadržaj odgovara korisnik koji ga je odobrio. Agenti su podešeni da koriste samo potvrđene činjenice, ali korisnik proverava svaki nacrt pre odobrenja.</p>
        <h2>Nalozi na mrežama</h2>
        <p>Povezivanjem kanala dajete nam dozvolu da u vaše ime objavljujemo odobren sadržaj i čitamo statistiku. Pravila platformi (Instagram, Threads, Telegram…) važe i dalje.</p>
        <h2>Planovi i plaćanje</h2>
        <p>Plaćeni planovi se naplaćuju mesečno preko Stripe-a i mogu da se otkažu u svakom trenutku do kraja obračunskog perioda.</p>
      }
    </div>
  `,
})
export default class Pravno {
  readonly vrsta = input<'privatnost' | 'uslovi'>('privatnost');
}
