-- StockLab · 0002 · Handelskalender, simulierter Markt, Unveränderlichkeit

-- ───────────────────────── Unveränderlichkeit ─────────────────────────
-- Abgerechnete Daten dürfen nie geändert oder gelöscht werden.
-- Ausnahme: reset_demo_round() setzt für die Dauer seiner Transaktion
-- 'stocklab.reset' = 'on' (nur für Demo-Runden, siehe 0003).
create function forbid_change() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('stocklab.reset', true), '') = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception 'immutable_record: % on % is not allowed', tg_op, tg_table_name
    using errcode = 'P0001';
end $$;

create trigger orders_immutable     before update or delete on orders
  for each row execute function forbid_change();
create trigger executions_immutable before update or delete on executions
  for each row execute function forbid_change();
create trigger cash_immutable       before update or delete on cash_movements
  for each row execute function forbid_change();
create trigger snapshots_immutable  before update or delete on portfolio_snapshots
  for each row execute function forbid_change();
create trigger prices_immutable     before update or delete on daily_prices
  for each row execute function forbid_change();

create function guard_settled_decision() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('stocklab.reset', true), '') = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if old.status = 'settled' then
    raise exception 'immutable_record: settled decision cannot be changed'
      using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger decisions_guard before update or delete on decisions
  for each row execute function guard_settled_decision();

-- ───────────────────────── Handelskalender ─────────────────────────
-- Börsentag = Mo–Fr und kein eingetragener Feiertag (US-Börse, NYSE).
create function is_trading_day(p_date date) returns boolean
language sql stable security definer set search_path = public as $$
  select extract(isodow from p_date) < 6
     and not exists (select 1 from market_holidays h where h.holiday_date = p_date)
$$;

