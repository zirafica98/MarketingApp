-- Veza član → profil, da pregledač može da učita ime i mejl člana uz članstvo (PostgREST embed).
-- profiles.id je isto što i auth.users.id i pravi se okidačem pri registraciji, pre bilo kog članstva.
alter table public.workspace_members
  add constraint workspace_members_profile_fk foreign key (user_id) references public.profiles (id) on delete cascade;

notify pgrst, 'reload schema';
