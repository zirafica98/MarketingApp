import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { ocistiSemu } from './ai/anthropic-api.ts';
import { proveriStripePotpis } from './naplata.ts';

test('Stripe potpis: ispravan prolazi, izmenjen ili star ne', () => {
  const telo = Buffer.from('{"type":"checkout.session.completed"}');
  const t = Math.floor(Date.now() / 1000);
  const potpis = createHmac('sha256', 'whsec_test').update(`${t}.${telo}`).digest('hex');
  assert.equal(proveriStripePotpis(telo, `t=${t},v1=${potpis}`, 'whsec_test'), true);
  assert.equal(proveriStripePotpis(Buffer.from('{"type":"zlo"}'), `t=${t},v1=${potpis}`, 'whsec_test'), false);
  assert.equal(proveriStripePotpis(telo, `t=${t},v1=${potpis}`, 'pogresna'), false);
  assert.equal(proveriStripePotpis(telo, `t=${t - 3600},v1=${potpis}`, 'whsec_test', Date.now()), false);
});

test('šema za API: skida ograničenja dužine, zadržava oblik i enum', () => {
  const s = ocistiSemu({ type: 'object', required: ['a'], additionalProperties: false,
    properties: { a: { type: 'string', maxLength: 10, pattern: '^x$', enum: ['x'] }, b: { type: 'array', maxItems: 3, items: { type: 'integer', minimum: 1 } } } });
  assert.deepEqual(s, { type: 'object', required: ['a'], additionalProperties: false,
    properties: { a: { type: 'string', enum: ['x'] }, b: { type: 'array', items: { type: 'integer' } } } });
});
