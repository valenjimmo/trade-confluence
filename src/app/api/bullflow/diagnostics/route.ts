import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type ProbeResult = {
  endpoint: string;
  ok: boolean;
  status: number;
  param?: string;
  topLevelKeys: string[];
  discoveredStrikeRows: number;
  sampleRowKeys: string[];
  error: string | null;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get("ticker") ?? "SPY").toUpperCase();
  const apiKey = process.env.BULLFLOW_API_KEY;
  const baseUrl = process.env.BULLFLOW_API_BASE_URL ?? "https://api.bullflow.io/v1";

  if (!apiKey) {
    return NextResponse.json({
      ticker,
      env: {
        hasBullflowApiKey: false,
        baseUrl,
      },
      error: "BULLFLOW_API_KEY is not available in this runtime.",
    }, { status: 503 });
  }

  const [netgex, netvex, alerts] = await Promise.all([
    probeDataEndpoint(`${baseUrl}/data/netgex`, ticker, apiKey),
    probeDataEndpoint(`${baseUrl}/data/netvex`, ticker, apiKey),
    probeStreamEndpoint(`${baseUrl}/streaming/alerts`, apiKey),
  ]);

  return NextResponse.json({
    ticker,
    env: {
      hasBullflowApiKey: true,
      keyPrefix: `${apiKey.slice(0, 4)}...`,
      baseUrl,
    },
    netgex,
    netvex,
    alerts,
  });
}

async function probeDataEndpoint(endpoint: string, ticker: string, apiKey: string): Promise<ProbeResult> {
  const params = ["ticker", "symbol", "underlying"];
  let last: ProbeResult | null = null;

  for (const param of params) {
    const url = new URL(endpoint);
    url.searchParams.set(param, ticker);
    url.searchParams.set("key", apiKey);
    const result = await fetchJsonProbe(url, endpoint, param, apiKey);
    if (result.ok && result.discoveredStrikeRows > 0) return result;
    last = result;
  }

  return last ?? emptyProbe(endpoint);
}

async function fetchJsonProbe(url: URL, endpoint: string, param: string, apiKey: string): Promise<ProbeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

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
    const rows = readRows(payload);

    return {
      endpoint,
      ok: response.ok,
      status: response.status,
      param,
      topLevelKeys: Object.keys(asRecord(payload)).slice(0, 20),
      discoveredStrikeRows: rows.length,
      sampleRowKeys: rows[0] ? Object.keys(rows[0]).slice(0, 20) : [],
      error: readError(payload) ?? null,
    };
  } catch (error) {
    return {
      endpoint,
      ok: false,
      status: 504,
      param,
      topLevelKeys: [],
      discoveredStrikeRows: 0,
      sampleRowKeys: [],
      error: error instanceof Error ? error.message : "Request failed.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function probeStreamEndpoint(endpoint: string, apiKey: string) {
  const url = new URL(endpoint);
  url.searchParams.set("key", apiKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "text/event-stream",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    response.body?.cancel().catch(() => {});
    return {
      endpoint,
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get("content-type"),
      error: response.ok ? null : `Bullflow stream returned HTTP ${response.status}.`,
    };
  } catch (error) {
    return {
      endpoint,
      ok: false,
      status: 504,
      contentType: null,
      error: error instanceof Error ? error.message : "Request failed.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function emptyProbe(endpoint: string): ProbeResult {
  return {
    endpoint,
    ok: false,
    status: 500,
    topLevelKeys: [],
    discoveredStrikeRows: 0,
    sampleRowKeys: [],
    error: "No probe result.",
  };
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

  if (Number.isFinite(readNumber(record.strike ?? record.strike_price ?? record.strikePrice))) {
    rows.push(record);
  }

  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") collectStrikeRows(nested, rows);
  }
}

function readError(payload: unknown) {
  const record = asRecord(payload);
  return record.error || record.message ? String(record.error ?? record.message) : null;
}

function readNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
