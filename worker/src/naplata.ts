// Planovi i naplata (Stripe Checkout + webhook). Bez STRIPE_SECRET_KEY plaćanje je isključeno (aplikacija to jasno kaže).
// Plan u bazi menja SAMO potvrđen webhook (potpis proveren), nikad pregledač.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type pg from 'pg';
import { citajJson, citajSirovo, dodajRutu, imaUloguURadnomProstoru, korisnik, posalji } from './http.ts';
import { KanalGreska } from './channels/index.ts';
import { obavesti } from './jobs/channels.ts';

const env = (k: string) => process.env[k] ?? '';

/** Koliko još nacrta radni prostor sme ovog meseca (Infinity sa sopstvenim AI ključem). */
export async function preostaloNacrta(db: pg.Pool, workspaceId: string): Promise<number> {
  const { rows } = await db.query<{ mode: string | null; max: number; n: number }>(
    `select (select mode from public.workspace_ai_settings where workspace_id = w.id) as mode, p.max_drafts_month as max,
            (select count(*)::int from public.drafts d join public.brands b on b.id = d.brand_id
              where b.workspace_id = w.id and d.created_at >= date_trunc('month', now())) as n
       from public.workspaces w join public.plans p on p.id = w.plan where w.id = $1`, [workspaceId]);
  const r = rows[0];
  if (!r) return 0;
  return r.mode === 'sopstveni' ? Number.POSITIVE_INFINITY : Math.max(0, r.max - r.n);
}

export async function obavestiLimit(db: pg.Pool, brandId: string): Promise<void> {
  await obavesti(db, brandId, 'limit', 'Dostignut mesečni broj nacrta',
    'Plan je iskoristio nacrte za ovaj mesec. Nadogradi plan ili dodaj sopstveni AI ključ da nastaviš.', '/plan');
}

/** Provera Stripe potpisa: header „t=…,v1=…“, HMAC-SHA256 nad „t.telo“, tolerancija 5 minuta. */
export function proveriStripePotpis(telo: Buffer, header: string, tajna: string, sada = Date.now()): boolean {
  const delovi = Object.fromEntries(header.split(',').map((x) => x.split('=') as [string, string]));
  const t = Number(delovi['t']);
  const v1 = header.split(',').filter((x) => x.startsWith('v1=')).map((x) => x.slice(3));
  if (!t || !v1.length || Math.abs(sada / 1000 - t) > 300) return false;
  const ocekivano = createHmac('sha256', tajna).update(`${t}.${telo.toString('utf8')}`).digest('hex');
  return v1.some((s) => s.length === ocekivano.length && timingSafeEqual(Buffer.from(s), Buffer.from(ocekivano)));
}

async function stripe<T>(putanja: string, polja: Record<string, string>): Promise<T> {
  const res = await fetch(`https://api.stripe.com/v1${putanja}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env('STRIPE_SECRET_KEY')}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(polja),
  });
  const j = (await res.json()) as T & { error?: { message: string } };
  if (!res.ok) throw new KanalGreska(`Stripe: ${j.error?.message ?? res.status}`);
  return j;
}

export function rutaNaplate(db: pg.Pool): void {
  dodajRutu('GET /naplata/stanje', async (_req, res) => posalji(res, 200, { ukljuceno: !!env('STRIPE_SECRET_KEY') }));

  dodajRutu('POST /naplata/checkout', async (req, res) => {
    const ja = await korisnik(req);
    const t = await citajJson<{ workspace_id?: string; plan?: string }>(req);
    if (!t.workspace_id || !(await imaUloguURadnomProstoru(db, ja.id, t.workspace_id, ['owner']))) throw new KanalGreska('Plan menja vlasnik.', true);
    if (!env('STRIPE_SECRET_KEY')) throw new KanalGreska('Plaćanje još nije uključeno na ovom serveru.', true);
    const cena = t.plan === 'pro' ? env('STRIPE_PRICE_PRO') : t.plan === 'agencija' ? env('STRIPE_PRICE_AGENCIJA') : '';
    if (!cena) throw new KanalGreska('Nepoznat plan.', true);
    const s = await stripe<{ url: string }>('/checkout/sessions', {
      mode: 'subscription',
      'line_items[0][price]': cena,
      'line_items[0][quantity]': '1',
      client_reference_id: t.workspace_id,
      'metadata[plan]': t.plan!,
      'metadata[workspace_id]': t.workspace_id,
      'subscription_data[metadata][workspace_id]': t.workspace_id,
      ...(ja.email ? { customer_email: ja.email } : {}),
      success_url: `${env('WEB_URL')}/plan?uspeh=1`,
      cancel_url: `${env('WEB_URL')}/plan`,
    });
    posalji(res, 200, { url: s.url });
  });

  dodajRutu('POST /naplata/webhook', async (req, res) => {
    const telo = await citajSirovo(req);
    if (!env('STRIPE_WEBHOOK_SECRET') || !proveriStripePotpis(telo, String(req.headers['stripe-signature'] ?? ''), env('STRIPE_WEBHOOK_SECRET'))) {
      return posalji(res, 400, { greska: 'Neispravan potpis.' });
    }
    const dogadjaj = JSON.parse(telo.toString('utf8')) as { type: string; data: { object: Record<string, unknown> } };
    const o = dogadjaj.data.object;
    if (dogadjaj.type === 'checkout.session.completed') {
      const meta = (o['metadata'] ?? {}) as Record<string, string>;
      if (meta['workspace_id'] && ['pro', 'agencija'].includes(meta['plan'] ?? '')) {
        await db.query('update public.workspaces set plan = $2, stripe_customer_id = $3 where id = $1', [meta['workspace_id'], meta['plan'], o['customer'] ?? null]);
      }
    } else if (dogadjaj.type === 'customer.subscription.deleted') {
      await db.query(`update public.workspaces set plan = 'besplatno', plan_renews_at = null where stripe_customer_id = $1`, [o['customer']]);
    } else if (dogadjaj.type === 'customer.subscription.updated' && typeof o['current_period_end'] === 'number') {
      await db.query('update public.workspaces set plan_renews_at = to_timestamp($2) where stripe_customer_id = $1', [o['customer'], o['current_period_end']]);
    }
    posalji(res, 200, { primljeno: true });
  });
}
