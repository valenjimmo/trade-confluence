import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

type BacktestRow = {
  strike: number;
  dte: number;
  winRate: number;
  avgReturn: number;
  sampleSize: number;
};

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const ticker = String(body?.ticker ?? "").toUpperCase();
  const setupType = String(body?.setupType ?? "");
  const dateFrom = String(body?.dateFrom ?? "");
  const dateTo = String(body?.dateTo ?? "");

  if (!ticker || !dateFrom || !dateTo) {
    return NextResponse.json({ error: "Ticker and date range are required." }, { status: 400 });
  }

  const apiKey = process.env.BULLFLOW_API_KEY;
  const baseUrl = process.env.BULLFLOW_API_BASE_URL ?? "https://api.bullflow.io/v1";
  const aggregateUrl = process.env.BULLFLOW_BACKTEST_AGGREGATE_URL;

  if (!apiKey) {
    return NextResponse.json(
      { error: "BULLFLOW_API_KEY is not configured. Add it server-side before running backtests." },
      { status: 503 },
    );
  }

  if (!aggregateUrl) {
    return NextResponse.json(
      {
        error:
          "Bullflow's public API exposes /streaming/backtesting SSE replay and /data/peakReturn contract scoring, not a ready-made aggregate strike/DTE backtest endpoint. Set BULLFLOW_BACKTEST_AGGREGATE_URL to a service that turns replayed alerts into aggregated rows.",
      },
      { status: 501 },
    );
  }

  const upstream = await fetch(aggregateUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ ticker, setupType, dateFrom, dateTo, bullflowBaseUrl: baseUrl }),
    cache: "no-store",
  });

  const payload = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    return NextResponse.json(
      { error: readError(payload) ?? `Backtest aggregate request failed with HTTP ${upstream.status}.` },
      { status: upstream.status },
    );
  }

  const rows = normalizeRows(payload).sort((a, b) => b.sampleSize - a.sampleSize);
  await cacheAggregates(ticker, setupType, dateFrom, dateTo, rows);

  return NextResponse.json({ ticker, rows });
}

function readError(payload: unknown) {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  return record.error || record.message ? String(record.error ?? record.message) : null;
}

function normalizeRows(payload: Record<string, unknown>): BacktestRow[] {
  const sourceRows = Array.isArray(payload.rows) ? payload.rows : Array.isArray(payload.data) ? payload.data : [];
  return sourceRows
    .map((row: Record<string, unknown>) => ({
      strike: Number(row.strike),
      dte: Number(row.dte ?? row.days_to_expiration),
      winRate: Number(row.winRate ?? row.win_rate ?? 0),
      avgReturn: Number(row.avgReturn ?? row.avg_peak_return ?? row.average_peak_return ?? 0),
      sampleSize: Number(row.sampleSize ?? row.sample_size ?? row.n ?? 0),
    }))
    .filter((row: BacktestRow) => Number.isFinite(row.strike) && Number.isFinite(row.dte));
}

async function cacheAggregates(
  ticker: string,
  setupType: string,
  dateFrom: string,
  dateTo: string,
  rows: BacktestRow[],
) {
  if (!rows.length) return;

  try {
    const supabase = getSupabaseAdmin();
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    await supabase.from("backtest_results_cache").upsert(
      rows.map((row) => ({
        ticker,
        setup_type: setupType,
        date_from: dateFrom,
        date_to: dateTo,
        strike: row.strike,
        dte: row.dte,
        win_rate: row.winRate,
        avg_return: row.avgReturn,
        sample_size: row.sampleSize,
        computed_at: new Date().toISOString(),
        expires_at: expiresAt,
      })),
      { onConflict: "ticker,setup_type,date_from,date_to,strike,dte" },
    );
  } catch {
    // Live backtest responses should still render if the optional cache is unavailable.
  }
}
