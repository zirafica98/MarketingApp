// Mali HTTP server workera: OAuth (start i povratak), unos tokena iz forme, kasnije plaćanje i AI ključevi.
// Pregledač nikad ne dobija tokene: sve tajne idu pravo u bazu, šifrovane.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import type pg from 'pg';
import { kanal, KanalGreska, sacuvajVezu } from './channels/index.ts';
import { AnthropicApiProvider } from './ai/anthropic-api.ts';
import { sifruj } from './crypto.ts';

export type Ruta = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>;
const dodatneRute = new Map<string, Ruta>();
/** Druge faze dodaju svoje rute (npr. 'POST /ai/kljuc'). */
export function dodajRutu(kljuc: string, r: Ruta): void {
  dodatneRute.set(kljuc, r);
}

const env = (k: string, d = '') => process.env[k] ?? d;

function posalji(res: ServerResponse, status: number, telo: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(telo));
}

function preusmeri(res: ServerResponse, url: string): void {
  res.writeHead(302, { location: url });
  res.end();
}

export async function citajJson<T>(req: IncomingMessage, max = 64_000): Promise<T> {
  let n = 0;
  const delovi: Buffer[] = [];
  for await (const d of req as AsyncIterable<Buffer>) {
    n += d.length;
    if (n > max) throw new KanalGreska('Zahtev je prevelik.', true);
    delovi.push(d);
  }
  return JSON.parse(Buffer.concat(delovi).toString('utf8') || '{}') as T;
}

export async function citajSirovo(req: IncomingMessage, max = 1_000_000): Promise<Buffer> {
  let n = 0;
  const delovi: Buffer[] = [];
  for await (const d of req as AsyncIterable<Buffer>) {
    n += d.length;
    if (n > max) throw new Error('Zahtev je prevelik.');
    delovi.push(d);
  }
  return Buffer.concat(delovi);
}

const supabase = () => createClient(env('SUPABASE_URL'), env('SUPABASE_PUBLISHABLE_KEY'), { auth: { persistSession: false } });

/** Prijavljeni korisnik iz „Authorization: Bearer <jwt>“ (Supabase proverava potpis i rok). */
export async function korisnik(req: IncomingMessage): Promise<{ id: string; email: string | undefined }> {
  const jwt = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
  if (!jwt) throw new KanalGreska('Niste prijavljeni.', true);
  const { data, error } = await supabase().auth.getUser(jwt);
  if (error || !data.user) throw new KanalGreska('Prijava je istekla. Osveži stranicu.', true);
  return { id: data.user.id, email: data.user.email };
}

export async function imaUlogu(db: pg.Pool, userId: string, brandId: string, uloge: string[]): Promise<boolean> {
  const { rows } = await db.query(
    `select 1 from public.brands b join public.workspace_members m on m.workspace_id = b.workspace_id
      where b.id = $1 and m.user_id = $2 and m.role = any ($3::public.workspace_role[]) and (m.brand_ids is null or b.id = any (m.brand_ids))`,
    [brandId, userId, uloge],
  );
  return rows.length > 0;
}

export async function imaUloguURadnomProstoru(db: pg.Pool, userId: string, workspaceId: string, uloge: string[]): Promise<boolean> {
  const { rows } = await db.query(
    `select 1 from public.workspace_members where workspace_id = $1 and user_id = $2 and role = any ($3::public.workspace_role[])`,
    [workspaceId, userId, uloge],
  );
  return rows.length > 0;
}

export function cors(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin;
  if (origin && origin === env('WEB_URL')) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('access-control-allow-headers', 'authorization, content-type');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    res.setHeader('vary', 'origin');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}

async function oauthStart(db: pg.Pool, res: ServerResponse, provider: string, state: string): Promise<void> {
  const { rows } = await db.query('select 1 from public.oauth_states where state = $1 and provider = $2 and expires_at > now()', [state, provider]);
  if (!rows.length) throw new KanalGreska('Link za povezivanje je istekao. Pokušaj ponovo.', true);
  const k = kanal(provider);
  if (!k?.authorizeUrl) throw new KanalGreska('Ovaj kanal se ne povezuje prijavom.', true);
  preusmeri(res, k.authorizeUrl(state, `${env('WORKER_PUBLIC_URL')}/oauth/${provider}/povratak`));
}

