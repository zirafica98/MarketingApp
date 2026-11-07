import type pg from 'pg';
import { desifruj } from '../crypto.ts';
import { AnthropicApiProvider } from './anthropic-api.ts';
import { ClaudeCodeProvider } from './claude-code.ts';
import type { AiProvider } from './provider.ts';

export * from './provider.ts';

export interface AiPodesavanja {
  provider: AiProvider;
  /** model po agentu (npr. { pisac: 'opus' }), iz podešavanja radnog prostora */
  modeli: Record<string, string>;
}

let claudeCode: ClaudeCodeProvider | null = null;
const nasKljuc = new Map<string, AnthropicApiProvider>();

/**
 * Ko daje model za radni prostor:
 *   1. sopstveni Anthropic ključ radnog prostora (šifrovan),
 *   2. naš ključ (ANTHROPIC_API_KEY) — AI uključen u plan,
 *   3. samo za razvoj/naše brendove: Claude Code sa pretplatom (AI_PROVIDER=claude-code).
 */
export async function aiZa(db: pg.Pool, workspaceId: string): Promise<AiPodesavanja> {
  const { rows } = await db.query<{ mode: string; agent_models: Record<string, string> }>(
    'select mode, agent_models from public.workspace_ai_settings where workspace_id = $1', [workspaceId]);
  const p = rows[0];
  const modeli = p?.agent_models ?? {};

  if (p?.mode === 'sopstveni') {
    const { rows: s } = await db.query<{ ciphertext: string }>('select ciphertext from public.workspace_secrets where workspace_id = $1', [workspaceId]);
    if (s[0]) return { provider: new AnthropicApiProvider(desifruj<{ api_key: string }>(s[0].ciphertext).api_key, 'anthropic-sopstveni'), modeli };
  }
  const env = process.env['ANTHROPIC_API_KEY'];
  if (env && process.env['AI_PROVIDER'] !== 'claude-code') {
    let x = nasKljuc.get(env);
    if (!x) nasKljuc.set(env, (x = new AnthropicApiProvider(env, 'anthropic-plan')));
    return { provider: x, modeli };
  }
  if ((process.env['AI_PROVIDER'] || 'claude-code') === 'claude-code') {
    claudeCode ??= new ClaudeCodeProvider();
    return { provider: claudeCode, modeli };
  }
  throw new Error('AI nije podešen na serveru (ANTHROPIC_API_KEY).');
}
