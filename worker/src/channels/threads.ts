// Threads API (graph.threads.net) — isti obrazac kao AI News (scripts/objavi-threads.mjs).

import { forma, json, KanalGreska, spavaj, type Kanal, type Tajna } from './types.ts';

const API = 'https://graph.threads.net/v1.0';
const SCOPES = ['threads_basic', 'threads_content_publish'];
const appId = () => process.env['THREADS_APP_ID'] ?? '';
const appSecret = () => process.env['THREADS_APP_SECRET'] ?? '';

async function get<T>(t: Tajna, path: string, polja: Record<string, string> = {}): Promise<T> {
  return json<T>(`${API}${path}?${new URLSearchParams({ ...polja, access_token: String(t.access_token) })}`);
}
async function post<T>(t: Tajna, path: string, polja: Record<string, string>): Promise<T> {
  return json<T>(`${API}${path}`, { method: 'POST', body: forma({ ...polja, access_token: String(t.access_token) }) });
}

async function cekaj(t: Tajna, id: string): Promise<void> {
  for (let i = 0; ; i++) {
    await spavaj(i === 0 ? 3000 : 8000);
    const { status } = await get<{ status?: string }>(t, `/${id}`, { fields: 'status' });
    if (!status || status === 'FINISHED') return;
    if (status === 'ERROR' || status === 'EXPIRED' || i >= 15) throw new KanalGreska(`Threads nije pripremio objavu (${status}).`);
  }
}

export const threads: Kanal = {
  id: 'threads',

  authorizeUrl(state, redirect) {
    if (!appId()) throw new KanalGreska('Threads nije podešen na serveru (THREADS_APP_ID).', true);
    const q = new URLSearchParams({ client_id: appId(), redirect_uri: redirect, response_type: 'code', scope: SCOPES.join(','), state });
    return `https://threads.net/oauth/authorize?${q}`;
  },

  async exchange(code, redirect) {
    const kratki = await json<{ access_token: string }>('https://graph.threads.net/oauth/access_token', {
      method: 'POST',
      body: forma({ client_id: appId(), client_secret: appSecret(), grant_type: 'authorization_code', redirect_uri: redirect, code }),
    });
    const q = new URLSearchParams({ grant_type: 'th_exchange_token', client_secret: appSecret(), access_token: kratki.access_token });
    const dugi = await json<{ access_token: string; expires_in: number }>(`https://graph.threads.net/access_token?${q}`);
    return { tajna: { access_token: dugi.access_token }, expires_at: new Date(Date.now() + dugi.expires_in * 1000), scopes: SCOPES };
  },

  async nalog(t) {
    const ja = await get<{ id: string; username: string }>(t, '/me', { fields: 'id,username' });
    return { account_id: ja.id, account_name: `@${ja.username}`, meta: {} };
  },

  async refresh(t) {
    const r = await json<{ access_token: string; expires_in: number }>(
      `https://graph.threads.net/refresh_access_token?${new URLSearchParams({ grant_type: 'th_refresh_token', access_token: String(t.access_token) })}`,
    );
    return { tajna: { ...t, access_token: r.access_token }, expires_at: new Date(Date.now() + r.expires_in * 1000) };
  },

  async objavi(t, n, o) {
    const text = o.tekst.slice(0, 500);
    let id: string;
    if (!o.slike.length) {
      id = (await post<{ id: string }>(t, `/${n.account_id}/threads`, { media_type: 'TEXT', text })).id;
    } else if (o.slike.length === 1) {
      id = (await post<{ id: string }>(t, `/${n.account_id}/threads`, { media_type: 'IMAGE', image_url: o.slike[0]!, text })).id;
    } else {
      const deca: string[] = [];
      for (const url of o.slike.slice(0, 10)) {
        deca.push((await post<{ id: string }>(t, `/${n.account_id}/threads`, { media_type: 'IMAGE', image_url: url, is_carousel_item: 'true' })).id);
      }
      id = (await post<{ id: string }>(t, `/${n.account_id}/threads`, { media_type: 'CAROUSEL', children: deca.join(','), text })).id;
    }
    await cekaj(t, id);
    const objava = await post<{ id: string }>(t, `/${n.account_id}/threads_publish`, { creation_id: id });
    const { permalink } = await get<{ permalink?: string }>(t, `/${objava.id}`, { fields: 'permalink' }).catch(() => ({ permalink: undefined }));
    return { external_id: objava.id, permalink: permalink ?? null };
  },

  async vecObjavljeno(t, n, tekst) {
    const r = await get<{ data: { id: string; text?: string; permalink?: string; timestamp?: string }[] }>(t, `/${n.account_id}/threads`, {
      fields: 'id,text,permalink,timestamp', limit: '10',
    });
    const m = r.data.find((x) => x.text?.startsWith(tekst.slice(0, 80)) && x.timestamp && Date.now() - new Date(x.timestamp).getTime() < 6 * 3600_000);
    return m ? { external_id: m.id, permalink: m.permalink ?? null } : null;
  },
};
