import { addTracking } from "@/lib/server/paypal";
import { errorResponse } from "@/lib/server/http";

export const runtime = "nodejs";

/**
 * Hackathon sandbox: Dalil acts as the merchant of record, so it "ships" the order
 * and registers tracking on the PayPal order (Orders v2 /track).
 */
export async function POST(req: Request) {
  try {
    const { orderId, captureId, store } = (await req.json()) as { orderId?: string; captureId?: string; store?: string };
    return Response.json(await addTracking(String(orderId ?? ""), String(captureId ?? ""), `${store ?? "Dalil"} Delivery`));
  } catch (err) {
    return errorResponse(err);
  }
}
