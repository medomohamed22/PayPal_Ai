import { authorizeOrder } from "@/lib/server/paypal";
import { errorResponse } from "@/lib/server/http";

export const runtime = "nodejs";

/** Buyer approved on PayPal → place a hold (authorization). Nothing is charged yet. */
export async function POST(req: Request) {
  try {
    const { orderId } = (await req.json()) as { orderId?: string };
    return Response.json(await authorizeOrder(String(orderId ?? "")));
  } catch (err) {
    return errorResponse(err);
  }
}
