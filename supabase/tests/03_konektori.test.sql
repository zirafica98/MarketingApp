-- Faza 2: konektori i analitika.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email, aud, role) values
  ('c1111111-1111-1111-1111-111111111111', 'vlasnik@k.rs', 'authenticated', 'authenticated'),
  ('c2222222-2222-2222-2222-222222222222', 'urednik@k.rs', 'authenticated', 'authenticated'),
  ('c3333333-3333-3333-3333-333333333333', 'pera@k.rs', 'authenticated', 'authenticated');

create function pg_temp.kao(uid text) returns void language sql as $$
  select set_config('role', 'authenticated', true), set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

select pg_temp.kao('c1111111-1111-1111-1111-111111111111');
create temp table ctx as select public.create_workspace('Konektori test') as ws;
grant select on ctx to authenticated;
-- testovi pristupa ne zavise od plana
reset role;
update public.workspaces set plan = 'agencija' where id = (select ws from ctx);
select pg_temp.kao('c1111111-1111-1111-1111-111111111111');
insert into public.brands (workspace_id, name, created_by) values ((select ws from ctx), 'Korak', auth.uid());
create temp table b as select id from public.brands where name = 'Korak';
grant select on b to authenticated;
reset role;
insert into public.workspace_members (workspace_id, user_id, role) values ((select ws from ctx), 'c2222222-2222-2222-2222-222222222222', 'editor');

-- veza i tajna kao da ih je upisao worker
insert into public.connections (id, brand_id, provider, account_name) values ('cc000000-0000-0000-0000-000000000001', (select id from b), 'instagram', '@korak');
insert into public.connection_secrets (connection_id, ciphertext) values ('cc000000-0000-0000-0000-000000000001', 'v1.tajno');
insert into public.channel_posts (id, brand_id, connection_id, provider, external_id, format)
  values ('cd000000-0000-0000-0000-000000000001', (select id from b), 'cc000000-0000-0000-0000-000000000001', 'instagram', '1', 'karusel');
insert into public.post_metrics (post_id, brand_id, day, reach) values ('cd000000-0000-0000-0000-000000000001', (select id from b), current_date, 100);

select pg_temp.kao('c2222222-2222-2222-2222-222222222222');
select is((select count(*)::int from public.connections), 1, 'urednik vidi vezu');
select is((select count(*)::int from public.connection_secrets), 0, 'tajne kanala ne vidi niko iz pregledača');
select is((select count(*)::int from public.post_metrics), 1, 'urednik vidi statistiku');
select throws_ok($$ select public.start_oauth((select id from b), 'instagram') $$, '42501', null, 'urednik ne povezuje kanale');
select throws_ok($$ select public.set_manual_channel((select id from b), 'tiktok', '@korak') $$, '42501', null, 'urednik ne uključuje ručni režim');
delete from public.connections where true;
reset role;
select is((select count(*)::int from public.connections where brand_id = (select id from b)), 1, 'urednik ne prekida vezu');
select pg_temp.kao('c2222222-2222-2222-2222-222222222222');
select lives_ok($$ select public.enqueue_job((select id from b), 'channel.sync', '{"connection_id":"cc000000-0000-0000-0000-000000000001"}') $$, 'urednik pokreće osvežavanje');

select pg_temp.kao('c1111111-1111-1111-1111-111111111111');
select ok(length(public.start_oauth((select id from b), 'instagram', '/b/x/konektori')) = 48, 'vlasnik dobija jednokratno stanje za OAuth');
select throws_ok($$ select public.start_oauth((select id from b), 'instagram', 'https://zlo.example') $$, '22023', null, 'povratak samo unutar aplikacije');
select lives_ok($$ select public.set_manual_channel((select id from b), 'tiktok', '@korak') $$, 'vlasnik uključuje ručni režim');
select is((select mode from public.connections where provider = 'tiktok'), 'rucno', 'ručni kanal je u ručnom režimu');

select pg_temp.kao('c3333333-3333-3333-3333-333333333333');
select is((select count(*)::int from public.channel_posts), 0, 'Pera ne vidi tuđe objave');

select * from finish();
rollback;
