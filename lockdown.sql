-- LOCKDOWN: only authenticated (logged-in) users can read/write any data.
-- After this runs, the public key ALONE returns nothing — a valid login is required.
-- Run in the Supabase SQL editor AFTER macros.sql, and AFTER the new auth-based code is deployed.

-- categories
drop policy if exists "public read categories" on categories;
create policy "auth read categories" on categories for select to authenticated using (true);

-- trainees
drop policy if exists "public read trainees"   on trainees;
drop policy if exists "public insert trainees" on trainees;
drop policy if exists "public update trainees" on trainees;
create policy "auth read trainees"   on trainees for select to authenticated using (true);
create policy "auth insert trainees" on trainees for insert to authenticated with check (true);
create policy "auth update trainees" on trainees for update to authenticated using (true);

-- tickets
drop policy if exists "public read tickets"   on tickets;
drop policy if exists "public insert tickets" on tickets;
drop policy if exists "public delete tickets" on tickets;
create policy "auth read tickets"   on tickets for select to authenticated using (true);
create policy "auth insert tickets" on tickets for insert to authenticated with check (true);
create policy "auth delete tickets" on tickets for delete to authenticated using (true);

-- submissions
drop policy if exists "public insert submissions" on submissions;
drop policy if exists "public read submissions"   on submissions;
drop policy if exists "public update submissions" on submissions;
create policy "auth insert submissions" on submissions for insert to authenticated with check (true);
create policy "auth read submissions"   on submissions for select to authenticated using (true);
create policy "auth update submissions" on submissions for update to authenticated using (true);

-- macros
drop policy if exists "public read macros"   on macros;
drop policy if exists "public insert macros" on macros;
drop policy if exists "public delete macros" on macros;
create policy "auth read macros"   on macros for select to authenticated using (true);
create policy "auth insert macros" on macros for insert to authenticated with check (true);
create policy "auth delete macros" on macros for delete to authenticated using (true);
