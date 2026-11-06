import { BrowserSession } from "@/lib/server/browser";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Ops check that the real browser launches in this deployment (Bearer CRON_SECRET). */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url).searchParams.get("url") || "https://example.com/";
  const t0 = Date.now();
  const s = new BrowserSession();
  try {
    const st = await s.open(url);
    return Response.json({
      ok: true,
      ms: Date.now() - t0,
      url: st.url,
      status: st.status,
      title: st.title,
      product: st.product,
      elements: st.elements.length,
      shotBytes: st.shot?.length ?? 0,
    });
  } catch (e) {
    return Response.json({ ok: false, ms: Date.now() - t0, error: (e as Error).message }, { status: 500 });
  } finally {
    await s.close();
  }
}
