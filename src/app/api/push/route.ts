import { z } from "zod";
import { pushConfigured, vapidPublicKey } from "@/lib/server/push";
import { setPushSubscription } from "@/lib/server/watches";
import { device, fail } from "@/lib/server/watch-http";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ configured: pushConfigured, publicKey: vapidPublicKey });
}

const Sub = z.object({
  endpoint: z.string().url().startsWith("https://"),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});

export async function PUT(req: Request) {
  try {
    const sub = Sub.parse(await req.json());
    await setPushSubscription(device(req), sub);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) return Response.json({ error: "Invalid subscription" }, { status: 400 });
    return fail(e);
  }
}

export async function DELETE(req: Request) {
  try {
    await setPushSubscription(device(req), null);
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
