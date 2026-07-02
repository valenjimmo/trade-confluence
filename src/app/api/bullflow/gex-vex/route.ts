import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker")?.toUpperCase();

  if (!ticker) {
    return NextResponse.json({ error: "Ticker is required." }, { status: 400 });
  }

  const apiKey = process.env.BULLFLOW_API_KEY;
  const baseUrl = process.env.BULLFLOW_API_BASE_URL ?? "https://api.bullflow.io/v1";

  if (!apiKey) {
    return NextResponse.json(
      { error: "BULLFLOW_API_KEY is not configured. Add it server-side before fetching live GEX/VEX data." },
      { status: 503 },
    );
  }

  const [gexResponse, vexResponse] = await Promise.all([
    fetchBullflow(`${baseUrl}/data/netgex`, ticker, apiKey),
    fetchBullflow(`${baseUrl}/data/netvex`, ticker, apiKey),
  ]);

  if (!gexResponse.ok || !vexResponse.ok) {
    return NextResponse.json(
      { error: gexResponse.error ?? vexResponse.error ?? "Bullflow GEX/VEX request failed." },
      { status: gexResponse.status === 200 ? vexResponse.status : gexResponse.status },
    );
  }

  const rows = mergeExposureRows(gexResponse.payload, vexResponse.payload);

  return NextResponse.json({
    ticker,
    currentPrice:
      readCurrentPrice(gexResponse.payload) ??
      readCurrentPrice(vexResponse.payload) ??
      null,
    rows,
  });
}

async function fetchBullflow(endpoint: string, ticker: string, apiKey: string) {
  const url = new URL(endpoint);
  url.searchParams.set("ticker", ticker);
  url.searchParams.set("symbol", ticker);
  url.searchParams.set("key", apiKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));
    return {
      ok: response.ok,
      status: response.status,
      payload,
      error: readError(payload) ?? (response.ok ? undefined : `Bullflow returned HTTP ${response.status}.`),
    };
  } catch (error) {
    return {
      ok: false,
      status: 504,
      payload: {},
      error:
        error instanceof Error && error.name === "AbortError"
          ? "Bullflow GEX/VEX request timed out after 12 seconds."
          : "Bullflow GEX/VEX request failed before a response was received.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function mergeExposureRows(gexPayload: unknown, vexPayload: unknown) {
  const byStrike = new Map<number, { strike: number; netGex: number; netVex: number }>();

  for (const row of readRows(gexPayload)) {
    const strike = Number(row.strike);
    if (!Number.isFinite(strike)) continue;
    byStrike.set(strike, {
      strike,
      netGex: Number(row.netGex ?? row.net_gex ?? row.gex ?? row.net ?? 0),
      netVex: byStrike.get(strike)?.netVex ?? 0,
    });
  }

  for (const row of readRows(vexPayload)) {
    const strike = Number(row.strike);
    if (!Number.isFinite(strike)) continue;
    byStrike.set(strike, {
      strike,
      netGex: byStrike.get(strike)?.netGex ?? 0,
      netVex: Number(row.netVex ?? row.net_vex ?? row.vex ?? row.net ?? 0),
    });
  }

  return Array.from(byStrike.values()).sort((a, b) => a.strike - b.strike);
}

function readRows(payload: unknown): Record<string, unknown>[] {
  const record = asRecord(payload);
  const rows = record.rows ?? record.data ?? record.results;
  return Array.isArray(rows) ? rows.map(asRecord) : [];
}

function readCurrentPrice(payload: unknown) {
  const record = asRecord(payload);
  const price = Number(record.currentPrice ?? record.current_price ?? record.price);
  return Number.isFinite(price) ? price : null;
}

function readError(payload: unknown) {
  const record = asRecord(payload);
  return record.error || record.message ? String(record.error ?? record.message) : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
