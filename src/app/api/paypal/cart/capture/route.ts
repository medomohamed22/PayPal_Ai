import { captureCartOrder } from "@/lib/server/paypal";
import { errorResponse } from "@/lib/server/http";
import { captureToken, checkOrderToken } from "@/lib/server/sign";
import { rateLimit } from "@/lib/server/ratelimit";

export const runtime = "nodejs";

/**
 * Multi-store cart approved on PayPal → capture every store's part. Only the
 * browser that created the cart order (order token) can do this; each store's
 * capture gets its own token so it can be refunded on its own.
 */
export async function POST(req: Request) {
  const limited = await rateLimit(req, "authorize", 30, 600);
  if (limited) return limited;
  try {
    const { orderId, orderToken } = (await req.json()) as { orderId?: string; orderToken?: string };
    const id = String(orderId ?? "");
    checkOrderToken(orderToken, id);
    const c = await captureCartOrder(id);
    return Response.json({ ...c, units: c.units.map((u) => ({ ...u, captureToken: captureToken(u.captureId, c.orderId) })) });
  } catch (err) {
    return errorResponse(err);
  }
}
