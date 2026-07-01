import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

type ImportRow = {
  ticker: string;
  sector?: string;
  latest_score?: number;
  latest_status?: string;
  latest_stage?: string;
  latest_trend?: string;
  latest_price?: number;
};

export async function POST(request: Request) {
  let rows: ImportRow[] = [];

  try {
    const body = await request.json();
    rows = Array.isArray(body.rows) ? body.rows : [];
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const cleaned = rows
    .filter((row) => row.ticker)
    .map((row) => ({
      ticker: row.ticker.toUpperCase(),
      sector: row.sector ?? null,
      latest_score: row.latest_score ?? null,
      latest_status: row.latest_status ?? null,
      latest_stage: row.latest_stage ?? null,
      latest_trend: row.latest_trend ?? null,
      latest_price: row.latest_price ?? null,
      updated_at: new Date().toISOString(),
    }));

  if (!cleaned.length) {
    return NextResponse.json({ upserted: 0 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("tickers_latest").upsert(cleaned, {
      onConflict: "ticker",
    });

    if (error) throw error;
    return NextResponse.json({ upserted: cleaned.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to persist ticker summaries." },
      { status: 500 },
    );
  }
}
