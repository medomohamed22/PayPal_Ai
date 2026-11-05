import { z } from "zod";
import { createOrder, PayPalError } from "@/lib/server/paypal";
import { verifyOffer } from "@/lib/server/sign";
import { errorResponse, originOf } from "@/lib/server/http";
import type { Offer } from "@/lib/types";

export const runtime = "nodejs";

const Body = z.object({
  offer: z.object({ sig: z.string() }).passthrough(),
  mandate: z.object({ maxSpend: z.number().min(0), verifiedOnly: z.boolean() }),
  vault: z.boolean().optional(),
});

/**
 * Creates an AUTHORIZE-intent order for a signed offer.
 * The spending mandate is enforced here, in code — not left to the model.
 */
export async function POST(req: Request) {
  try {
    const { offer: raw, mandate, vault } = Body.parse(await req.json());
    const offer = raw as unknown as Offer;

    if (!verifyOffer(offer)) {
      throw new PayPalError("This offer could not be verified. Ask Dalil to search again.", 400, "OFFER_TAMPERED_OR_EXPIRED");
    }
    if (offer.trust === "suspicious") {
      throw new PayPalError("Blocked: this store looks suspicious.", 403, "MANDATE_SUSPICIOUS_STORE");
    }
    if (mandate.verifiedOnly && offer.trust !== "verified") {
      throw new PayPalError("Blocked by your mandate: verified stores only.", 403, "MANDATE_UNVERIFIED_STORE");
    }
    if (mandate.maxSpend > 0 && offer.total > mandate.maxSpend) {
      throw new PayPalError(
        `Blocked by your mandate: total ${offer.total} ${offer.currency} is above your limit of ${mandate.maxSpend}.`,
        403,
        "MANDATE_OVER_LIMIT",
      );
    }

    const origin = originOf(req);
    const order = await createOrder({
      referenceId: offer.id,
      title: offer.title,
      store: offer.store,
      url: offer.url,
      imageUrl: offer.image,
      price: offer.price,
      shipping: offer.shipping ?? 0,
      currency: offer.currency,
      returnUrl: `${origin}/paypal/return`,
      cancelUrl: `${origin}/paypal/cancel`,
      vault,
    });
    return Response.json(order);
  } catch (err) {
    if (err instanceof z.ZodError) return Response.json({ error: "Invalid request" }, { status: 400 });
    return errorResponse(err);
  }
}
