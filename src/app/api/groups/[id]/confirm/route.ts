import { confirmShare } from "@/lib/server/groups";
import { deviceOf, groupFail } from "@/lib/server/group-http";

export const runtime = "nodejs";
export const maxDuration = 60;

/** After PayPal approval: hold the share; captures everyone once the last share is held. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { orderId } = (await req.json().catch(() => ({}))) as { orderId?: string };
    return Response.json({ group: await confirmShare(id, String(orderId ?? ""), deviceOf(req)) });
  } catch (e) {
    return groupFail(e);
  }
}
