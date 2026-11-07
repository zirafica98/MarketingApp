-- Faze 3 i 4 — strategija, nacrti, pregled, objava, obaveštenja.
--
-- Pravila:
--   * Nacrte, tekstove i slike pravi worker. Pregledač ih menja samo kroz funkcije koje proveravaju ulogu i stanje:
--       review_draft  — odobri / odbij / popravi / objavi odmah / vrati u pregled
--       edit_variant  — izmena teksta po kanalu (urednik i više)
--   * Objaviti sme samo nacrt u stanju „zakazan“ (to proverava worker pre objave).
--   * Svaka odluka se upisuje u review_events: to čita Učitelj (Faza 5).

-- ───────────────────────── strategija ─────────────────────────

create table public.strategies (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  status text not null default 'predlog' check (status in ('predlog', 'aktivna', 'arhiva')),
  -- { revizija, stubovi[], raspored[], eksperimenti[], napomene }
  content jsonb not null,
  note text,
  job_id uuid references public.jobs (id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_by uuid references auth.users (id),
  accepted_at timestamptz
);
create unique index strategies_one_active on public.strategies (brand_id) where status = 'aktivna';
create index strategies_brand_idx on public.strategies (brand_id, created_at desc);

-- ───────────────────────── nacrti ─────────────────────────

create table public.drafts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  strategy_id uuid references public.strategies (id) on delete set null,
  campaign_id uuid,
  status text not null default 'pravi_se' check (status in
    ('pravi_se', 'za_pregled', 'popravlja_se', 'odobren', 'zakazan', 'objavljuje_se', 'objavljen', 'greska', 'odbijen')),
  format text not null check (format in ('slika', 'karusel', 'tekst')),
  pillar text,
  topic text,
  channels text[] not null,
  scheduled_at timestamptz,
  -- [{ naslov, tekst }]
  slides jsonb not null default '[]'::jsonb,
  -- provera Urednika: { prosao, stavke: [{ ok, tekst }] }
  check_result jsonb,
  experiment_key text,
  experiment_variant text,
  product_id uuid,
  error text,
  revision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz
);
create index drafts_brand_idx on public.drafts (brand_id, status, scheduled_at);
create index drafts_due_idx on public.drafts (scheduled_at) where status = 'zakazan';

