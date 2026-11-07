-- Faza 6 — proizvodi iz prodavnice i kampanje.

create table public.products (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  connection_id uuid not null references public.connections (id) on delete cascade,
  external_id text not null,
  name text not null,
  price numeric(12, 2),
  currency text,
  url text,
  image_url text,
  description text,
  in_stock boolean,
  updated_at timestamptz not null default now(),
  unique (connection_id, external_id)
);
create index products_brand_idx on public.products (brand_id, name);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 100),
  goal text not null,
  starts_on date not null,
  ends_on date not null,
  channels text[] not null check (cardinality(channels) > 0),
  product_ids uuid[] not null default '{}',
  notes text,
  posts_target int not null default 6 check (posts_target between 1 and 20),
  status text not null default 'planira_se' check (status in ('planira_se', 'spremna', 'greska')),
  error text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on and ends_on <= starts_on + 60)
);
create index campaigns_brand_idx on public.campaigns (brand_id, starts_on desc);

alter table public.drafts add constraint drafts_campaign_fk foreign key (campaign_id) references public.campaigns (id) on delete set null;
alter table public.drafts add constraint drafts_product_fk foreign key (product_id) references public.products (id) on delete set null;

alter table public.products enable row level security;
alter table public.campaigns enable row level security;
create policy prod_select on public.products for select to authenticated using (public.can_see_brand(brand_id));
create policy camp_select on public.campaigns for select to authenticated using (public.can_see_brand(brand_id));
create policy camp_delete on public.campaigns for delete to authenticated using (public.can_edit_brand(brand_id));

create function public.create_campaign(
  p_brand uuid, p_name text, p_goal text, p_starts date, p_ends date, p_channels text[],
  p_products uuid[] default '{}', p_notes text default null, p_posts int default 6
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare cid uuid; ws uuid;
begin
  if not public.can_edit_brand(p_brand) then raise exception 'Kampanje pravi urednik ili vlasnik.' using errcode = '42501'; end if;
  if p_starts < (now() at time zone 'utc')::date then raise exception 'Kampanja ne može da počne u prošlosti.' using errcode = '22023'; end if;
  if p_ends < p_starts then raise exception 'Kraj je pre početka.' using errcode = '22023'; end if;
  if p_ends > p_starts + 60 then raise exception 'Kampanja može da traje najviše 60 dana.' using errcode = '22023'; end if;
  if exists (select 1 from unnest(coalesce(p_products, '{}')) x where not exists (select 1 from public.products p where p.id = x and p.brand_id = p_brand)) then
    raise exception 'Proizvod nije iz ovog brenda.' using errcode = '22023';
  end if;
  insert into public.campaigns (brand_id, name, goal, starts_on, ends_on, channels, product_ids, notes, posts_target, created_by)
  values (p_brand, trim(p_name), p_goal, p_starts, p_ends, p_channels, coalesce(p_products, '{}'), nullif(trim(p_notes), ''), p_posts, auth.uid())
  returning id into cid;
  select workspace_id into ws from public.brands where id = p_brand;
  insert into public.jobs (workspace_id, brand_id, type, payload, created_by)
  values (ws, p_brand, 'campaign.plan', jsonb_build_object('campaign_id', cid::text), auth.uid());
  perform pg_notify('jobs', 'kampanja');
  return cid;
end;
$$;

revoke execute on function public.create_campaign(uuid, text, text, date, date, text[], uuid[], text, int) from public, anon;
grant execute on function public.create_campaign(uuid, text, text, date, date, text[], uuid[], text, int) to authenticated;

alter publication supabase_realtime add table public.campaigns;
