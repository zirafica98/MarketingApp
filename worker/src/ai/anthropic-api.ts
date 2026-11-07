// Claude preko Anthropic API ključa (naš ključ za planove, ili korisnikov sopstveni).
// Strukturisan izlaz: output_config.format (json_schema). Odbijen zahtev ide na rezervni model (fallbacks: "default").

import Anthropic from '@anthropic-ai/sdk';
import { AiError, type AiProvider, type AskRequest, type AskResult, type JsonSchema } from './provider.ts';

export const MODELI: Record<string, string> = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
};

/** USD po milion tokena (ulaz, izlaz). */
const CENE: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
};

/**
 * Strukturisan izlaz prihvata podskup JSON šeme. Ograničenja dužine i opsega skidamo
 * (poštuju se kroz uputstvo, a kod posle svakako čisti izlaz); oblik, tipovi, enum i obavezna polja ostaju.
 */
export function ocistiSemu(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(ocistiSemu);
  if (!s || typeof s !== 'object') return s;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
    if (['maxLength', 'minLength', 'pattern', 'minimum', 'maximum', 'maxItems', 'minItems', 'format'].includes(k)) continue;
    out[k] = ocistiSemu(v);
  }
  return out;
}

export class AnthropicApiProvider implements AiProvider {
  readonly name: string;
  private readonly client: Anthropic;

  constructor(apiKey: string, name = 'anthropic-api') {
    this.client = new Anthropic({ apiKey, maxRetries: 2 });
    this.name = name;
  }

  async ask<T>(req: AskRequest): Promise<AskResult<T>> {
    const model = MODELI[req.model ?? 'sonnet'] ?? req.model ?? MODELI['sonnet']!;
    const started = Date.now();
    const sema = ocistiSemu(req.schema) as JsonSchema;
    try {
      // Streaming: dugi zadaci (strategija, učenje) mogu trajati; finalMessage() vraća celu poruku.
      const stream = this.client.beta.messages.stream(
        {
          model,
          max_tokens: 32_000,
          ...(model.startsWith('claude-haiku') ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
          output_config: { format: { type: 'json_schema', schema: sema }, effort: model.startsWith('claude-opus') ? 'high' : 'medium' },
          messages: [{ role: 'user', content: req.prompt }],
        },
        { timeout: req.timeoutMs ?? 20 * 60_000 },
      );
      const msg = await stream.finalMessage();
      if (msg.stop_reason === 'refusal') throw new AiError('Model je odbio zahtev (bezbednosna pravila). Promeni sadržaj i pokušaj ponovo.', false);
      if (msg.stop_reason === 'max_tokens') throw new AiError('Odgovor je predugačak i prekinut je.', true);
      const tekst = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      let output: T;
      try {
        output = JSON.parse(tekst) as T;
      } catch {
        throw new AiError('Model nije vratio ispravan JSON.', true);
      }
      const u = msg.usage;
      const ulaz = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      const [ci, co] = CENE[model] ?? [0, 0];
      return {
        output,
        provider: this.name,
        model,
        inputTokens: ulaz,
        outputTokens: u.output_tokens ?? 0,
        costUsd: Math.round(((ulaz * ci + (u.output_tokens ?? 0) * co) / 1_000_000) * 10_000) / 10_000,
        durationMs: Date.now() - started,
      };
    } catch (e) {
      if (e instanceof AiError) throw e;
      if (e instanceof Anthropic.AuthenticationError) throw new AiError('API ključ nije ispravan ili je opozvan.', false);
      if (e instanceof Anthropic.PermissionDeniedError) throw new AiError('API ključ nema pristup ovom modelu.', false);
      if (e instanceof Anthropic.BadRequestError) throw new AiError(`Neispravan zahtev ka modelu: ${e.message}`, false);
      if (e instanceof Anthropic.RateLimitError) throw new AiError('Previše zahteva ka modelu; pokušavamo ponovo.', true);
      if (e instanceof Anthropic.APIError) throw new AiError(`Greška modela (${e.status ?? '?'}).`, true);
      throw new AiError(`Model nije dostupan: ${e instanceof Error ? e.message : String(e)}`, true);
    }
  }

  /** Provera ključa bez troška (lista modela). */
  async proveri(): Promise<void> {
    try {
      await this.client.models.list({ limit: 1 });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
        throw new AiError('Ključ nije ispravan.', false);
      }
      throw new AiError('Anthropic trenutno ne odgovara. Pokušaj ponovo za minut.', true);
    }
  }
}
