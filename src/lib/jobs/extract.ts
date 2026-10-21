import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv, type ServerEnv } from "../env";
import { getAdminSupabase } from "../supabase/admin";
import { FirecrawlError, scrapeUrl } from "../firecrawl";
import {
  buildDiffContext,
  diffContent,
  hashLines,
  normalizeLines,
} from "../diff";
import { analyzeDiff } from "../llm";
import { renderHighPriorityAlert } from "../email/templates";
import { renderExtractionFailure } from "../email/admin-templates";
import { sendPlainTextEmail } from "../email/resend";
import { isCrawlDue } from "../time";
import { logSystemEvent } from "../logging";
import type { AnalysisResult, ClientRow, CompetitorRow } from "../types";

export type ExtractionOutcome =
  | "baseline"
  | "unchanged"
  | "changed"
  | "analysis_failed"
  | "failed"
  | "skipped";

export type ExtractionDetail = {
  competitorId: string;
  competitorName: string;
  outcome: ExtractionOutcome;
  priority?: string;
  alertSent?: boolean;
  note?: string;
};

export type ExtractionReport = {
  startedAt: string;
  finishedAt: string;
  competitorsEvaluated: number;
  extracted: number;
  unchanged: number;
  changed: number;
  alertsSent: number;
  failures: number;
  analysisFailures: number;
  skipped: number;
  details: ExtractionDetail[];
};

type CompetitorWithClient = CompetitorRow & {
  clients: ClientRow | ClientRow[] | null;
};

export type ExtractionOptions = {
  now?: Date;
  competitorId?: string;
  /** Ignore crawl_interval_days (manual smoke test). */
  force?: boolean;
  limit?: number;
};

/**
 * FR-002/003/004: scrapes every due competitor, hashes the visible content,
 * diffs against the last successful snapshot and asks the LLM whether the
 * change is noise, a weekly finding, or an immediate alert.
 */
export async function runExtractionCycle(
  options: ExtractionOptions = {},
): Promise<ExtractionReport> {
  const now = options.now ?? new Date();
  const env = getServerEnv();
  const db = getAdminSupabase();

  let query = db
    .from("competitors")
    .select(
      `id, client_id, name, url, is_active, crawl_interval_days, last_crawled_at, created_at,
       clients (id, user_id, email, company_name, timezone, tracking_goals, status, weekly_digest_enabled)`,
    )
    .eq("is_active", true);

  if (options.competitorId) query = query.eq("id", options.competitorId);

  const { data, error } = await query;
  if (error) {
    throw new Error(`No se pudieron cargar los competidores: ${error.message}`);
  }

  const competitors = (data ?? []) as unknown as CompetitorWithClient[];
  const due = competitors.filter(
    (competitor) =>
      options.force ||
      Boolean(options.competitorId) ||
      isCrawlDue(competitor.last_crawled_at, competitor.crawl_interval_days, now),
  );

  const report: ExtractionReport = {
    startedAt: now.toISOString(),
    finishedAt: now.toISOString(),
    competitorsEvaluated: 0,
    extracted: 0,
    unchanged: 0,
    changed: 0,
    alertsSent: 0,
    failures: 0,
    analysisFailures: 0,
    skipped: 0,
    details: [],
  };

  const queue = options.limit ? due.slice(0, options.limit) : due;

  for (const competitor of queue) {
    const client = pickClient(competitor);
    report.competitorsEvaluated += 1;

    if (!client || client.status === "paused") {
      report.skipped += 1;
      report.details.push({
        competitorId: competitor.id,
        competitorName: competitor.name,
        outcome: "skipped",
        note: client ? "cliente pausado" : "cliente no encontrado",
      });
      continue;
    }

    // A competitor that just failed is not retried on every hourly tick.
    if (!options.force && !options.competitorId && (await hasRecentFailure(db, competitor.id, now))) {
      report.skipped += 1;
      report.details.push({
        competitorId: competitor.id,
        competitorName: competitor.name,
        outcome: "skipped",
        note: "fallo reciente, reintento diferido",
      });
      continue;
    }

    const detail = await processCompetitor({ db, env, competitor, client, now });

    switch (detail.outcome) {
      case "baseline":
        report.extracted += 1;
        break;
      case "unchanged":
        report.unchanged += 1;
        break;
      case "changed":
        report.extracted += 1;
        report.changed += 1;
        break;
      case "analysis_failed":
        report.extracted += 1;
        report.analysisFailures += 1;
        break;
      case "failed":
        report.failures += 1;
        break;
      default:
        report.skipped += 1;
    }

    if (detail.alertSent) report.alertsSent += 1;
    report.details.push(detail);
  }

  report.finishedAt = new Date().toISOString();
  return report;
}

