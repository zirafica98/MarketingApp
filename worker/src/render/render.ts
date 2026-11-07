// HTML → PNG preko Chrome-a (playwright-core), isto kao ContentStudio. Na serveru: CHROME_BIN = putanja do chromium-a.

import { chromium } from 'playwright-core';
import { createClient } from '@supabase/supabase-js';

const CHROME = () => process.env['CHROME_BIN'] || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export async function uSlike(html: string[], { width = 1080, height = 1350 } = {}): Promise<Buffer[]> {
  if (!html.length) return [];
  const browser = await chromium.launch({ executablePath: CHROME(), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const out: Buffer[] = [];
    for (const h of html) {
      await page.setContent(h, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      out.push(await page.screenshot({ type: 'png' }));
    }
    return out;
  } finally {
    await browser.close();
  }
}

function skladiste() {
  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Nedostaju SUPABASE_URL i SUPABASE_SERVICE_ROLE_KEY za čuvanje slika.');
  return createClient(url, key, { auth: { persistSession: false } }).storage.from('media');
}

/** Upload u javni bucket „media“; vraća javni URL (mreže preuzimaju sliku sa njega). */
export async function sacuvajSliku(putanja: string, png: Buffer): Promise<string> {
  const s = skladiste();
  const { error } = await s.upload(putanja, png, { contentType: 'image/png', upsert: true, cacheControl: '31536000' });
  if (error) throw new Error(`Slika nije sačuvana: ${error.message}`);
  // verzija u URL-u: nova slika posle popravke ne sme da se vidi kao stara iz keša
  return `${s.getPublicUrl(putanja).data.publicUrl}?v=${Date.now()}`;
}

export async function obrisiSlike(prefiks: string): Promise<void> {
  const s = skladiste();
  const { data } = await s.list(prefiks);
  if (data?.length) await s.remove(data.map((f) => `${prefiks}/${f.name}`));
}
