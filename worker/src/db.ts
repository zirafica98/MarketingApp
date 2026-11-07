import pg from 'pg';

export interface Job {
  id: string;
  workspace_id: string;
  brand_id: string | null;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

export interface AgentRunRow {
  job_id: string | null;
  workspace_id: string;
  brand_id: string | null;
  agent: string;
  provider: string;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  duration_ms: number | null;
  error: string | null;
}

/** Direktna veza sa bazom (DATABASE_URL, korisnik sa pravima service_role ili postgres). Zaobilazi RLS — samo za worker. */
export function createPool(url: string): pg.Pool {
  return new pg.Pool({ connectionString: url, max: 5 });
}

export async function claimJob(db: pg.Pool, worker: string): Promise<Job | null> {
  const { rows } = await db.query<Job>('select * from public.claim_job($1)', [worker]);
  return rows[0] ?? null;
}

export async function finishJob(db: pg.Pool, id: string, result: unknown): Promise<void> {
  await db.query('select public.finish_job($1, $2)', [id, JSON.stringify(result ?? null)]);
}

export async function failJob(db: pg.Pool, id: string, error: string, retryable: boolean): Promise<void> {
  // Greška koja se ne rešava ponavljanjem: odmah poslednji pokušaj.
  if (!retryable) await db.query('update public.jobs set attempts = max_attempts where id = $1', [id]);
  await db.query('select public.fail_job($1, $2)', [id, error]);
}

export async function requeueStale(db: pg.Pool): Promise<number> {
  const { rows } = await db.query<{ n: number }>('select public.requeue_stale_jobs() as n');
  return rows[0]?.n ?? 0;
}

export async function logAgentRun(db: pg.Pool, r: AgentRunRow): Promise<void> {
  await db.query(
    `insert into public.agent_runs
       (job_id, workspace_id, brand_id, agent, provider, model, input_tokens, output_tokens, cost_usd, duration_ms, error)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [r.job_id, r.workspace_id, r.brand_id, r.agent, r.provider, r.model, r.input_tokens, r.output_tokens, r.cost_usd, r.duration_ms, r.error],
  );
}
