-- Per-assignment opt-in for study blocks between midnight and 06:00.
-- Off by default. The scheduler only acts on it once the assignment's
-- deadline is within 48 hours, and only after waking hours are full.
-- Existing row level security on assignments already covers this column:
-- users can only read and change their own rows.

alter table public.assignments
  add column if not exists allow_overnight boolean not null default false;

comment on column public.assignments.allow_overnight is
  'User opted in to overnight (00:00-06:00) study blocks when the deadline is close.';
