import { z } from "zod";
import { runAgent } from "@/lib/server/agent";
import { runDemo } from "@/lib/server/demo";
import { hostedConfig, hostedEnabled, takeHostedQuota } from "@/lib/server/hosted";
import type { AgentEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string().max(20000),
        images: z.array(z.string().max(8_000_000)).max(4).optional(),
      }),
    )
    .min(1)
    .max(60),
  settings: z.object({
    baseUrl: z.string().url(),
    model: z.string().min(1).max(100),
    reasoningEffort: z.enum(["minimal", "low", "medium", "high", "xhigh"]),
    market: z.enum(["EG", "US"]),
    city: z.string().min(1).max(80),
    lang: z.enum(["ar", "en"]),
    demoMode: z.boolean(),
    coords: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).nullish(),
  }),
});

export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const apiKey = req.headers.get("x-model-api-key") ?? "";
  const { settings, history } = body;
  const last = history[history.length - 1];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const emit = (e: AgentEvent) => {
        try {
          controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {
          /* client went away */
        }
      };
      try {
        const useHosted = !settings.demoMode && !apiKey && hostedEnabled();
        if (useHosted) await takeHostedQuota(req);
        if (settings.demoMode || (!apiKey && !useHosted)) {
          if (!settings.demoMode) throw new Error("NO_API_KEY");
          await runDemo({
            text: last.text,
            hasImage: !!last.images?.length,
            market: settings.market,
            city: settings.city,
            lang: settings.lang,
            signal: req.signal,
            emit,
          });
        } else {
          await runAgent({
            cfg: useHosted
              ? hostedConfig(settings.reasoningEffort)
              : {
                  baseUrl: settings.baseUrl,
                  apiKey,
                  model: settings.model,
                  reasoningEffort: settings.reasoningEffort,
                },
            history,
            market: settings.market,
            city: settings.city,
            coords: settings.coords ?? undefined,
            lang: settings.lang,
            signal: req.signal,
            emit,
          });
        }
      } catch (err) {
        emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        emit({ type: "done" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
