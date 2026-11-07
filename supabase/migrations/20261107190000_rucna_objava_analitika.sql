-- Ručno objavljena objava (TikTok, X, ili mreža bez API veze) ulazi i u analitiku sa oznakama nacrta,
-- da Učitelj zna šta je objavljeno i kada, i da kasnije uveženi podaci mogu da se povežu.
create or replace function public.mark_manual_published(p_publication uuid, p_permalink text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.publications; d public.drafts; tz text;
begin
  select * into p from public.publications where id = p_publication for update;
  if not found then raise exception 'Objava ne postoji.' using errcode = 'P0002'; end if;
  if not public.has_brand_role(p.brand_id, array['owner', 'admin', 'editor', 'approver']::public.workspace_role[]) then
    raise exception 'Nemaš dozvolu.' using errcode = '42501';
  end if;
  if p.status <> 'ceka_rucno' then raise exception 'Ova objava ne čeka ručnu objavu.' using errcode = '22023'; end if;
  if p_permalink is not null and p_permalink !~* '^https?://' then raise exception 'Link nije ispravan.' using errcode = '22023'; end if;
  update public.publications set status = 'objavljeno', permalink = p_permalink, published_at = now(), published_by = auth.uid() where id = p.id;

  select * into d from public.drafts where id = p.draft_id;
  select timezone into tz from public.brands where id = p.brand_id;
  if p.connection_id is not null then
    insert into public.channel_posts (brand_id, connection_id, provider, external_id, permalink, caption, format, published_at, tags, draft_id)
    select p.brand_id, p.connection_id, p.channel, coalesce(p_permalink, 'rucno-' || p.id::text), p_permalink,
           (select v.caption from public.draft_variants v where v.draft_id = d.id and v.channel = p.channel),
           d.format, now(),
           jsonb_strip_nulls(jsonb_build_object(
             'stub', d.pillar, 'format', d.format, 'eksperiment', d.experiment_key, 'varijanta', d.experiment_variant,
             'kampanja', d.campaign_id, 'rucno', true,
             'sat', extract(hour from now() at time zone tz)::int,
             'dan', (array['pon','uto','sre','cet','pet','sub','ned'])[extract(isodow from now() at time zone tz)::int])),
           d.id
    on conflict (connection_id, external_id) do nothing;
  end if;

  update public.drafts set status = 'objavljen', updated_at = now()
   where id = p.draft_id and not exists (select 1 from public.publications x where x.draft_id = p.draft_id and x.status <> 'objavljeno');
end;
$$;
