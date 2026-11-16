-- Google Calendar sync: one row per user who has connected a calendar.
--
-- Holds the (encrypted) Google refresh token, so this table is server-only.
-- Row level security is ON with NO policies, and the anon/authenticated
-- roles have no privileges on it at all: nothing running in a browser can
-- read or write it, even for the user's own row. Only the service-role key
-- used by the API routes can. The token is additionally encrypted by the
-- app (AES-256-GCM, key in GOOGLE_TOKEN_ENCRYPTION_KEY) before it gets here.

create table if not exists public.google_calendar_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  refresh_token_encrypted text not null,
  calendar_id text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.google_calendar_connections enable row level security;

revoke all on table public.google_calendar_connections from anon, authenticated;

comment on table public.google_calendar_connections is
  'Server-only. Encrypted Google refresh token per user for Calendar sync. RLS on, no policies.';
