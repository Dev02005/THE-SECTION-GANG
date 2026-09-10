-- Corridor - let a signed-in post change its own password.
--
-- WHAT THIS IS, AND WHAT A REAL DEPLOYMENT WOULD DO INSTEAD
--
-- A real deployment carries no password at all. Every officer already has an
-- HRMS employee ID, and an internal application on RailNet authenticates
-- against that directory - so "reset my password" is an HRMS action, not ours,
-- and there would be nothing here to reset. That is stated on /limits and it
-- has not changed.
--
-- What this adds is the demonstration equivalent: the same credential check,
-- the same bcrypt storage, the same audit trail, so the shape of the operation
-- is real even though the directory behind it is not.
--
-- THE RISK, NAMED
--
-- This database is shared by everyone who opens the deployed site, and the
-- sign-in page prints the demonstration password. A visitor who changes one
-- leaves that page wrong for that post, and the post effectively locked. So
-- `restore_demo_password` exists beside `change_password`, needs only a valid
-- current credential, and puts the shared password back. Both are logged.
--
-- The current password is required even though the caller already holds it in
-- their session. It costs one field and it is the correct shape: a change of
-- credential proves the credential, rather than proving only that a browser
-- once knew it.

-- ---------------------------------------------------------------------------

create or replace function change_password(
  p_officer_id text, p_password text, p_new_password text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare o officers%rowtype;
begin
  o := _officer(p_officer_id, p_password);
  if o.id is null then raise exception 'invalid credentials'; end if;

  --  Length only. An internal application would inherit whatever policy the
  --  directory enforces; inventing a stricter one here would be theatre.
  if length(coalesce(p_new_password, '')) < 8 then
    raise exception 'a password must be at least 8 characters';
  end if;
  if p_new_password = p_password then
    raise exception 'the new password is the same as the current one';
  end if;

  update officers
     set password_hash = crypt(p_new_password, gen_salt('bf', 10))
   where id = o.id;

  --  The NEW password is not logged, and neither is the old one. What is
  --  worth recording is that the credential changed, and when.
  insert into audit_log (actor, action, entity, entity_id)
       values (o.id, 'officer.password_changed', 'officer', o.id);
  return true;
end;
$$;

comment on function change_password(text, text, text) is
  'Change the calling post''s own password. Re-verifies the current one, '
  'stores bcrypt with a fresh salt, and logs that a change happened without '
  'logging either value.';

-- ---------------------------------------------------------------------------

create or replace function restore_demo_password(
  p_officer_id text, p_password text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare o officers%rowtype;
begin
  o := _officer(p_officer_id, p_password);
  if o.id is null then raise exception 'invalid credentials'; end if;

  --  The one shared demonstration password, as seeded in 0005 and printed on
  --  the sign-in page. This is the way back for a shared instance, and the
  --  reason changing a password here is not a one-way door.
  update officers
     set password_hash = crypt('block@2026', gen_salt('bf', 10))
   where id = o.id;

  insert into audit_log (actor, action, entity, entity_id)
       values (o.id, 'officer.password_restored', 'officer', o.id);
  return true;
end;
$$;

comment on function restore_demo_password(text, text) is
  'Put the shared demonstration password back for the calling post. Exists '
  'because this database is shared and the sign-in page prints that password: '
  'a change made by one visitor would otherwise lock the post for everyone.';

-- ---------------------------------------------------------------------------
-- Grants. The tables stay shut; the functions are the whole API.
-- ---------------------------------------------------------------------------

revoke all on function change_password(text, text, text) from public;
revoke all on function restore_demo_password(text, text) from public;
grant execute on function change_password(text, text, text) to anon, authenticated;
grant execute on function restore_demo_password(text, text) to anon, authenticated;
