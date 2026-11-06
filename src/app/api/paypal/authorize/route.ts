import { authorizeOrder } from "@/lib/server/paypal";
import { errorResponse } from "@/lib/server/http";
import { holdToken } from "@/lib/server/sign";

export const runtime = "nodejs";

/** Buyer approved on PayPal → place a hold (authorization). Nothing is charged yet. */
export async function POST(req: Request) {
  try {
    const { orderId } = (await req.json()) as { orderId?: string };
    const a = await authorizeOrder(String(orderId ?? ""));
    // The token proves this browser placed the hold — required to capture or void it.
    return Response.json({ ...a, holdToken: holdToken(a.authorizationId, a.orderId) });
  } catch (err) {
    return errorResponse(err);
  }
}
