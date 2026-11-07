-- Faza 2 — konektori i analitika.
--
-- Pravila:
--   * Tokeni mreža su u connection_secrets, šifrovani u workeru (AES-256-GCM). Tabela nema nijedno RLS pravilo:
--     pregledač je ne vidi ni ne menja; čita je samo worker (direktna veza).
--   * Vezu pravi worker (posle OAuth-a ili provere tokena). Pregledač sme samo da:
--       - zatraži OAuth (start_oauth → jednokratno stanje),
--       - uključi ručni režim za kanal (set_manual_channel),
--       - prekine vezu (delete, vlasnik/admin).
--   * Objave i statistiku sa kanala upisuje worker; čitaju svi koji vide brend.

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  provider text not null check (provider ~ '^[a-z0-9_]{2,30}$'),
  -- auto: alat objavljuje sam; rucno: alat pripremi, čovek objavi
  mode text not null default 'auto' check (mode in ('auto', 'rucno')),
  status text not null default 'povezano' check (status in ('povezano', 'istice', 'greska', 'rucno')),
  account_id text,
  account_name text,
  account_meta jsonb not null default '{}'::jsonb,
  scopes text[] not null default '{}',
  token_expires_at timestamptz,
  last_sync_at timestamptz,
  last_error text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (brand_id, provider)
);

create table public.connection_secrets (
  connection_id uuid primary key references public.connections (id) on delete cascade,
  ciphertext text not null,
  updated_at timestamptz not null default now()
);

create table public.oauth_states (
  state text primary key default encode(extensions.gen_random_bytes(24), 'hex'),
  brand_id uuid not null references public.brands (id) on delete cascade,
  provider text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  return_to text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes'
);

-- objave sa kanala (uvezene ili objavljene kroz alat)
create table public.channel_posts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  connection_id uuid not null references public.connections (id) on delete cascade,
  provider text not null,
  external_id text not null,
  permalink text,
  caption text,
  media_type text,
  -- format za poređenje: slika | karusel | reel | prica | tekst | video
  format text,
  thumbnail_url text,
  published_at timestamptz,
  -- oznake za učenje: { stub, tema, sat, dan, ima_cenu, cta, eksperiment, varijanta }
  tags jsonb not null default '{}'::jsonb,
  draft_id uuid,
  created_at timestamptz not null default now(),
  unique (connection_id, external_id)
);
create index channel_posts_brand_idx on public.channel_posts (brand_id, published_at desc);

-- dnevni snimak brojki po objavi (poslednji red je trenutno stanje)
create table public.post_metrics (
  post_id uuid not null references public.channel_posts (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  day date not null,
  reach int, views int, likes int, comments int, saves int, shares int, clicks int, follows int,
  raw jsonb,
  primary key (post_id, day)
);
create index post_metrics_brand_idx on public.post_metrics (brand_id, day);

-- dnevni snimak naloga
create table public.account_metrics (
  connection_id uuid not null references public.connections (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  day date not null,
  followers int, reach int, profile_views int, website_clicks int,
  raw jsonb,
  primary key (connection_id, day)
);

alter table public.connections enable row level security;
alter table public.connection_secrets enable row level security;
alter table public.oauth_states enable row level security;
alter table public.channel_posts enable row level security;
alter table public.post_metrics enable row level security;
alter table public.account_metrics enable row level security;

create policy conn_select on public.connections for select to authenticated using (public.can_see_brand(brand_id));
create policy conn_delete on public.connections for delete to authenticated
  using (public.has_brand_role(brand_id, array['owner', 'admin']::public.workspace_role[]));
create policy posts_select on public.channel_posts for select to authenticated using (public.can_see_brand(brand_id));
create policy pm_select on public.post_metrics for select to authenticated using (public.can_see_brand(brand_id));
create policy am_select on public.account_metrics for select to authenticated using (public.can_see_brand(brand_id));
-- connection_secrets i oauth_states: namerno bez pravila (samo worker)

create function public.start_oauth(p_brand uuid, p_provider text, p_return_to text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare s text;
begin
  if not public.has_brand_role(p_brand, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'Kanale povezuje vlasnik ili admin.' using errcode = '42501';
  end if;
  if p_return_to is not null and (p_return_to !~ '^/' or p_return_to ~ '^//') then
    raise exception 'Neispravna povratna adresa.' using errcode = '22023';
  end if;
  delete from public.oauth_states where expires_at < now();
  insert into public.oauth_states (brand_id, provider, user_id, return_to)
  values (p_brand, p_provider, auth.uid(), p_return_to) returning state into s;
  return s;
end;
$$;

-- Ručni režim: kanal bez API veze (TikTok dok čeka odobrenje, X…). Alat pripremi objavu, čovek objavi.
create function public.set_manual_channel(p_brand uuid, p_provider text, p_account_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare cid uuid;
begin
  if not public.has_brand_role(p_brand, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'Kanale povezuje vlasnik ili admin.' using errcode = '42501';
  end if;
  if p_provider !~ '^[a-z0-9_]{2,30}$' then raise exception 'Nepoznat kanal.' using errcode = '22023'; end if;
  insert into public.connections (brand_id, provider, mode, status, account_name, created_by)
  values (p_brand, p_provider, 'rucno', 'rucno', nullif(trim(p_account_name), ''), auth.uid())
  on conflict (brand_id, provider) do update
    set mode = 'rucno', status = 'rucno', account_name = coalesce(excluded.account_name, public.connections.account_name)
  returning id into cid;
  delete from public.connection_secrets where connection_id = cid;
  return cid;
end;
$$;

revoke execute on function public.start_oauth(uuid, text, text), public.set_manual_channel(uuid, text, text) from public, anon;
grant execute on function public.start_oauth(uuid, text, text), public.set_manual_channel(uuid, text, text) to authenticated;

-- Novi posao: sinhronizacija kanala (pokreće ga i korisnik dugmetom „Osveži“).
create or replace function public.enqueue_job(p_brand uuid, p_type text, p_payload jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare ws uuid; jid uuid;
begin
  if p_type not in ('system.ping', 'ai.test', 'brand.research', 'brand.competitor', 'brand.interview', 'brand.profile',
                    'channel.sync') then
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

alter publication supabase_realtime add table public.connections;
