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
