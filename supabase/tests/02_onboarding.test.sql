-- Pravila pristupa za Fazu 1 (onboarding). Pokretanje: npm run db:test
-- Vlasnik (Mihajlo), urednik (Uroš), odobrava (Ana) za isti brend, i Pera spolja.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('a1111111-1111-1111-1111-111111111111', 'vlasnik@ob.rs', '{"full_name":"Vlasnik"}', 'authenticated', 'authenticated'),
  ('a2222222-2222-2222-2222-222222222222', 'urednik@ob.rs', '{"full_name":"Urednik"}', 'authenticated', 'authenticated'),
  ('a3333333-3333-3333-3333-333333333333', 'odobrava@ob.rs', '{"full_name":"Odobrava"}', 'authenticated', 'authenticated'),
  ('a4444444-4444-4444-4444-444444444444', 'pera@ob.rs', '{"full_name":"Pera"}', 'authenticated', 'authenticated');

create function pg_temp.kao(uid text) returns void language sql as $$
  select set_config('role', 'authenticated', true), set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

select pg_temp.kao('a1111111-1111-1111-1111-111111111111');
create temp table ctx as select public.create_workspace('Onboarding test') as ws;
grant select on ctx to authenticated;
-- testovi pristupa ne zavise od plana
reset role;
update public.workspaces set plan = 'agencija' where id = (select ws from ctx);
select pg_temp.kao('a1111111-1111-1111-1111-111111111111');
insert into public.brands (workspace_id, name, website, created_by)
  values ((select ws from ctx), 'Korak', 'https://korak.example', auth.uid());
create temp table b as select id from public.brands where name = 'Korak';
grant select on b to authenticated;

-- članovi direktno (pozivi su testirani u 01)
reset role;
insert into public.workspace_members (workspace_id, user_id, role) values
  ((select ws from ctx), 'a2222222-2222-2222-2222-222222222222', 'editor'),
  ((select ws from ctx), 'a3333333-3333-3333-3333-333333333333', 'approver');

select pg_temp.kao('a1111111-1111-1111-1111-111111111111');
select is((select count(*)::int from public.brand_profiles where brand_id = (select id from b)), 1, 'profil se pravi sam uz brend');
select is((select version from public.brand_profiles where brand_id = (select id from b)), 1, 'nov profil je verzija 1');

-- urednik
select pg_temp.kao('a2222222-2222-2222-2222-222222222222');
update public.brand_profiles set answers = '{"sta_prodajes":"Patike"}' where brand_id = (select id from b);
select is((select answers ->> 'sta_prodajes' from public.brand_profiles where brand_id = (select id from b)), 'Patike', 'urednik upisuje odgovore');
select is((select version from public.brand_profiles where brand_id = (select id from b)), 2, 'izmena odgovora povećava verziju');
select is((select count(*)::int from public.brand_profile_versions where brand_id = (select id from b)), 1, 'prethodna verzija je sačuvana');
update public.brand_profiles set answers = '{"sta_prodajes":"Patike i čarape"}' where brand_id = (select id from b);
select is((select version from public.brand_profiles where brand_id = (select id from b)), 2, 'ista osoba odmah posle: ista verzija (automatsko čuvanje)');
update public.brand_profiles set summary = '{"jedna_recenica":"x"}', summary_status = 'predlog' where brand_id = (select id from b);
select is((select version from public.brand_profiles where brand_id = (select id from b)), 3, 'promena sažetka uvek pravi novu verziju');
select throws_ok($$ update public.brand_profiles set suggestions = '{"x":1}' where brand_id = (select id from b) $$,
  '42501', null, 'predloge agenta pregledač ne može da menja');
select lives_ok($$ insert into public.competitors (brand_id, url, created_by) values ((select id from b), 'https://konkurent.example', auth.uid()) $$,
  'urednik dodaje konkurenta');
select throws_ok($$ insert into public.competitors (brand_id, url, created_by, analysis) values ((select id from b), 'https://drugi.example', auth.uid(), '{"opis":"lažno"}') $$,
  '42501', null, 'analizu konkurenta ne upisuje pregledač');
select lives_ok($$ insert into public.brand_facts (brand_id, text, source_kind, status) values ((select id from b), 'Dostava za 24h', 'korisnik', 'potvrdjeno') $$,
  'urednik dodaje svoju činjenicu');
select throws_ok($$ insert into public.brand_facts (brand_id, text, source_kind, status) values ((select id from b), 'Lažna sa sajta', 'sajt', 'potvrdjeno') $$,
  '42501', null, 'pregledač ne može da se predstavi kao agent (izvor sajt)');
select lives_ok($$ select public.enqueue_job((select id from b), 'brand.research') $$, 'urednik pokreće proučavanje');
select is(public.enqueue_job((select id from b), 'brand.research'),
  (select id from public.jobs where brand_id = (select id from b) and type = 'brand.research'),
  'isto proučavanje se ne duplira dok čeka');
select is((select count(*)::int from public.jobs where brand_id = (select id from b) and type = 'brand.research'), 1, 'samo jedan posao u redu');

-- odobrava: čita, ne menja
select pg_temp.kao('a3333333-3333-3333-3333-333333333333');
select is((select answers ->> 'sta_prodajes' from public.brand_profiles where brand_id = (select id from b)), 'Patike i čarape', 'odobrava čita profil');
update public.brand_profiles set answers = '{}' where brand_id = (select id from b);
reset role;
select is((select answers ->> 'sta_prodajes' from public.brand_profiles where brand_id = (select id from b)), 'Patike i čarape', 'odobrava ne menja profil');
select pg_temp.kao('a3333333-3333-3333-3333-333333333333');
select is((select count(*)::int from public.competitors), 1, 'odobrava vidi konkurente');
delete from public.competitors where true;
reset role;
select is((select count(*)::int from public.competitors where brand_id = (select id from b)), 1, 'odobrava ne briše konkurente');

-- Pera spolja
select pg_temp.kao('a4444444-4444-4444-4444-444444444444');
select is((select count(*)::int from public.brand_profiles), 0, 'Pera ne vidi tuđi profil');
select is((select count(*)::int from public.brand_facts), 0, 'Pera ne vidi tuđe činjenice');
select is((select count(*)::int from public.brand_profile_versions), 0, 'Pera ne vidi istoriju profila');

select * from finish();
rollback;
