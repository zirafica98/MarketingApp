// Jedan interfejs za sve agente, nezavisno od toga ko daje model.
// Faza 0: samo Claude Code (OAuth token pretplate). Kasnije: Anthropic API ključ (naš ili korisnikov), drugi provajderi.

export type JsonSchema = Record<string, unknown>;

export interface AskRequest {
  /** Ime agenta (istrazivac, pisac, ucitelj…) — za log i trošak. */
  agent: string;
  /** Uputstvo i ulaz u jednom tekstu. */
  prompt: string;
  /** JSON šema odgovora; odgovor se uvek proverava prema njoj. */
  schema: JsonSchema;
  /** Alias ili tačan ID modela, npr. 'sonnet', 'opus'. */
  model?: string;
  /** Da li agent sme da čita veb stranice (samo URL-ove iz prompta). */
  webFetch?: boolean;
  timeoutMs?: number;
}

export interface AskResult<T> {
  output: T;
  provider: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  durationMs: number;
}

export interface AiProvider {
  readonly name: string;
  ask<T>(req: AskRequest): Promise<AskResult<T>>;
}

export class AiError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
    this.name = 'AiError';
  }
}
