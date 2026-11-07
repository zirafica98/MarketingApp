import { ClaudeCodeProvider } from './claude-code.ts';
import type { AiProvider } from './provider.ts';

export * from './provider.ts';

const providers = new Map<string, AiProvider>();

/**
 * Provajder za radni prostor. Faza 0: svi koriste Claude Code (AI_PROVIDER=claude-code).
 * Kasnije: čita se iz podešavanja radnog prostora (naš API ključ / sopstveni ključ korisnika).
 */
export function providerFor(_workspaceId: string): AiProvider {
  const name = process.env['AI_PROVIDER'] || 'claude-code';
  let p = providers.get(name);
  if (!p) {
    if (name !== 'claude-code') throw new Error(`Nepoznat AI_PROVIDER: ${name}`);
    p = new ClaudeCodeProvider();
    providers.set(name, p);
  }
  return p;
}
