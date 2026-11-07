-- Faza 0 — temelj: profili, radni prostori, članovi i uloge, brendovi, pozivi, red poslova, pozivi agenata.
--
-- Pravila pristupa:
--   * Sve tabele imaju RLS. Pregledač (anon/authenticated) nikad ne piše direktno u tabele radnog prostora,
--     članova, poziva i poslova: za to postoje funkcije ispod (security definer) koje same proveravaju ulogu.
--   * Član može biti ograničen na pojedine brendove (workspace_members.brand_ids); null = svi brendovi.
--   * Worker radi sa service_role ključem i jedini sme da uzme posao (claim_job) i upiše rezultat.

-- ───────────────────────── tipovi ─────────────────────────

create type public.workspace_role as enum ('owner', 'admin', 'editor', 'approver', 'viewer');
create type public.job_status as enum ('queued', 'running', 'done', 'failed', 'canceled');

-- ───────────────────────── profili ─────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text not null,
  created_at timestamptz not null default now()
);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), coalesce(new.email, ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────── radni prostori ─────────────────────────

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.workspace_role not null,
  -- null = pristup svim brendovima radnog prostora; inače samo navedenim.
  brand_ids uuid[],
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id),
  -- vlasnik i admin uvek vide sve brendove
  constraint owner_admin_all_brands check (role not in ('owner', 'admin') or brand_ids is null)
);
create index workspace_members_user_idx on public.workspace_members (user_id);

-- ───────────────────────── brendovi ─────────────────────────

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  website text check (website is null or website ~* '^https?://'),
  instagram_handle text check (instagram_handle is null or instagram_handle ~ '^[A-Za-z0-9._]{1,30}$'),
  language text not null default 'sr',
  timezone text not null default 'Europe/Belgrade',
  color text not null default '#4b3fd1' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);
create index brands_workspace_idx on public.brands (workspace_id);

-- ───────────────────────── pozivi ─────────────────────────

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null check (position('@' in email) > 1),
  role public.workspace_role not null check (role <> 'owner'),
  brand_ids uuid[],
  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  invited_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id),
  constraint inv_admin_all_brands check (role <> 'admin' or brand_ids is null)
);
create index invitations_workspace_idx on public.invitations (workspace_id);

-- ───────────────────────── red poslova ─────────────────────────

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_id uuid references public.brands (id) on delete cascade,
  type text not null check (type ~ '^[a-z][a-z0-9_.]{1,60}$'),
  payload jsonb not null default '{}'::jsonb,
  status public.job_status not null default 'queued',
  result jsonb,
  error text,
  attempts int not null default 0,
  max_attempts int not null default 3 check (max_attempts between 1 and 10),
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index jobs_queue_idx on public.jobs (run_after) where status = 'queued';
create index jobs_brand_idx on public.jobs (brand_id, created_at desc);
create index jobs_workspace_idx on public.jobs (workspace_id, created_at desc);

-- ───────────────────────── pozivi agenata (trošak, debug) ─────────────────────────

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs (id) on delete set null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_id uuid references public.brands (id) on delete cascade,
  agent text not null,
  provider text not null,
  model text,
  input_tokens int,
  output_tokens int,
  cost_usd numeric(10, 4),
  duration_ms int,
  error text,
  created_at timestamptz not null default now()
);
create index agent_runs_brand_idx on public.agent_runs (brand_id, created_at desc);

-- ───────────────────────── pomoćne funkcije za pravila ─────────────────────────
-- security definer da pravila ne bi rekurzivno okidala RLS na workspace_members.

create function public.my_role(ws uuid) returns public.workspace_role
language sql stable security definer set search_path = '' as $$
  select m.role from public.workspace_members m
  where m.workspace_id = ws and m.user_id = auth.uid();
$$;

create function public.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = auth.uid());
$$;

create function public.is_ws_admin(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role(ws) in ('owner', 'admin'), false);
$$;

-- Da li trenutni korisnik vidi brend (član radnog prostora, i brend je u njegovom spisku ili spiska nema).
create function public.can_see_brand(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.brands br
    join public.workspace_members m on m.workspace_id = br.workspace_id and m.user_id = auth.uid()
    where br.id = b and (m.brand_ids is null or br.id = any (m.brand_ids))
  );
$$;

-- Da li trenutni korisnik ima jednu od uloga i vidi brend.
create function public.has_brand_role(b uuid, roles public.workspace_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.brands br
    join public.workspace_members m on m.workspace_id = br.workspace_id and m.user_id = auth.uid()
    where br.id = b and m.role = any (roles) and (m.brand_ids is null or br.id = any (m.brand_ids))
  );
$$;

-- ───────────────────────── RLS ─────────────────────────

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.brands enable row level security;
alter table public.invitations enable row level security;
alter table public.jobs enable row level security;
alter table public.agent_runs enable row level security;

