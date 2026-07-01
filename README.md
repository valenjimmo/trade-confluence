# Trade Confluence

Next.js App Router dashboard for RS-qualified tickers, Bullflow GEX/VEX maps, and aggregated strike/expiration backtests.

## Run Locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Environment

Set these in Vercel and mirror them locally without committing any `.env*` file:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
BULLFLOW_API_KEY=
BULLFLOW_API_BASE_URL=https://api.bullflow.io/v1
NEXT_PUBLIC_APP_URL=
CRON_SECRET=
```

Google OAuth should be configured in Supabase Auth. The app uses `supabase.auth.signInWithOAuth({ provider: "google" })`; it does not implement a custom OAuth flow.

## Supabase

Apply the migration in `supabase/migrations/20260701215000_initial_trade_confluence.sql`.

The schema intentionally persists only:

- `tickers_latest`: one flattened row per ticker from imports
- `user_watchlist`: tiny user-scoped saved watchlist/filter data
- `backtest_results_cache`: aggregated result rows only
- `flow_cache`: short-lived aggregate payloads only

Do not add raw uploaded JSON, raw options flow streams, or raw per-strike GEX/VEX history tables. `vercel.json` runs `/api/cron/cleanup` daily to purge expired cache rows.

## Useful Routes

- `/api/bullflow/gex-vex`: server-only Bullflow GEX/VEX proxy
- `/api/bullflow/backtest`: server-only Bullflow backtest proxy and aggregate cache writer
- `/api/tickers/import-summary`: upserts flattened import summaries
- `/api/cron/cleanup`: deletes expired cache rows, protected by `CRON_SECRET`
- `/api/admin/db-size`: reports `pg_database_size()` through the `database_size_bytes()` RPC, protected by `CRON_SECRET`

## Checks

```bash
npm run lint
npm run build
```