-- Welcher Kursmarkt gehört zu einer Runde? simulated → 'simulated', external → 'real'.
create function round_market(p_round uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when data_mode = 'simulated' then 'simulated' else 'real' end from rounds where id = p_round
$$;

-- Letzter Börsentag VOR p_date (für den Start-Kurs einer neuen Runde).
create function prev_trading_day(p_date date) returns date
language plpgsql stable security definer set search_path = public as $$
declare d date := p_date - 1; i int := 0;
begin
  while i < 15 loop
    if is_trading_day(d) then return d; end if;
    d := d - 1; i := i + 1;
  end loop;
  return null;
end $$;

-- Einsendeschluss für den Handelstag p_date, zeitzonenrichtig.
create function round_deadline(p_round uuid, p_date date) returns timestamptz
language sql stable security definer set search_path = public as $$
  select ((p_date + r.deadline_time) at time zone r.timezone) from rounds r where r.id = p_round
$$;

-- Nächster Handelstag, für den eine Entscheidung noch möglich ist:
-- Börsentag, noch nicht abgerechnet, Einsendeschluss noch nicht erreicht.
create function current_trading_date(p_round uuid) returns date
language plpgsql stable security definer set search_path = public as $$
declare
  r rounds%rowtype;
  d date;
  i int := 0;
begin
  select * into r from rounds where id = p_round;
  if not found or r.status <> 'active' then return null; end if;
  d := greatest((app_now() at time zone r.timezone)::date, r.start_date);
  while i < 30 loop
    if r.end_date is not null and d > r.end_date then return null; end if;
    if is_trading_day(d)
       and not exists (select 1 from settlement_runs s
                        where s.round_id = p_round and s.trading_date = d and s.status = 'completed')
       and app_now() < round_deadline(p_round, d)
    then
      return d;
    end if;
    d := d + 1; i := i + 1;
  end loop;
  return null;
end $$;

-- ───────────────────────── Simulierter Markt ─────────────────────────
-- Deterministisch (Hash statt Zufall): gleiche Eingabe → gleicher Kurs.
-- Quelle wird in daily_prices.source = 'simulated' festgehalten und in der
-- Oberfläche immer als „simuliert“ gekennzeichnet.
create function sim_z(p_symbol text, p_date date) returns numeric
language sql immutable as $$
  select (sum(u) - 2) / sqrt(1.0 / 3)
  from (
    select (('x' || substr(md5(p_symbol || p_date::text || i::text), 1, 7))::bit(28)::int)::numeric
           / 268435456 as u
    from generate_series(1, 4) i
  ) s
$$;

-- Erzeugt fehlende Kurse bis einschließlich p_upto, Tag für Tag in Reihenfolge.
-- Bestehende Kurse werden nie überschrieben. Der ETF ist der Durchschnitt
-- aller Aktien-Renditen (→ Diversifikation ist im Modell sichtbar).
create function generate_simulated_prices(p_upto date) returns integer
language plpgsql as $$
declare
  v_day   date;
  a       record;
  prev    numeric;
  r       numeric;
  r_sum   numeric;
  r_cnt   integer;
  n       integer := 0;
begin
  perform pg_advisory_xact_lock(884201);
  select coalesce(max(price_date) + 1, p_upto) into v_day
    from daily_prices where source = 'simulated';
  while v_day <= p_upto loop
    if is_trading_day(v_day) then
      r_sum := 0; r_cnt := 0;
      for a in select * from assets where active and kind = 'stock' order by symbol loop
        select close into prev from daily_prices
         where asset_id = a.id and price_date < v_day and market = 'simulated'
         order by price_date desc limit 1;
        prev := coalesce(prev, a.base_price);
        r := greatest(-0.2, least(0.2, a.drift + a.volatility * sim_z(a.symbol, v_day)));
        insert into daily_prices(asset_id, price_date, close, source)
          values (a.id, v_day, round(prev * (1 + r), 2), 'simulated')
          on conflict do nothing;
        r_sum := r_sum + r; r_cnt := r_cnt + 1; n := n + 1;
      end loop;
      for a in select * from assets where active and kind = 'etf' order by symbol loop
        select close into prev from daily_prices
         where asset_id = a.id and price_date < v_day and market = 'simulated'
         order by price_date desc limit 1;
        prev := coalesce(prev, a.base_price);
        r := case when r_cnt > 0 then r_sum / r_cnt else 0 end;
        insert into daily_prices(asset_id, price_date, close, source)
          values (a.id, v_day, round(prev * (1 + r), 2), 'simulated')
          on conflict do nothing;
        n := n + 1;
      end loop;
    end if;
    v_day := v_day + 1;
  end loop;
  return n;
end $$;

-- ───────────────────────── Stammdaten ─────────────────────────
insert into assets (symbol, name, kind, sector, description, base_price, volatility, drift) values
 ('AAPL', 'Apple',            'stock', 'Technology',        'Consumer electronics and services (iPhone, Mac, App Store).', 190.00, 0.0170, 0.00035),
 ('MSFT', 'Microsoft',        'stock', 'Technology',        'Software, cloud computing and business services.',            420.00, 0.0155, 0.00040),
 ('AMZN', 'Amazon',           'stock', 'Consumer / Cloud',  'Online retail and cloud services.',                           180.00, 0.0210, 0.00035),
 ('TSLA', 'Tesla',            'stock', 'Automotive',        'Electric vehicles and energy storage.',                       250.00, 0.0350, 0.00020),
 ('KO',   'Coca-Cola',        'stock', 'Consumer staples',  'Soft drinks sold in more than 200 countries.',                 62.00, 0.0090, 0.00020),
 ('NKE',  'Nike',             'stock', 'Consumer goods',    'Sports shoes and apparel.',                                    95.00, 0.0170, 0.00025),
 ('DIS',  'Disney',           'stock', 'Media',             'Film, streaming and theme parks.',                            110.00, 0.0190, 0.00025),
 ('MCD',  'McDonald''s',      'stock', 'Consumer services', 'Fast-food restaurants, mostly franchised.',                   290.00, 0.0100, 0.00025),
 ('URTH','iShares MSCI World ETF', 'etf', 'Index fund',    'Spreads money across companies worldwide — the passive alternative.', 165.00, 0.0, 0.0);

-- NYSE-Feiertage (Börse geschlossen). Jährlich bei Bedarf ergänzen.
insert into market_holidays (holiday_date, note) values
 ('2026-11-26', 'Thanksgiving'),
 ('2026-12-25', 'Christmas'),
 ('2027-01-01', 'New Year''s Day'),
 ('2027-01-18', 'Martin Luther King Jr. Day'),
 ('2027-02-15', 'Presidents'' Day'),
 ('2027-03-26', 'Good Friday'),
 ('2027-05-31', 'Memorial Day'),
 ('2027-06-18', 'Juneteenth (observed)'),
 ('2027-07-05', 'Independence Day (observed)'),
 ('2027-09-06', 'Labor Day'),
 ('2027-11-25', 'Thanksgiving'),
 ('2027-12-24', 'Christmas (observed)');
