-- Faza 5 — učenje: knjiga pravila brenda (Učitelj) i nedeljni izveštaji.
--
-- Pravila:
--   * Pravila piše Učitelj (worker). Korisnik može da zaključa pravilo (Učitelj ga više ne menja),
--     izmeni ga (postaje „korisnikovo“ i zaključano), obriše ga (Učitelj ga više ne vraća) ili doda svoje.
--   * Svako pravilo ima dokaz i sigurnost. Agenti koriste samo „sigurna“, korisnikova i zaključana.

create table public.brand_playbook_rules (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9-]{2,60}$'),
  statement text not null check (char_length(statement) between 3 and 400),
  evidence text,
  confidence text not null check (confidence in ('sigurno', 'proverava_se', 'odbaceno', 'odluka')),
  source text not null check (source in ('analitika', 'odluka', 'korisnik')),
  status text not null default 'aktivno' check (status in ('aktivno', 'obrisano')),
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, key)
);
create index playbook_brand_idx on public.brand_playbook_rules (brand_id, status);

create table public.learning_reports (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  -- { radilo[], nije[], predlog, eksperimenti[], brojke, odluke }
  content jsonb not null,
  strategy_proposed boolean not null default false,
  job_id uuid references public.jobs (id) on delete set null,
  created_at timestamptz not null default now()
);
create index learning_reports_brand_idx on public.learning_reports (brand_id, created_at desc);

alter table public.brand_playbook_rules enable row level security;
alter table public.learning_reports enable row level security;
create policy pr_select on public.brand_playbook_rules for select to authenticated using (public.can_see_brand(brand_id));
create policy lr_select on public.learning_reports for select to authenticated using (public.can_see_brand(brand_id));

create function public.rule_action(p_rule uuid, p_action text, p_statement text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.brand_playbook_rules;
begin
  select * into r from public.brand_playbook_rules where id = p_rule for update;
  if not found then raise exception 'Pravilo ne postoji.' using errcode = 'P0002'; end if;
  if not public.can_edit_brand(r.brand_id) then raise exception 'Pravila menja urednik ili vlasnik.' using errcode = '42501'; end if;
  case p_action
    when 'zakljucaj' then update public.brand_playbook_rules set locked = true, updated_at = now() where id = r.id;
    when 'otkljucaj' then update public.brand_playbook_rules set locked = false, updated_at = now() where id = r.id;
    when 'obrisi' then update public.brand_playbook_rules set status = 'obrisano', locked = false, updated_at = now() where id = r.id;
    when 'vrati' then update public.brand_playbook_rules set status = 'aktivno', updated_at = now() where id = r.id;
    when 'izmeni' then
      if char_length(coalesce(trim(p_statement), '')) < 3 then raise exception 'Pravilo je prekratko.' using errcode = '22023'; end if;
      update public.brand_playbook_rules
         set statement = left(trim(p_statement), 400), source = 'korisnik', confidence = 'odluka', locked = true, updated_at = now()
       where id = r.id;
    else raise exception 'Nepoznata radnja.' using errcode = '22023';
  end case;
end;
$$;

create function public.rule_add(p_brand uuid, p_statement text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare id uuid;
begin
  if not public.can_edit_brand(p_brand) then raise exception 'Pravila dodaje urednik ili vlasnik.' using errcode = '42501'; end if;
  if char_length(coalesce(trim(p_statement), '')) < 3 then raise exception 'Pravilo je prekratko.' using errcode = '22023'; end if;
  insert into public.brand_playbook_rules (brand_id, key, statement, confidence, source, locked)
  values (p_brand, 'korisnik-' || substr(md5(random()::text), 1, 10), left(trim(p_statement), 400), 'odluka', 'korisnik', true)
  returning brand_playbook_rules.id into id;
  return id;
end;
$$;

revoke execute on function public.rule_action(uuid, text, text), public.rule_add(uuid, text) from public, anon;
grant execute on function public.rule_action(uuid, text, text), public.rule_add(uuid, text) to authenticated;

create or replace function public.enqueue_job(p_brand uuid, p_type text, p_payload jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare ws uuid; jid uuid;
begin
  if p_type not in ('system.ping', 'ai.test', 'brand.research', 'brand.competitor', 'brand.interview', 'brand.profile',
                    'channel.sync', 'brand.strategy', 'drafts.week', 'brand.learn') then
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

alter publication supabase_realtime add table public.brand_playbook_rules, public.learning_reports;
