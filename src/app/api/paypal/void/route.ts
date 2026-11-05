import { voidAuthorization } from "@/lib/server/paypal";
import { errorResponse } from "@/lib/server/http";

export const runtime = "nodejs";

/** One-tap cancel: void the authorization so the hold is released. */
export async function POST(req: Request) {
  try {
    const { authorizationId } = (await req.json()) as { authorizationId?: string };
    return Response.json(await voidAuthorization(String(authorizationId ?? "")));
  } catch (err) {
    return errorResponse(err);
  }
}
