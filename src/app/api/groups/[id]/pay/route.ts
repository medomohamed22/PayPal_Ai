import { payShare } from "@/lib/server/groups";
import { deviceOf, groupFail } from "@/lib/server/group-http";
import { originOf } from "@/lib/server/http";

export const runtime = "nodejs";

/** A participant starts paying their share (PayPal order for that share). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { name } = (await req.json().catch(() => ({}))) as { name?: string };
    return Response.json(await payShare(id, deviceOf(req), String(name ?? ""), originOf(req)));
  } catch (e) {
    return groupFail(e);
  }
}