function pickClient(competitor: CompetitorWithClient): ClientRow | null {
  if (!competitor.clients) return null;
  return Array.isArray(competitor.clients)
    ? (competitor.clients[0] ?? null)
    : competitor.clients;
}

type ProcessArgs = {
  db: SupabaseClient;
  env: ServerEnv;
  competitor: CompetitorWithClient;
  client: ClientRow;
  now: Date;
};

async function processCompetitor({
  db,
  env,
  competitor,
  client,
  now,
}: ProcessArgs): Promise<ExtractionDetail> {
  let scraped;
  try {
    scraped = await scrapeUrl(competitor.url, { apiKey: env.FIRECRAWL_API_KEY });
  } catch (error) {
    return recordExtractionFailure({ db, env, competitor, client, error, now });
  }

  const contentHash = hashLines(normalizeLines(scraped.markdown));
  const previous = await getPreviousSnapshot(db, competitor.id);

  // First successful crawl: store the baseline, nothing to compare yet.
  if (!previous) {
    await db.from("extractions").insert({
      competitor_id: competitor.id,
      status: "success",
      markdown: scraped.markdown,
      content_hash: contentHash,
      http_status: scraped.httpStatus,
      duration_ms: scraped.durationMs,
    });
    await touchCompetitor(db, competitor.id, now);
    await logSystemEvent(db, {
      level: "info",
      source: "extraction",
      message: `Línea base registrada para ${competitor.name}`,
      context: { url: competitor.url, lines: normalizeLines(scraped.markdown).length },
      competitorId: competitor.id,
    });

    return {
      competitorId: competitor.id,
      competitorName: competitor.name,
      outcome: "baseline",
      note: "primera extracción, sin comparación",
    };
  }

  if (previous.content_hash === contentHash) {
    await db.from("extractions").insert({
      competitor_id: competitor.id,
      status: "unchanged",
      content_hash: contentHash,
      http_status: scraped.httpStatus,
      duration_ms: scraped.durationMs,
    });
    await touchCompetitor(db, competitor.id, now);

    return {
      competitorId: competitor.id,
      competitorName: competitor.name,
      outcome: "unchanged",
    };
  }

  const diff = diffContent(previous.markdown, scraped.markdown);
  const context = buildDiffContext(diff);

  if (!diff.changed || context.totalChanges === 0) {
    await db.from("extractions").insert({
      competitor_id: competitor.id,
      status: "unchanged",
      content_hash: contentHash,
      http_status: scraped.httpStatus,
      duration_ms: scraped.durationMs,
    });
    await touchCompetitor(db, competitor.id, now);

    return {
      competitorId: competitor.id,
      competitorName: competitor.name,
      outcome: "unchanged",
      note: "solo cambios de formato o ruido de navegación",
    };
  }

  const extractionId = await persistExtraction(db, {
    competitor_id: competitor.id,
    status: "success",
    markdown: scraped.markdown,
    content_hash: contentHash,
    http_status: scraped.httpStatus,
    duration_ms: scraped.durationMs,
  });

  if (!extractionId) {
    return {
      competitorId: competitor.id,
      competitorName: competitor.name,
      outcome: "analysis_failed",
      note: "no se pudo guardar la extracción",
    };
  }

  let analysisResponse;
  try {
    analysisResponse = await analyzeDiff(
      {
        competitorName: competitor.name,
        competitorUrl: competitor.url,
        clientGoals: client.tracking_goals,
        diffText: context.text,
        priceChanges: context.priceChanges,
        totalChanges: context.totalChanges,
        truncated: context.truncated,
      },
      {
        apiKey: env.LLM_API_KEY,
        baseUrl: env.LLM_BASE_URL,
        model: env.LLM_MODEL,
      },
    );
  } catch (error) {
    const message = (error as Error).message;
    await logSystemEvent(db, {
      level: "error",
      source: "llm",
      message: `Fallo de análisis en ${competitor.name}: ${message}`,
      context: { url: competitor.url, totalChanges: context.totalChanges },
      competitorId: competitor.id,
    });
    await touchCompetitor(db, competitor.id, now);

    return {
      competitorId: competitor.id,
      competitorName: competitor.name,
      outcome: "analysis_failed",
      note: message.slice(0, 200),
    };
  }

  const { analysis } = analysisResponse;

  const { data: analysisRow, error: analysisError } = await db
    .from("analyses")
    .insert({
      extraction_id: extractionId,
      competitor_id: competitor.id,
      client_id: client.id,
      priority: analysis.priority,
      has_meaningful_change: analysis.hasMeaningfulChange,
      headline: analysis.headline,
      precios: analysis.precios,
      posicionamiento: analysis.posicionamiento,
      productos: analysis.productos,
      reasoning: analysis.reasoning ?? null,
      model: analysisResponse.model,
      tokens_used: analysisResponse.tokensUsed,
    })
    .select("id")
    .single();

  if (analysisError) {
    await logSystemEvent(db, {
      level: "error",
      source: "analysis_persist",
      message: `No se pudo guardar el análisis de ${competitor.name}: ${analysisError.message}`,
      competitorId: competitor.id,
    });
  }

  let alertSent = false;
  if (analysis.priority === "ALTA_PRIORIDAD" && analysis.hasMeaningfulChange) {
    alertSent = await sendAlert({
      db,
      env,
      competitor,
      client,
      now,
      analysis,
      analysisId: (analysisRow as { id: string } | null)?.id ?? null,
    });
  }

  await touchCompetitor(db, competitor.id, now);

  return {
    competitorId: competitor.id,
    competitorName: competitor.name,
    outcome: "changed",
    priority: analysis.priority,
    alertSent,
    note: `${context.priceChanges} cambios de precio de ${context.totalChanges} líneas`,
  };
}

