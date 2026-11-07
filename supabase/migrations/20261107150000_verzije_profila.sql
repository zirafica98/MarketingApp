-- Upitnik se čuva sam posle svake pauze u kucanju, pa je svaka izmena pravila novu verziju (14 verzija za jedno popunjavanje).
-- Sada: izmene ODGOVORA iste osobe u roku od 15 minuta ostaju u istoj verziji.
-- Nova verzija uvek nastaje kad se promeni sažetak ili njegov status, ili kad menja neko drugi (ili agent).

create or replace function public.version_brand_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  ko uuid := auth.uid();
  samo_odgovori boolean := new.summary is not distinct from old.summary and new.summary_status is not distinct from old.summary_status;
begin
  if new.answers is distinct from old.answers or not samo_odgovori then
    if not (samo_odgovori and ko is not null and ko = old.updated_by and old.updated_at > now() - interval '15 minutes'
            and old.version > 1) then
      insert into public.brand_profile_versions (brand_id, version, answers, summary, summary_status, changed_by)
      values (old.brand_id, old.version, old.answers, old.summary, old.summary_status, old.updated_by);
      new.version := old.version + 1;
    end if;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(ko, new.updated_by);
  return new;
end;
$$;

revoke execute on function public.version_brand_profile() from public, anon, authenticated;
