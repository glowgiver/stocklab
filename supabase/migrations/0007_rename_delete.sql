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