-- profili: svoj, i profili ljudi sa kojima deliš radni prostor (da se vide imena u timu)
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = auth.uid() or exists (
      select 1 from public.workspace_members a
      join public.workspace_members b on b.workspace_id = a.workspace_id
      where a.user_id = auth.uid() and b.user_id = profiles.id
    )
  );
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- radni prostori: čitaju članovi, menja ime vlasnik/admin; pravi se samo kroz create_workspace()
create policy workspaces_select on public.workspaces for select to authenticated using (public.is_member(id));
create policy workspaces_update on public.workspaces for update to authenticated
  using (public.is_ws_admin(id)) with check (public.is_ws_admin(id));

-- članovi: vide se međusobno; menja se samo kroz funkcije
create policy members_select on public.workspace_members for select to authenticated using (public.is_member(workspace_id));

-- brendovi: čita ko ih vidi; dodaje/menja/briše vlasnik ili admin
create policy brands_select on public.brands for select to authenticated using (public.can_see_brand(id));
create policy brands_insert on public.brands for insert to authenticated
  with check (public.is_ws_admin(workspace_id) and created_by = auth.uid());
create policy brands_update on public.brands for update to authenticated
  using (public.is_ws_admin(workspace_id)) with check (public.is_ws_admin(workspace_id));
create policy brands_delete on public.brands for delete to authenticated using (public.my_role(workspace_id) = 'owner');

-- pozivi: vide ih vlasnik/admin; pravi se i prihvata kroz funkcije
create policy invitations_select on public.invitations for select to authenticated using (public.is_ws_admin(workspace_id));
create policy invitations_delete on public.invitations for delete to authenticated
  using (public.is_ws_admin(workspace_id) and accepted_at is null);

-- poslovi: čita ko vidi brend (ili ceo radni prostor za poslove bez brenda: samo vlasnik/admin)
create policy jobs_select on public.jobs for select to authenticated
  using (case when brand_id is null then public.is_ws_admin(workspace_id) else public.can_see_brand(brand_id) end);

create policy agent_runs_select on public.agent_runs for select to authenticated
  using (case when brand_id is null then public.is_ws_admin(workspace_id) else public.can_see_brand(brand_id) end);

-- ───────────────────────── funkcije za pregledač ─────────────────────────

create function public.create_workspace(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare ws uuid;
begin
  if auth.uid() is null then raise exception 'Niste prijavljeni.' using errcode = '42501'; end if;
  insert into public.workspaces (name, created_by) values (trim(p_name), auth.uid()) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, auth.uid(), 'owner');
  return ws;
end;
$$;

create function public.invite_member(p_workspace uuid, p_email text, p_role public.workspace_role, p_brand_ids uuid[])
returns text
language plpgsql security definer set search_path = '' as $$
declare t text;
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
  insert into public.invitations (workspace_id, email, role, brand_ids, invited_by)
  values (p_workspace, lower(trim(p_email)), p_role, nullif(p_brand_ids, '{}'), auth.uid())
  returning token into t;
  return t;
end;
$$;

-- Šta poziv nudi (za ekran prihvatanja, pre nego što je korisnik član).
create function public.invitation_preview(p_token text)
returns table (workspace_name text, role public.workspace_role, email text, brand_names text[], expired boolean, accepted boolean)
language sql stable security definer set search_path = '' as $$
  select w.name, i.role, i.email,
         (select array_agg(b.name order by b.name) from public.brands b where b.id = any (i.brand_ids)),
         i.expires_at < now(), i.accepted_at is not null
  from public.invitations i join public.workspaces w on w.id = i.workspace_id
  where i.token = p_token and auth.uid() is not null;
$$;

create function public.accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare inv public.invitations;
begin
  if auth.uid() is null then raise exception 'Niste prijavljeni.' using errcode = '42501'; end if;
  select * into inv from public.invitations where token = p_token for update;
  if not found then raise exception 'Poziv ne postoji.' using errcode = 'P0002'; end if;
  if inv.accepted_at is not null then raise exception 'Poziv je već iskorišćen.' using errcode = '22023'; end if;
  if inv.expires_at < now() then raise exception 'Poziv je istekao.' using errcode = '22023'; end if;
  if lower((select email from auth.users where id = auth.uid())) <> inv.email then
    raise exception 'Poziv je poslat na drugu adresu (%).', inv.email using errcode = '42501';
  end if;
  insert into public.workspace_members (workspace_id, user_id, role, brand_ids)
  values (inv.workspace_id, auth.uid(), inv.role, inv.brand_ids)
  on conflict (workspace_id, user_id) do nothing;
  update public.invitations set accepted_at = now(), accepted_by = auth.uid() where id = inv.id;
  return inv.workspace_id;
end;
$$;

create function public.update_member(p_workspace uuid, p_user uuid, p_role public.workspace_role, p_brand_ids uuid[])
returns void
language plpgsql security definer set search_path = '' as $$
declare cur public.workspace_role;
begin
  if not public.is_ws_admin(p_workspace) then
    raise exception 'Samo vlasnik ili admin menja članove.' using errcode = '42501';
  end if;
  select role into cur from public.workspace_members where workspace_id = p_workspace and user_id = p_user;
  if cur is null then raise exception 'Član ne postoji.' using errcode = 'P0002'; end if;
  if cur = 'owner' or p_role = 'owner' then
    raise exception 'Vlasnik se ne menja ovde.' using errcode = '42501';
  end if;
  if cur = 'admin' and public.my_role(p_workspace) <> 'owner' then
    raise exception 'Admina menja samo vlasnik.' using errcode = '42501';
  end if;
  update public.workspace_members
     set role = p_role, brand_ids = case when p_role = 'admin' then null else nullif(p_brand_ids, '{}') end
   where workspace_id = p_workspace and user_id = p_user;