async function oauthPovratak(db: pg.Pool, res: ServerResponse, provider: string, url: URL): Promise<void> {
  const state = url.searchParams.get('state') ?? '';
  const { rows } = await db.query<{ brand_id: string; user_id: string; return_to: string | null }>(
    'delete from public.oauth_states where state = $1 and provider = $2 and expires_at > now() returning brand_id, user_id, return_to',
    [state, provider],
  );
  const s = rows[0];
  const nazad = (q: Record<string, string>) =>
    `${env('WEB_URL')}${s?.return_to ?? (s ? `/b/${s.brand_id}/konektori` : '/')}?${new URLSearchParams(q)}`;
  if (!s) return preusmeri(res, nazad({ greska: 'Link za povezivanje je istekao. Pokušaj ponovo.' }));
  if (url.searchParams.get('error')) {
    return preusmeri(res, nazad({ greska: url.searchParams.get('error_description') ?? 'Povezivanje je otkazano.' }));
  }
  try {
    if (!(await imaUlogu(db, s.user_id, s.brand_id, ['owner', 'admin']))) throw new KanalGreska('Nemaš dozvolu za povezivanje kanala.', true);
    const k = kanal(provider);
    if (!k?.exchange) throw new KanalGreska('Nepoznat kanal.', true);
    const { tajna, expires_at, scopes } = await k.exchange(url.searchParams.get('code') ?? '', `${env('WORKER_PUBLIC_URL')}/oauth/${provider}/povratak`);
    const nalog = await k.nalog(tajna);
    const id = await sacuvajVezu(db, { brand_id: s.brand_id, provider, user_id: s.user_id, nalog, tajna, expires_at, scopes });
    await zakaziSync(db, s.brand_id, id);
    preusmeri(res, nazad({ povezano: provider }));
  } catch (e) {
    preusmeri(res, nazad({ greska: e instanceof Error ? e.message : String(e) }));
  }
}

export async function zakaziSync(db: pg.Pool, brandId: string, connectionId: string): Promise<void> {
  await db.query(
    `insert into public.jobs (workspace_id, brand_id, type, payload)
     select workspace_id, id, 'channel.sync', jsonb_build_object('connection_id', $2::text) from public.brands where id = $1`,
    [brandId, connectionId],
  );
  await db.query(`select pg_notify('jobs', 'sync')`);
}

/** Token iz forme (Telegram; prodavnice u Fazi 6 dodaju svoje rukovaoce kroz kanal()). */
async function tokenIzForme(db: pg.Pool, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const ja = await korisnik(req);
  const telo = await citajJson<{ brand_id?: string; provider?: string; polja?: Record<string, string> }>(req);
  if (!telo.brand_id || !telo.provider || !telo.polja) throw new KanalGreska('Nedostaju podaci.', true);
  if (!(await imaUlogu(db, ja.id, telo.brand_id, ['owner', 'admin']))) throw new KanalGreska('Kanale povezuje vlasnik ili admin.', true);
  const k = kanal(telo.provider);
  if (!k?.fromForm) throw new KanalGreska('Ovaj kanal se ne povezuje tokenom.', true);
  const { tajna, nalog } = await k.fromForm(telo.polja);
  const id = await sacuvajVezu(db, { brand_id: telo.brand_id, provider: telo.provider, user_id: ja.id, nalog, tajna });
  if (k.uvezi || telo.provider === 'shopify' || telo.provider === 'woocommerce') await zakaziSync(db, telo.brand_id, id);
  posalji(res, 200, { ok: true, account_name: nalog.account_name });
}

