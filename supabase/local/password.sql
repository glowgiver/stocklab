-- Nur für Tests und den lokalen Demo-Modus: dort speichert die nachgebaute auth.users-Tabelle
-- einen SHA-256-Wert (wie im lokalen Login). NIE in Supabase einspielen.
create or replace function set_auth_password(p_user uuid, p_password text) returns void
language sql security definer set search_path = public as $$
  update auth.users set pw_hash = encode(sha256(convert_to(p_password, 'UTF8')), 'hex') where id = p_user
$$;
