-- Faza 1 — onboarding: profil brenda (upitnik + predlozi agenta + sažetak), činjenice sa izvorom,
-- konkurenti, pitanja iz razgovora sa agentom.
--
-- Pravila:
--   * Čitaju svi koji vide brend. Menjaju vlasnik, admin i urednik.
--   * Profil se pravi sam uz brend (okidač), pa pregledač nikad ne radi insert u brand_profiles.
--   * Predloge, činjenice i pitanja upisuje worker (direktna veza, bez RLS).

-- ───────────────────────── profil brenda ─────────────────────────

create table public.brand_profiles (
  brand_id uuid primary key references public.brands (id) on delete cascade,
  -- odgovori korisnika iz upitnika: { "kljuc_polja": "tekst" | ["izbor", ...] }
  answers jsonb not null default '{}'::jsonb,
  -- predlozi agenta: { "kljuc_polja": { "vrednost": [...], "razlog": "...", "izvor": "url" } }
  suggestions jsonb not null default '{}'::jsonb,
  -- grupe koje je korisnik namerno preskočio
  skipped_groups text[] not null default '{}',
  -- sažetak koji sastavlja agent iz svega (publika, ton, zabrane, ciljevi…), korisnik ga menja i potvrđuje
  summary jsonb,
  summary_status text not null default 'nema' check (summary_status in ('nema', 'predlog', 'potvrdjen')),
  version int not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

create table public.brand_profile_versions (
  id bigint generated always as identity primary key,
  brand_id uuid not null references public.brands (id) on delete cascade,
  version int not null,
  answers jsonb not null,
  summary jsonb,
  summary_status text not null,
  changed_by uuid references auth.users (id),
  changed_at timestamptz not null default now()
);
create index brand_profile_versions_brand_idx on public.brand_profile_versions (brand_id, version desc);

-- Novi brend dobija prazan profil.
create function public.create_brand_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.brand_profiles (brand_id, updated_by) values (new.id, new.created_by) on conflict do nothing;
  return new;
end;
$$;
create trigger brand_profile_on_brand
  after insert on public.brands for each row execute function public.create_brand_profile();

insert into public.brand_profiles (brand_id, updated_by)
select id, created_by from public.brands on conflict do nothing;

-- Svaka izmena odgovora ili sažetka čuva prethodnu verziju i povećava broj verzije.
create function public.version_brand_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.answers is distinct from old.answers or new.summary is distinct from old.summary
     or new.summary_status is distinct from old.summary_status then
    insert into public.brand_profile_versions (brand_id, version, answers, summary, summary_status, changed_by)
    values (old.brand_id, old.version, old.answers, old.summary, old.summary_status, old.updated_by);
    new.version := old.version + 1;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;
create trigger brand_profile_versioning
  before update on public.brand_profiles for each row execute function public.version_brand_profile();

-- ───────────────────────── činjenice ─────────────────────────

create table public.brand_facts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  text text not null check (char_length(text) between 3 and 600),
  category text not null default 'ostalo',
  source_kind text not null check (source_kind in ('sajt', 'konkurent', 'korisnik', 'razgovor')),
  source_url text,
  status text not null default 'predlog' check (status in ('predlog', 'potvrdjeno', 'odbaceno')),
  job_id uuid references public.jobs (id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz
);
create index brand_facts_brand_idx on public.brand_facts (brand_id, status);

-- ───────────────────────── konkurenti ─────────────────────────

create table public.competitors (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  url text not null check (url ~* '^https?://'),
  name text,
  -- šta je agent našao: { "opis", "ponuda", "ton", "cene", "jake_strane": [], "razlike": [] }
  analysis jsonb,
  analyzed_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (brand_id, url)
);

-- ───────────────────────── pitanja iz razgovora ─────────────────────────

create table public.brand_questions (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  question text not null,
  why text,
  options text[] not null default '{}',
  -- polje upitnika koje odgovor dopunjuje (ako postoji)
  field_key text,
  answer text,
  status text not null default 'otvoreno' check (status in ('otvoreno', 'odgovoreno', 'preskoceno')),
  position int not null default 0,
  job_id uuid references public.jobs (id) on delete set null,
  created_at timestamptz not null default now(),
  answered_by uuid references auth.users (id),
  answered_at timestamptz
);
create index brand_questions_brand_idx on public.brand_questions (brand_id, status, position);

-- ───────────────────────── RLS ─────────────────────────

alter table public.brand_profiles enable row level security;
alter table public.brand_profile_versions enable row level security;
alter table public.brand_facts enable row level security;
alter table public.competitors enable row level security;
alter table public.brand_questions enable row level security;

-- pomoćna: urednik ili više za brend
create function public.can_edit_brand(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_brand_role(b, array['owner', 'admin', 'editor']::public.workspace_role[]);
$$;

create policy bp_select on public.brand_profiles for select to authenticated using (public.can_see_brand(brand_id));
create policy bp_update on public.brand_profiles for update to authenticated
  using (public.can_edit_brand(brand_id)) with check (public.can_edit_brand(brand_id));

create policy bpv_select on public.brand_profile_versions for select to authenticated using (public.can_see_brand(brand_id));

create policy facts_select on public.brand_facts for select to authenticated using (public.can_see_brand(brand_id));
create policy facts_insert on public.brand_facts for insert to authenticated
  with check (public.can_edit_brand(brand_id) and source_kind = 'korisnik' and status = 'potvrdjeno');
create policy facts_update on public.brand_facts for update to authenticated
  using (public.can_edit_brand(brand_id)) with check (public.can_edit_brand(brand_id));
create policy facts_delete on public.brand_facts for delete to authenticated using (public.can_edit_brand(brand_id));

create policy comp_select on public.competitors for select to authenticated using (public.can_see_brand(brand_id));
create policy comp_insert on public.competitors for insert to authenticated
  with check (public.can_edit_brand(brand_id) and created_by = auth.uid() and analysis is null);
create policy comp_update on public.competitors for update to authenticated
  using (public.can_edit_brand(brand_id)) with check (public.can_edit_brand(brand_id));
create policy comp_delete on public.competitors for delete to authenticated using (public.can_edit_brand(brand_id));

create policy q_select on public.brand_questions for select to authenticated using (public.can_see_brand(brand_id));
create policy q_update on public.brand_questions for update to authenticated
  using (public.can_edit_brand(brand_id)) with check (public.can_edit_brand(brand_id));

-- Pregledač sme da menja samo ove kolone (predloge, analizu, pitanja piše worker).
revoke update on public.brand_profiles from authenticated;
grant update (answers, skipped_groups, summary, summary_status) on public.brand_profiles to authenticated;
revoke update on public.brand_facts from authenticated;
grant update (status, reviewed_by, reviewed_at) on public.brand_facts to authenticated;
revoke update on public.competitors from authenticated;
grant update (name) on public.competitors to authenticated;
revoke update on public.brand_questions from authenticated;
grant update (answer, status, answered_by, answered_at) on public.brand_questions to authenticated;

-- ───────────────────────── poslovi ─────────────────────────

-- Novi tipovi poslova; isti posao koji već čeka ili radi za taj brend (i iste ulazne podatke) se ne duplira.
create or replace function public.enqueue_job(p_brand uuid, p_type text, p_payload jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare ws uuid; jid uuid;
begin
  if p_type not in ('system.ping', 'ai.test', 'brand.research', 'brand.competitor', 'brand.interview', 'brand.profile') then
    raise exception 'Nepoznat posao: %', p_type using errcode = '22023';
  end if;
  if not public.has_brand_role(p_brand, array['owner', 'admin', 'editor']::public.workspace_role[]) then
    raise exception 'Nemate dozvolu za ovaj brend.' using errcode = '42501';
  end if;
  select j.id into jid from public.jobs j
   where j.brand_id = p_brand and j.type = p_type and j.status in ('queued', 'running')
     and j.payload = coalesce(p_payload, '{}'::jsonb)
   limit 1;
  if jid is not null then return jid; end if;
  select workspace_id into ws from public.brands where brands.id = p_brand;
  insert into public.jobs (workspace_id, brand_id, type, payload, created_by)
  values (ws, p_brand, p_type, coalesce(p_payload, '{}'::jsonb), auth.uid())
  returning jobs.id into jid;
  perform pg_notify('jobs', jid::text);
  return jid;
end;
$$;

revoke execute on function public.create_brand_profile(), public.version_brand_profile() from public, anon, authenticated;
revoke execute on function public.can_edit_brand(uuid) from public, anon;
grant execute on function public.can_edit_brand(uuid) to authenticated;

alter publication supabase_realtime add table public.brand_profiles, public.brand_facts, public.competitors, public.brand_questions;
