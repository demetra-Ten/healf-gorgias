-- Copy the checked STAGING import into the real new-joiner tables. Run only after you have
-- looked at staging (select * from staging.agents; etc.) and are happy with it.
-- Adds/updates only the agents in staging; matches on name; never deletes anything.

begin;

insert into agents (name, start_date, cohort, buddy, team_lead, learning_style, status)
select s.name, s.start_date, s.cohort, s.buddy, s.team_lead, s.learning_style, coalesce(s.status, 'onboarding')
  from staging.agents s
 where not exists (select 1 from agents a where lower(trim(a.name)) = lower(trim(s.name)));

insert into weekly_metrics (agent_id, week, week_start_date, tickets_logged, tickets_scored,
                            score_3s, score_2s, score_1s, messages_sent, qa_mentions, calls_done)
select a.id, m.week, m.week_start_date, m.tickets_logged, m.tickets_scored,
       m.score_3s, m.score_2s, m.score_1s, m.messages_sent, m.qa_mentions, m.calls_done
  from staging.weekly_metrics m
  join agents a on lower(trim(a.name)) = lower(trim(m.agent_name))
on conflict (agent_id, week) do update set
  week_start_date = excluded.week_start_date, tickets_logged = excluded.tickets_logged,
  tickets_scored = excluded.tickets_scored, score_3s = excluded.score_3s, score_2s = excluded.score_2s,
  score_1s = excluded.score_1s, messages_sent = excluded.messages_sent, qa_mentions = excluded.qa_mentions,
  calls_done = excluded.calls_done, updated_at = now();

insert into weekly_reviews (agent_id, week, strengths, areas_to_improve, progress_summary, next_steps, reviewer)
select a.id, r.week, r.strengths, r.areas_to_improve, r.progress_summary, r.next_steps, r.reviewer
  from staging.weekly_reviews r
  join agents a on lower(trim(a.name)) = lower(trim(r.agent_name))
on conflict (agent_id, week) do update set
  strengths = excluded.strengths, areas_to_improve = excluded.areas_to_improve,
  progress_summary = excluded.progress_summary, next_steps = excluded.next_steps,
  reviewer = excluded.reviewer, updated_at = now();

commit;

select name, start_date, status, current_week, latest_week, latest_rag, probation_flag
  from nj_agent_overview order by start_date;
