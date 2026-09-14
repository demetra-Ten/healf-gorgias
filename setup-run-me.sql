-- Run this once in the Supabase SQL editor. Two things:
--   1. lets signed-in trainees load the real ticket photos
--   2. remembers who has finished the walkthrough, so it only ever runs once

-- ── 1. Ticket attachment photos ──────────────────────────────────────────────
-- The photos live in the PRIVATE bucket 'ticket-attachments'. Private means
-- nothing is readable without a policy, so this grants read to signed-in
-- trainees only. There is no insert/update/delete policy, so trainees can read
-- the photos but never change them. The bucket is never public, so nothing is
-- published with the site or reachable by URL alone.
alter table storage.objects enable row level security;

drop policy if exists "Signed-in trainees can read ticket attachments" on storage.objects;

create policy "Signed-in trainees can read ticket attachments"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'ticket-attachments');

-- ── 2. Walkthrough completion ────────────────────────────────────────────────
-- This was kept in the browser, which meant it came back on a different browser
-- or machine. Storing it against the trainee means a new joiner gets it once and
-- nobody gets it twice.
alter table trainees add column if not exists tour_done_at timestamptz;

-- Everyone who has already been through the sim: mark them done so they are not
-- made to sit through it. New joiners start with tour_done_at null and get it.
update trainees set tour_done_at = now() where tour_done_at is null;
