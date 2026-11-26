-- StockLab · 0008 · Passwort für Schüler neu setzen (durch die eigene Lehrkraft)
-- Kann einzeln in ein bestehendes Supabase-Projekt eingespielt werden; vorhandene Daten bleiben.

-- INTERN: schreibt das Passwort in die Anmeldedaten von Supabase und beendet alte Sitzungen.
-- Darf von keinem Client aufgerufen werden (siehe Rechte unten).
create or replace function set_auth_password(p_user uuid, p_password text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = p_user;
  if not found then raise exception 'invalid_student'; end if;
  begin
    delete from auth.sessions where user_id = p_user;
  exception when insufficient_privilege or undefined_table then null;
  end;
end $$;

-- Pseudonyme einer eigenen Klasse (für die Passwort-Liste).
create or replace function class_students(p_class uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_teacher_of_class(p_class) then raise exception 'forbidden'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('student_id', student_id, 'pseudonym', pseudonym)
                                    order by lower(pseudonym)), '[]'::jsonb)
            from class_members where class_id = p_class);
end $$;

-- Erzeugt ein zufälliges Übergangspasswort für eine Schülerin / einen Schüler der EIGENEN Klasse
-- und gibt es genau einmal zurück. Lehrkraft-Konten lassen sich so nie ändern.
create or replace function teacher_reset_student_password(p_student uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';   -- ohne i, l, o, 0, 1
  v_random text := md5(gen_random_uuid()::text);
  v_password text := '';
  i integer;
begin
  if not exists (
       select 1 from class_members m
         join classes c on c.id = m.class_id
         join profiles p on p.user_id = m.student_id
        where m.student_id = p_student and c.teacher_id = auth.uid() and p.role = 'student') then
    raise exception 'forbidden';
  end if;
  for i in 0..9 loop
    v_password := v_password || substr(alphabet,
      1 + (('x' || substr(v_random, i * 3 + 1, 3))::bit(12)::int % length(alphabet)), 1);
  end loop;
  perform set_auth_password(p_student, v_password);
  return v_password;
end $$;

revoke execute on function set_auth_password(uuid, text) from public, anon, authenticated;
revoke execute on function class_students(uuid), teacher_reset_student_password(uuid) from public, anon;
grant execute on function class_students(uuid), teacher_reset_student_password(uuid) to authenticated, service_role;
