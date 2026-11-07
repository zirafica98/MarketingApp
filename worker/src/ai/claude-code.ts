// Claude preko Claude Code CLI-ja (`claude -p`), isto kao u AI News (scripts/claude.mjs).
// Prijava: CLAUDE_CODE_OAUTH_TOKEN (pravi se komandom `claude setup-token`) ili postojeća prijava na ovom računaru.
// VAŽNO: pretplata je lična — ovaj provajder je samo za naše brendove i testiranje, ne za spoljne korisnike.

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiError, type AiProvider, type AskRequest, type AskResult } from './provider.ts';

const DEFAULT_TIMEOUT_MS = 20 * 60_000;

interface ClaudeJsonResult {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  modelUsage?: Record<string, unknown>;
}

export class ClaudeCodeProvider implements AiProvider {
  readonly name = 'claude-code';

  private readonly bin: string;
  constructor(bin = process.env['CLAUDE_BIN'] || 'claude') {
    this.bin = bin;
  }

  async ask<T>(req: AskRequest): Promise<AskResult<T>> {
    // Prazan privremeni folder: da Claude ne pokupi CLAUDE.md i podešavanja iz repoa.
    const cwd = await mkdtemp(join(tmpdir(), 'mp-agent-'));
    const started = Date.now();
    try {
      const raw = await this.run(req, cwd);
      if (raw.is_error || raw.subtype !== 'success') {
        throw new AiError(`Claude nije završio (${raw.subtype ?? 'nepoznato'}): ${raw.result ?? ''}`.trim(), true);
      }
      if (raw.structured_output === undefined) {
        throw new AiError('Claude nije vratio strukturisan odgovor.', true);
      }
      const usage = raw.usage ?? {};
      const input =
        (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
      return {
        output: raw.structured_output as T,
        provider: this.name,
        model: Object.keys(raw.modelUsage ?? {})[0] ?? req.model ?? null,
        inputTokens: usage.input_tokens === undefined ? null : input,
        outputTokens: usage.output_tokens ?? null,
        costUsd: raw.total_cost_usd ?? null,
        durationMs: Date.now() - started,
      };
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }

  private run(req: AskRequest, cwd: string): Promise<ClaudeJsonResult> {
    const model = req.model ?? 'sonnet';
    const args = [
      '-p',
      '--restricted',
      '--strict-mcp-config',
      '--tools', req.webFetch ? 'WebFetch' : '',
      ...(req.webFetch ? ['--allowedTools', 'WebFetch'] : []),
      '--permission-mode', 'dontAsk',
      '--no-session-persistence',
      '--output-format', 'json',
      '--json-schema', JSON.stringify(req.schema),
      '--model', model,
      ...(model === 'sonnet' ? [] : ['--fallback-model', 'sonnet']),
    ];
    const timeout = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      const child = spawn(this.bin, args, { cwd, timeout, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      child.on('error', (e) => reject(new AiError(`Ne mogu da pokrenem Claude (${this.bin}): ${e.message}`, false)));
      child.on('close', (code, signal) => {
        if (signal) return reject(new AiError(`Claude je prekinut (${signal}) posle ${timeout / 60_000} min.`, true));
        try {
          resolve(JSON.parse(stdout) as ClaudeJsonResult);
        } catch {
          const msg = (stderr || stdout).trim().slice(0, 2000);
          // Neispravna prijava se ne rešava ponavljanjem.
          const auth = /log ?in|auth|token|401/i.test(msg);
          reject(new AiError(`Claude je završio sa kodom ${code}. ${msg}`, !auth));
        }
      });
      child.stdin.end(req.prompt);
    });
  }
}
