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
  const ticker = String(
    record.ticker ??
      record.underlying ??
      record.root ??
      parseUnderlying(optionSymbol) ??
      "",
  ).toUpperCase();
  const side = readSide(record, optionSymbol);
  const premium = readNumber(record.premium ?? record.total_premium ?? record.cost_basis ?? record.value);
  const price = readNumber(record.price ?? record.trade_price ?? record.option_price);
  const size = readNumber(record.size ?? record.volume ?? record.contracts);

  return {
    id: String(record.id ?? record.uuid ?? `${ticker}-${optionSymbol}-${record.timestamp ?? Date.now()}`),
    receivedAt: String(record.timestamp ?? record.time ?? record.created_at ?? new Date().toISOString()),
    ticker,
    optionSymbol,
    side,
    sentiment: readSentiment(record, side),
    strike: readNumber(record.strike),
    expiration: String(record.expiration ?? record.expiry ?? record.expiration_date ?? ""),
    dte: readNumber(record.dte ?? record.days_to_expiration),
    premium,
    price,
    size,
    alertType: String(record.alertType ?? record.alert_type ?? record.type ?? "Bullflow alert"),
  };
}

function readSide(record: Record<string, unknown>, optionSymbol: string): NormalizedAlert["side"] {
  const value = String(record.side ?? record.option_type ?? record.put_call ?? record.call_put ?? "").toUpperCase();
  if (value.includes("CALL") || value === "C") return "CALL";
  if (value.includes("PUT") || value === "P") return "PUT";
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
  const match = optionSymbol.match(/^([A-Z]{1,6})/);
  return match?.[1] ?? null;
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
