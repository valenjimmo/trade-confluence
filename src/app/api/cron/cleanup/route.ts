import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");

  if (secret && header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();
    const backtests = await supabase.from("backtest_results_cache").delete().lt("expires_at", now);
    const flow = await supabase.from("flow_cache").delete().lt("expires_at", now);

    if (backtests.error) throw backtests.error;
    if (flow.error) throw flow.error;

    return NextResponse.json({ ok: true, purgedAt: now });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cleanup failed." },
      { status: 500 },
    );
  }
}
