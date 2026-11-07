import type pg from 'pg';
import { desifruj, sifruj } from '../crypto.ts';
import { instagram } from './instagram.ts';
import { shopifyKanal, wooKanal } from './prodavnice.ts';
import { telegram } from './telegram.ts';
import { threads } from './threads.ts';
import type { Kanal, Nalog, Tajna } from './types.ts';

export * from './types.ts';

const KANALI: Record<string, Kanal> = { instagram, threads, telegram, shopify: shopifyKanal, woocommerce: wooKanal };

export function kanal(id: string): Kanal | undefined {
  return KANALI[id];
}

export interface Veza {
  id: string;
  brand_id: string;
  provider: string;
  mode: 'auto' | 'rucno';
  status: string;
  account_id: string | null;
  account_name: string | null;
  account_meta: Record<string, unknown>;
  token_expires_at: Date | null;
  last_sync_at: Date | null;
}

export async function veza(db: pg.Pool, id: string): Promise<Veza | null> {
  const { rows } = await db.query<Veza>('select * from public.connections where id = $1', [id]);
  return rows[0] ?? null;
}

export async function tajna(db: pg.Pool, connectionId: string): Promise<Tajna> {
  const { rows } = await db.query<{ ciphertext: string }>('select ciphertext from public.connection_secrets where connection_id = $1', [connectionId]);
  if (!rows[0]) throw new Error('Kanal nema sačuvan pristup. Poveži ga ponovo.');
  return desifruj<Tajna>(rows[0].ciphertext);
}

export function nalogIzVeze(v: Veza): Nalog {
  return { account_id: v.account_id ?? '', account_name: v.account_name ?? '', meta: v.account_meta };
}

/** Upis (ili zamena) veze posle uspešnog OAuth-a ili provere tokena. */
export async function sacuvajVezu(
  db: pg.Pool,
  p: { brand_id: string; provider: string; user_id: string; nalog: Nalog; tajna: Tajna; expires_at?: Date | null; scopes?: string[] },
): Promise<string> {
  const c = await db.connect();
  try {
    await c.query('begin');
    const { rows } = await c.query<{ id: string }>(
      `insert into public.connections (brand_id, provider, mode, status, account_id, account_name, account_meta, scopes, token_expires_at, last_error, created_by)
       values ($1, $2, 'auto', 'povezano', $3, $4, $5, $6, $7, null, $8)
       on conflict (brand_id, provider) do update set mode = 'auto', status = 'povezano', account_id = excluded.account_id,
         account_name = excluded.account_name, account_meta = excluded.account_meta, scopes = excluded.scopes,
         token_expires_at = excluded.token_expires_at, last_error = null
       returning id`,
      [p.brand_id, p.provider, p.nalog.account_id, p.nalog.account_name, JSON.stringify(p.nalog.meta), p.scopes ?? [], p.expires_at ?? null, p.user_id],
    );
    const id = rows[0]!.id;
    await c.query(
      `insert into public.connection_secrets (connection_id, ciphertext) values ($1, $2)
       on conflict (connection_id) do update set ciphertext = excluded.ciphertext, updated_at = now()`,
      [id, sifruj(p.tajna)],
    );
    await c.query('commit');
    return id;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

export async function zameniTajnu(db: pg.Pool, connectionId: string, t: Tajna, expires: Date | null): Promise<void> {
  await db.query('update public.connection_secrets set ciphertext = $2, updated_at = now() where connection_id = $1', [connectionId, sifruj(t)]);
  await db.query(`update public.connections set token_expires_at = $2, status = 'povezano', last_error = null where id = $1`, [connectionId, expires]);
}
