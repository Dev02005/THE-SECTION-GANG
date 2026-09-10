-- Corridor - make sign-in finish inside the statement timeout.
--
-- THE BUG. `_officer` was written as one predicate:
--
--     where lower(id) = lower(trim(p_officer_id))
--       and password_hash = crypt(p_password, password_hash)
--
-- which invites the planner to evaluate `crypt` per row. bcrypt at cost 10 is
-- deliberately expensive - roughly 80 ms - so across 425 officers that is
-- about 34 seconds against an 8-second timeout, and every call came back
-- 57014 query_canceled. The slowness is the point of bcrypt; running it 425
-- times to check one password is the error.
--
-- THE FIX. Two steps, in order: find the single candidate row by id, then hash
-- once against that row's salt. The CTE is a planner fence, so the comparison
-- cannot be hoisted back into a per-row filter.
--
-- Also an index on lower(id), because the lookup is case-insensitive and
-- lower(id) is not the primary key - without it this is a sequential scan
-- whose cost happens not to matter at 425 rows but would at 425 divisions'
-- worth of posts.

create index if not exists officers_lower_id_idx on officers (lower(id));

create or replace function _officer(p_officer_id text, p_password text)
returns officers
language sql
stable
security definer
set search_path = public, extensions
as $$
  with candidate as (
    select * from officers
     where lower(id) = lower(trim(p_officer_id))
     limit 1
  )
  select * from candidate
   where password_hash = crypt(p_password, password_hash);
$$;

revoke all on function _officer(text, text) from public, anon, authenticated;
