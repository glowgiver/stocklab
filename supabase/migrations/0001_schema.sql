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
