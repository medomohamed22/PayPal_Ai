import { z } from "zod";
import { deleteWatch, watchAction } from "@/lib/server/watches";
import { device, fail } from "@/lib/server/watch-http";

export const runtime = "nodejs";

const Body = z.object({
  action: z.enum(["simulate", "check", "cancel", "capture", "reactivate", "purchased"]),
  price: z.number().positive().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const b = Body.parse(await req.json());
    return Response.json({ watch: await watchAction(device(req), id, b.action, { price: b.price }) });
  } catch (e) {
    if (e instanceof z.ZodError) return Response.json({ error: "Invalid request" }, { status: 400 });
    return fail(e);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await deleteWatch(device(req), id);
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
