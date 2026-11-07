// Prodavnice: Shopify (Admin API token iz „custom app“) i WooCommerce (REST ključ samo za čitanje).
// Samo čitanje kataloga: naziv, cena, slika, link, opis, zaliha. Adrese prolaze istu zaštitu kao čitanje sajtova.

import { proveriAdresu } from '../web/fetch-site.ts';
import { json, KanalGreska, type Kanal, type Proizvod, type Tajna } from './types.ts';

const VERZIJA = '2025-10';
const bezHtml = (s: string | null | undefined) =>
  (s ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1500) || null;

// ───────────── Shopify ─────────────

async function shopify<T>(t: Tajna, putanja: string): Promise<T> {
  return json<T>(`https://${String(t['shop'])}/admin/api/${VERZIJA}${putanja}`, {
    headers: { 'X-Shopify-Access-Token': String(t['access_token']), accept: 'application/json' },
  });
}

export const shopifyKanal: Kanal = {
  id: 'shopify',
  async fromForm(polja) {
    const shop = (polja['shop'] ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const token = (polja['access_token'] ?? '').trim();
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) throw new KanalGreska('Upiši adresu kao imeprodavnice.myshopify.com.', true);
    if (!/^shpat_[a-f0-9]{20,}$/i.test(token)) throw new KanalGreska('Admin API token počinje sa „shpat_“.', true);
    const tajna: Tajna = { shop, access_token: token };
    return { tajna, nalog: await shopifyKanal.nalog(tajna) };
  },
  async nalog(t) {
    const { shop } = await shopify<{ shop: { id: number; name: string; domain: string; currency: string } }>(t, '/shop.json');
    return { account_id: String(shop.id), account_name: shop.name, meta: { domen: shop.domain, valuta: shop.currency } };
  },
  async proizvodi(t) {
    const nalog = await shopifyKanal.nalog(t);
    const domen = String(nalog.meta['domen'] ?? t['shop']);
    const r = await shopify<{ products: { id: number; title: string; handle: string; body_html: string | null; status: string;
      variants: { price: string; inventory_quantity?: number }[]; images: { src: string }[] }[] }>(
      t, '/products.json?limit=250&status=active&fields=id,title,handle,body_html,status,variants,images');
    return r.products.map((p): Proizvod => ({
      external_id: String(p.id), name: p.title,
      price: p.variants[0] ? Number(p.variants[0].price) : null, currency: String(nalog.meta['valuta'] ?? '') || null,
      url: `https://${domen}/products/${p.handle}`, image_url: p.images[0]?.src ?? null, description: bezHtml(p.body_html),
      in_stock: p.variants.some((v) => (v.inventory_quantity ?? 1) > 0),
    }));
  },
};

// ───────────── WooCommerce ─────────────

async function woo<T>(t: Tajna, putanja: string): Promise<T> {
  const url = new URL(`${String(t['site']).replace(/\/$/, '')}/wp-json/wc/v3${putanja}`);
  await proveriAdresu(url);
  const auth = Buffer.from(`${String(t['consumer_key'])}:${String(t['consumer_secret'])}`).toString('base64');
  return json<T>(url.href, { headers: { authorization: `Basic ${auth}`, accept: 'application/json' } });
}

export const wooKanal: Kanal = {
  id: 'woocommerce',
  async fromForm(polja) {
    let site = (polja['site'] ?? '').trim().replace(/\/$/, '');
    if (!/^https?:\/\//i.test(site)) site = `https://${site}`;
    if (!/^https:\/\//i.test(site)) throw new KanalGreska('Prodavnica mora da radi preko https:// (ključ ne sme da ide nešifrovano).', true);
    const consumer_key = (polja['consumer_key'] ?? '').trim();
    const consumer_secret = (polja['consumer_secret'] ?? '').trim();
    if (!/^ck_[a-f0-9]{20,}$/i.test(consumer_key) || !/^cs_[a-f0-9]{20,}$/i.test(consumer_secret)) {
      throw new KanalGreska('Ključevi izgledaju kao ck_… i cs_… (WooCommerce → Settings → Advanced → REST API).', true);
    }
    const tajna: Tajna = { site, consumer_key, consumer_secret };
    return { tajna, nalog: await wooKanal.nalog(tajna) };
  },
  async nalog(t) {
    await woo<unknown[]>(t, '/products?per_page=1');
    const host = new URL(String(t['site'])).hostname;
    return { account_id: host, account_name: host, meta: {} };
  },
  async proizvodi(t) {
    const out: Proizvod[] = [];
    for (let strana = 1; strana <= 5; strana++) {
      const l = await woo<{ id: number; name: string; permalink: string; price: string; short_description: string; description: string;
        images: { src: string }[]; stock_status: string }[]>(t, `/products?per_page=100&status=publish&page=${strana}`);
      for (const p of l) {
        out.push({
          external_id: String(p.id), name: p.name, price: p.price ? Number(p.price) : null, currency: null, url: p.permalink,
          image_url: p.images[0]?.src ?? null, description: bezHtml(p.short_description || p.description), in_stock: p.stock_status === 'instock',
        });
      }
      if (l.length < 100) break;
    }
    return out;
  },
};
