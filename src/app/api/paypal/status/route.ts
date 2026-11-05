import { paypalConfigured, PAYPAL_API } from "@/lib/server/paypal";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    configured: paypalConfigured(),
    env: PAYPAL_API.includes("sandbox") ? "sandbox" : "live",
    egpPerUsd: Number(process.env.EGP_PER_USD) || 50,
  });
}
