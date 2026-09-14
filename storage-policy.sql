-- Ticket attachment photos — run once in the Supabase SQL editor.
--
-- The real customer photos live in the PRIVATE bucket 'ticket-attachments'.
-- Private means nothing is readable without a policy, so this grants read
-- access to signed-in trainees only. The bucket is never public, so the photos
-- are not published with the site and cannot be reached by URL alone.

alter table storage.objects enable row level security;

drop policy if exists "Signed-in trainees can read ticket attachments" on storage.objects;

create policy "Signed-in trainees can read ticket attachments"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'ticket-attachments');

-- Nobody but the service key can write: no insert/update/delete policy exists,
-- so trainees can read the photos but never add to or change them.