/** Sopstveni Anthropic ključ radnog prostora: proveri ga (besplatno), pa sačuvaj šifrovano. */
async function aiKljuc(db: pg.Pool, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const ja = await korisnik(req);
  const t = await citajJson<{ workspace_id?: string; api_key?: string }>(req);
  const kljuc = (t.api_key ?? '').trim();
  if (!t.workspace_id || !(await imaUloguURadnomProstoru(db, ja.id, t.workspace_id, ['owner', 'admin']))) {
    throw new KanalGreska('AI ključ menja vlasnik ili admin.', true);
  }
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(kljuc)) throw new KanalGreska('Ključ izgleda kao sk-ant-… (console.anthropic.com → API Keys).', true);
  await new AnthropicApiProvider(kljuc).proveri();
  await db.query(
    `insert into public.workspace_secrets (workspace_id, ciphertext) values ($1, $2)
     on conflict (workspace_id) do update set ciphertext = excluded.ciphertext, updated_at = now()`, [t.workspace_id, sifruj({ api_key: kljuc })]);
  await db.query(
    `insert into public.workspace_ai_settings (workspace_id, mode, key_hint) values ($1, 'sopstveni', $2)
     on conflict (workspace_id) do update set mode = 'sopstveni', key_hint = excluded.key_hint, updated_at = now()`, [t.workspace_id, `…${kljuc.slice(-4)}`]);
  posalji(res, 200, { ok: true, key_hint: `…${kljuc.slice(-4)}` });
}

async function aiKljucObrisi(db: pg.Pool, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const ja = await korisnik(req);
  const t = await citajJson<{ workspace_id?: string }>(req);
  if (!t.workspace_id || !(await imaUloguURadnomProstoru(db, ja.id, t.workspace_id, ['owner', 'admin']))) {
    throw new KanalGreska('AI ključ menja vlasnik ili admin.', true);
  }
  await db.query('delete from public.workspace_secrets where workspace_id = $1', [t.workspace_id]);
  await db.query(`update public.workspace_ai_settings set mode = 'ukljuceno', key_hint = null, updated_at = now() where workspace_id = $1`, [t.workspace_id]);
  posalji(res, 200, { ok: true });
}

/** Koji OAuth konektori su podešeni na ovom serveru (bez otkrivanja vrednosti). */
function stanjeKonektora(): Record<string, boolean> {
  return {
    instagram: !!env('INSTAGRAM_APP_ID') && !!env('INSTAGRAM_APP_SECRET'),
    threads: !!env('THREADS_APP_ID') && !!env('THREADS_APP_SECRET'),
  };
}

export function pokreniHttp(db: pg.Pool): void {
  const port = Number(env('WORKER_HTTP_PORT', '8787'));
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    try {
      if (cors(req, res)) return;
      const m = /^\/oauth\/([a-z0-9_]+)\/(start|povratak)$/.exec(url.pathname);
      if (req.method === 'GET' && url.pathname === '/zdravlje') return posalji(res, 200, { ok: true });
      if (req.method === 'GET' && m?.[2] === 'start') return await oauthStart(db, res, m[1]!, url.searchParams.get('state') ?? '');
      if (req.method === 'GET' && m?.[2] === 'povratak') return await oauthPovratak(db, res, m[1]!, url);
      if (req.method === 'POST' && url.pathname === '/veze/token') return await tokenIzForme(db, req, res);
      if (req.method === 'GET' && url.pathname === '/konektori/stanje') return posalji(res, 200, stanjeKonektora());
      if (req.method === 'POST' && url.pathname === '/ai/kljuc') return await aiKljuc(db, req, res);
      if (req.method === 'POST' && url.pathname === '/ai/kljuc/obrisi') return await aiKljucObrisi(db, req, res);
      const dodatna = dodatneRute.get(`${req.method} ${url.pathname}`);
      if (dodatna) return await dodatna(req, res, url);
      posalji(res, 404, { greska: 'Ne postoji.' });
    } catch (e) {
      const poruka = e instanceof Error ? e.message : String(e);
      if (url.pathname.startsWith('/oauth/') && req.method === 'GET') {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end(poruka);
      }
      posalji(res, e instanceof KanalGreska ? 400 : 500, { greska: poruka });
    }
  });
  server.listen(port, () => console.log(new Date().toISOString(), `HTTP workera na portu ${port}`));
}

export { posalji };
