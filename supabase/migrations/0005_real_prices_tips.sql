-- StockLab · 0005 · Echte Tagesschlusskurse (von der Lehrkraft eingetragen), Lesetipps,
--                   Abrechnung auf Knopfdruck

-- ───────────────────────── Runde mit echten Kursen anlegen ─────────────────────────
drop function create_round(uuid, text, numeric, time, boolean);
create function create_round(
  p_class uuid, p_name text, p_capital numeric default 10000,
  p_deadline time default '15:00', p_is_demo boolean default false,
  p_data_mode text default 'simulated'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_teacher_of_class(p_class) then raise exception 'forbidden'; end if;
  if p_data_mode not in ('simulated', 'external') then raise exception 'invalid_round_settings'; end if;
  -- „Tag vorspulen“ gibt es nur mit simulierten Kursen
  if p_data_mode = 'external' and p_is_demo then raise exception 'invalid_round_settings'; end if;
  insert into rounds(class_id, name, starting_capital, deadline_time, is_demo, data_mode)
    values (p_class, btrim(p_name), p_capital, p_deadline, p_is_demo, p_data_mode)
    returning id into v_id;
  return v_id;
end $$;

-- Startet eine Runde. Echte Kurse: erst starten, wenn die Schlusskurse des letzten Handelstags
-- da sind — sonst sähe die Klasse am ersten Tag keine Kurse.
create or replace function start_round(p_round uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype;
begin
  if not is_teacher_of_round(p_round) then raise exception 'forbidden'; end if;
  select * into r from rounds where id = p_round for update;
  if r.status <> 'draft' then raise exception 'round_not_draft'; end if;
  if exists (select 1 from rounds where class_id = r.class_id and status = 'active') then
    raise exception 'round_already_active';
  end if;
  if r.data_mode = 'external' and exists (
       select 1 from assets a where a.active
          and not exists (select 1 from daily_prices dp where dp.asset_id = a.id and dp.market = 'real')) then
    raise exception 'no_start_prices';
  end if;
  update rounds set status = 'active',
         start_date = (app_now() at time zone r.timezone)::date
   where id = p_round;
  perform ensure_portfolios(p_round);
  if r.data_mode = 'simulated' then
    perform generate_simulated_prices(prev_trading_day((app_now() at time zone r.timezone)::date));
  end if;
end $$;

-- ───────────────────────── Kurse eintragen (Lehrkraft) ─────────────────────────
-- Trägt Schlusskurse für einen vergangenen/heutigen Börsentag ein. Korrigierbar, solange der
-- Tag in keiner Runde abgerechnet ist. Kurse aus anderen Quellen werden nie überschrieben.
-- p_prices: {"AAPL": 193.09, "MSFT": 421.5, …}
create function teacher_set_prices(p_date date, p_prices jsonb, p_force boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  k text;
  v numeric;
  a assets%rowtype;
  v_prev numeric;
  v_today date := (app_now() at time zone 'Europe/Berlin')::date;
  v_saved integer := 0;
  v_missing text[];
begin
  if not is_teacher() then raise exception 'forbidden'; end if;
  if p_date is null or not is_trading_day(p_date) or p_date > v_today then
    raise exception 'invalid_price_date';
  end if;
  if exists (select 1 from settlement_runs s join rounds r on r.id = s.round_id
              where s.trading_date = p_date and s.status = 'completed' and r.data_mode = 'external')
     or exists (select 1 from daily_prices where price_date = p_date and market = 'real' and source <> 'manual') then
    raise exception 'prices_locked';
  end if;
  if jsonb_typeof(p_prices) <> 'object' then raise exception 'invalid_prices'; end if;

  -- erst prüfen, dann schreiben: alles oder nichts
  for k in select jsonb_object_keys(p_prices) loop
    select * into a from assets where symbol = k and active;
    if not found then raise exception 'invalid_prices'; end if;
    begin v := (p_prices ->> k)::numeric; exception when others then raise exception 'invalid_prices'; end;
    if v is null or v <= 0 or v >= 100000 then raise exception 'invalid_prices'; end if;
    select close into v_prev from daily_prices
     where asset_id = a.id and price_date < p_date and market = 'real'
     order by price_date desc limit 1;
    if not p_force and v_prev is not null and abs(v / v_prev - 1) > 0.35 then
      raise exception 'prices_implausible';
    end if;
  end loop;

  perform set_config('stocklab.reset', 'on', true);   -- erlaubt Korrektur eigener manueller Einträge
  for k in select jsonb_object_keys(p_prices) loop
    select * into a from assets where symbol = k;
    delete from daily_prices where asset_id = a.id and price_date = p_date and market = 'real' and source = 'manual';
    insert into daily_prices(asset_id, price_date, close, source)
      values (a.id, p_date, round((p_prices ->> k)::numeric, 2), 'manual');
    v_saved := v_saved + 1;
  end loop;
  perform set_config('stocklab.reset', 'off', true);

  select array_agg(s.symbol order by s.symbol) into v_missing
    from assets s where s.active and not exists
      (select 1 from daily_prices dp where dp.asset_id = s.id and dp.price_date = p_date and dp.market = 'real');
  return jsonb_build_object('saved', v_saved, 'missing', coalesce(to_jsonb(v_missing), '[]'::jsonb));
end $$;

-- Was fehlt für die nächste Abrechnung?
create function teacher_price_status(p_round uuid) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  r rounds%rowtype;
  d date;
  v_missing text[];
begin
  if not is_teacher_of_round(p_round) then raise exception 'forbidden'; end if;
  select * into r from rounds where id = p_round;
  if r.status = 'draft' then
    -- noch nicht gestartet: gebraucht werden die Startkurse = Schlusskurse des letzten Handelstags
    d := prev_trading_day((app_now() at time zone r.timezone)::date);
  else
    select coalesce(max(trading_date) + 1, r.start_date) into d
      from settlement_runs where round_id = p_round and status = 'completed';
    d := greatest(d, r.start_date);
    while not is_trading_day(d) loop d := d + 1; end loop;
  end if;
  select array_agg(s.symbol order by s.symbol) into v_missing
    from assets s where s.active and not exists
      (select 1 from daily_prices dp where dp.asset_id = s.id and dp.price_date = d
          and dp.market = round_market(p_round));
  return jsonb_build_object(
    'data_mode', r.data_mode, 'status', r.status,
    'date', d,
    'closed', d <= (app_now() at time zone 'Europe/Berlin')::date,
    'missing', coalesce(to_jsonb(v_missing), '[]'::jsonb),
    'symbols', (select coalesce(jsonb_agg(jsonb_build_object('symbol', symbol, 'name', name,
                  'last', latest_close(id, null, round_market(p_round))) order by kind desc, symbol), '[]'::jsonb)
                  from assets where active));
end $$;

-- ───────────────────────── Abrechnung ─────────────────────────
-- Alle fälligen Tage EINER Runde der Reihe nach (auch verpasste). Intern.
create function settle_round_due(p_round uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r rounds%rowtype;
  d date;
  v_res text;
  v_out jsonb := '[]'::jsonb;
  v_last date;
begin
  select * into r from rounds where id = p_round and status = 'active';
  if not found then return v_out; end if;
  select coalesce(max(trading_date) + 1, r.start_date) into d
    from settlement_runs where round_id = r.id and status = 'completed';
  d := greatest(d, r.start_date);
  v_last := (app_now() at time zone r.timezone)::date;
  while d <= v_last loop
    if is_trading_day(d) then
      v_res := settle_round_day(r.id, d, false);
      v_out := v_out || jsonb_build_array(jsonb_build_object('round', r.id, 'date', d, 'result', v_res));
      exit when v_res in ('not_due', 'blocked_missing_prices');
    end if;
    d := d + 1;
  end loop;
  return v_out;
end $$;

create or replace function run_daily_settlement() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r rounds%rowtype;
  v_out jsonb := '[]'::jsonb;
begin
  for r in select * from rounds where status = 'active' loop
    v_out := v_out || settle_round_due(r.id);
  end loop;
  return v_out;
end $$;

-- Lehrkraft: „Jetzt abrechnen“ (nur was fällig ist, nie vorgezogen).
create function teacher_settle_due(p_round uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_teacher_of_round(p_round) then raise exception 'forbidden'; end if;
  return settle_round_due(p_round);
end $$;

-- ───────────────────────── Lesetipps ─────────────────────────
create table reading_tips (
  id         uuid primary key default gen_random_uuid(),
  round_id   uuid not null references rounds(id) on delete cascade,
  title      text not null check (char_length(btrim(title)) between 3 and 200),
  source     text check (char_length(source) <= 80),
  url        text not null check (url ~ '^https://[^[:space:]]+$' and char_length(url) <= 500),
  created_at timestamptz not null default now()
);
create index on reading_tips (round_id, created_at desc);
alter table reading_tips enable row level security;
-- (Supabase vergibt auf neuen Tabellen automatisch Rechte → ausdrücklich zurücknehmen)
revoke all on reading_tips from public, anon, authenticated;
grant select on reading_tips to authenticated;
grant all on reading_tips to service_role;

create function can_see_round(p_round uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from rounds r
                  where r.id = p_round
                    and (is_teacher_of_class(r.class_id) or is_member_of_class(r.class_id)))
$$;
create policy tips_read on reading_tips for select to authenticated using (can_see_round(round_id));

create function add_reading_tip(p_round uuid, p_title text, p_source text, p_url text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_teacher_of_round(p_round) then raise exception 'forbidden'; end if;
  begin
    insert into reading_tips(round_id, title, source, url)
      values (p_round, btrim(p_title), nullif(btrim(p_source), ''), btrim(p_url))
      returning id into v_id;
  exception when check_violation then raise exception 'invalid_tip';
  end;
  return v_id;
end $$;

create function delete_reading_tip(p_tip uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_round uuid;
begin
  select round_id into v_round from reading_tips where id = p_tip;
  if v_round is null or not is_teacher_of_round(v_round) then raise exception 'forbidden'; end if;
  delete from reading_tips where id = p_tip;
end $$;

create function list_reading_tips(p_round uuid) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'title', t.title, 'source', t.source, 'url', t.url, 'created_at', t.created_at
         ) order by t.created_at desc), '[]'::jsonb)
    from (select * from reading_tips where round_id = p_round order by created_at desc limit 20) t
$$;
