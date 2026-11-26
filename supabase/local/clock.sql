-- Nur für Tests: erlaubt, die Uhr zu verstellen (stocklab.now). Nie in Produktion.
create or replace function app_now() returns timestamptz
language sql stable as $$
  select coalesce(nullif(current_setting('stocklab.now', true), '')::timestamptz, now())
$$;
