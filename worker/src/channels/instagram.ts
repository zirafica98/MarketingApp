// Instagram API sa Instagram prijavom (graph.instagram.com) — isti put kao AI News (scripts/objavi-instagram.mjs).
// Token se šalje u telu POST zahteva, ne u URL-u, da ne završi u logovima. GET mora u URL (API drugačije ne prima).

import { forma, json, KanalGreska, spavaj, type Kanal, type Nalog, type Tajna, type UvezenaObjava } from './types.ts';

const API = 'https://graph.instagram.com/v25.0';
const SCOPES = ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_insights'];

const appId = () => process.env['INSTAGRAM_APP_ID'] ?? '';
const appSecret = () => process.env['INSTAGRAM_APP_SECRET'] ?? '';

async function get<T>(t: Tajna, path: string, polja: Record<string, string> = {}): Promise<T> {
  const q = new URLSearchParams({ ...polja, access_token: String(t.access_token) });
  return json<T>(`${API}${path}?${q}`);
}
async function post<T>(t: Tajna, path: string, polja: Record<string, string>): Promise<T> {
  return json<T>(`${API}${path}`, { method: 'POST', body: forma({ ...polja, access_token: String(t.access_token) }) });
}

export function formatIzMedija(mediaType?: string | null, product?: string | null): string {
  if (product === 'REELS') return 'reel';
  if (product === 'STORY') return 'prica';
  if (mediaType === 'CAROUSEL_ALBUM') return 'karusel';
  if (mediaType === 'VIDEO') return 'video';
  return 'slika';
}

interface Medij {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  permalink?: string;
  timestamp?: string;
  thumbnail_url?: string;
  media_url?: string;
  like_count?: number;
  comments_count?: number;
}

async function uvidi(t: Tajna, m: Medij): Promise<Record<string, number>> {
  // Nisu sve metrike dostupne za sve vrste objava; prvo pun skup, pa skraćen.
  const skupovi = m.media_product_type === 'REELS'
    ? ['reach,saved,shares,views,total_interactions', 'reach,saved']
    : ['reach,saved,shares,views,total_interactions', 'reach,saved', 'reach'];
  for (const metric of skupovi) {
    try {
      const r = await get<{ data: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] }>(t, `/${m.id}/insights`, { metric });
      return Object.fromEntries(r.data.map((d) => [d.name, d.total_value?.value ?? d.values?.[0]?.value ?? 0]));
    } catch {
      /* sledeći skup */
    }
  }
  return {};
}