end;
$$;

create function public.remove_member(p_workspace uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare cur public.workspace_role;
begin
  select role into cur from public.workspace_members where workspace_id = p_workspace and user_id = p_user;
  if cur is null then raise exception 'Član ne postoji.' using errcode = 'P0002'; end if;
  if cur = 'owner' then raise exception 'Vlasnik ne može da se ukloni.' using errcode = '42501'; end if;
  -- sam sebe može da ukloni svako; druge vlasnik/admin (admina samo vlasnik)
  if p_user <> auth.uid() then
    if not public.is_ws_admin(p_workspace) then raise exception 'Nemate dozvolu.' using errcode = '42501'; end if;
    if cur = 'admin' and public.my_role(p_workspace) <> 'owner' then
      raise exception 'Admina uklanja samo vlasnik.' using errcode = '42501';
    end if;
  end if;
  delete from public.workspace_members where workspace_id = p_workspace and user_id = p_user;
end;
$$;

-- Dozvoljeni tipovi poslova iz pregledača i ko sme da ih pokrene.
create function public.enqueue_job(p_brand uuid, p_type text, p_payload jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare ws uuid; id uuid;
begin
  if p_type not in ('system.ping', 'ai.test') then
    raise exception 'Nepoznat posao: %', p_type using errcode = '22023';
  end if;
  if not public.has_brand_role(p_brand, array['owner', 'admin', 'editor']::public.workspace_role[]) then
    raise exception 'Nemate dozvolu za ovaj brend.' using errcode = '42501';
  end if;
  select workspace_id into ws from public.brands where brands.id = p_brand;
  insert into public.jobs (workspace_id, brand_id, type, payload, created_by)
  values (ws, p_brand, p_type, coalesce(p_payload, '{}'::jsonb), auth.uid())
  returning jobs.id into id;
  perform pg_notify('jobs', id::text);
  return id;
end;
$$;

-- ───────────────────────── funkcije za worker (samo service_role) ─────────────────────────

create function public.claim_job(p_worker text) returns setof public.jobs
language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.jobs j
     set status = 'running', locked_at = now(), locked_by = p_worker, attempts = j.attempts + 1
   where j.id = (
     select q.id from public.jobs q
      where q.status = 'queued' and q.run_after <= now()
      order by q.run_after
      for update skip locked
      limit 1)
  returning j.*;
end;
$$;

create function public.finish_job(p_job uuid, p_result jsonb) returns void
language sql security definer set search_path = '' as $$
  update public.jobs set status = 'done', result = p_result, error = null, finished_at = now(), locked_at = null
   where id = p_job and status = 'running';
$$;

-- Greška: ako ima još pokušaja, vraća u red sa odlaganjem (30 s, 2 min, 8 min…), inače 'failed'.
create function public.fail_job(p_job uuid, p_error text) returns void
language sql security definer set search_path = '' as $$
  update public.jobs
     set status = case when attempts >= max_attempts then 'failed'::public.job_status else 'queued'::public.job_status end,
         error = left(p_error, 4000),
         run_after = now() + make_interval(secs => 30 * power(4, greatest(attempts - 1, 0))),
         finished_at = case when attempts >= max_attempts then now() end,
         locked_at = null, locked_by = null
   where id = p_job and status = 'running';
$$;

-- Poslovi koji „vise“ (worker pao usred posla) vraćaju se u red.
create function public.requeue_stale_jobs(p_older_than interval default interval '15 minutes') returns int
language sql security definer set search_path = '' as $$
  with x as (
    update public.jobs set status = 'queued', locked_at = null, locked_by = null
     where status = 'running' and locked_at < now() - p_older_than
    returning 1)
  select count(*)::int from x;
$$;

-- ───────────────────────── dozvole izvršavanja ─────────────────────────

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.create_workspace(text),
  public.invite_member(uuid, text, public.workspace_role, uuid[]),
  public.invitation_preview(text),
  public.accept_invitation(text),
  public.update_member(uuid, uuid, public.workspace_role, uuid[]),
  public.remove_member(uuid, uuid),
  public.enqueue_job(uuid, text, jsonb),
  public.my_role(uuid), public.is_member(uuid), public.is_ws_admin(uuid),
  public.can_see_brand(uuid), public.has_brand_role(uuid, public.workspace_role[])
to authenticated;

revoke execute on function
  public.claim_job(text), public.finish_job(uuid, jsonb), public.fail_job(uuid, text),
  public.requeue_stale_jobs(interval)
from authenticated;
grant execute on function
  public.claim_job(text), public.finish_job(uuid, jsonb), public.fail_job(uuid, text),
  public.requeue_stale_jobs(interval)
to service_role;

-- Pregledač prati promene posla uživo (status probnog posla).
alter publication supabase_realtime add table public.jobs;
