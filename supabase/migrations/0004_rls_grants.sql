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
