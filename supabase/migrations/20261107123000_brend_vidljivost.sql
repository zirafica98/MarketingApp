-- Ispravka: pravilo čitanja brenda ne sme da traži brend u tabeli brands, jer novi red nije vidljiv
-- u istoj naredbi (insert ... returning iz pregledača je padao sa „permission denied“).
-- Provera sada koristi kolone samog reda (workspace_id, id).

create function public.can_see_brand_in(ws uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid() and (m.brand_ids is null or b = any (m.brand_ids))
  );
$$;

revoke execute on function public.can_see_brand_in(uuid, uuid) from public, anon;
grant execute on function public.can_see_brand_in(uuid, uuid) to authenticated;

drop policy brands_select on public.brands;
create policy brands_select on public.brands for select to authenticated
  using (public.can_see_brand_in(workspace_id, id));

-- isto za poslove: vidljivost po koloni workspace_id, bez dodatnog čitanja brenda
drop policy jobs_select on public.jobs;
create policy jobs_select on public.jobs for select to authenticated
  using (case when brand_id is null then public.is_ws_admin(workspace_id) else public.can_see_brand_in(workspace_id, brand_id) end);

drop policy agent_runs_select on public.agent_runs;
create policy agent_runs_select on public.agent_runs for select to authenticated
  using (case when brand_id is null then public.is_ws_admin(workspace_id) else public.can_see_brand_in(workspace_id, brand_id) end);
