-- NEW JOINER TRAINING TRACKING — run once in the Supabase SQL editor (2026-10-23).
-- Replaces the "Onboarding Master file" tabs: New Joiner KPI Timeline, Onboarding Report,
-- Buddy Report, Week 5-10. Only ADDS tables, views and a staging schema; nothing existing changes,
-- so the simulators and their scoring are untouched. Safe to re-run.
--
-- Access: ADMIN LOGIN ONLY. The simulator tables let any signed-in user read them, which includes
-- the shared trainee login — new joiners must not be able to read each other's reviews, so every
-- policy here checks for the admin account by email.
--
-- Weeks are WORKING weeks, Monday to Friday. Week 1 is the Mon–Fri week the joiner starts in
-- (even if they start mid-week); each following Monday starts the next week.
-- Quality %, average score, QA % and RAG are always CALCULATED in the views below, never stored.

-- ── 1. Tables ─────────────────────────────────────────────────────────────
create table if not exists agents (
  id              bigint generated always as identity primary key,
  name            text not null,
  start_date      date not null,
  cohort          text,
  buddy           text,
  team_lead       text,
  learning_style  text,
  status          text not null default 'onboarding'
                  check (status in ('onboarding','buddying','probation','passed','left')),
  created_at      timestamptz not null default now()
);

create table if not exists kpi_targets (
  week                 int primary key check (week between 1 and 11),
  phase                text not null check (phase in ('onboarding','buddying','probation','passed')),
  goal_messages        int,
  min_messages         int,
  quality_target_pct   numeric,   -- % of scored tickets that must be a 3
  qa_mentions_max_pct  numeric,   -- QA mentions must stay UNDER this % of messages sent
  calls_target         int,
  notes                text
);

create table if not exists weekly_metrics (
  id               bigint generated always as identity primary key,
  agent_id         bigint not null references agents(id) on delete cascade,
  week             int not null check (week between 1 and 11),
  week_start_date  date,
  tickets_logged   int check (tickets_logged >= 0),
  tickets_scored   int check (tickets_scored >= 0),
  score_3s         int check (score_3s >= 0),
  score_2s         int check (score_2s >= 0),
  score_1s         int check (score_1s >= 0),
  messages_sent    int check (messages_sent >= 0),
  qa_mentions      int check (qa_mentions >= 0),
  calls_done       int check (calls_done >= 0),
  updated_at       timestamptz not null default now(),
  unique (agent_id, week)
);

create table if not exists weekly_reviews (
  id                bigint generated always as identity primary key,
  agent_id          bigint not null references agents(id) on delete cascade,
  week              int not null check (week between 1 and 11),
  strengths         text,
  areas_to_improve  text,
  progress_summary  text,
  next_steps        text,
  reviewer          text,
  updated_at        timestamptz not null default now(),
  unique (agent_id, week)
);

create table if not exists ticket_scores (
  id              bigint generated always as identity primary key,
  agent_id        bigint not null references agents(id) on delete cascade,
  date            date not null,
  contact_reason  text,
  score           int not null check (score between 1 and 3),
  feedback        text,
  reviewer        text,
  created_at      timestamptz not null default now()
);
create index if not exists ticket_scores_agent_date_idx on ticket_scores (agent_id, date);

