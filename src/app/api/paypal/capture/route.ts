import { captureAuthorization } from "@/lib/server/paypal";
import { errorResponse } from "@/lib/server/http";

export const runtime = "nodejs";

/** Cancel window passed (or user confirmed) → capture the held funds. */
export async function POST(req: Request) {
  try {
    const { authorizationId } = (await req.json()) as { authorizationId?: string };
    return Response.json(await captureAuthorization(String(authorizationId ?? "")));
  } catch (err) {
    return errorResponse(err);
  }
}
