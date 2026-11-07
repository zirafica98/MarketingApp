-- Pregledač sme da menja samo naziv radnog prostora; plan, Stripe kupac i datum obnove menja samo server (webhook).
revoke update on public.workspaces from authenticated;
grant update (name) on public.workspaces to authenticated;
