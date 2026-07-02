export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type NormalizedAlert = {
  id: string;
  receivedAt: string;
  ticker: string;
  optionSymbol: string;
  side: "CALL" | "PUT" | "UNKNOWN";
  sentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
  strike: number | null;
  expiration: string;
  dte: number | null;
  premium: number | null;
  price: number | null;
  size: number | null;
  alertType: string;
};

export async function GET(request: Request) {
  const apiKey = process.env.BULLFLOW_API_KEY;
  const baseUrl = process.env.BULLFLOW_API_BASE_URL ?? "https://api.bullflow.io/v1";
  const { searchParams } = new URL(request.url);
  const tickers = new Set(
    (searchParams.get("tickers") ?? "")
      .split(",")
      .map((ticker) => ticker.trim().toUpperCase())
      .filter(Boolean),
  );

  if (!apiKey) {
    return sseResponse((controller) => {
      sendEvent(controller, "status", {
        message: "BULLFLOW_API_KEY is not configured. Add it server-side before connecting the flow stream.",
      });
      controller.close();
    });
  }

  const upstreamUrl = new URL(`${baseUrl}/streaming/alerts`);
  upstreamUrl.searchParams.set("key", apiKey);

  const upstream = await fetch(upstreamUrl, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "text/event-stream",
    },
    cache: "no-store",
  });

  if (!upstream.ok || !upstream.body) {
    return sseResponse((controller) => {
      sendEvent(controller, "status", {
        message: `Bullflow alerts stream failed with HTTP ${upstream.status}.`,
      });
      controller.close();
    });
  }

  return sseResponse(async (controller) => {
    const reader = upstream.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      sendEvent(controller, "status", { message: "Connected to Bullflow alerts stream." });
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const parsed = parseJson(line.slice(6));
          const record = asRecord(parsed);
          if (record.event && record.event !== "alert") continue;

          const alert = normalizeAlert(record.data ?? record);
          if (!alert.ticker) continue;
          if (tickers.size && !tickers.has(alert.ticker)) continue;
          controller.enqueue(`data: ${JSON.stringify(alert)}\n\n`);
        }
      }
    } catch {
      sendEvent(controller, "status", { message: "Bullflow alerts stream ended unexpectedly." });
    } finally {
      reader.releaseLock();
      controller.close();
    }
  });
}

function sseResponse(start: (controller: ReadableStreamDefaultController<string>) => void | Promise<void>) {
  const stream = new ReadableStream<string>({ start });
  return new Response(stream.pipeThrough(new TextEncoderStream()), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

function sendEvent(controller: ReadableStreamDefaultController<string>, event: string, payload: unknown) {
  controller.enqueue(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function normalizeAlert(value: unknown): NormalizedAlert {
  const record = asRecord(value);
  const optionSymbol = String(
    record.optionSymbol ??
      record.option_symbol ??
      record.contract ??
      record.symbol ??
      "",
  );
  const parsedOption = parseOptionSymbol(optionSymbol);
  const ticker = readTicker(record, optionSymbol, parsedOption);
  const side = readSide(record, optionSymbol, parsedOption);
  const premium = readNumber(record.premium ?? record.total_premium ?? record.cost_basis ?? record.value);
  const price = readNumber(record.price ?? record.trade_price ?? record.option_price);
  const size = readNumber(record.size ?? record.volume ?? record.contracts);
  const expiration = String(
    record.expiration ??
      record.expiry ??
      record.expiration_date ??
      parsedOption?.expiration ??
      "",
  );

  return {
    id: String(record.id ?? record.uuid ?? `${ticker}-${optionSymbol}-${record.timestamp ?? Date.now()}`),
    receivedAt: String(record.timestamp ?? record.time ?? record.created_at ?? new Date().toISOString()),
    ticker,
    optionSymbol,
    side,
    sentiment: readSentiment(record, side),
    strike: readNumber(record.strike) ?? parsedOption?.strike ?? null,
    expiration,
    dte: readNumber(record.dte ?? record.days_to_expiration) ?? readDte(expiration),
    premium,
    price,
    size,
    alertType: String(record.alertType ?? record.alert_type ?? record.type ?? "Bullflow alert"),
  };
}

function readTicker(
  record: Record<string, unknown>,
  optionSymbol: string,
  parsedOption: ParsedOption | null,
) {
  const explicitTicker = record.ticker ?? record.underlying ?? record.root;
  if (explicitTicker && !looksLikeOptionSymbol(String(explicitTicker))) {
    return String(explicitTicker).toUpperCase();
  }

  return (parsedOption?.ticker ?? parseUnderlying(optionSymbol) ?? "").toUpperCase();
}

function readSide(
  record: Record<string, unknown>,
  optionSymbol: string,
  parsedOption: ParsedOption | null,
): NormalizedAlert["side"] {
  const value = String(record.side ?? record.option_type ?? record.put_call ?? record.call_put ?? "").toUpperCase();
  if (value.includes("CALL") || value === "C") return "CALL";
  if (value.includes("PUT") || value === "P") return "PUT";
  if (parsedOption?.side) return parsedOption.side;
  if (/C\d{8,}/.test(optionSymbol)) return "CALL";
  if (/P\d{8,}/.test(optionSymbol)) return "PUT";
  return "UNKNOWN";
}

function readSentiment(record: Record<string, unknown>, side: NormalizedAlert["side"]): NormalizedAlert["sentiment"] {
  const value = String(record.sentiment ?? record.bias ?? record.direction ?? "").toUpperCase();
  if (value.includes("BULL")) return "BULLISH";
  if (value.includes("BEAR")) return "BEARISH";
  if (side === "CALL") return "BULLISH";
  if (side === "PUT") return "BEARISH";
  return "NEUTRAL";
}

function parseUnderlying(optionSymbol: string) {
  const normalized = normalizeOptionSymbol(optionSymbol);
  const match = normalized.match(/^([A-Z]{1,6})(?=\d{6}[CP]\d{8})/) ?? normalized.match(/^([A-Z]{1,6})/);
  return match?.[1] ?? null;
}

type ParsedOption = {
  ticker: string;
  expiration: string;
  side: "CALL" | "PUT";
  strike: number;
};

function parseOptionSymbol(optionSymbol: string): ParsedOption | null {
  const normalized = normalizeOptionSymbol(optionSymbol);
  const match = normalized.match(/^([A-Z]{1,6})(\d{6})([CP])(\d{8})$/);
  if (!match) return null;

  const [, ticker, yymmdd, side, strikeText] = match;
  const year = 2000 + Number(yymmdd.slice(0, 2));
  const month = yymmdd.slice(2, 4);
  const day = yymmdd.slice(4, 6);

  return {
    ticker,
    expiration: `${year}-${month}-${day}`,
    side: side === "C" ? "CALL" : "PUT",
    strike: Number(strikeText) / 1000,
  };
}

function normalizeOptionSymbol(optionSymbol: string) {
  return optionSymbol.toUpperCase().replace(/^O:/, "").replace(/\s+/g, "");
}

function looksLikeOptionSymbol(value: string) {
  return Boolean(parseOptionSymbol(value));
}

function readDte(expiration: string) {
  if (!expiration) return null;
  const expiry = new Date(`${expiration}T00:00:00Z`);
  if (Number.isNaN(expiry.getTime())) return null;
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const expiryUtc = Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth(), expiry.getUTCDate());
  return Math.max(0, Math.round((expiryUtc - todayUtc) / 86400000));
}

function readNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
