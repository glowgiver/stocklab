-- StockLab · 0003 · Geschäftslogik (alle schreibenden Wege)
-- Jede Funktion prüft selbst, wer aufruft. Clients haben keine Tabellen-Schreibrechte.

-- ───────────────────────── Hilfsfunktionen (auch für RLS) ─────────────────────────
create function is_teacher() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where user_id = auth.uid() and role = 'teacher')
$$;

create function is_teacher_of_class(p_class uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from classes where id = p_class and teacher_id = auth.uid())
$$;

create function is_teacher_of_round(p_round uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from rounds r join classes c on c.id = r.class_id
                  where r.id = p_round and c.teacher_id = auth.uid())
$$;

create function is_member_of_class(p_class uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from class_members where class_id = p_class and student_id = auth.uid())
$$;

create function can_see_portfolio(p_portfolio uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from portfolios p
                  where p.id = p_portfolio
                    and (p.student_id = auth.uid() or is_teacher_of_round(p.round_id)))
$$;

create function can_see_decision(p_decision uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from decisions d
                  where d.id = p_decision
                    and (d.student_id = auth.uid() or is_teacher_of_round(d.round_id)))
$$;

create function latest_close(p_asset uuid, p_on date default null, p_market text default null) returns numeric
language sql stable security definer set search_path = public as $$
  select close from daily_prices
   where asset_id = p_asset and (p_on is null or price_date <= p_on)
     and (p_market is null or market = p_market)
   order by price_date desc limit 1
$$;

-- ───────────────────────── Konten ─────────────────────────
create function register_teacher(p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from profiles where user_id = auth.uid()) then return; end if;
  if p_code is null or p_code <> (select value from app_config where key = 'teacher_signup_code') then
    raise exception 'invalid_teacher_code';
  end if;
  insert into profiles(user_id, role) values (auth.uid(), 'teacher');
end $$;

create function create_class(p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_id uuid;
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if not is_teacher() then raise exception 'forbidden'; end if;
  loop
    v_code := (select string_agg(substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1), '')
                 from generate_series(1, 8));
    exit when not exists (select 1 from classes where join_code = v_code);
  end loop;
  insert into classes(teacher_id, name, join_code) values (auth.uid(), btrim(p_name), v_code)
    returning id into v_id;
  return jsonb_build_object('id', v_id, 'join_code', v_code);
end $$;

-- Wird direkt nach dem Registrieren des Schüler-Kontos aufgerufen.
create function join_class(p_code text, p_pseudonym text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c classes%rowtype;
  v_round uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from profiles where user_id = auth.uid() and role = 'teacher') then
    raise exception 'forbidden';
  end if;
  select * into c from classes where join_code = upper(btrim(p_code)) and join_open;
  if not found then raise exception 'invalid_class_code'; end if;
  if exists (select 1 from class_members where student_id = auth.uid()) then
    raise exception 'already_member';
  end if;
  insert into profiles(user_id, role) values (auth.uid(), 'student') on conflict do nothing;
  begin
    insert into class_members(class_id, student_id, pseudonym)
      values (c.id, auth.uid(), btrim(p_pseudonym));
  exception when unique_violation then
    raise exception 'pseudonym_taken';
  end;
  -- läuft schon eine Runde, bekommt der Neuzugang sofort sein Startdepot
  select id into v_round from rounds where class_id = c.id and status = 'active';
  if v_round is not null then perform ensure_portfolios(v_round); end if;
  return jsonb_build_object('class_id', c.id, 'class_name', c.name);
end $$;

