import { z } from "zod";
import { refundCapture } from "@/lib/server/paypal";
import { errorResponse } from "@/lib/server/http";

export const runtime = "nodejs";

const Body = z.object({
  captureId: z.string(),
  reason: z.enum(["not_received", "damaged", "not_as_described"]),
});

const NOTE: Record<z.infer<typeof Body>["reason"], string> = {
  not_received: "Refund from Dalil: item not received.",
  damaged: "Refund from Dalil: item arrived damaged.",
  not_as_described: "Refund from Dalil: item not as described.",
};

/** Order problem → refund the captured payment through PayPal. */
export async function POST(req: Request) {
  try {
    const b = Body.parse(await req.json());
    return Response.json(await refundCapture(b.captureId, NOTE[b.reason]));
  } catch (err) {
    if (err instanceof z.ZodError) return Response.json({ error: "Invalid request" }, { status: 400 });
    return errorResponse(err);
  }
}