-- ── 2. Admin-only access ──────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['agents','kpi_targets','weekly_metrics','weekly_reviews','ticket_scores'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "admin only" on %I', t);
    execute format($p$create policy "admin only" on %I for all to authenticated
                      using ((auth.jwt() ->> 'email') = 'admin-access@healf.com')
                      with check ((auth.jwt() ->> 'email') = 'admin-access@healf.com')$p$, t);
  end loop;
end $$;

-- ── 3. KPI targets (from the New Joiner KPI Timeline tab) ─────────────────
insert into kpi_targets (week, phase, goal_messages, min_messages, quality_target_pct, qa_mentions_max_pct, calls_target, notes) values
  (1,  'onboarding', null, null, null, null, null, 'Onboarding (Demetra). No volume KPI.'),
  (2,  'onboarding', null, null, null, null, null, 'Onboarding (Demetra). No volume KPI.'),
  (3,  'buddying',   null, null, 90,   null, null, 'Buddying (Demetra/Cleo). No volume KPI. 90% of scored tickets must be 3s.'),
  (4,  'buddying',   150,  null, 90,   null, null, 'Buddying. Suggested daily: M 30, T 35, W 40, F 45.'),
  (5,  'probation',  225,  200,  null, 5,    null, 'Team Lead handover + QA intro meeting. QA team takes over quality.'),
  (6,  'probation',  250,  240,  null, 5,    null, null),
  (7,  'probation',  300,  290,  null, 5,    null, 'Calls training session (Demetra).'),
  (8,  'probation',  325,  315,  null, 5,    1,    null),
  (9,  'probation',  350,  340,  null, 5,    1,    null),
  (10, 'probation',  350,  350,  null, 5,    3,    'Probation pass minimum. 3 calls done in total by end of probation.'),
  (11, 'passed',     450,  null, null, null, null, 'Probation ended. 450+ a week.')
on conflict (week) do update set
  phase = excluded.phase, goal_messages = excluded.goal_messages, min_messages = excluded.min_messages,
  quality_target_pct = excluded.quality_target_pct, qa_mentions_max_pct = excluded.qa_mentions_max_pct,
  calls_target = excluded.calls_target, notes = excluded.notes;

-- ── 4. Calculated views (run as the signed-in user, so the admin-only rule applies) ──
create or replace function nj_week_of(start_date date, on_date date) returns int
language sql immutable as $$
  select ((date_trunc('week', on_date)::date - date_trunc('week', start_date)::date) / 7) + 1
$$;

create or replace function nj_week_start(start_date date, week int) returns date
language sql immutable as $$
  select (date_trunc('week', start_date)::date + (week - 1) * 7)
$$;

create or replace view nj_week_stats with (security_invoker = true) as
with base as (
  select m.*, k.phase, k.goal_messages, k.min_messages, k.quality_target_pct, k.qa_mentions_max_pct, k.calls_target,
    round(100.0 * m.score_3s / nullif(m.tickets_scored, 0), 1)                                         as quality_pct,
    round((3.0 * coalesce(m.score_3s,0) + 2 * coalesce(m.score_2s,0) + coalesce(m.score_1s,0))
          / nullif(coalesce(m.score_3s,0) + coalesce(m.score_2s,0) + coalesce(m.score_1s,0), 0), 2)    as avg_score,
    round(100.0 * m.qa_mentions / nullif(m.messages_sent, 0), 1)                                       as qa_pct
  from weekly_metrics m join kpi_targets k on k.week = m.week
), rags as (
  select b.*,
    case when b.goal_messages is null or b.messages_sent is null then null
         when b.messages_sent >= b.goal_messages then 'green'
         when b.min_messages is null or b.messages_sent >= b.min_messages then 'amber'
         else 'red' end as volume_rag,
    case when b.quality_target_pct is null or b.quality_pct is null then null
         when b.quality_pct >= b.quality_target_pct then 'green'
         when b.quality_pct >= b.quality_target_pct - 10 then 'amber'
         else 'red' end as quality_rag,
    case when b.qa_mentions_max_pct is null or b.qa_pct is null then null
         when b.qa_pct < b.qa_mentions_max_pct then 'green'
         else 'red' end as qa_rag
  from base b
)
select r.*,
  case when 'red'   in (r.volume_rag, r.quality_rag, r.qa_rag) then 'red'
       when 'amber' in (r.volume_rag, r.quality_rag, r.qa_rag) then 'amber'
       when 'green' in (r.volume_rag, r.quality_rag, r.qa_rag) then 'green' end as rag
from rags r;

create or replace view nj_agent_overview with (security_invoker = true) as
select a.*,
  nj_week_of(a.start_date, current_date)                                        as current_week,
  (select k.phase from kpi_targets k where k.week = least(greatest(nj_week_of(a.start_date, current_date), 1), 11)) as current_phase,
  l.week            as latest_week,
  l.rag             as latest_rag,
  l.messages_sent   as latest_messages,
  l.min_messages    as latest_min,
  l.qa_pct          as latest_qa_pct,
  l.quality_pct     as latest_quality_pct,
  -- Probation flag: in probation weeks (5+), the latest week is under that week's minimum
  -- messages, or QA mentions are at/over the limit.
  coalesce(l.week >= 5 and (
     (l.min_messages is not null and l.messages_sent < l.min_messages)
     or (l.qa_mentions_max_pct is not null and l.qa_pct >= l.qa_mentions_max_pct)), false) as probation_flag
from agents a
left join lateral (
  select s.* from nj_week_stats s
   where s.agent_id = a.id and s.week <= greatest(nj_week_of(a.start_date, current_date), 1)
   order by s.week desc limit 1
) l on true;

-- ── 5. Staging area for the one-off import ────────────────────────────────
-- The import loads here first (by agent NAME, so it reads easily). Nothing in the app reads
-- this schema; check it, then run new-joiner-import-promote.sql to copy it into the real tables.
create schema if not exists staging;
revoke all on schema staging from anon, authenticated;

create table if not exists staging.agents (
  name text primary key, start_date date, cohort text, buddy text, team_lead text,
  learning_style text, status text
);
create table if not exists staging.weekly_metrics (
  agent_name text not null, week int not null, week_start_date date,
  tickets_logged int, tickets_scored int, score_3s int, score_2s int, score_1s int,
  messages_sent int, qa_mentions int, calls_done int,
  primary key (agent_name, week)
);
create table if not exists staging.weekly_reviews (
  agent_name text not null, week int not null, strengths text, areas_to_improve text,
  progress_summary text, next_steps text, reviewer text,
  primary key (agent_name, week)
);
