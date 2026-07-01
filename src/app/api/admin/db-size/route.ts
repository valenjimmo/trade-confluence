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
    const { data, error } = await supabase.rpc("database_size_bytes");
    if (error) throw error;

    const bytes = Number(data ?? 0);
    return NextResponse.json({
      bytes,
      megabytes: Math.round((bytes / 1024 / 1024) * 100) / 100,
      freeTierCapMb: 500,
      pctOfCap: Math.round((bytes / 1024 / 1024 / 500) * 10000) / 100,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to read database size." },
      { status: 500 },
    );
  }
}
