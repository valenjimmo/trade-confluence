import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.DEBUG !== "1") {
    return NextResponse.json({ enabled: false });
  }

  const apiKey = process.env.BULLFLOW_API_KEY;
  const baseUrl = process.env.BULLFLOW_API_BASE_URL ?? "https://api.bullflow.io/v1";

  if (!apiKey) {
    return NextResponse.json(
      {
        enabled: true,
        error: "BULLFLOW_API_KEY is not available in this runtime.",
      },
      { status: 503 },
    );
  }

  const url = new URL(`${baseUrl}/streaming/alerts`);
  url.searchParams.set("key", apiKey);

  return NextResponse.json({
    enabled: true,
    curl: [
      "curl",
      "-N",
      "-H",
      "'Accept: text/event-stream'",
      `'${url.toString()}'`,
    ].join(" "),
  });
}