type PreviousSnapshot = {
  id: string;
  markdown: string;
  content_hash: string | null;
};

const FAILURE_BACKOFF_HOURS = 6;
const ADMIN_ALERT_WINDOW_HOURS = 24;

/** Prevents an anti-bot block from burning Firecrawl credits every hour. */
async function hasRecentFailure(
  db: SupabaseClient,
  competitorId: string,
  now: Date,
  hours: number = FAILURE_BACKOFF_HOURS,
): Promise<boolean> {
  const since = new Date(now.getTime() - hours * 3_600_000).toISOString();

  const { data } = await db
    .from("extractions")
    .select("id")
    .eq("competitor_id", competitorId)
    .eq("status", "failed")
    .gte("extracted_at", since)
    .limit(1);

  return (data ?? []).length > 0;
}

async function getPreviousSnapshot(
  db: SupabaseClient,
  competitorId: string,
): Promise<PreviousSnapshot | null> {
  const { data, error } = await db
    .from("extractions")
    .select("id, markdown, content_hash")
    .eq("competitor_id", competitorId)
    .eq("status", "success")
    .not("markdown", "is", null)
    .order("extracted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`[extract] no se pudo leer el snapshot previo: ${error.message}`);
    return null;
  }

  const row = data as { id: string; markdown: string | null; content_hash: string | null } | null;
  if (!row?.markdown) return null;

  return {
    id: row.id,
    markdown: row.markdown,
    content_hash: row.content_hash,
  };
}

async function persistExtraction(
  db: SupabaseClient,
  payload: Record<string, unknown>,
): Promise<string | null> {
  const { data, error } = await db
    .from("extractions")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    console.error(`[extract] no se pudo guardar la extracción: ${error.message}`);
    return null;
  }

  return (data as { id: string } | null)?.id ?? null;
}

async function touchCompetitor(
  db: SupabaseClient,
  competitorId: string,
  now: Date,
): Promise<void> {
  const { error } = await db
    .from("competitors")
    .update({ last_crawled_at: now.toISOString() })
    .eq("id", competitorId);

  if (error) {
    console.error(`[extract] no se pudo actualizar last_crawled_at: ${error.message}`);
  }
}

type FailureArgs = {
  db: SupabaseClient;
  env: ServerEnv;
  competitor: CompetitorWithClient;
  client: ClientRow;
  error: unknown;
  now: Date;
};

