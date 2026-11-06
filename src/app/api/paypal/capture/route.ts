import { captureAuthorization } from "@/lib/server/paypal";
import { errorResponse } from "@/lib/server/http";
import { captureToken, checkHoldToken, verifyToken } from "@/lib/server/sign";

export const runtime = "nodejs";

/** Cancel window passed (or user confirmed) → capture the held funds. */
export async function POST(req: Request) {
  try {
    const { authorizationId, holdToken: token } = (await req.json()) as { authorizationId?: string; holdToken?: string };
    const id = String(authorizationId ?? "");
    checkHoldToken(token, id);
    const orderId = verifyToken<{ o: string }>(token)!.o;
    const c = await captureAuthorization(id);
    return Response.json({ ...c, captureToken: captureToken(c.id, orderId) });
  } catch (err) {
    return errorResponse(err);
  }
}
