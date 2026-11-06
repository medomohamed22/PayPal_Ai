import { voidAuthorization } from "@/lib/server/paypal";
import { errorResponse } from "@/lib/server/http";
import { checkHoldToken } from "@/lib/server/sign";

export const runtime = "nodejs";

/** One-tap cancel: void the authorization so the hold is released. */
export async function POST(req: Request) {
  try {
    const { authorizationId, holdToken } = (await req.json()) as { authorizationId?: string; holdToken?: string };
    const id = String(authorizationId ?? "");
    checkHoldToken(holdToken, id);
    return Response.json(await voidAuthorization(id));
  } catch (err) {
    return errorResponse(err);
  }
}
