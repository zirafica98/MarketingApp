// Zajednički oblik za sve kanale (konektore) koje alat ume automatski.

export interface Tajna {
  access_token?: string;
  [k: string]: unknown;
}

export interface Nalog {
  account_id: string;
  account_name: string;
  meta: Record<string, unknown>;
  expires_at?: Date | null;
  scopes?: string[];
}

export interface UvezenaObjava {
  external_id: string;
  permalink?: string | null;
  caption?: string | null;
  media_type?: string | null;
  format: string;
  thumbnail_url?: string | null;
  published_at?: string | null;
  metrics: { reach?: number | null; views?: number | null; likes?: number | null; comments?: number | null; saves?: number | null; shares?: number | null };
}

export interface ZaObjavu {
  /** javni URL-ovi slika redom (prazno za tekst) */
  slike: string[];
  tekst: string;
}

export interface Objavljeno {
  external_id: string;
  permalink: string | null;
}

export interface Proizvod {
  external_id: string;
  name: string;
  price: number | null;
  currency: string | null;
  url: string | null;
  image_url: string | null;
  description: string | null;
  in_stock: boolean | null;
}

export interface Kanal {
  id: string;
  /** OAuth: adresa za prijavu (state, redirect) */
  authorizeUrl?(state: string, redirect: string): string;
  /** OAuth: kod → dugotrajni token */
  exchange?(code: string, redirect: string): Promise<{ tajna: Tajna; expires_at: Date | null; scopes?: string[] }>;
  /** Token iz forme (Telegram, prodavnice) → provera i nalog */
  fromForm?(polja: Record<string, string>): Promise<{ tajna: Tajna; nalog: Nalog }>;
  nalog(t: Tajna): Promise<Nalog>;
  /** produženje tokena; vraća null ako nije potrebno */
  refresh?(t: Tajna): Promise<{ tajna: Tajna; expires_at: Date | null } | null>;
  /** uvoz objava i brojki (od najnovije), do `od` datuma */
  uvezi?(t: Tajna, od: Date): Promise<UvezenaObjava[]>;
  /** brojke naloga za danas */
  brojkeNaloga?(t: Tajna): Promise<{ followers?: number | null; reach?: number | null; profile_views?: number | null; website_clicks?: number | null; raw?: unknown }>;
  objavi?(t: Tajna, n: Nalog, o: ZaObjavu): Promise<Objavljeno>;
  /** prodavnice: katalog proizvoda */
  proizvodi?(t: Tajna): Promise<Proizvod[]>;
  /** da li je ista objava već na kanalu (posle pada usred objave) */
  vecObjavljeno?(t: Tajna, n: Nalog, tekst: string): Promise<Objavljeno | null>;
}

export class KanalGreska extends Error {
  readonly trajna: boolean;
  constructor(poruka: string, trajna = false) {
    super(poruka);
    this.trajna = trajna;
  }
}

export const spavaj = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch sa JSON odgovorom i čitljivom greškom; tokeni nikad u poruci greške. */
export async function json<T>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 30_000) });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  if (!res.ok || (body && typeof body === 'object' && 'error' in body && (body as { error: unknown }).error)) {
    const e = (body as { error?: { message?: string; code?: number } | string; description?: string })?.error;
    const msg = typeof e === 'string' ? e : e?.message ?? (body as { description?: string })?.description ?? `HTTP ${res.status}`;
    const sakriveno = String(msg).replace(/(access_token|token)=[^&\s]+/gi, '$1=***');
    throw new KanalGreska(sakriveno, res.status === 400 || res.status === 401 || res.status === 403);
  }
  return body as T;
}

export function forma(polja: Record<string, string | undefined>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(polja)) if (v !== undefined) p.set(k, v);
  return p;
}
