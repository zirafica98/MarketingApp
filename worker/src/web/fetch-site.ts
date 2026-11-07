// Čitanje javnih sajtova za agente. Adrese daje korisnik, pa se čuvamo:
//  * samo http(s), samo javne IP adrese (ne localhost, privatne mreže, metadata servise) — proverava se i posle svakog preusmeravanja,
//  * ograničeno vreme, veličina i broj stranica,
//  * tekst stranice je PODATAK za agenta, nikad uputstvo (to piše i u promptu).

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const UA = 'MarketingPilotBot/0.1 (+brand research; contact via app)';
const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 15_000;

export class FetchError extends Error {}

export interface Stranica {
  url: string;
  naslov: string;
  opis: string;
  tekst: string;
  linkovi: string[];
}

function privatnaAdresa(ip: string): boolean {
  if (isIP(ip) === 6) {
    const a = ip.toLowerCase();
    if (a === '::1' || a === '::' || a.startsWith('fc') || a.startsWith('fd') || a.startsWith('fe80')) return true;
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
    return m ? privatnaAdresa(m[1]!) : false;
  }
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return (
    a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  );
}

export async function proveriAdresu(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FetchError(`Nije veb adresa: ${url.href}`);
  if (url.username || url.password) throw new FetchError('Adresa sa lozinkom nije dozvoljena.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new FetchError(`Adresa nije javna: ${host}`);
  const adrese = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!adrese.length) throw new FetchError(`Sajt ne postoji ili nije dostupan: ${host}`);
  if (adrese.some((a) => privatnaAdresa(a.address))) throw new FetchError(`Adresa nije javna: ${host}`);
}

/** Preuzima HTML sa javne adrese, prateći najviše 5 preusmeravanja (svako se ponovo proverava). */
export async function preuzmiHtml(pocetna: string): Promise<{ url: string; html: string }> {
  let url = new URL(pocetna);
  for (let skok = 0; skok <= 5; skok++) {
    await proveriAdresu(url);
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'sr,en;q=0.8' },
    }).catch((e: unknown) => {
      throw new FetchError(`Ne mogu da otvorim ${url.href}: ${e instanceof Error ? e.message : e}`);
    });
    if (res.status >= 300 && res.status < 400) {
      const dalje = res.headers.get('location');
      if (!dalje) throw new FetchError(`Preusmeravanje bez adrese: ${url.href}`);
      url = new URL(dalje, url);
      continue;
    }
    if (!res.ok) throw new FetchError(`${url.href} vraća ${res.status}.`);
    const vrsta = res.headers.get('content-type') ?? '';
    if (!/html|xml/i.test(vrsta)) throw new FetchError(`${url.href} nije veb stranica (${vrsta}).`);
    const body = res.body;
    if (!body) return { url: url.href, html: '' };
    const delovi: Uint8Array[] = [];
    let ukupno = 0;
    for await (const deo of body as unknown as AsyncIterable<Uint8Array>) {
      ukupno += deo.byteLength;
      if (ukupno > MAX_BYTES) break;
      delovi.push(deo);
    }
    return { url: url.href, html: Buffer.concat(delovi).toString('utf8') };
  }
  throw new FetchError(`Previše preusmeravanja: ${pocetna}`);
}

const ENTITETI: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function dekodiraj(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITETI[e.toLowerCase()] ?? m;
  });
}

/** Grubo, ali dovoljno: tekst stranice bez skripti i stilova, sa naslovima kao zasebnim redovima. */
export function htmlUTekst(html: string, baseUrl: string): Omit<Stranica, 'url'> {
  const naslov = dekodiraj(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? '');
  const opis = dekodiraj(
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(html)?.[1] ??
      /<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["']/i.exec(html)?.[1] ??
      '',
  );
  const linkovi = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
    try {
      const u = new URL(dekodiraj(m[1]!), baseUrl);
      u.hash = '';
      if (u.protocol.startsWith('http')) linkovi.add(u.href);
    } catch {
      /* loš link */
    }
  }
  const tekst = dekodiraj(
    html
      .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(h[1-6]|p|li|div|section|article|br|tr|header|footer|nav)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/ *\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return { naslov, opis, tekst, linkovi: [...linkovi] };
}

const VAZNE = /(o-nama|about|onama|kontakt|contact|cene|cenovnik|pricing|price|proizvod|product|shop|prodavnica|usluge|services|faq|pitanja|funkcij|features|kako|how|tim|team|blog|kolekcij|collection|nedelj)/i;

/**
 * Pročita početnu stranicu i do `maxStranica - 1` stranica sa istog sajta, prvo one koje zvuče važno
 * (o nama, cene, proizvodi, FAQ…). Ukupan tekst je ograničen.
 */
export async function procitajSajt(pocetna: string, { maxStranica = 8, maxZnakovaPoStrani = 6000, maxUkupno = 40_000 } = {}): Promise<Stranica[]> {
  const prva = await preuzmiHtml(pocetna);
  const host = new URL(prva.url).hostname.replace(/^www\./, '');
  const strane: Stranica[] = [{ url: prva.url, ...htmlUTekst(prva.html, prva.url) }];

  const kandidati = strane[0]!.linkovi
    .filter((l) => {
      const u = new URL(l);
      return u.hostname.replace(/^www\./, '') === host && !/\.(pdf|jpe?g|png|gif|webp|svg|zip|mp4|mp3)$/i.test(u.pathname) && u.href !== prva.url;
    })
    .map((l) => l.replace(/\/$/, ''))
    .filter((l, i, a) => a.indexOf(l) === i)
    .sort((a, b) => Number(VAZNE.test(b)) - Number(VAZNE.test(a)) || a.length - b.length)
    .slice(0, maxStranica - 1);

  for (const url of kandidati) {
    try {
      const { url: konacni, html } = await preuzmiHtml(url);
      strane.push({ url: konacni, ...htmlUTekst(html, konacni) });
    } catch {
      /* jedna stranica ne obara ostale */
    }
  }

  let ukupno = 0;
  return strane.map((s) => {
    const dozvoljeno = Math.max(0, Math.min(maxZnakovaPoStrani, maxUkupno - ukupno));
    const tekst = s.tekst.slice(0, dozvoljeno);
    ukupno += tekst.length;
    return { ...s, tekst };
  }).filter((s) => s.tekst.length > 0 || s.opis);
}

/** Stranice kao blok za prompt; svaka u svojoj oznaci, da agent zna odakle je šta. */
export function stranicePrompt(strane: Stranica[]): string {
  return strane
    .map((s) => `<stranica url="${s.url}">\nNaslov: ${s.naslov}\nOpis: ${s.opis}\n\n${s.tekst}\n</stranica>`)
    .join('\n\n');
}
