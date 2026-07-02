import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const apiKey = process.env.BULLFLOW_API_KEY;
  const baseUrl = process.env.BULLFLOW_API_BASE_URL ?? "https://api.bullflow.io/v1";
  const { searchParams } = new URL(request.url);
  const seconds = Math.min(Math.max(Number(searchParams.get("seconds") ?? 8), 2), 20);

  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        env: { hasBullflowApiKey: false, baseUrl },
        error: "BULLFLOW_API_KEY is not available in this runtime.",
      },
      { status: 503 },
    );
  }

  const upstreamUrl = new URL(`${baseUrl}/streaming/alerts`);
  upstreamUrl.searchParams.set("key", apiKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), seconds * 1000);

  try {
    const response = await fetch(upstreamUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "text/event-stream",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    const sample = await readSseSample(response, seconds);
    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get("content-type"),
      env: {
        hasBullflowApiKey: true,
        keyPrefix: `${apiKey.slice(0, 4)}...`,
        baseUrl,
      },
      seconds,
      ...sample,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      status: 504,
      contentType: null,
      env: {
        hasBullflowApiKey: true,
        keyPrefix: `${apiKey.slice(0, 4)}...`,
        baseUrl,
      },
      seconds,
      error:
        error instanceof Error && error.name === "AbortError"
          ? `No complete SSE sample was received within ${seconds} seconds.`
          : error instanceof Error
            ? error.message
            : "Flow probe failed.",
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readSseSample(response: Response, seconds: number) {
  if (!response.ok || !response.body) {
    return {
      lineCount: 0,
      eventTypes: [],
      dataEvents: 0,
      alertEvents: 0,
      firstDataKeys: [],
      firstAlertKeys: [],
      error: response.ok ? "Response body was empty." : `Bullflow returned HTTP ${response.status}.`,
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + seconds * 1000;
  const eventTypes = new Set<string>();
  let buffer = "";
  let lineCount = 0;
  let dataEvents = 0;
  let alertEvents = 0;
  let firstDataKeys: string[] = [];
  let firstAlertKeys: string[] = [];

  try {
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const result = await Promise.race([
        reader.read(),
        new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) =>
          setTimeout(() => resolve({ done: true, value: undefined }), remaining),
        ),
      ]);

      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line) continue;
        lineCount += 1;

        if (line.startsWith("event: ")) {
          eventTypes.add(line.slice(7).trim());
          continue;
        }

        if (!line.startsWith("data: ")) continue;
        dataEvents += 1;
        const parsed = parseJson(line.slice(6));
        const record = asRecord(parsed);
        if (!firstDataKeys.length) firstDataKeys = Object.keys(record).slice(0, 20);
        if (record.event === "alert" || record.data) {
          alertEvents += record.event === "alert" ? 1 : 0;
          const alert = asRecord(record.data ?? record);
          if (!firstAlertKeys.length) firstAlertKeys = Object.keys(alert).slice(0, 20);
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  return {
    lineCount,
    eventTypes: Array.from(eventTypes),
    dataEvents,
    alertEvents,
    firstDataKeys,
    firstAlertKeys,
    error: null,
  };
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
