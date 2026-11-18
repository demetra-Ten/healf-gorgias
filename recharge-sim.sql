-- RECHARGE SIMULATOR — run once in the Supabase SQL editor.
-- The Recharge sim builds every customer and subscription from the tickets themselves
-- (sim-shared.js rcModel), so the only thing it stores is what a trainee DOES in it.
-- Same shape and lockdown as shop_actions: logged-in users only, no deletes.

create table if not exists recharge_actions (
  id             bigserial primary key,
  trainee_id     int not null references trainees(id),
  ticket_id      int not null references tickets(id),
  submission_id  int references submissions(id),
  kind           text not null check (kind in ('skip','unskip','reschedule','frequency','swap','quantity',
                                               'edit_address','cancel','activate','delete','process')),
  detail         jsonb not null default '{}',
  summary        text not null,               -- plain-English line, what the scorer reads
  created_at     timestamptz not null default now()
);
create index if not exists recharge_actions_attempt_idx on recharge_actions (trainee_id, ticket_id);

-- The scorer's view of what was done in Recharge, kept on the submission for review.
alter table submissions add column if not exists recharge_actions text;

alter table recharge_actions enable row level security;
create policy "auth read recharge_actions"   on recharge_actions for select to authenticated using (true);
create policy "auth insert recharge_actions" on recharge_actions for insert to authenticated with check (true);
create policy "auth update recharge_actions" on recharge_actions for update to authenticated using (true);
-- No delete policy: like real Recharge, a cancel or a processed charge cannot be taken back
-- (a cancelled subscription can be reactivated, which is its own row).
