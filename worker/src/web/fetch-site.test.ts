import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ocistiPredlog, polje } from '../../../shared/upitnik.ts';
import { FetchError, htmlUTekst, preuzmiHtml } from './fetch-site.ts';

test('odbija lokalne i privatne adrese', async () => {
  for (const url of [
    'http://localhost:55321/',
    'http://127.0.0.1/',
    'http://10.0.0.5/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://printer.local/',
    'file:///etc/passwd',
    'http://user:pass@example.com/',
  ]) {
    await assert.rejects(preuzmiHtml(url), FetchError, url);
  }
});

test('izvlači naslov, opis, tekst i linkove bez skripti', () => {
  const html = `<html><head><title>Korak &amp; Co</title><meta name="description" content="Patike za 24h">
    <script>alert('x')</script><style>.a{}</style></head>
    <body><h1>Dobrodošli</h1><p>Originalne patike.</p><a href="/o-nama#tim">O nama</a><a href="mailto:x@y.z">mejl</a></body></html>`;
  const s = htmlUTekst(html, 'https://korak.example/');
  assert.equal(s.naslov, 'Korak & Co');
  assert.equal(s.opis, 'Patike za 24h');
  assert.match(s.tekst, /Dobrodošli\nOriginalne patike\./);
  assert.doesNotMatch(s.tekst, /alert/);
  assert.deepEqual(s.linkovi, ['https://korak.example/o-nama']);
});

test('predlog za polje sa izborima zadržava samo ponuđene izbore', () => {
  assert.deepEqual(ocistiPredlog(polje('godine')!, ['18–24', '25–34', 'tinejdžeri']), ['18–24', '25–34']);
  assert.equal(ocistiPredlog(polje('vrsta_posla')!, ['Aplikacija ili softver', 'Usluga']), 'Aplikacija ili softver');
  assert.equal(ocistiPredlog(polje('pol')!, ['žene']), null);
  assert.equal(ocistiPredlog(polje('glavni_proizvodi')!, ['Dnevnik', 'Kalkulator']), 'Dnevnik\nKalkulator');
});
