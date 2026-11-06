import { z } from "zod";
import { originOf } from "@/lib/server/http";
import { negotiate } from "@/lib/server/negotiate";
import { verifyOffer } from "@/lib/server/sign";
import type { Offer } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  offer: z.object({ sig: z.string() }).passthrough(),
  lang: z.enum(["ar", "en"]),
  competitor: z.object({ store: z.string().max(120), total: z.number().positive() }).optional(),
});

/** Streams the buyer↔seller agent conversation as NDJSON; ends with a newly signed offer. */
export async function POST(req: Request) {
  let b: z.infer<typeof Body>;
  try {
    b = Body.parse(await req.json());
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const offer = b.offer as unknown as Offer;
  if (!verifyOffer(offer)) {
    return Response.json({ error: "Offer could not be verified", code: "OFFER_TAMPERED_OR_EXPIRED" }, { status: 400 });
  }
  if (offer.trust === "suspicious") {
    return Response.json({ error: "Not negotiating with a suspicious store", code: "SUSPICIOUS" }, { status: 403 });
  }

  const origin = originOf(req);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      try {
        for await (const ev of negotiate({ offer, lang: b.lang, origin, competitor: b.competitor, signal: req.signal })) {
          controller.enqueue(enc.encode(JSON.stringify(ev) + "\n"));
        }
      } catch (e) {
        controller.enqueue(enc.encode(JSON.stringify({ type: "error", message: (e as Error).message }) + "\n"));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