export const instagram: Kanal = {
  id: 'instagram',

  authorizeUrl(state, redirect) {
    if (!appId()) throw new KanalGreska('Instagram nije podešen na serveru (INSTAGRAM_APP_ID).', true);
    const q = new URLSearchParams({ client_id: appId(), redirect_uri: redirect, response_type: 'code', scope: SCOPES.join(','), state });
    return `https://www.instagram.com/oauth/authorize?${q}`;
  },

  async exchange(code, redirect) {
    const kratki = await json<{ access_token: string; user_id: string; permissions?: string[] }>('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      body: forma({ client_id: appId(), client_secret: appSecret(), grant_type: 'authorization_code', redirect_uri: redirect, code }),
    });
    const q = new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: appSecret(), access_token: kratki.access_token });
    const dugi = await json<{ access_token: string; expires_in: number }>(`https://graph.instagram.com/access_token?${q}`);
    return {
      tajna: { access_token: dugi.access_token },
      expires_at: new Date(Date.now() + dugi.expires_in * 1000),
      scopes: kratki.permissions ?? SCOPES,
    };
  },

  async nalog(t): Promise<Nalog> {
    const ja = await get<{ user_id: string; username: string; account_type?: string; followers_count?: number; media_count?: number; profile_picture_url?: string }>(
      t, '/me', { fields: 'user_id,username,account_type,followers_count,media_count,profile_picture_url' },
    );
    if (ja.account_type && !['BUSINESS', 'MEDIA_CREATOR'].includes(ja.account_type)) {
      throw new KanalGreska('Instagram nalog nije poslovni ni kreatorski. Prebaci ga u profesionalni nalog pa poveži ponovo.', true);
    }
    return { account_id: ja.user_id, account_name: `@${ja.username}`, meta: { tip: ja.account_type, pratioci: ja.followers_count, objava: ja.media_count, slika: ja.profile_picture_url } };
  },

  async refresh(t) {
    // Dugotrajni token važi 60 dana; produžava se pre isteka (bar 24h star).
    const r = await json<{ access_token: string; expires_in: number }>(
      `https://graph.instagram.com/refresh_access_token?${new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: String(t.access_token) })}`,
    );
    return { tajna: { ...t, access_token: r.access_token }, expires_at: new Date(Date.now() + r.expires_in * 1000) };
  },

  async uvezi(t, od) {
    const out: UvezenaObjava[] = [];
    let url: string | null = `${API}/me/media?${new URLSearchParams({
      fields: 'id,caption,media_type,media_product_type,permalink,timestamp,thumbnail_url,media_url,like_count,comments_count',
      limit: '50',
      access_token: String(t.access_token),
    })}`;
    while (url && out.length < 300) {
      const strana: { data: Medij[]; paging?: { next?: string } } = await json(url);
      for (const m of strana.data) {
        if (m.timestamp && new Date(m.timestamp) < od) return out;
        const u = await uvidi(t, m);
        out.push({
          external_id: m.id,
          permalink: m.permalink ?? null,
          caption: m.caption ?? null,
          media_type: m.media_type ?? null,
          format: formatIzMedija(m.media_type, m.media_product_type),
          thumbnail_url: m.thumbnail_url ?? (m.media_type === 'IMAGE' || m.media_type === 'CAROUSEL_ALBUM' ? m.media_url : null) ?? null,
          published_at: m.timestamp ?? null,
          metrics: {
            likes: m.like_count ?? null, comments: m.comments_count ?? null,
            reach: u['reach'] ?? null, saves: u['saved'] ?? null, shares: u['shares'] ?? null, views: u['views'] ?? null,
          },
        });
      }
      url = strana.paging?.next ?? null;
    }
    return out;
  },

  async brojkeNaloga(t) {
    const ja = await get<{ followers_count?: number }>(t, '/me', { fields: 'followers_count' });
    let reach: number | null = null, profile_views: number | null = null, website_clicks: number | null = null;
    try {
      const r = await get<{ data: { name: string; total_value?: { value: number } }[] }>(t, '/me/insights', {
        metric: 'reach,profile_views,website_clicks', period: 'day', metric_type: 'total_value',
      });
      for (const d of r.data) {
        if (d.name === 'reach') reach = d.total_value?.value ?? null;
        if (d.name === 'profile_views') profile_views = d.total_value?.value ?? null;
        if (d.name === 'website_clicks') website_clicks = d.total_value?.value ?? null;
      }
    } catch {
      /* uvidi naloga nisu uvek dostupni (mali nalozi) */
    }
    return { followers: ja.followers_count ?? null, reach, profile_views, website_clicks };
  },

  async objavi(t, n, o) {
    if (!o.slike.length) throw new KanalGreska('Instagram objava mora imati bar jednu sliku.', true);
    const caption = o.tekst.slice(0, 2200);
    let kontejner: string;
    if (o.slike.length === 1) {
      kontejner = (await post<{ id: string }>(t, `/${n.account_id}/media`, { image_url: o.slike[0]!, caption })).id;
    } else {
      const deca: string[] = [];
      for (const url of o.slike.slice(0, 10)) {
        deca.push((await post<{ id: string }>(t, `/${n.account_id}/media`, { image_url: url, is_carousel_item: 'true' })).id);
      }
      kontejner = (await post<{ id: string }>(t, `/${n.account_id}/media`, { media_type: 'CAROUSEL', children: deca.join(','), caption })).id;
    }
    // Instagram obrađuje kontejner u pozadini; objava pre FINISHED vraća grešku.
    for (let i = 0; ; i++) {
      await spavaj(i === 0 ? 3000 : 10_000);
      const { status_code } = await get<{ status_code: string }>(t, `/${kontejner}`, { fields: 'status_code' });
      if (status_code === 'FINISHED') break;
      if (status_code === 'ERROR' || status_code === 'EXPIRED' || i >= 18) throw new KanalGreska(`Instagram nije pripremio objavu (${status_code}).`);
    }
    const objava = await post<{ id: string }>(t, `/${n.account_id}/media_publish`, { creation_id: kontejner });
    const { permalink } = await get<{ permalink?: string }>(t, `/${objava.id}`, { fields: 'permalink' }).catch(() => ({ permalink: undefined }));
    return { external_id: objava.id, permalink: permalink ?? null };
  },

  async vecObjavljeno(t, _n, tekst) {
    const pocetak = tekst.slice(0, 80);
    const r = await get<{ data: Medij[] }>(t, '/me/media', { fields: 'id,caption,permalink,timestamp', limit: '10' });
    const m = r.data.find((x) => x.caption?.startsWith(pocetak) && x.timestamp && Date.now() - new Date(x.timestamp).getTime() < 6 * 3600_000);
    return m ? { external_id: m.id, permalink: m.permalink ?? null } : null;
  },
};