/** AC-003: log the failure, alert the admin, stay silent for the customer. */
async function recordExtractionFailure({
  db,
  env,
  competitor,
  client,
  error,
  now,
}: FailureArgs): Promise<ExtractionDetail> {
  const httpStatus = error instanceof FirecrawlError ? error.status : null;
  const message = (error as Error)?.message ?? "Error desconocido al extraer";

  // Only one admin email per competitor per day, even while the job retries.
  const alertWindowStart = new Date(
    now.getTime() - ADMIN_ALERT_WINDOW_HOURS * 3_600_000,
  ).toISOString();

  const { data: recentAlerts } = await db
    .from("system_events")
    .select("id")
    .eq("competitor_id", competitor.id)
    .eq("source", "firecrawl")
    .eq("level", "error")
    .gte("created_at", alertWindowStart)
    .limit(1);

  const alreadyAlerted = (recentAlerts ?? []).length > 0;

  await db.from("extractions").insert({
    competitor_id: competitor.id,
    status: "failed",
    error_message: message.slice(0, 1000),
    http_status: httpStatus,
  });

  await logSystemEvent(db, {
    level: "error",
    source: "firecrawl",
    message: `Fallo de extracción en ${competitor.name}: ${message}`,
    context: { url: competitor.url, httpStatus, adminNotified: !alreadyAlerted },
    competitorId: competitor.id,
  });

  if (alreadyAlerted) {
    return {
      competitorId: competitor.id,
      competitorName: competitor.name,
      outcome: "failed",
      note: `${message.slice(0, 150)} (admin ya alertado en las últimas ${ADMIN_ALERT_WINDOW_HOURS} h)`,
    };
  }

  const rendered = renderExtractionFailure({
    competitorName: competitor.name,
    competitorUrl: competitor.url,
    errorMessage: message,
    httpStatus,
    occurredAt: now,
    timeZone: client.timezone,
  });

  const send = await sendPlainTextEmail(
    { to: env.ADMIN_EMAIL, subject: rendered.subject, body: rendered.body },
    { apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM },
  );

  if (!send.ok) {
    await logSystemEvent(db, {
      level: "warning",
      source: "email",
      message: `No se pudo alertar al admin sobre ${competitor.name}: ${send.error}`,
      competitorId: competitor.id,
    });
  }

  return {
    competitorId: competitor.id,
    competitorName: competitor.name,
    outcome: "failed",
    note: message.slice(0, 200),
  };
}

type AlertArgs = {
  db: SupabaseClient;
  env: ServerEnv;
  competitor: CompetitorWithClient;
  client: ClientRow;
  now: Date;
  analysis: AnalysisResult;
  analysisId: string | null;
};

/** FR-004: immediate high-priority plain-text email. */
async function sendAlert({
  db,
  env,
  competitor,
  client,
  now,
  analysis,
  analysisId,
}: AlertArgs): Promise<boolean> {
  const rendered = renderHighPriorityAlert({
    companyName: client.company_name,
    competitorName: competitor.name,
    competitorUrl: competitor.url,
    headline: analysis.headline,
    priority: analysis.priority,
    precios: analysis.precios,
    posicionamiento: analysis.posicionamiento,
    productos: analysis.productos,
    reasoning: analysis.reasoning,
    detectedAt: now,
    timeZone: client.timezone,
  });

  const { data: alertRow } = await db
    .from("alerts")
    .insert({
      client_id: client.id,
      competitor_id: competitor.id,
      analysis_id: analysisId,
      priority: analysis.priority,
      subject: rendered.subject,
      body: rendered.body,
    })
    .select("id")
    .single();

  const send = await sendPlainTextEmail(
    { to: client.email, subject: rendered.subject, body: rendered.body },
    { apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM },
  );

  const alertId = (alertRow as { id: string } | null)?.id;
  if (alertId) {
    await db
      .from("alerts")
      .update({
        sent_at: send.ok ? now.toISOString() : null,
        send_error: send.ok ? null : send.error,
        provider_message_id: send.ok ? send.id : null,
      })
      .eq("id", alertId);
  }

  if (!send.ok) {
    await logSystemEvent(db, {
      level: "error",
      source: "email",
      message: `No se pudo enviar la alerta de ${competitor.name}: ${send.error}`,
      competitorId: competitor.id,
    });
  }

  return send.ok;
}
