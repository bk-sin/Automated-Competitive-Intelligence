import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { runWeeklyDigestCycle } from "@/lib/jobs/weekly-digest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * FR-005 trigger. Runs hourly; each client is only served when its local
 * clock reads Monday 08:xx (see shouldSendWeeklyDigest), so timezones are
 * respected without per-client cron entries.
 *
 * Manual run: curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *   "$APP_URL/api/cron/weekly-digest?force=1"
 */
async function handle(request: Request) {
  let env;
  try {
    env = getServerEnv();
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 },
    );
  }

  if (!isAuthorizedCron(request, env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const clientId = url.searchParams.get("clientId") ?? undefined;

  try {
    const report = await runWeeklyDigestCycle({ force, clientId });
    return NextResponse.json({ ok: true, report });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
