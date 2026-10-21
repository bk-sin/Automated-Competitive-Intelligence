import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "../env";
import { getAdminSupabase } from "../supabase/admin";
import { renderWeeklyDigest } from "../email/templates";
import { sendPlainTextEmail } from "../email/resend";
import { getWeekBounds, shouldSendWeeklyDigest } from "../time";
import { logSystemEvent } from "../logging";
import type { AlertPriority, ClientRow, Finding } from "../types";

export type DigestOutcome = "sent" | "skipped" | "failed" | "already_sent";

export type DigestDetail = {
  clientId: string;
  companyName: string;
  outcome: DigestOutcome;
  findings?: number;
  note?: string;
};

export type DigestReport = {
  startedAt: string;
  finishedAt: string;
  clientsEvaluated: number;
  sent: number;
  skipped: number;
  failed: number;
  details: DigestDetail[];
};

export type DigestOptions = {
  now?: Date;
  /** Ignore the "Monday 08:00 local" window (manual runs / smoke tests). */
  force?: boolean;
  clientId?: string;
};

type AnalysisWithCompetitor = {
  priority: AlertPriority;
  has_meaningful_change: boolean;
  headline: string;
  precios: string[] | null;
  posicionamiento: string[] | null;
  productos: string[] | null;
  created_at: string;
  competitor_id: string;
  competitors: { name: string; url: string } | { name: string; url: string }[] | null;
};

/**
 * FR-005 / AC-001: every Monday at 08:00 in the client's timezone, compile
 * the week's validated findings into a single plain-text page.
 *
 * Runs hourly (GitHub Actions); the local-clock check makes it idempotent,
 * and the UNIQUE(client_id, week_start) constraint prevents double sends.
 */
export async function runWeeklyDigestCycle(
  options: DigestOptions = {},
): Promise<DigestReport> {
  const now = options.now ?? new Date();
  const env = getServerEnv();
  const db = getAdminSupabase();

  let query = db
    .from("clients")
    .select(
      "id, user_id, email, company_name, timezone, tracking_goals, status, weekly_digest_enabled, created_at, updated_at",
    )
    .eq("status", "active")
    .eq("weekly_digest_enabled", true);

  if (options.clientId) query = query.eq("id", options.clientId);

  const { data, error } = await query;
  if (error) throw new Error(`No se pudieron cargar los clientes: ${error.message}`);

  const clients = (data ?? []) as unknown as ClientRow[];

  const report: DigestReport = {
    startedAt: now.toISOString(),
    finishedAt: now.toISOString(),
    clientsEvaluated: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    details: [],
  };

  for (const client of clients) {
    report.clientsEvaluated += 1;

    if (!options.force && !shouldSendWeeklyDigest(now, client.timezone)) {
      report.skipped += 1;
      report.details.push({
        clientId: client.id,
        companyName: client.company_name,
        outcome: "skipped",
        note: "fuera de la ventana del lunes 08:00 local",
      });
      continue;
    }

    const detail = await sendDigestForClient({
      db,
      env,
      client,
      now,
      appUrl: env.NEXT_PUBLIC_APP_URL,
    });

    if (detail.outcome === "sent") report.sent += 1;
    else if (detail.outcome === "failed") report.failed += 1;
    else report.skipped += 1;

    report.details.push(detail);
  }

  report.finishedAt = new Date().toISOString();
  return report;
}

type SendDigestArgs = {
  db: SupabaseClient;
  env: ReturnType<typeof getServerEnv>;
  client: ClientRow;
  now: Date;
  appUrl: string;
};

async function sendDigestForClient({
  db,
  env,
  client,
  now,
  appUrl,
}: SendDigestArgs): Promise<DigestDetail> {
  const bounds = getWeekBounds(now, client.timezone);

  const { data: existing } = await db
    .from("digests")
    .select("id, sent_at")
    .eq("client_id", client.id)
    .eq("week_start", bounds.weekStart)
    .maybeSingle();

  if (existing?.sent_at) {
    return {
      clientId: client.id,
      companyName: client.company_name,
      outcome: "already_sent",
      note: bounds.weekStart,
    };
  }

  // The digest covers the current local week up to "now".
  const since = `${bounds.weekStart}T00:00:00.000Z`;
  const { data: analyses, error } = await db
    .from("analyses")
    .select(
      "priority, has_meaningful_change, headline, precios, posicionamiento, productos, created_at, competitor_id, competitors (name, url)",
    )
    .eq("client_id", client.id)
    .eq("has_meaningful_change", true)
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  if (error) {
    await logSystemEvent(db, {
      level: "error",
      source: "weekly_digest",
      message: `No se pudieron leer los hallazgos de ${client.company_name}: ${error.message}`,
    });

    return {
      clientId: client.id,
      companyName: client.company_name,
      outcome: "failed",
      note: error.message.slice(0, 200),
    };
  }

  const findings = (analyses ?? []).map((row) =>
    toFinding(row as unknown as AnalysisWithCompetitor),
  );

  const rendered = renderWeeklyDigest({
    companyName: client.company_name,
    weekLabel: bounds.label,
    timeZone: client.timezone,
    findings,
    generatedAt: now,
    dashboardUrl: `${appUrl}/dashboard`,
  });

  const send = await sendPlainTextEmail(
    { to: client.email, subject: rendered.subject, body: rendered.body },
    { apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM },
  );

  const { error: upsertError } = await db.from("digests").upsert(
    {
      client_id: client.id,
      week_start: bounds.weekStart,
      subject: rendered.subject,
      body: rendered.body,
      sent_at: send.ok ? now.toISOString() : null,
      send_error: send.ok ? null : send.error,
    },
    { onConflict: "client_id,week_start" },
  );

  if (upsertError) {
    await logSystemEvent(db, {
      level: "warning",
      source: "weekly_digest",
      message: `No se pudo registrar el digest de ${client.company_name}: ${upsertError.message}`,
    });
  }

  if (!send.ok) {
    await logSystemEvent(db, {
      level: "error",
      source: "email",
      message: `No se pudo enviar el resumen de ${client.company_name}: ${send.error}`,
    });

    return {
      clientId: client.id,
      companyName: client.company_name,
      outcome: "failed",
      findings: findings.length,
      note: send.error.slice(0, 200),
    };
  }

  return {
    clientId: client.id,
    companyName: client.company_name,
    outcome: "sent",
    findings: findings.length,
  };
}

function toFinding(row: AnalysisWithCompetitor): Finding {
  const competitor = Array.isArray(row.competitors)
    ? (row.competitors[0] ?? null)
    : row.competitors;

  return {
    competitorId: row.competitor_id,
    competitorName: competitor?.name ?? "Competidor",
    competitorUrl: competitor?.url ?? "",
    hasMeaningfulChange: row.has_meaningful_change,
    priority: row.priority,
    headline: row.headline,
    precios: row.precios ?? [],
    posicionamiento: row.posicionamiento ?? [],
    productos: row.productos ?? [],
    detectedAt: new Date(row.created_at),
  };
}
