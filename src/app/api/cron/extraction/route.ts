import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { runExtractionCycle } from "@/lib/jobs/extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * FR-002 trigger. Called hourly by the GitHub Actions workflow; each
 * competitor decides internally whether its crawl_interval_days elapsed,
 * which keeps the endpoint idempotent and cheap to retry.
 *
 * Manual run: curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *   "$APP_URL/api/cron/extraction?force=1"
 */
async function handle(request: Request) {
  // Auth first: an unauthenticated probe must never learn the config state.
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    console.error("[cron:extraction] CRON_SECRET no configurado: se rechazan todas las llamadas");
    return NextResponse.json({ ok: false, error: "Cron no configurado" }, { status: 503 });
  }

  if (!isAuthorizedCron(request, cronSecret)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  // Fail fast, with a generic message, if server secrets are incomplete.
  try {
    getServerEnv();
  } catch (error) {
    console.error("[cron:extraction] configuración incompleta:", (error as Error).message);
    return NextResponse.json(
      { ok: false, error: "Configuración incompleta del servidor" },
      { status: 500 },
    );
  }

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const competitorId = url.searchParams.get("competitorId") ?? undefined;
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

  try {
    const report = await runExtractionCycle({
      force,
      competitorId,
      limit: Number.isFinite(limit) ? limit : undefined,
    });

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
