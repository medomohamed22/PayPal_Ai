import { createVaultSetupToken } from "@/lib/server/paypal";
import { originOf } from "@/lib/server/http";
import { device, fail } from "@/lib/server/watch-http";

export const runtime = "nodejs";

/** Start "save PayPal for auto-buy" (Vault without purchase). */
export async function POST(req: Request) {
  try {
    device(req);
    const o = originOf(req);
    return Response.json(await createVaultSetupToken(`${o}/paypal/return?flow=vault`, `${o}/paypal/cancel?flow=vault`));
  } catch (e) {
    return fail(e);
  }
}
