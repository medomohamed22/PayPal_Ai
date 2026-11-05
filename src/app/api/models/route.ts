import { listModels } from "@/lib/server/meta";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const apiKey = req.headers.get("x-model-api-key") ?? "";
  const { baseUrl } = (await req.json().catch(() => ({}))) as { baseUrl?: string };
  if (!apiKey || !baseUrl) return Response.json({ error: "Missing API key or base URL" }, { status: 400 });
  try {
    const models = await listModels({ baseUrl, apiKey });
    return Response.json({ models });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
