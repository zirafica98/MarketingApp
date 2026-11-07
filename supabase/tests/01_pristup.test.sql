-- Pravila pristupa za Fazu 0. Pokretanje: npm run db:test
-- Scenario: Mihajlo (vlasnik) ima 2 brenda, poziva Anu kao „odobrava“ samo za Dnevnik trudnoće.
-- Pera je drugi korisnik sa svojim radnim prostorom i ne sme ništa da vidi kod Mihajla.
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

-- korisnici
insert into auth.users (id, email, raw_user_meta_data, aud, role)
values
  ('11111111-1111-1111-1111-111111111111', 'mihajlo@test.rs', '{"full_name":"Mihajlo"}', 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'ana@test.rs', '{"full_name":"Ana"}', 'authenticated', 'authenticated'),
  ('33333333-3333-3333-3333-333333333333', 'pera@test.rs', '{"full_name":"Pera"}', 'authenticated', 'authenticated');

select is((select count(*)::int from public.profiles where email like '%@test.rs'), 3, 'profil se pravi sam pri registraciji');

create function pg_temp.kao(uid text) returns void language sql as $$
  select set_config('role', 'authenticated', true), set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- ── Mihajlo: radni prostor i dva brenda
select pg_temp.kao('11111111-1111-1111-1111-111111111111');
select lives_ok($$ select public.create_workspace('Mihajlo') $$, 'pravi radni prostor');
create temp table ctx as select (select id from public.workspaces limit 1) as ws;
grant select on ctx to authenticated;
-- testovi pristupa ne zavise od plana
reset role;
update public.workspaces set plan = 'agencija' where id = (select ws from ctx);
select pg_temp.kao('11111111-1111-1111-1111-111111111111');

select is(public.my_role((select ws from ctx)), 'owner'::public.workspace_role, 'tvorac je vlasnik');
select lives_ok($$ insert into public.brands (workspace_id, name, website, created_by)
  values ((select ws from ctx), 'Dnevnik trudnoće', 'https://dnevniktrudnoce.com', auth.uid()) $$, 'vlasnik dodaje brend 1');
select lives_ok($$ insert into public.brands (workspace_id, name, created_by)
  values ((select ws from ctx), 'Korak Sneakers', auth.uid()) $$, 'vlasnik dodaje brend 2');
select lives_ok($$ with x as (insert into public.brands (workspace_id, name, created_by)
  values ((select ws from ctx), 'Treći', auth.uid()) returning id) select id from x $$, 'insert ... returning radi (kao iz pregledača)');
delete from public.brands where name = 'Treći';
select is((select count(*)::int from public.brands), 2, 'vlasnik vidi oba brenda');
select throws_ok($$ insert into public.brands (workspace_id, name, website, created_by)
  values ((select ws from ctx), 'Loš sajt', 'dnevnik.com', auth.uid()) $$, '23514', null, 'sajt mora da počne sa http(s)://');

create temp table b as select id, name from public.brands;
grant select on b to authenticated;

select throws_ok($$ select public.invite_member((select ws from ctx), 'x@test.rs', 'owner', null) $$, '22023', null, 'vlasnik se ne poziva');
select throws_ok($$ select public.invite_member((select ws from ctx), 'x@test.rs', 'admin', array[(select id from b limit 1)]) $$, '22023', null, 'admin ne može biti ograničen na brend');

create temp table inv as select public.invite_member((select ws from ctx), 'Ana@Test.rs', 'approver',
  array[(select id from b where name = 'Dnevnik trudnoće')]) as token;
grant select on inv to authenticated;
select ok((select length(token) = 48 from inv), 'poziv vraća token');

-- ── Pera: ne vidi ništa, ne može da iskoristi Anin poziv
select pg_temp.kao('33333333-3333-3333-3333-333333333333');
select is((select count(*)::int from public.workspaces), 0, 'Pera ne vidi tuđi radni prostor');
select is((select count(*)::int from public.brands), 0, 'Pera ne vidi tuđe brendove');
select is((select count(*)::int from public.invitations), 0, 'Pera ne vidi pozive');
select throws_ok($$ select public.accept_invitation((select token from inv)) $$, '42501', null, 'poziv važi samo za adresu na koju je poslat');
select throws_ok($$ insert into public.brands (workspace_id, name, created_by) values ((select ws from ctx), 'Upad', auth.uid()) $$,
  '42501', null, 'Pera ne može da doda brend u tuđi prostor');
select throws_ok($$ select public.enqueue_job((select id from b limit 1), 'system.ping') $$, '42501', null, 'Pera ne može da pokrene posao za tuđi brend');

-- ── Ana: prihvata poziv i vidi samo Dnevnik
select pg_temp.kao('22222222-2222-2222-2222-222222222222');
select lives_ok($$ select public.accept_invitation((select token from inv)) $$, 'Ana prihvata poziv');
select throws_ok($$ select public.accept_invitation((select token from inv)) $$, '22023', null, 'poziv se ne koristi dvaput');
select is((select array_agg(name)::text from public.brands), '{"Dnevnik trudnoće"}', 'Ana vidi samo Dnevnik trudnoće');
select is(public.my_role((select ws from ctx)), 'approver'::public.workspace_role, 'Ana je „odobrava“');
select is((select count(*)::int from public.workspace_members), 2, 'Ana vidi članove tima');
select is((select count(*)::int from public.profiles), 2, 'Ana vidi profile članova tima, ne i Perin');
select throws_ok($$ select public.enqueue_job((select id from b where name = 'Dnevnik trudnoće'), 'system.ping') $$, '42501', null, 'odobrava ne pokreće poslove');
select is((select count(*)::int from public.invitations), 0, 'Ana ne vidi pozive (nije admin)');
update public.brands set name = 'Promenjeno' where true;
select is((select count(*)::int from public.brands where name = 'Promenjeno'), 0, 'Ana ne može da menja brend');

-- ── Mihajlo: poslovi; worker funkcije nisu za pregledač
select pg_temp.kao('11111111-1111-1111-1111-111111111111');
select throws_ok($$ select public.enqueue_job((select id from b limit 1), 'nesto.drugo') $$, '22023', null, 'nepoznat tip posla se odbija');
select lives_ok($$ select public.enqueue_job((select id from b where name = 'Korak Sneakers'), 'system.ping') $$, 'vlasnik pokreće posao');
select throws_ok($$ select * from public.claim_job('pregledac') $$, '42501', null, 'pregledač ne može da uzme posao iz reda');

select pg_temp.kao('22222222-2222-2222-2222-222222222222');
select is((select count(*)::int from public.jobs), 0, 'Ana ne vidi poslove brenda za koji nema pristup');

select * from finish();
rollback;
