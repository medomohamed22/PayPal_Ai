import { channel3Enabled } from "@/lib/server/channel3";
import { hostedEnabled, hostedLimits } from "@/lib/server/hosted";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public feature flags for the client (no secrets). */
export async function GET() {
  return Response.json({
    hostedAI: hostedEnabled(),
    hostedDailyLimit: hostedEnabled() ? hostedLimits().perVisitor : 0,
    catalog: channel3Enabled(),
  });
}
