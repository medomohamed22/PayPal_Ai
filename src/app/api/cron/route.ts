import { runAll } from "@/lib/server/watches";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Checks every price watch. Vercel Cron (daily on Hobby) calls this with
 * `Authorization: Bearer $CRON_SECRET`; for faster checks, point a free external
 * cron (e.g. cron-job.org, every 10–15 min) at this URL with the same header.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET not set" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const result = await runAll();
  return Response.json({ ...result, ms: Date.now() - started });
}