-- ───────────────────────── Runden ─────────────────────────
create function create_round(
  p_class uuid, p_name text, p_capital numeric default 10000,
  p_deadline time default '15:00', p_is_demo boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_teacher_of_class(p_class) then raise exception 'forbidden'; end if;
  insert into rounds(class_id, name, starting_capital, deadline_time, is_demo)
    values (p_class, btrim(p_name), p_capital, p_deadline, p_is_demo)
    returning id into v_id;
  return v_id;
end $$;

-- Legt fehlende Startdepots an (Bargeld + Buchung „initial“). Idempotent.
create function ensure_portfolios(p_round uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  r rounds%rowtype;
  m record;
  v_pid uuid;
  n integer := 0;
begin
  select * into r from rounds where id = p_round;
  for m in select student_id from class_members where class_id = r.class_id loop
    if not exists (select 1 from portfolios where round_id = p_round and student_id = m.student_id) then
      insert into portfolios(round_id, student_id, cash) values (p_round, m.student_id, r.starting_capital)
        returning id into v_pid;
      insert into cash_movements(portfolio_id, kind, amount, balance_after)
        values (v_pid, 'initial', r.starting_capital, r.starting_capital);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

create function start_round(p_round uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype;
begin
  if not is_teacher_of_round(p_round) then raise exception 'forbidden'; end if;
  select * into r from rounds where id = p_round for update;
  if r.status <> 'draft' then raise exception 'round_not_draft'; end if;
  if exists (select 1 from rounds where class_id = r.class_id and status = 'active') then
    raise exception 'round_already_active';
  end if;
  update rounds set status = 'active',
         start_date = (app_now() at time zone r.timezone)::date
   where id = p_round;
  perform ensure_portfolios(p_round);
  -- Simuliert: Startkurse bis zum letzten Börsentag erzeugen, damit die Klasse schon
  -- am ersten Tag Kurse sieht (externe Kurse kommen vom Provider-Lauf).
  if r.data_mode = 'simulated' then
    perform generate_simulated_prices(prev_trading_day((app_now() at time zone r.timezone)::date));
  end if;
end $$;

create function end_round(p_round uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_teacher_of_round(p_round) then raise exception 'forbidden'; end if;
  update rounds set status = 'ended',
         end_date = (app_now() at time zone timezone)::date
   where id = p_round and status = 'active';
end $$;

-- ───────────────────────── Entscheidung ─────────────────────────
-- Schüler/in gibt die Entscheidung für den aktuellen Handelstag ab oder
-- überschreibt sie (nur bis zum Einsendeschluss, nur solange nicht abgerechnet).
create function submit_decision(
  p_round uuid, p_action text, p_asset uuid, p_quantity integer,
  p_expectation text, p_reasoning text, p_evidence text, p_risks text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r rounds%rowtype;
  v_date date;
  v_pf portfolios%rowtype;
  v_price numeric;
  v_owned integer;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into r from rounds where id = p_round;
  if not found or not is_member_of_class(r.class_id) then raise exception 'forbidden'; end if;
  if r.status <> 'active' then raise exception 'round_not_active'; end if;

  v_date := current_trading_date(p_round);
  if v_date is null then raise exception 'no_trading_day_open'; end if;

  select * into v_pf from portfolios where round_id = p_round and student_id = auth.uid();
  if not found then raise exception 'no_portfolio'; end if;

  if p_action not in ('buy','sell','hold') then raise exception 'invalid_action'; end if;
  if p_action = 'hold' then
    p_asset := null; p_quantity := null;
  else
    if p_asset is null or p_quantity is null or p_quantity <= 0 then
      raise exception 'invalid_order';
    end if;
    if not exists (select 1 from assets where id = p_asset and active) then
      raise exception 'invalid_asset';
    end if;
    if p_action = 'buy' then
      v_price := latest_close(p_asset, null, round_market(p_round));
      if v_price is not null and p_quantity * v_price > v_pf.cash then
        raise exception 'insufficient_cash';
      end if;
    else
      select coalesce(quantity, 0) into v_owned from holdings
       where portfolio_id = v_pf.id and asset_id = p_asset;
      if coalesce(v_owned, 0) < p_quantity then raise exception 'insufficient_shares'; end if;
    end if;
  end if;

  insert into decisions(round_id, student_id, portfolio_id, trading_date, action, asset_id, quantity,
                        expectation, reasoning, evidence, risks)
  values (p_round, auth.uid(), v_pf.id, v_date, p_action, p_asset, p_quantity,
          p_expectation, p_reasoning, p_evidence, p_risks)
  on conflict (student_id, round_id, trading_date) do update
    set action = excluded.action, asset_id = excluded.asset_id, quantity = excluded.quantity,
        expectation = excluded.expectation, reasoning = excluded.reasoning,
        evidence = excluded.evidence, risks = excluded.risks, updated_at = now()
    where decisions.status = 'pending'
  returning id into v_id;
  if v_id is null then raise exception 'decision_locked'; end if;

  return jsonb_build_object('decision_id', v_id, 'trading_date', v_date,
                            'deadline', round_deadline(p_round, v_date));
end $$;

-- ───────────────────────── Abrechnung ─────────────────────────
-- Rechnet GENAU EINEN Handelstag einer Runde ab. Idempotent: ein zweiter Aufruf
-- für denselben Tag ändert nichts. Fehlen Kurse, wird nichts ausgeführt.
-- Rückgabe: completed | already_settled | not_due | blocked_missing_prices | not_trading_day
create function settle_round_day(p_round uuid, p_date date, p_force boolean default false)
returns text
language plpgsql security definer set search_path = public as $$
declare
  r rounds%rowtype;
  v_missing text[];
  d record;
  v_price numeric;
  v_cash numeric;
  v_owned integer;
  v_avg numeric;
  v_order uuid;
  v_exec uuid;
  v_cost numeric;
  v_reason text;
  v_hv numeric;
  v_market text;
  p record;
begin
  select * into r from rounds where id = p_round for update;   -- serialisiert parallele Läufe
  v_market := round_market(p_round);
  if not found or r.status <> 'active' then raise exception 'round_not_active'; end if;
  if not is_trading_day(p_date) then return 'not_trading_day'; end if;
  if exists (select 1 from settlement_runs
              where round_id = p_round and trading_date = p_date and status = 'completed') then
    return 'already_settled';
  end if;
  if not p_force and app_now() < round_deadline(p_round, p_date) then return 'not_due'; end if;

  if r.data_mode = 'simulated' then perform generate_simulated_prices(p_date); end if;

  select array_agg(a.symbol order by a.symbol) into v_missing
    from assets a
   where a.active and not exists (select 1 from daily_prices dp
                                   where dp.asset_id = a.id and dp.price_date = p_date
                                     and dp.market = v_market);
  if v_missing is not null then
    insert into settlement_runs(round_id, trading_date, status, detail)
      values (p_round, p_date, 'blocked', jsonb_build_object('missing_prices', to_jsonb(v_missing)))
      on conflict (round_id, trading_date)
      do update set status = 'blocked', detail = excluded.detail, finished_at = now();
    return 'blocked_missing_prices';
  end if;

  -- erst Verkäufe, dann Käufe, innerhalb davon nach Abgabezeit → deterministisch
  for d in
    select * from decisions
     where round_id = p_round and trading_date = p_date and status = 'pending'
     order by (action = 'sell') desc, created_at, id
  loop
    if d.action = 'hold' then
      update decisions set status = 'settled' where id = d.id;
      continue;
    end if;

    select close into v_price from daily_prices
     where asset_id = d.asset_id and price_date = p_date and market = v_market;
    select cash into v_cash from portfolios where id = d.portfolio_id for update;
    select coalesce(quantity, 0), coalesce(avg_cost, 0) into v_owned, v_avg
      from holdings where portfolio_id = d.portfolio_id and asset_id = d.asset_id;
    v_owned := coalesce(v_owned, 0);
    v_reason := null;
    v_cost := d.quantity * v_price;

    if d.action = 'buy'  and v_cost > v_cash   then v_reason := 'insufficient_cash';   end if;
    if d.action = 'sell' and d.quantity > v_owned then v_reason := 'insufficient_shares'; end if;

    insert into orders(decision_id, portfolio_id, asset_id, side, quantity, status, reject_reason)
      values (d.id, d.portfolio_id, d.asset_id, d.action, d.quantity,
              case when v_reason is null then 'executed' else 'rejected' end, v_reason)
      returning id into v_order;

    if v_reason is null then
      insert into executions(order_id, price, quantity, gross, price_date)
        values (v_order, v_price, d.quantity, v_cost, p_date) returning id into v_exec;

      if d.action = 'buy' then
        update portfolios set cash = cash - v_cost where id = d.portfolio_id;
        insert into cash_movements(portfolio_id, kind, amount, balance_after, execution_id)
          values (d.portfolio_id, 'buy', -v_cost, v_cash - v_cost, v_exec);
        insert into holdings(portfolio_id, asset_id, quantity, avg_cost)
          values (d.portfolio_id, d.asset_id, d.quantity, v_price)
        on conflict (portfolio_id, asset_id) do update
          set avg_cost = (holdings.avg_cost * holdings.quantity + v_cost) / (holdings.quantity + d.quantity),
              quantity = holdings.quantity + d.quantity;
      else
        update portfolios set cash = cash + v_cost where id = d.portfolio_id;
        insert into cash_movements(portfolio_id, kind, amount, balance_after, execution_id)
          values (d.portfolio_id, 'sell', v_cost, v_cash + v_cost, v_exec);
        update holdings set quantity = quantity - d.quantity
         where portfolio_id = d.portfolio_id and asset_id = d.asset_id;
      end if;
    end if;
    update decisions set status = 'settled' where id = d.id;
  end loop;

  -- Tagesbewertung für ALLE Depots der Runde (auch ohne Entscheidung)
  for p in select id, cash from portfolios where round_id = p_round loop
    select coalesce(sum(h.quantity * dp.close), 0) into v_hv
      from holdings h
      join daily_prices dp on dp.asset_id = h.asset_id and dp.price_date = p_date
                          and dp.market = v_market
     where h.portfolio_id = p.id;
    insert into portfolio_snapshots(portfolio_id, snap_date, cash, holdings_value, total_value)
      values (p.id, p_date, p.cash, v_hv, p.cash + v_hv)
      on conflict do nothing;
  end loop;

  insert into settlement_runs(round_id, trading_date, status)
    values (p_round, p_date, 'completed')
    on conflict (round_id, trading_date)
    do update set status = 'completed', detail = null, finished_at = now();
  return 'completed';
end $$;

-- Täglicher Lauf (GitHub Action, service_role): rechnet alle fälligen Tage aller
-- aktiven Runden der Reihe nach ab, auch verpasste (Wochenende, Ausfall).
create function run_daily_settlement() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r rounds%rowtype;
  d date;
  v_res text;
  v_out jsonb := '[]'::jsonb;
  v_last date;
begin
  for r in select * from rounds where status = 'active' loop
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
  end loop;
  return v_out;
end $$;

-- ───────────────────────── Lehrkraft: Demo ─────────────────────────
-- Nur Demo-Runden mit simulierten Kursen: den nächsten offenen Handelstag sofort
-- abrechnen („Tag vorspulen“).
create function demo_settle_next_day(p_round uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r rounds%rowtype;
  d date;
  v_res text;
begin
  if not is_teacher_of_round(p_round) then raise exception 'forbidden'; end if;
  select * into r from rounds where id = p_round;
  if not r.is_demo or r.data_mode <> 'simulated' then raise exception 'demo_only'; end if;
  select coalesce(max(trading_date) + 1, r.start_date) into d
    from settlement_runs where round_id = p_round and status = 'completed';
  d := greatest(d, r.start_date);
  while not is_trading_day(d) loop d := d + 1; end loop;
  v_res := settle_round_day(p_round, d, true);
  return jsonb_build_object('date', d, 'result', v_res);
end $$;

-- Demo-Runde auf Anfang zurück — betrifft nur diese eine Runde.
create function reset_demo_round(p_round uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype;
begin
  if not is_teacher_of_round(p_round) then raise exception 'forbidden'; end if;
  select * into r from rounds where id = p_round for update;
  if not r.is_demo then raise exception 'demo_only'; end if;
  perform set_config('stocklab.reset', 'on', true);          -- nur diese Transaktion
  delete from decisions where round_id = p_round;            -- kaskadiert Orders/Executions/…
  delete from settlement_runs where round_id = p_round;
  delete from portfolios where round_id = p_round;           -- kaskadiert Holdings/Cash/Snapshots
  update rounds set status = 'draft', start_date = null, end_date = null where id = p_round;
  perform set_config('stocklab.reset', 'off', true);
end $$;

-- ───────────────────────── Reflexion & Feedback ─────────────────────────
create function save_reflection(p_decision uuid, p_convincing text, p_overlooked text, p_change text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from decisions where id = p_decision and student_id = auth.uid()) then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from decisions where id = p_decision and status = 'settled') then
    raise exception 'decision_not_settled';
  end if;
  insert into reflections(decision_id, student_id, convincing, overlooked, would_change)
    values (p_decision, auth.uid(), p_convincing, p_overlooked, p_change)
  on conflict (decision_id) do update
    set convincing = excluded.convincing, overlooked = excluded.overlooked,
        would_change = excluded.would_change;
end $$;

create function save_feedback(
  p_decision uuid, p_comment text,
  p_reasoning smallint, p_evidence smallint, p_risk smallint, p_reflection smallint
) returns void
language plpgsql security definer set search_path = public as $$
declare v_round uuid;
begin
  select round_id into v_round from decisions where id = p_decision;
  if v_round is null or not is_teacher_of_round(v_round) then raise exception 'forbidden'; end if;
  insert into teacher_feedback(decision_id, teacher_id, comment, score_reasoning, score_evidence,
                               score_risk, score_reflection)
    values (p_decision, auth.uid(), p_comment, p_reasoning, p_evidence, p_risk, p_reflection)
  on conflict (decision_id) do update
    set comment = excluded.comment, score_reasoning = excluded.score_reasoning,
        score_evidence = excluded.score_evidence, score_risk = excluded.score_risk,
        score_reflection = excluded.score_reflection, updated_at = now();
end $$;

-- ───────────────────────── Lesen (SECURITY INVOKER → RLS gilt) ─────────────────────────
create function whoami() returns jsonb
language sql stable set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('role', role, 'locale', locale) from profiles where user_id = auth.uid()),
    jsonb_build_object('role', null))
$$;

-- Schüler/in: alles für die Startseite in einem Aufruf.
create function my_overview() returns jsonb
language plpgsql stable set search_path = public as $$
declare
  v_member class_members%rowtype;
  v_class classes%rowtype;
  v_round rounds%rowtype;
  v_pf portfolios%rowtype;
  v_date date;
  v_market text;
  v_out jsonb;
begin
  select * into v_member from class_members where student_id = auth.uid();
  if not found then return jsonb_build_object('member', false); end if;
  select * into v_class from classes where id = v_member.class_id;
  select * into v_round from rounds
   where class_id = v_class.id and status in ('active','ended')
   order by (status = 'active') desc, created_at desc limit 1;
  v_market := case when v_round.id is null then null else round_market(v_round.id) end;

  v_out := jsonb_build_object(
    'member', true, 'pseudonym', v_member.pseudonym, 'class_name', v_class.name,
    'assets', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', a.id, 'symbol', a.symbol, 'name', a.name, 'kind', a.kind,
                  'sector', a.sector, 'description', a.description,
                  'price', latest_close(a.id, null, v_market), 'prev_price', (
                     select close from daily_prices where asset_id = a.id
                        and (v_market is null or market = v_market)
                      order by price_date desc offset 1 limit 1)
               ) order by a.kind desc, a.symbol), '[]'::jsonb)
                from assets a where a.active)
  );
  if v_round.id is null then return v_out || jsonb_build_object('round', null); end if;

  select * into v_pf from portfolios where round_id = v_round.id and student_id = auth.uid();
  v_date := current_trading_date(v_round.id);

  return v_out || jsonb_build_object(
    'round', jsonb_build_object('id', v_round.id, 'name', v_round.name, 'status', v_round.status,
                                'starting_capital', v_round.starting_capital,
                                'is_demo', v_round.is_demo, 'data_mode', v_round.data_mode,
                                'timezone', v_round.timezone),
    'next_trading_date', v_date,
    'deadline', case when v_date is null then null else round_deadline(v_round.id, v_date) end,
    'cash', v_pf.cash,
    'holdings', (select coalesce(jsonb_agg(jsonb_build_object(
                    'asset_id', h.asset_id, 'quantity', h.quantity, 'avg_cost', h.avg_cost,
                    'price', latest_close(h.asset_id, null, v_market)) order by h.asset_id), '[]'::jsonb)
                   from holdings h where h.portfolio_id = v_pf.id and h.quantity > 0),
    'snapshots', (select coalesce(jsonb_agg(jsonb_build_object(
                    'date', s.snap_date, 'total', s.total_value) order by s.snap_date), '[]'::jsonb)
                    from portfolio_snapshots s where s.portfolio_id = v_pf.id),
    'pending_decision', (select to_jsonb(d) from decisions d
                          where d.student_id = auth.uid() and d.round_id = v_round.id
                            and d.trading_date = v_date and d.status = 'pending'),
    'history', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', d.id, 'trading_date', d.trading_date, 'action', d.action,
                    'asset_id', d.asset_id, 'quantity', d.quantity, 'status', d.status,
                    'expectation', d.expectation, 'reasoning', d.reasoning,
                    'evidence', d.evidence, 'risks', d.risks,
                    'order_status', o.status, 'reject_reason', o.reject_reason,
                    'price', e.price,
                    'reflection', (select to_jsonb(rf) from reflections rf where rf.decision_id = d.id),
                    'feedback', (select jsonb_build_object('comment', f.comment)
                                   from teacher_feedback f where f.decision_id = d.id)
                  ) order by d.trading_date desc), '[]'::jsonb)
                  from decisions d
                  left join orders o on o.decision_id = d.id
                  left join executions e on e.order_id = o.id
                 where d.student_id = auth.uid() and d.round_id = v_round.id)
  );
