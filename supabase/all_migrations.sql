-- ═══ 0001_schema.sql ═══
-- StockLab · 0001 · Schema
-- Alle Finanz-Zustandsänderungen laufen später über SECURITY-DEFINER-Funktionen
-- (0003). Clients bekommen KEINE Schreibrechte auf Tabellen (0004).

-- Zeitquelle: in Produktion einfach now(). Tests ersetzen diese Funktion.
create or replace function app_now() returns timestamptz
language sql stable as $$ select now() $$;

-- ───────────────────────── Nutzer & Rollen ─────────────────────────
create table profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null check (role in ('student','teacher')),
  locale     text not null default 'de' check (locale in ('de','en')),
  created_at timestamptz not null default now()
);

-- Geheimer Lehrkraft-Einladungscode. Kein Policy → für Clients unsichtbar.
create table app_config (
  key   text primary key,
  value text not null
);
insert into app_config(key, value)
values ('teacher_signup_code', substr(md5(random()::text || clock_timestamp()::text), 1, 12));

-- ───────────────────────── Klassen & Runden ─────────────────────────
create table classes (
  id         uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles(user_id),
  name       text not null check (char_length(name) between 1 and 80),
  join_code  text not null unique,
  join_open  boolean not null default true,
  created_at timestamptz not null default now()
);

-- Pseudonym ↔ Person steht NIRGENDS in der App (nur auf Papier bei der Lehrkraft).
create table class_members (
  id         uuid primary key default gen_random_uuid(),
  class_id   uuid not null references classes(id) on delete cascade,
  student_id uuid not null unique references profiles(user_id) on delete cascade,
  pseudonym  text not null check (pseudonym ~ '^[A-Za-z0-9ÄÖÜäöüß _-]{2,24}$'),
  created_at timestamptz not null default now()
);
create unique index class_members_pseudonym_uq on class_members (class_id, lower(pseudonym));

create table rounds (
  id               uuid primary key default gen_random_uuid(),
  class_id         uuid not null references classes(id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 80),
  starting_capital numeric(14,2) not null default 10000 check (starting_capital > 0),
  deadline_time    time not null default '15:00',
  timezone         text not null default 'Europe/Berlin',
  status           text not null default 'draft' check (status in ('draft','active','ended')),
  data_mode        text not null default 'simulated' check (data_mode in ('simulated','external')),
  is_demo          boolean not null default false,
  start_date       date,
  end_date         date,
  created_at       timestamptz not null default now()
);
create unique index rounds_one_active_per_class on rounds (class_id) where status = 'active';

-- ───────────────────────── Markt ─────────────────────────
create table assets (
  id          uuid primary key default gen_random_uuid(),
  symbol      text not null unique,
  name        text not null,
  kind        text not null check (kind in ('stock','etf')),
  sector      text,
  description text,
  base_price  numeric(12,2) not null check (base_price > 0),
  volatility  numeric(6,4)  not null default 0.0180,  -- Tages-σ (nur Simulation)
  drift       numeric(8,5)  not null default 0.00030, -- Tages-Drift (nur Simulation)
  active      boolean not null default true
);

create table market_holidays (
  holiday_date date primary key,
  note         text
);

create table daily_prices (
  asset_id   uuid not null references assets(id),
  price_date date not null,
  close      numeric(12,2) not null check (close > 0),
  source     text not null check (source in ('simulated','eod_api','manual')),
  -- Simulierte und echte Kurse sind getrennte Märkte: eine Demo-Runde mit „Tag vorspulen“
  -- blockiert nie echte Kurse desselben Datums, und beide Welten mischen sich nie.
  market     text generated always as (case when source = 'simulated' then 'simulated' else 'real' end) stored,
  fetched_at timestamptz not null default now(),
  primary key (asset_id, price_date, market)
);

-- ───────────────────────── Depots ─────────────────────────
create table portfolios (
  id         uuid primary key default gen_random_uuid(),
  round_id   uuid not null references rounds(id) on delete cascade,
  student_id uuid not null references profiles(user_id) on delete cascade,
  cash       numeric(14,2) not null check (cash >= 0),
  created_at timestamptz not null default now(),
  unique (round_id, student_id)
);

