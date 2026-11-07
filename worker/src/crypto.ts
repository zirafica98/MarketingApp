// Šifrovanje tajni (tokeni mreža, API ključevi) pre upisa u bazu. AES-256-GCM, ključ iz TOKEN_ENC_KEY (32 bajta, base64).
// Format: v1.<iv base64>.<tag base64>.<podaci base64>

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function kljuc(): Buffer {
  const k = Buffer.from(process.env['TOKEN_ENC_KEY'] ?? '', 'base64');
  if (k.length !== 32) throw new Error('TOKEN_ENC_KEY mora biti 32 bajta u base64 (vidi .env.example).');
  return k;
}

export function sifruj(podaci: unknown): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', kljuc(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(podaci), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

export function desifruj<T>(tekst: string): T {
  const [v, iv, tag, enc] = tekst.split('.');
  if (v !== 'v1' || !iv || !tag || !enc) throw new Error('Nepoznat format tajne.');
  const d = createDecipheriv('aes-256-gcm', kljuc(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8')) as T;
}