create table public.draft_variants (
  draft_id uuid not null references public.drafts (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  channel text not null,
  caption text not null default '',
  hashtags text[] not null default '{}',
  -- [{ url, path }]
  media jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (draft_id, channel)
);

create table public.review_events (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.drafts (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  user_id uuid references auth.users (id),
  action text not null check (action in ('odobri', 'odbij', 'popravi', 'izmeni', 'objavi_odmah', 'vrati')),
  reason text,
  comment text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index review_events_brand_idx on public.review_events (brand_id, created_at desc);

-- ───────────────────────── objave ─────────────────────────

create table public.publications (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.drafts (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  channel text not null,
  connection_id uuid references public.connections (id) on delete set null,
  mode text not null check (mode in ('auto', 'rucno')),
  status text not null default 'objavljuje_se' check (status in ('objavljuje_se', 'ceka_rucno', 'objavljeno', 'greska')),
  external_id text,
  permalink text,
  error text,
  attempts int not null default 0,
  started_at timestamptz not null default now(),
  published_at timestamptz,
  published_by uuid references auth.users (id),
  unique (draft_id, channel)
);
create index publications_brand_idx on public.publications (brand_id, status);

-- ───────────────────────── obaveštenja ─────────────────────────

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_id uuid references public.brands (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  created_at timestamptz not null default now()
);
create index notifications_ws_idx on public.notifications (workspace_id, created_at desc);

create table public.notification_reads (
  notification_id uuid not null references public.notifications (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

-- ───────────────────────── skladište slika ─────────────────────────
-- Javno čitanje (mreže preuzimaju sliku sa URL-a); upis samo worker (service_role).
insert into storage.buckets (id, name, public) values ('media', 'media', true) on conflict (id) do nothing;

-- ───────────────────────── RLS ─────────────────────────

alter table public.strategies enable row level security;
alter table public.drafts enable row level security;
alter table public.draft_variants enable row level security;
alter table public.review_events enable row level security;
alter table public.publications enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_reads enable row level security;

create policy str_select on public.strategies for select to authenticated using (public.can_see_brand(brand_id));
create policy dr_select on public.drafts for select to authenticated using (public.can_see_brand(brand_id));
create policy dv_select on public.draft_variants for select to authenticated using (public.can_see_brand(brand_id));
create policy re_select on public.review_events for select to authenticated using (public.can_see_brand(brand_id));
create policy pub_select on public.publications for select to authenticated using (public.can_see_brand(brand_id));
create policy no_select on public.notifications for select to authenticated
  using (case when brand_id is null then public.is_member(workspace_id) else public.can_see_brand(brand_id) end);
create policy nr_select on public.notification_reads for select to authenticated using (user_id = auth.uid());

-- ───────────────────────── funkcije za pregledač ─────────────────────────

create function public.draft_brand_role(p_draft uuid, roles public.workspace_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.drafts d where d.id = p_draft and public.has_brand_role(d.brand_id, roles));
$$;

create function public.review_draft(
  p_draft uuid, p_action text, p_reason text default null, p_comment text default null, p_scheduled_at timestamptz default null
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  d public.drafts;
  novo text;
  odobravaci constant public.workspace_role[] := array['owner', 'admin', 'editor', 'approver'];
  urednici constant public.workspace_role[] := array['owner', 'admin', 'editor'];
begin
  select * into d from public.drafts where id = p_draft for update;
  if not found then raise exception 'Nacrt ne postoji.' using errcode = 'P0002'; end if;

  if p_action in ('odobri', 'odbij', 'objavi_odmah', 'vrati') then
    if not public.has_brand_role(d.brand_id, odobravaci) then raise exception 'Nemaš dozvolu da odobravaš.' using errcode = '42501'; end if;
  elsif p_action = 'popravi' then
    if not public.has_brand_role(d.brand_id, urednici) then raise exception 'Popravke traži urednik.' using errcode = '42501'; end if;
  else
    raise exception 'Nepoznata radnja: %', p_action using errcode = '22023';
  end if;

  case p_action
    when 'odobri' then
      if d.status not in ('za_pregled', 'odobren') then raise exception 'Nacrt nije za pregled.' using errcode = '22023'; end if;
      if coalesce(p_scheduled_at, d.scheduled_at) is not null and coalesce(p_scheduled_at, d.scheduled_at) < now() - interval '5 minutes' then
        raise exception 'Vreme objave je u prošlosti. Izaberi novo vreme ili „Objavi odmah“.' using errcode = '22023';
      end if;
      novo := case when coalesce(p_scheduled_at, d.scheduled_at) is null then 'odobren' else 'zakazan' end;
      update public.drafts set status = novo, scheduled_at = coalesce(p_scheduled_at, scheduled_at), reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now() where id = d.id;
    when 'objavi_odmah' then
      if d.status not in ('za_pregled', 'odobren', 'zakazan', 'greska') then raise exception 'Ovaj nacrt ne može da se objavi.' using errcode = '22023'; end if;
      novo := 'zakazan';
      update public.drafts set status = novo, scheduled_at = now(), error = null, reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now() where id = d.id;
    when 'vrati' then
      if d.status not in ('odobren', 'zakazan', 'greska') then raise exception 'Nacrt ne može da se vrati u pregled.' using errcode = '22023'; end if;
      novo := 'za_pregled';
      update public.drafts set status = novo, updated_at = now() where id = d.id;
    when 'odbij' then
      if d.status not in ('za_pregled', 'odobren', 'zakazan', 'greska') then raise exception 'Nacrt ne može da se odbije.' using errcode = '22023'; end if;
      if coalesce(trim(p_reason), '') = '' then raise exception 'Izaberi razlog odbijanja.' using errcode = '22023'; end if;
      novo := 'odbijen';
      update public.drafts set status = novo, reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now() where id = d.id;
    when 'popravi' then
      if d.status not in ('za_pregled', 'greska') then raise exception 'Popravka se traži samo za nacrt u pregledu.' using errcode = '22023'; end if;
      if coalesce(trim(p_comment), '') = '' then raise exception 'Napiši šta da se popravi.' using errcode = '22023'; end if;
      novo := 'popravlja_se';
      update public.drafts set status = novo, revision_note = trim(p_comment), updated_at = now() where id = d.id;
      insert into public.jobs (workspace_id, brand_id, type, payload, created_by)
      select b.workspace_id, d.brand_id, 'draft.generate', jsonb_build_object('draft_id', d.id::text, 'napomena', trim(p_comment)), auth.uid()
        from public.brands b where b.id = d.brand_id;
      perform pg_notify('jobs', 'popravka');
  end case;

  insert into public.review_events (draft_id, brand_id, user_id, action, reason, comment)
  values (d.id, d.brand_id, auth.uid(), p_action, nullif(trim(p_reason), ''), nullif(trim(p_comment), ''));
  return novo;
end;
$$;

create function public.edit_variant(p_draft uuid, p_channel text, p_caption text, p_hashtags text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.drafts; staro public.draft_variants;
begin
  select * into d from public.drafts where id = p_draft for update;
  if not found then raise exception 'Nacrt ne postoji.' using errcode = 'P0002'; end if;
  if not public.has_brand_role(d.brand_id, array['owner', 'admin', 'editor']::public.workspace_role[]) then
    raise exception 'Tekst menja urednik.' using errcode = '42501';
  end if;
  if d.status not in ('za_pregled', 'odobren', 'zakazan') then raise exception 'Ovaj nacrt više ne može da se menja.' using errcode = '22023'; end if;
  select * into staro from public.draft_variants where draft_id = p_draft and channel = p_channel for update;
  if not found then raise exception 'Nema teksta za taj kanal.' using errcode = 'P0002'; end if;
  if staro.caption = p_caption and staro.hashtags = coalesce(p_hashtags, '{}') then return; end if;
  update public.draft_variants set caption = left(p_caption, 5000), hashtags = coalesce(p_hashtags, '{}'), updated_at = now()
   where draft_id = p_draft and channel = p_channel;
  insert into public.review_events (draft_id, brand_id, user_id, action, before, after)
  values (d.id, d.brand_id, auth.uid(), 'izmeni',
          jsonb_build_object('kanal', p_channel, 'tekst', staro.caption, 'hashtagovi', to_jsonb(staro.hashtags)),
          jsonb_build_object('kanal', p_channel, 'tekst', p_caption, 'hashtagovi', to_jsonb(coalesce(p_hashtags, '{}'))));
end;
$$;

create function public.accept_strategy(p_strategy uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.strategies;
begin
  select * into s from public.strategies where id = p_strategy for update;
  if not found then raise exception 'Strategija ne postoji.' using errcode = 'P0002'; end if;
  if not public.can_edit_brand(s.brand_id) then raise exception 'Strategiju prihvata urednik ili vlasnik.' using errcode = '42501'; end if;
  update public.strategies set status = 'arhiva' where brand_id = s.brand_id and status = 'aktivna';
  update public.strategies set status = 'aktivna', accepted_by = auth.uid(), accepted_at = now() where id = s.id;
end;
$$;

create function public.mark_manual_published(p_publication uuid, p_permalink text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.publications;
begin
  select * into p from public.publications where id = p_publication for update;
  if not found then raise exception 'Objava ne postoji.' using errcode = 'P0002'; end if;
  if not public.has_brand_role(p.brand_id, array['owner', 'admin', 'editor', 'approver']::public.workspace_role[]) then
    raise exception 'Nemaš dozvolu.' using errcode = '42501';
  end if;
  if p.status <> 'ceka_rucno' then raise exception 'Ova objava ne čeka ručnu objavu.' using errcode = '22023'; end if;
  if p_permalink is not null and p_permalink !~* '^https?://' then raise exception 'Link nije ispravan.' using errcode = '22023'; end if;
  update public.publications set status = 'objavljeno', permalink = p_permalink, published_at = now(), published_by = auth.uid() where id = p.id;
  -- nacrt je objavljen kad nema više objava koje čekaju
  update public.drafts set status = 'objavljen', updated_at = now()
   where id = p.draft_id and not exists (select 1 from public.publications x where x.draft_id = p.draft_id and x.status <> 'objavljeno');
end;
$$;

create function public.mark_notifications_read(p_ids uuid[]) returns void
language sql security definer set search_path = '' as $$
  insert into public.notification_reads (notification_id, user_id)
  select n.id, auth.uid() from public.notifications n
   where n.id = any (p_ids)
     and (case when n.brand_id is null then public.is_member(n.workspace_id) else public.can_see_brand(n.brand_id) end)
  on conflict do nothing;
$$;

-- novi tipovi poslova
create or replace function public.enqueue_job(p_brand uuid, p_type text, p_payload jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare ws uuid; jid uuid;
begin
  if p_type not in ('system.ping', 'ai.test', 'brand.research', 'brand.competitor', 'brand.interview', 'brand.profile',
                    'channel.sync', 'brand.strategy', 'drafts.week') then
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

revoke execute on function public.draft_brand_role(uuid, public.workspace_role[]),
  public.review_draft(uuid, text, text, text, timestamptz), public.edit_variant(uuid, text, text, text[]),
  public.accept_strategy(uuid), public.mark_manual_published(uuid, text), public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.review_draft(uuid, text, text, text, timestamptz), public.edit_variant(uuid, text, text, text[]),
  public.accept_strategy(uuid), public.mark_manual_published(uuid, text), public.mark_notifications_read(uuid[]) to authenticated;

alter publication supabase_realtime add table public.strategies, public.drafts, public.draft_variants, public.publications, public.notifications;
