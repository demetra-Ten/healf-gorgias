-- Trainer feedback on the AUTO-MARKING itself.
-- Run once in the Supabase SQL editor. Safe to re-run (IF NOT EXISTS).
--
-- Purpose: Demetra marks the marker. Each row becomes a gold-set case used to
-- calibrate the scoring rubric in n8n workflow DHLJ1PVNIj9kEnsl.

alter table submissions add column if not exists trainer_verdict     text;         -- 'too_harsh' | 'fair' | 'too_lenient'
alter table submissions add column if not exists trainer_score       int;          -- what the score SHOULD have been (1-3)
alter table submissions add column if not exists trainer_note        text;         -- why: which bullet was wrong and what the right call was
alter table submissions add column if not exists trainer_reviewed_at timestamptz;  -- when the verdict was left

-- Quick view of everything awaiting calibration
-- select id, ticket_id, score, trainer_score, trainer_verdict, trainer_note
--   from submissions where trainer_verdict is not null order by trainer_reviewed_at desc;

-- ── Customer message sent-date (added later) ──
-- Gorgias shows a sent date on every message; the sim now does too. Where this is
-- null the app derives a date from the ticket's most recent order, so it always
-- shows something sensible. Populate it to reflect the real source ticket.
alter table tickets add column if not exists message_at timestamptz;
