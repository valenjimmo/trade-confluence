import { NextResponse } from "next/server";

type BullflowResult = {
  ok: boolean;
  status: number;
  payload: unknown;
  error?: string;
};

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

  if (!rows.length) {
    return NextResponse.json({
      ticker,
      currentPrice:
        readCurrentPrice(gexResponse.payload) ??
        readCurrentPrice(vexResponse.payload) ??
        null,
      rows,
      diagnostics: {
        netgexTopLevelKeys: Object.keys(asRecord(gexResponse.payload)).slice(0, 12),
        netvexTopLevelKeys: Object.keys(asRecord(vexResponse.payload)).slice(0, 12),
        netgexStrikeRows: readRows(gexResponse.payload).length,
        netvexStrikeRows: readRows(vexResponse.payload).length,
      },
    });
  }

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
  const attempts = [
    { param: "ticker", value: ticker },
    { param: "symbol", value: ticker },
    { param: "underlying", value: ticker },
  ];

  let lastFailure: BullflowResult = {
    ok: false,
    status: 500,
    payload: {},
    error: "Bullflow GEX/VEX request failed.",
  };

  for (const attempt of attempts) {
    const result = await fetchBullflowAttempt(endpoint, apiKey, attempt.param, attempt.value);
    if (result.ok) return result;
    lastFailure = result;
  }

  return lastFailure;
}

async function fetchBullflowAttempt(endpoint: string, apiKey: string, param: string, ticker: string) {
  const url = new URL(endpoint);
  url.searchParams.set(param, ticker);
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
      error: readError(payload) ?? (response.ok ? undefined : `Bullflow returned HTTP ${response.status} using ${param}=...`),
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
    const strike = readStrike(row);
    if (!Number.isFinite(strike)) continue;
    const existing = byStrike.get(strike);
    byStrike.set(strike, {
      strike,
      netGex: (existing?.netGex ?? 0) + readExposure(row, "gex"),
      netVex: existing?.netVex ?? 0,
    });
  }

  for (const row of readRows(vexPayload)) {
    const strike = readStrike(row);
    if (!Number.isFinite(strike)) continue;
    const existing = byStrike.get(strike);
    byStrike.set(strike, {
      strike,
      netGex: existing?.netGex ?? 0,
      netVex: (existing?.netVex ?? 0) + readExposure(row, "vex"),
    });
  }

  return Array.from(byStrike.values()).sort((a, b) => a.strike - b.strike);
}

function readRows(payload: unknown): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  collectStrikeRows(payload, rows);
  return rows;
}

function collectStrikeRows(value: unknown, rows: Record<string, unknown>[]) {
  if (Array.isArray(value)) {
    for (const item of value) collectStrikeRows(item, rows);
    return;
  }

  const record = asRecord(value);
  if (!Object.keys(record).length) return;

  if (Number.isFinite(readStrike(record))) {
    rows.push(record);
  }

  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") collectStrikeRows(nested, rows);
  }
}

function readStrike(row: Record<string, unknown>) {
  return readNumber(row.strike ?? row.strike_price ?? row.strikePrice);
}

function readExposure(row: Record<string, unknown>, metric: "gex" | "vex") {
  const keys =
    metric === "gex"
      ? ["netGex", "net_gex", "netGammaExposure", "net_gamma_exposure", "gex", "gamma_exposure", "net"]
      : ["netVex", "net_vex", "netVannaExposure", "net_vanna_exposure", "vex", "vanna_exposure", "net"];

  for (const key of keys) {
    const value = readNumber(row[key]);
    if (Number.isFinite(value)) return value;
  }

  const call = readNumber(row.call ?? row.call_gex ?? row.callGex ?? row.call_vex ?? row.callVex);
  const put = readNumber(row.put ?? row.put_gex ?? row.putGex ?? row.put_vex ?? row.putVex);
  if (Number.isFinite(call) || Number.isFinite(put)) return (call || 0) + (put || 0);

  return 0;
}

function readNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
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
