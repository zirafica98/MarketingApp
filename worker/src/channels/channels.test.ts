import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { poGrupi, sazetak, type ObjavaBrojke } from '../../../shared/statistika.ts';
import { desifruj, sifruj } from '../crypto.ts';
import { satIDan } from '../jobs/channels.ts';
import { formatIzMedija, instagram } from './instagram.ts';
import { telegram } from './telegram.ts';
import { KanalGreska } from './types.ts';

process.env['TOKEN_ENC_KEY'] = Buffer.alloc(32, 7).toString('base64');
const pravi = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = pravi;
});

test('šifrovanje: vraća isto, svaki put drugačiji zapis, otkriva izmenu', () => {
  const a = sifruj({ access_token: 'IGQ-tajna' });
  assert.notEqual(a, sifruj({ access_token: 'IGQ-tajna' }));
  assert.deepEqual(desifruj(a), { access_token: 'IGQ-tajna' });
  const p = a.split('.');
  p[3] = Buffer.from('zlo').toString('base64');
  assert.throws(() => desifruj(p.join('.')));
});

test('format Instagram objave', () => {
  assert.equal(formatIzMedija('CAROUSEL_ALBUM', 'FEED'), 'karusel');
  assert.equal(formatIzMedija('VIDEO', 'REELS'), 'reel');
  assert.equal(formatIzMedija('IMAGE', 'FEED'), 'slika');
});

test('sat i dan objave u zoni brenda', () => {
  assert.deepEqual(satIDan('2026-11-09T19:30:00Z', 'Europe/Belgrade'), { sat: 20, dan: 'pon' });
});

test('Instagram: lični nalog se odbija sa jasnom porukom', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ user_id: '1', username: 'x', account_type: 'PERSONAL' }))) as typeof fetch;
  await assert.rejects(instagram.nalog({ access_token: 't' }), /nije poslovni/);
});

test('Instagram: token ne sme da završi u poruci greške', async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: { message: 'Invalid token access_token=IGQSECRET123' } }), { status: 400 })) as typeof fetch;
  await assert.rejects(instagram.nalog({ access_token: 'IGQSECRET123' }), (e: Error) => !e.message.includes('IGQSECRET123') && e instanceof KanalGreska);
});

test('Instagram: karusel pravi decu, čeka obradu i objavljuje', async () => {
  const pozivi: string[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    pozivi.push(`${init?.method ?? 'GET'} ${u.replace(/\?.*/, '')}`);
    if (u.includes('/media_publish')) return new Response(JSON.stringify({ id: 'objava1' }));
    if (u.endsWith('/42/media')) return new Response(JSON.stringify({ id: `k${pozivi.length}` }));
    if (u.includes('fields=status_code')) return new Response(JSON.stringify({ status_code: 'FINISHED' }));
    if (u.includes('fields=permalink')) return new Response(JSON.stringify({ permalink: 'https://instagram.com/p/x' }));
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  const r = await instagram.objavi!({ access_token: 't' }, { account_id: '42', account_name: '@k', meta: {} }, { slike: ['https://a/1.png', 'https://a/2.png'], tekst: 'Zdravo' });
  assert.deepEqual(r, { external_id: 'objava1', permalink: 'https://instagram.com/p/x' });
  assert.equal(pozivi.filter((p) => p === 'POST https://graph.instagram.com/v25.0/42/media').length, 3); // 2 deteta + karusel
});

test('Telegram: proverava token i kanal pre poziva', async () => {
  await assert.rejects(telegram.fromForm!({ bot_token: 'los', chat: '@kanal' }), /Token bota/);
  await assert.rejects(telegram.fromForm!({ bot_token: '123456:' + 'a'.repeat(30), chat: 'x y' }), /@imekanala/);
});

test('statistika: odnos prema proseku brenda', () => {
  const o = (id: string, format: string, reach: number, saves: number): ObjavaBrojke => ({
    id, format, published_at: null, tags: {}, reach, views: null, likes: 0, comments: 0, saves, shares: 0,
  });
  const l = [o('1', 'karusel', 300, 30), o('2', 'karusel', 300, 30), o('3', 'slika', 100, 1), o('4', 'slika', 100, 1)];
  assert.equal(sazetak(l).prosekDosega, 200);
  const g = poGrupi(l, (x) => x.format);
  assert.equal(g[0]!.grupa, 'karusel');
  assert.equal(g[0]!.odnosDosega, 1.5);
  assert.ok(g[0]!.odnosCuvanja > 1 && g[1]!.odnosCuvanja < 1);
});

test('Shopify: proverava adresu i token, pa čita katalog', async () => {
  const { shopifyKanal } = await import('./prodavnice.ts');
  await assert.rejects(shopifyKanal.fromForm!({ shop: 'korak.rs', access_token: 'shpat_' + 'a'.repeat(32) }), /myshopify/);
  await assert.rejects(shopifyKanal.fromForm!({ shop: 'korak.myshopify.com', access_token: 'los' }), /shpat_/);
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.endsWith('/shop.json')) return new Response(JSON.stringify({ shop: { id: 1, name: 'Korak', domain: 'korak.rs', currency: 'RSD' } }));
    return new Response(JSON.stringify({ products: [{ id: 7, title: 'Patika X', handle: 'patika-x', body_html: '<p>Lagana&nbsp;patika</p>', status: 'active',
      variants: [{ price: '12990.00', inventory_quantity: 3 }], images: [{ src: 'https://cdn/x.jpg' }] }] }));
  }) as typeof fetch;
  const l = await shopifyKanal.proizvodi!({ shop: 'korak.myshopify.com', access_token: 'shpat_x' });
  assert.deepEqual(l[0], { external_id: '7', name: 'Patika X', price: 12990, currency: 'RSD', url: 'https://korak.rs/products/patika-x',
    image_url: 'https://cdn/x.jpg', description: 'Lagana patika', in_stock: true });
});

test('WooCommerce: samo https i ispravni ključevi', async () => {
  const { wooKanal } = await import('./prodavnice.ts');
  await assert.rejects(wooKanal.fromForm!({ site: 'http://korak.rs', consumer_key: 'ck_' + 'a'.repeat(30), consumer_secret: 'cs_' + 'b'.repeat(30) }), /https/);
  await assert.rejects(wooKanal.fromForm!({ site: 'https://localhost', consumer_key: 'ck_' + 'a'.repeat(30), consumer_secret: 'cs_' + 'b'.repeat(30) }), /nije javna/);
});
