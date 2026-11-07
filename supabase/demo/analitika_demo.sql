-- SAMO ZA LOKALNU PROVERU. Izmišljeni podaci: Instagram veza „(demo)“ i 45 objava kroz 4 meseca za brend „Dnevnik trudnoće“.
-- Pokretanje: psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -f supabase/demo/analitika_demo.sql
-- Obrasci su namerno ugrađeni (da Učitelj ima šta da nađe): karuseli imaju više čuvanja, reelovi veći doseg, objave posle 20h bolje prolaze.

do $$
declare
  b uuid := (select id from public.brands where name = 'Dnevnik trudnoće' order by created_at limit 1);
  c uuid;
  p uuid;
  i int;
  fmt text;
  sat int;
  baza numeric;
  dan timestamptz;
begin
  if b is null then raise exception 'Nema brenda „Dnevnik trudnoće“.'; end if;
  delete from public.connections where brand_id = b and provider = 'instagram';
  insert into public.connections (brand_id, provider, mode, status, account_id, account_name, account_meta, last_sync_at)
  values (b, 'instagram', 'auto', 'povezano', 'demo', '@dnevniktrudnoce (demo podaci)', '{"demo": true, "pratioci": 3482, "objava": 45}', now())
  returning id into c;

  for i in 0..44 loop
    fmt := case when i % 5 in (0, 1) then 'karusel' when i % 5 = 2 then 'reel' else 'slika' end;
    sat := case when i % 3 = 0 then 13 else 20 + (i % 2) end;
    dan := date_trunc('day', now()) - make_interval(days => 119 - (i * 27) / 10) + make_interval(hours => sat - 1, mins => 30);
    baza := 1400 + i * 25;
    insert into public.channel_posts (brand_id, connection_id, provider, external_id, permalink, caption, media_type, format, published_at, tags)
    values (b, c, 'instagram', 'demo-' || i, null,
      case fmt when 'karusel' then 'Nedelja ' || (8 + i % 30) || ': šta se dešava sa bebom i sa tobom 💛'
               when 'reel' then 'Tvoja beba ove nedelje u 15 sekundi'
               else case when i % 2 = 0 then 'Ime dana: ' || (array['Mila','Luka','Teodora','Vuk','Sara'])[1 + i % 5] else 'Funkcija: porodilišta u Srbiji na jednom mestu' end end,
      case fmt when 'karusel' then 'CAROUSEL_ALBUM' when 'reel' then 'VIDEO' else 'IMAGE' end,
      fmt, dan,
      jsonb_build_object('sat', sat, 'format', fmt,
        'stub', case when fmt = 'karusel' or fmt = 'reel' then 'Nedelja po nedelja' when i % 2 = 0 then 'Imena za bebe' else 'Funkcija aplikacije' end))
    returning id into p;
    insert into public.post_metrics (post_id, brand_id, day, reach, views, likes, comments, saves, shares)
    values (p, b, current_date,
      round(baza * case fmt when 'reel' then 2.4 when 'karusel' then 1.2 else 0.7 end * case when sat >= 19 then 1.35 else 0.8 end),
      round(baza * case fmt when 'reel' then 4 else 1.6 end),
      round(baza * 0.06), round(baza * case when fmt = 'karusel' then 0.012 else 0.005 end),
      round(baza * case fmt when 'karusel' then 0.07 when 'reel' then 0.02 else 0.012 end),
      round(baza * case fmt when 'reel' then 0.02 else 0.006 end));
  end loop;

  for i in 0..120 loop
    insert into public.account_metrics (connection_id, brand_id, day, followers)
    values (c, b, current_date - (120 - i), 2900 + i * 5 - (i % 7));
  end loop;
end $$;