end $$;

-- Lehrkraft: Klassenübersicht (Depots, offene Abgaben, anonyme Tagesstatistik).
create function teacher_overview() returns jsonb
language plpgsql stable set search_path = public as $$
begin
  if not is_teacher() then raise exception 'forbidden'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'join_code', c.join_code, 'join_open', c.join_open,
      'member_count', (select count(*) from class_members m where m.class_id = c.id),
      'rounds', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', r.id, 'name', r.name, 'status', r.status, 'is_demo', r.is_demo, 'data_mode', r.data_mode,
          'starting_capital', r.starting_capital, 'deadline_time', r.deadline_time,
          'start_date', r.start_date,
          'next_trading_date', current_trading_date(r.id),
          'deadline', case when current_trading_date(r.id) is null then null
                           else round_deadline(r.id, current_trading_date(r.id)) end,
          'settled_days', (select count(*) from settlement_runs s
                            where s.round_id = r.id and s.status = 'completed')
        ) order by r.created_at desc), '[]'::jsonb)
        from rounds r where r.class_id = c.id)
    ) order by c.created_at desc), '[]'::jsonb)
    from classes c where c.teacher_id = auth.uid()
  );
end $$;

create function teacher_round_detail(p_round uuid) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  v_date date;
  v_last date;
begin
  if not is_teacher_of_round(p_round) then raise exception 'forbidden'; end if;
  v_date := current_trading_date(p_round);
  select max(trading_date) into v_last from settlement_runs
   where round_id = p_round and status = 'completed';
  return jsonb_build_object(
    'next_trading_date', v_date,
    'students', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'student_id', m.student_id, 'pseudonym', m.pseudonym,
        'cash', p.cash,
        'total', (select s.total_value from portfolio_snapshots s
                   where s.portfolio_id = p.id order by s.snap_date desc limit 1),
        'submitted_today', exists (select 1 from decisions d
                                    where d.student_id = m.student_id and d.round_id = p_round
                                      and d.trading_date = v_date)
      ) order by m.pseudonym), '[]'::jsonb)
      from rounds r
      join class_members m on m.class_id = r.class_id
      left join portfolios p on p.round_id = r.id and p.student_id = m.student_id
      where r.id = p_round),
    -- Anonyme Aggregate (für die Wand): wie viele kaufen/verkaufen/halten?
    'counts_next', (
      select jsonb_build_object(
        'buy',  count(*) filter (where action = 'buy'),
        'sell', count(*) filter (where action = 'sell'),
        'hold', count(*) filter (where action = 'hold'))
      from decisions where round_id = p_round and trading_date = v_date),
    'counts_last', (
      select jsonb_build_object(
        'date', v_last,
        'buy',  count(*) filter (where action = 'buy'),
        'sell', count(*) filter (where action = 'sell'),
        'hold', count(*) filter (where action = 'hold'))
      from decisions where round_id = p_round and trading_date = v_last),
    'decisions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', d.id, 'pseudonym', m.pseudonym, 'trading_date', d.trading_date,
        'action', d.action, 'symbol', a.symbol, 'quantity', d.quantity, 'status', d.status,
        'expectation', d.expectation, 'reasoning', d.reasoning,
        'evidence', d.evidence, 'risks', d.risks,
        'order_status', o.status, 'reject_reason', o.reject_reason, 'price', e.price,
        'reflection', (select to_jsonb(rf) from reflections rf where rf.decision_id = d.id),
        'feedback', (select to_jsonb(f) from teacher_feedback f where f.decision_id = d.id)
      ) order by d.trading_date desc, m.pseudonym), '[]'::jsonb)
      from decisions d
      join rounds r on r.id = d.round_id
      join class_members m on m.class_id = r.class_id and m.student_id = d.student_id
      left join assets a on a.id = d.asset_id
      left join orders o on o.decision_id = d.id
      left join executions e on e.order_id = o.id
      where d.round_id = p_round)
  );
end $$;
