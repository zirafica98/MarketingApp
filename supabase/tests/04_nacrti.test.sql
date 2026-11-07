-- Faze 3–4: nacrti, pregled, objava.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email, aud, role) values
  ('d1111111-1111-1111-1111-111111111111', 'vlasnik@n.rs', 'authenticated', 'authenticated'),
  ('d2222222-2222-2222-2222-222222222222', 'urednik@n.rs', 'authenticated', 'authenticated'),
  ('d3333333-3333-3333-3333-333333333333', 'odobrava@n.rs', 'authenticated', 'authenticated'),
  ('d4444444-4444-4444-4444-444444444444', 'posmatrac@n.rs', 'authenticated', 'authenticated');

create function pg_temp.kao(uid text) returns void language sql as $$
  select set_config('role', 'authenticated', true), set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

select pg_temp.kao('d1111111-1111-1111-1111-111111111111');
create temp table ctx as select public.create_workspace('Nacrti test') as ws;
grant select on ctx to authenticated;
-- testovi pristupa ne zavise od plana
reset role;
update public.workspaces set plan = 'agencija' where id = (select ws from ctx);
select pg_temp.kao('d1111111-1111-1111-1111-111111111111');
insert into public.brands (workspace_id, name, created_by) values ((select ws from ctx), 'Korak', auth.uid());
create temp table b as select id from public.brands where name = 'Korak';
grant select on b to authenticated;
reset role;
insert into public.workspace_members (workspace_id, user_id, role) values
  ((select ws from ctx), 'd2222222-2222-2222-2222-222222222222', 'editor'),
  ((select ws from ctx), 'd3333333-3333-3333-3333-333333333333', 'approver'),
  ((select ws from ctx), 'd4444444-4444-4444-4444-444444444444', 'viewer');
insert into public.drafts (id, brand_id, status, format, channels, scheduled_at, topic)
values ('dd000000-0000-0000-0000-000000000001', (select id from b), 'za_pregled', 'karusel', '{instagram}', now() + interval '2 days', 'Test'),
       ('dd000000-0000-0000-0000-000000000002', (select id from b), 'za_pregled', 'slika', '{instagram}', now() + interval '3 days', 'Drugi');
insert into public.draft_variants (draft_id, brand_id, channel, caption) values
  ('dd000000-0000-0000-0000-000000000001', (select id from b), 'instagram', 'Stari tekst'),
  ('dd000000-0000-0000-0000-000000000002', (select id from b), 'instagram', 'Tekst');

-- posmatrač
select pg_temp.kao('d4444444-4444-4444-4444-444444444444');
select is((select count(*)::int from public.drafts), 2, 'posmatrač vidi nacrte');
select throws_ok($$ select public.review_draft('dd000000-0000-0000-0000-000000000001', 'odobri') $$, '42501', null, 'posmatrač ne odobrava');
update public.drafts set status = 'zakazan' where true;
reset role;
select is((select count(*)::int from public.drafts where status = 'zakazan' and brand_id = (select id from b)), 0, 'pregledač ne menja nacrt direktno');

-- odobrava
select pg_temp.kao('d3333333-3333-3333-3333-333333333333');
select throws_ok($$ select public.edit_variant('dd000000-0000-0000-0000-000000000001', 'instagram', 'x', '{}') $$, '42501', null, 'odobrava ne menja tekst');
select throws_ok($$ select public.review_draft('dd000000-0000-0000-0000-000000000001', 'popravi', null, 'kraće') $$, '42501', null, 'odobrava ne traži popravku');
select throws_ok($$ select public.review_draft('dd000000-0000-0000-0000-000000000002', 'odbij') $$, '22023', null, 'odbijanje traži razlog');
select is(public.review_draft('dd000000-0000-0000-0000-000000000001', 'odobri'), 'zakazan', 'odobrava odobrava → zakazano');
select throws_ok($$ select public.review_draft('dd000000-0000-0000-0000-000000000001', 'odobri', null, null, now() - interval '1 day') $$, '22023', null, 'ne zakazuje se u prošlost');

-- urednik
select pg_temp.kao('d2222222-2222-2222-2222-222222222222');
select lives_ok($$ select public.edit_variant('dd000000-0000-0000-0000-000000000002', 'instagram', 'Novi tekst', '{#korak}') $$, 'urednik menja tekst');
select is((select after ->> 'tekst' from public.review_events where action = 'izmeni' and brand_id = (select id from b)), 'Novi tekst', 'izmena je zapisana (pre/posle) za učenje');
select is(public.review_draft('dd000000-0000-0000-0000-000000000002', 'popravi', null, 'kraći uvod'), 'popravlja_se', 'urednik traži popravku');
select is((select count(*)::int from public.jobs where type = 'draft.generate' and brand_id = (select id from b)), 1, 'popravka pravi posao za Pisca');
select is(public.review_draft('dd000000-0000-0000-0000-000000000001', 'vrati'), 'za_pregled', 'zakazan nacrt se vraća u pregled');
select is(public.review_draft('dd000000-0000-0000-0000-000000000001', 'odbij', 'Dosadno'), 'odbijen', 'odbijanje sa razlogom');

-- ručna objava
reset role;
insert into public.publications (id, draft_id, brand_id, channel, mode, status)
values ('de000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000002', (select id from b), 'tiktok', 'rucno', 'ceka_rucno');
select pg_temp.kao('d4444444-4444-4444-4444-444444444444');
select throws_ok($$ select public.mark_manual_published('de000000-0000-0000-0000-000000000001') $$, '42501', null, 'posmatrač ne označava objavu');
select pg_temp.kao('d3333333-3333-3333-3333-333333333333');
select lives_ok($$ select public.mark_manual_published('de000000-0000-0000-0000-000000000001', 'https://tiktok.com/@k/1') $$, 'odobrava označava ručnu objavu');

select * from finish();
rollback;
