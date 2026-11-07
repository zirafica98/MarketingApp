// Registar poslova. Novi tip posla: dodaj rukovaoca ovde i tip u public.enqueue_job (migracija).

import type pg from 'pg';
import { aiZa, AiError, type AskRequest, type AskResult } from '../ai/index.ts';
import { logAgentRun, type Job } from '../db.ts';
import { brandCompetitor, brandInterview, brandProfile, brandResearch } from './brand.ts';
import { channelSync } from './channels.ts';
import { draftGenerate, draftsWeek } from './drafts.ts';
import { publishDraft } from './publish.ts';
import { brandStrategy } from './strategy.ts';
import { brandLearn } from './learn.ts';
import { campaignPlan } from './campaign.ts';

export interface JobContext {
  db: pg.Pool;
  job: Job;
  /** Poziv agenta sa upisom u agent_runs (trošak, trajanje, greška). */
  ask<T>(req: AskRequest): Promise<AskResult<T>>;
}

export type JobHandler = (ctx: JobContext) => Promise<unknown>;

export class JobError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.retryable = retryable;
  }
}

const handlers: Record<string, JobHandler> = {
  /** Proverava da red poslova i worker rade, bez AI-ja. */
  'system.ping': async ({ job }) => ({ pong: true, at: new Date().toISOString(), attempt: job.attempts }),

  /** Proverava AI sloj: kratak opis brenda u jednoj rečenici, po JSON šemi. */
  'ai.test': async ({ db, job, ask }) => {
    const { rows } = await db.query<{ name: string; website: string | null; language: string }>(
      'select name, website, language from public.brands where id = $1',
      [job.brand_id],
    );
    const brand = rows[0];
    if (!brand) throw new JobError('Brend više ne postoji.');
    const res = await ask<{ pozdrav: string; ideja: string }>({
      agent: 'test',
      model: 'sonnet',
      prompt:
        `Ovo je probni poziv alata za marketing. Brend: „${brand.name}“` +
        (brand.website ? ` (${brand.website})` : '') +
        `. Na jeziku „${brand.language}“ (srpski = latinica) napiši kratak pozdrav timu ovog brenda i jednu ideju za objavu ` +
        `na Instagramu. Ne izmišljaj činjenice o brendu koje nisu u ovom tekstu; ideja neka bude opšta.`,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['pozdrav', 'ideja'],
        properties: {
          pozdrav: { type: 'string', maxLength: 200 },
          ideja: { type: 'string', maxLength: 400 },
        },
      },
      timeoutMs: 5 * 60_000,
    });
    return { ...res.output, model: res.model, trosak_usd: res.costUsd, trajanje_ms: res.durationMs };
  },
};

Object.assign(handlers, {
  'brand.research': brandResearch,
  'brand.competitor': brandCompetitor,
  'brand.interview': brandInterview,
  'brand.profile': brandProfile,
  'channel.sync': channelSync,
  'brand.strategy': brandStrategy,
  'drafts.week': draftsWeek,
  'draft.generate': draftGenerate,
  'publish.draft': publishDraft,
  'brand.learn': brandLearn,
  'campaign.plan': campaignPlan,
} satisfies Record<string, JobHandler>);

export async function runJob(db: pg.Pool, job: Job): Promise<unknown> {
  const handler = handlers[job.type];
  if (!handler) throw new JobError(`Worker ne zna posao „${job.type}“.`);
  const { provider, modeli } = await aiZa(db, job.workspace_id);

  const ask = async <T>(req: AskRequest): Promise<AskResult<T>> => {
    const base = { job_id: job.id, workspace_id: job.workspace_id, brand_id: job.brand_id, agent: req.agent, provider: provider.name };
    try {
      // model po agentu iz podešavanja radnog prostora (npr. „pisac“ ili „strateg.kampanja“ → „strateg“)
      const izbor = modeli[req.agent.split('.')[0]!];
      const res = await provider.ask<T>(izbor ? { ...req, model: izbor } : req);
      await logAgentRun(db, {
        ...base, model: res.model, input_tokens: res.inputTokens, output_tokens: res.outputTokens,
        cost_usd: res.costUsd, duration_ms: res.durationMs, error: null,
      });
      return res;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logAgentRun(db, {
        ...base, model: req.model ?? null, input_tokens: null, output_tokens: null, cost_usd: null, duration_ms: null, error: msg.slice(0, 2000),
      });
      throw e instanceof AiError ? new JobError(msg, e.retryable) : e;
    }
  };

  return handler({ db, job, ask });
}
