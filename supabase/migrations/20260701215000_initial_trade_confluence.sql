-- Trade Confluence storage policy:
-- Keep Supabase small. Do not add raw uploaded JSON, raw options-flow streams,
-- or raw per-strike GEX/VEX history tables. Persist only flattened ticker
-- summaries, user-scoped tiny settings, and short-lived aggregated caches.

create table if not exists public.tickers_latest (
  ticker text primary key,
  sector text,
  latest_score numeric,
  latest_status text check (latest_status in ('TRADEABLE', 'NOT TRADEABLE')),
  latest_stage text,
  latest_trend text,
  latest_price numeric,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null,
  saved_filter jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, ticker)
);

create table if not exists public.backtest_results_cache (
  ticker text not null,
  setup_type text not null,
  date_from date not null,
  date_to date not null,
  strike numeric not null,
  dte integer not null,
  win_rate numeric not null,
  avg_return numeric not null,
  sample_size integer not null,
  computed_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '48 hours'),
  primary key (ticker, setup_type, date_from, date_to, strike, dte)
);

create table if not exists public.flow_cache (
  cache_key text primary key,
  aggregate_payload jsonb not null,
  computed_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  constraint flow_cache_no_raw_stream check (jsonb_typeof(aggregate_payload) = 'object')
);

create index if not exists backtest_results_cache_expires_at_idx
  on public.backtest_results_cache (expires_at);

create index if not exists flow_cache_expires_at_idx
  on public.flow_cache (expires_at);

alter table public.tickers_latest enable row level security;
alter table public.user_watchlist enable row level security;
alter table public.backtest_results_cache enable row level security;
alter table public.flow_cache enable row level security;

create policy "authenticated can read latest tickers"
  on public.tickers_latest for select
  to authenticated
  using (true);

create policy "users manage their watchlist"
  on public.user_watchlist for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "authenticated can read cached backtests"
  on public.backtest_results_cache for select
  to authenticated
  using (true);

create or replace function public.database_size_bytes()
returns bigint
language sql
security definer
set search_path = public
as $$
  select pg_database_size(current_database());
$$;

revoke all on function public.database_size_bytes() from public;
grant execute on function public.database_size_bytes() to service_role;
