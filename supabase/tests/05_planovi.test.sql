-- Faza 7: planovi, ograničenja, AI podešavanja.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email, aud, role) values
  ('e1111111-1111-1111-1111-111111111111', 'vlasnik@p.rs', 'authenticated', 'authenticated'),
  ('e2222222-2222-2222-2222-222222222222', 'urednik@p.rs', 'authenticated', 'authenticated');

create function pg_temp.kao(uid text) returns void language sql as $$
  select set_config('role', 'authenticated', true), set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

select pg_temp.kao('e1111111-1111-1111-1111-111111111111');
create temp table ctx as select public.create_workspace('Plan test') as ws;
grant select on ctx to authenticated;
select is((select plan from public.workspaces where id = (select ws from ctx)), 'besplatno', 'nov radni prostor je na besplatnom planu');
select lives_ok($$ insert into public.brands (workspace_id, name, created_by) values ((select ws from ctx), 'Prvi', auth.uid()) $$, 'prvi brend prolazi');
select throws_ok($$ insert into public.brands (workspace_id, name, created_by) values ((select ws from ctx), 'Drugi', auth.uid()) $$,
  'P0001', null, 'besplatan plan: drugi brend se odbija');
select lives_ok($$ select public.invite_member((select ws from ctx), 'a@p.rs', 'editor', null) $$, 'drugi član (poziv) prolazi');
select throws_ok($$ select public.invite_member((select ws from ctx), 'b@p.rs', 'editor', null) $$, 'P0001', null, 'besplatan plan: treći član se odbija');
select throws_ok($$ update public.workspaces set plan = 'agencija' where id = (select ws from ctx) $$, '42501', null, 'vlasnik ne može sam da promeni plan');
reset role;
select is((select plan from public.workspaces where id = (select ws from ctx)), 'besplatno', 'plan ne menja pregledač (samo plaćanje)');

select pg_temp.kao('e1111111-1111-1111-1111-111111111111');
select throws_ok($$ select public.set_agent_models((select ws from ctx), '{"pisac":"gpt"}') $$, '22023', null, 'nepoznat model se odbija');
select lives_ok($$ select public.set_agent_models((select ws from ctx), '{"pisac":"sonnet"}') $$, 'vlasnik bira model agenta');
reset role;
insert into public.workspace_secrets (workspace_id, ciphertext) values ((select ws from ctx), 'v1.tajno');
select pg_temp.kao('e1111111-1111-1111-1111-111111111111');
select is((select count(*)::int from public.workspace_secrets), 0, 'AI ključ ne vidi niko iz pregledača, ni vlasnik');

select * from finish();
rollback;