create table holdings (
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  asset_id     uuid not null references assets(id),
  quantity     integer not null check (quantity >= 0),
  avg_cost     numeric(14,4) not null default 0,
  primary key (portfolio_id, asset_id)
);

-- ───────────────────────── Entscheidungen ─────────────────────────
create table decisions (
  id           uuid primary key default gen_random_uuid(),
  round_id     uuid not null references rounds(id) on delete cascade,
  student_id   uuid not null references profiles(user_id) on delete cascade,
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  trading_date date not null,
  action       text not null check (action in ('buy','sell','hold')),
  asset_id     uuid references assets(id),
  quantity     integer,
  expectation  text not null check (char_length(btrim(expectation)) between 10 and 1000),
  reasoning    text not null check (char_length(btrim(reasoning))   between 10 and 1000),
  evidence     text not null check (char_length(btrim(evidence))    between 10 and 1000),
  risks        text not null check (char_length(btrim(risks))       between 10 and 1000),
  status       text not null default 'pending' check (status in ('pending','settled')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Eine Entscheidung je Schüler, Runde und Handelstag — hart in der Datenbank.
  unique (student_id, round_id, trading_date),
  check ( (action = 'hold' and asset_id is null and quantity is null)
       or (action in ('buy','sell') and asset_id is not null and quantity is not null and quantity > 0) )
);

create table orders (
  id            uuid primary key default gen_random_uuid(),
  decision_id   uuid not null unique references decisions(id) on delete cascade,
  portfolio_id  uuid not null references portfolios(id) on delete cascade,
  asset_id      uuid not null references assets(id),
  side          text not null check (side in ('buy','sell')),
  quantity      integer not null check (quantity > 0),
  status        text not null check (status in ('executed','rejected')),
  reject_reason text,
  created_at    timestamptz not null default now()
);

create table executions (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null unique references orders(id) on delete cascade, -- nie doppelt
  price        numeric(12,2) not null,
  quantity     integer not null check (quantity > 0),
  gross        numeric(14,2) not null,
  price_date   date not null,
  executed_at  timestamptz not null default now()
);

create table cash_movements (
  id            bigint generated always as identity primary key,
  portfolio_id  uuid not null references portfolios(id) on delete cascade,
  kind          text not null check (kind in ('initial','buy','sell')),
  amount        numeric(14,2) not null,       -- + Zufluss, − Abfluss
  balance_after numeric(14,2) not null check (balance_after >= 0),
  execution_id  uuid unique references executions(id) on delete cascade,
  created_at    timestamptz not null default now()
);
create unique index cash_one_initial on cash_movements (portfolio_id) where kind = 'initial';

create table portfolio_snapshots (
  portfolio_id   uuid not null references portfolios(id) on delete cascade,
  snap_date      date not null,
  cash           numeric(14,2) not null,
  holdings_value numeric(14,2) not null,
  total_value    numeric(14,2) not null,
  primary key (portfolio_id, snap_date)
);

create table settlement_runs (
  id           uuid primary key default gen_random_uuid(),
  round_id     uuid not null references rounds(id) on delete cascade,
  trading_date date not null,
  status       text not null check (status in ('completed','blocked')),
  detail       jsonb,
  finished_at  timestamptz not null default now(),
  unique (round_id, trading_date)  -- zweite Abrechnung desselben Tages unmöglich
);

-- ───────────────────────── Lernen & Feedback ─────────────────────────
create table reflections (
  id           uuid primary key default gen_random_uuid(),
  decision_id  uuid not null unique references decisions(id) on delete cascade,
  student_id   uuid not null references profiles(user_id) on delete cascade,
  convincing   text not null check (char_length(btrim(convincing)) between 5 and 1000),
  overlooked   text not null check (char_length(btrim(overlooked)) between 5 and 1000),
  would_change text not null check (char_length(btrim(would_change)) between 5 and 1000),
  created_at   timestamptz not null default now()
);

-- Manuelle Lehrkraft-Bewertung (0–4 je Kriterium). Nichts wird automatisch benotet.
create table teacher_feedback (
  id               uuid primary key default gen_random_uuid(),
  decision_id      uuid not null unique references decisions(id) on delete cascade,
  teacher_id       uuid not null references profiles(user_id),
  comment          text check (char_length(comment) <= 500),
  score_reasoning  smallint check (score_reasoning  between 0 and 4),
  score_evidence   smallint check (score_evidence   between 0 and 4),
  score_risk       smallint check (score_risk       between 0 and 4),
  score_reflection smallint check (score_reflection between 0 and 4),
  updated_at       timestamptz not null default now()
);

create index on decisions (round_id, trading_date);
create index on portfolios (round_id);
create index on class_members (class_id);

-- ═══ 0002_market_integrity.sql ═══
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

-- ═══ 0003_functions.sql ═══
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

-- ═══ 0004_rls_grants.sql ═══
-- StockLab · 0004 · Row Level Security + Rechte
-- Prinzip: Clients dürfen NUR lesen (und das nur Eigenes bzw. die eigene Klasse).
-- Alle Schreibzugriffe laufen über die Funktionen aus 0003.

alter table profiles             enable row level security;
alter table app_config           enable row level security;
alter table classes              enable row level security;
alter table class_members        enable row level security;
alter table rounds               enable row level security;
alter table assets               enable row level security;
alter table market_holidays      enable row level security;
alter table daily_prices         enable row level security;
alter table portfolios           enable row level security;
alter table holdings             enable row level security;
alter table decisions            enable row level security;
alter table orders               enable row level security;
alter table executions           enable row level security;
alter table cash_movements       enable row level security;
alter table portfolio_snapshots  enable row level security;
alter table settlement_runs      enable row level security;
alter table reflections          enable row level security;
alter table teacher_feedback     enable row level security;

create policy profiles_own on profiles for select to authenticated
  using (user_id = auth.uid());

create policy classes_read on classes for select to authenticated
  using (teacher_id = auth.uid() or is_member_of_class(id));

create policy members_read on class_members for select to authenticated
  using (student_id = auth.uid() or is_teacher_of_class(class_id));

create policy rounds_read on rounds for select to authenticated
  using (is_teacher_of_class(class_id) or is_member_of_class(class_id));

create policy assets_read    on assets          for select to authenticated using (true);
create policy holidays_read  on market_holidays for select to authenticated using (true);
create policy prices_read    on daily_prices    for select to authenticated using (true);

create policy portfolios_read on portfolios for select to authenticated
  using (student_id = auth.uid() or is_teacher_of_round(round_id));

create policy holdings_read  on holdings            for select to authenticated using (can_see_portfolio(portfolio_id));
create policy cash_read      on cash_movements      for select to authenticated using (can_see_portfolio(portfolio_id));
create policy snapshots_read on portfolio_snapshots for select to authenticated using (can_see_portfolio(portfolio_id));
create policy orders_read    on orders              for select to authenticated using (can_see_portfolio(portfolio_id));

create policy executions_read on executions for select to authenticated
  using (exists (select 1 from orders o where o.id = order_id and can_see_portfolio(o.portfolio_id)));

create policy decisions_read on decisions for select to authenticated
  using (student_id = auth.uid() or is_teacher_of_round(round_id));

create policy runs_read on settlement_runs for select to authenticated
  using (is_teacher_of_round(round_id));

create policy reflections_read on reflections    for select to authenticated using (can_see_decision(decision_id));
create policy feedback_read    on teacher_feedback for select to authenticated using (can_see_decision(decision_id));
-- app_config: bewusst KEINE Policy → nur service_role / SQL-Editor.

-- ───────────── Tabellenrechte: nur Lesen ─────────────
revoke all on all tables in schema public from public, anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
grant select on all tables in schema public to authenticated;
revoke select on app_config from authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- Funktionsrechte: siehe 0006_grants.sql (nach allen Funktionen).

-- ═══ 0005_real_prices_tips.sql ═══
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

-- ═══ 0006_grants.sql ═══
-- StockLab · 0006 · Funktionsrechte (Allow-List) — bewusst als LETZTE Migration:
-- Neue Funktionen sind in Postgres standardmäßig für alle ausführbar. Hier wird erst alles
-- gesperrt und dann nur freigegeben, was Clients wirklich aufrufen dürfen.
-- Neue Funktion hinzugefügt? → hier in die Liste, sonst ist sie für die App gesperrt.

revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  app_now(), is_teacher(), is_teacher_of_class(uuid), is_teacher_of_round(uuid),
  is_member_of_class(uuid), can_see_portfolio(uuid), can_see_decision(uuid), can_see_round(uuid),
  latest_close(uuid, date, text), round_market(uuid), is_trading_day(date), prev_trading_day(date), round_deadline(uuid, date),
  current_trading_date(uuid),
  register_teacher(text), create_class(text), join_class(text, text),
  create_round(uuid, text, numeric, time, boolean, text), start_round(uuid), end_round(uuid),
  submit_decision(uuid, text, uuid, integer, text, text, text, text),
  demo_settle_next_day(uuid), reset_demo_round(uuid),
  teacher_set_prices(date, jsonb, boolean), teacher_price_status(uuid), teacher_settle_due(uuid),
  add_reading_tip(uuid, text, text, text), delete_reading_tip(uuid), list_reading_tips(uuid),
  save_reflection(uuid, text, text, text),
  save_feedback(uuid, text, smallint, smallint, smallint, smallint),
  whoami(), my_overview(), teacher_overview(), teacher_round_detail(uuid)
to authenticated;

-- Interne Funktionen (settle_round_day, settle_round_due, run_daily_settlement,
-- generate_simulated_prices, ensure_portfolios, …): nur service_role bzw. andere Funktionen.
grant execute on all functions in schema public to service_role;

-- ═══ 0007_rename_delete.sql ═══
-- StockLab · 0007 · Umbenennen und Löschen (Klassen umbenennen; Runden umbenennen/löschen)
-- Kann einzeln in ein bestehendes Supabase-Projekt eingespielt werden; vorhandene Daten bleiben.

create or replace function rename_class(p_class uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_teacher_of_class(p_class) then raise exception 'forbidden'; end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 80 then raise exception 'invalid_name'; end if;
  update classes set name = btrim(p_name) where id = p_class;
end $$;

create or replace function rename_round(p_round uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_teacher_of_round(p_round) then raise exception 'forbidden'; end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 80 then raise exception 'invalid_name'; end if;
  update rounds set name = btrim(p_name) where id = p_round;
end $$;

-- Löschregeln:
--   Entwurf oder Demo-Runde  → direkt löschbar
--   echte Runde              → erst beenden, dann den Rundennamen als Bestätigung angeben
-- Gelöscht werden nur Daten dieser Runde (Entscheidungen, Reflexionen, Feedback, Depots,
-- Buchungen, Lesetipps). Kurse, Klasse und Schülerkonten bleiben.
create or replace function delete_round(p_round uuid, p_confirm text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype;
begin
  if not is_teacher_of_round(p_round) then raise exception 'forbidden'; end if;
  select * into r from rounds where id = p_round for update;
  if r.status <> 'draft' and not r.is_demo then
    if r.status <> 'ended' then raise exception 'round_still_running'; end if;
    if p_confirm is null or btrim(p_confirm) <> r.name then raise exception 'invalid_confirmation'; end if;
  end if;
  perform set_config('stocklab.reset', 'on', true);          -- nur diese Transaktion
  delete from decisions where round_id = p_round;
  delete from settlement_runs where round_id = p_round;
  delete from portfolios where round_id = p_round;
  delete from rounds where id = p_round;
  perform set_config('stocklab.reset', 'off', true);
end $$;

revoke execute on function rename_class(uuid, text), rename_round(uuid, text), delete_round(uuid, text)
  from public, anon;
grant execute on function rename_class(uuid, text), rename_round(uuid, text), delete_round(uuid, text)
  to authenticated, service_role;
