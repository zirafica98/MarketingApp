-- Faza 7 — planovi i ograničenja, AI podešavanja radnog prostora (sopstveni ključ, model po agentu), naplata.
--
-- Pravila:
--   * Plan menja samo server (Stripe webhook u workeru). Pregledač ga čita.
--   * API ključ korisnika je šifrovan u workspace_secrets (bez RLS pravila: vidi ga samo worker).
--   * Ograničenja se proveravaju u bazi (okidač za brendove, funkcije za članove), ne samo u aplikaciji.

create table public.plans (
  id text primary key,
  name text not null,
  max_brands int not null,
  max_members int not null,
  max_drafts_month int not null,
  price_eur numeric(8, 2) not null,
  sort int not null
);
insert into public.plans values
  ('besplatno', 'Besplatno', 1, 2, 12, 0, 1),
  ('pro', 'Pro', 5, 5, 120, 29, 2),
  ('agencija', 'Agencija', 25, 20, 600, 99, 3);

alter table public.workspaces add column plan text not null default 'besplatno' references public.plans (id);
alter table public.workspaces add column stripe_customer_id text;
alter table public.workspaces add column plan_renews_at timestamptz;
-- postojeći (lokalni/test) radni prostori: Pro, da ništa ne pukne
update public.workspaces set plan = 'pro';

alter table public.plans enable row level security;
create policy plans_select on public.plans for select to authenticated using (true);

create table public.workspace_ai_settings (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  -- ukljuceno: AI je uključen u plan (naš ključ); sopstveni: korisnikov Anthropic ključ
  mode text not null default 'ukljuceno' check (mode in ('ukljuceno', 'sopstveni')),
  key_hint text,
  -- { "pisac": "opus", "urednik": "sonnet", ... }
  agent_models jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.workspace_secrets (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  ciphertext text not null,
  updated_at timestamptz not null default now()
);

alter table public.workspace_ai_settings enable row level security;
alter table public.workspace_secrets enable row level security;
create policy ai_select on public.workspace_ai_settings for select to authenticated using (public.is_member(workspace_id));

create function public.set_agent_models(p_workspace uuid, p_models jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_ws_admin(p_workspace) then raise exception 'Modele bira vlasnik ili admin.' using errcode = '42501'; end if;
  if exists (select 1 from jsonb_each_text(coalesce(p_models, '{}')) e
              where e.key not in ('istrazivac', 'intervjuer', 'strateg', 'pisac', 'urednik', 'ucitelj')
                 or e.value not in ('opus', 'sonnet', 'haiku')) then
    raise exception 'Nepoznat agent ili model.' using errcode = '22023';
  end if;
  insert into public.workspace_ai_settings (workspace_id, agent_models) values (p_workspace, coalesce(p_models, '{}'))
  on conflict (workspace_id) do update set agent_models = excluded.agent_models, updated_at = now();
end;
$$;

-- ───────── ograničenja plana ─────────

create function public.plan_of(ws uuid) returns public.plans
language sql stable security definer set search_path = '' as $$
  select p.* from public.plans p join public.workspaces w on w.plan = p.id where w.id = ws;
$$;

create function public.check_brand_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p public.plans; n int;
begin
  p := public.plan_of(new.workspace_id);
  select count(*) into n from public.brands where workspace_id = new.workspace_id;
  if n >= p.max_brands then
    raise exception 'Plan „%“ dozvoljava % brend(a). Nadogradi plan da dodaš još.', p.name, p.max_brands using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger brands_plan_limit before insert on public.brands for each row execute function public.check_brand_limit();

create or replace function public.invite_member(p_workspace uuid, p_email text, p_role public.workspace_role, p_brand_ids uuid[])
returns text
language plpgsql security definer set search_path = '' as $$
declare t text; p public.plans; n int;
begin
  if not public.is_ws_admin(p_workspace) then
    raise exception 'Samo vlasnik ili admin poziva članove.' using errcode = '42501';
  end if;
  if p_role = 'owner' then raise exception 'Vlasnik se ne poziva.' using errcode = '22023'; end if;
  if p_role = 'admin' and p_brand_ids is not null then
    raise exception 'Admin uvek vidi sve brendove.' using errcode = '22023';
  end if;
  if p_brand_ids is not null and exists (
    select 1 from unnest(p_brand_ids) b where not exists (
      select 1 from public.brands br where br.id = b and br.workspace_id = p_workspace)
  ) then
    raise exception 'Brend nije iz ovog radnog prostora.' using errcode = '22023';
  end if;
  p := public.plan_of(p_workspace);
  select (select count(*) from public.workspace_members where workspace_id = p_workspace)
       + (select count(*) from public.invitations where workspace_id = p_workspace and accepted_at is null and expires_at > now())
    into n;
  if n >= p.max_members then
    raise exception 'Plan „%“ dozvoljava % člana. Nadogradi plan da pozoveš još.', p.name, p.max_members using errcode = 'P0001';
  end if;
  insert into public.invitations (workspace_id, email, role, brand_ids, invited_by)
  values (p_workspace, lower(trim(p_email)), p_role, nullif(p_brand_ids, '{}'), auth.uid())
  returning token into t;
  return t;
end;
$$;

-- potrošnja u tekućem mesecu (za ekran „Plan i potrošnja“ i za worker)
create function public.workspace_usage(p_workspace uuid) returns table (
  brands int, members int, drafts_month int, ai_cost_month numeric, ai_runs_month int
)
language sql stable security definer set search_path = '' as $$
  select
    (select count(*)::int from public.brands where workspace_id = p_workspace),
    (select count(*)::int from public.workspace_members where workspace_id = p_workspace),
    (select count(*)::int from public.drafts d join public.brands b on b.id = d.brand_id
      where b.workspace_id = p_workspace and d.created_at >= date_trunc('month', now())),
    (select coalesce(sum(cost_usd), 0) from public.agent_runs where workspace_id = p_workspace and created_at >= date_trunc('month', now())),
    (select count(*)::int from public.agent_runs where workspace_id = p_workspace and created_at >= date_trunc('month', now()))
  where public.is_member(p_workspace);
$$;

revoke execute on function public.set_agent_models(uuid, jsonb), public.plan_of(uuid), public.workspace_usage(uuid),
  public.check_brand_limit() from public, anon;
grant execute on function public.set_agent_models(uuid, jsonb), public.workspace_usage(uuid) to authenticated;
