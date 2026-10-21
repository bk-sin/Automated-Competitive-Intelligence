import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ConfigNotice } from "@/components/config-notice";
import { isPublicEnvConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AlertPriority, AnalysisRow, ClientRow, CompetitorRow } from "@/lib/types";

export const metadata: Metadata = {
  title: "Panel — Radar Competitivo",
};

export const dynamic = "force-dynamic";

type WithCompetitor = {
  competitors: { name: string } | { name: string }[] | null;
};

const PRIORITY_LABEL: Record<AlertPriority, string> = {
  ALTA_PRIORIDAD: "Alta",
  MEDIA: "Media",
  BAJA: "Baja",
};

const PRIORITY_CLASS: Record<AlertPriority, string> = {
  ALTA_PRIORIDAD: "badge badge--high",
  MEDIA: "badge badge--medium",
  BAJA: "badge badge--low",
};

function competitorName(row: WithCompetitor): string {
  if (!row.competitors) return "Competidor";
  return Array.isArray(row.competitors)
    ? (row.competitors[0]?.name ?? "Competidor")
    : row.competitors.name;
}

function formatDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function DashboardPage() {
  if (!isPublicEnvConfigured()) {
    return (
      <ConfigNotice
        title="El panel todavía no está conectado"
        description="Falta configurar el proyecto de Supabase en las variables de entorno."
      />
    );
  }

  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: clientData } = await supabase
    .from("clients")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  const client = clientData as ClientRow | null;

  if (!client) {
    return (
      <>
        <section className="page-header">
          <div className="container">
            <h1>Tu cuenta está en configuración</h1>
            <p>
              Ya tenemos tu solicitud. El equipo está cargando tus competidores y te avisamos
              por email cuando el primer relevamiento termine.
            </p>
          </div>
        </section>
        <div className="container" style={{ padding: "32px 24px 80px" }}>
          <Link href="/" className="button button--ghost">
            Volver al inicio
          </Link>
        </div>
      </>
    );
  }

  const [{ data: competitorsData }, { data: analysesData }, { data: alertsData }] =
    await Promise.all([
      supabase
        .from("competitors")
        .select("*")
        .eq("client_id", client.id)
        .order("name", { ascending: true }),
      supabase
        .from("analyses")
        .select("*, competitors (name)")
        .eq("client_id", client.id)
        .eq("has_meaningful_change", true)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("alerts")
        .select("*")
        .eq("client_id", client.id)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

  const competitors = (competitorsData ?? []) as CompetitorRow[];
  const analyses = (analysesData ?? []) as unknown as Array<AnalysisRow & WithCompetitor>;
  const alerts = (alertsData ?? []) as unknown as Array<
    { id: string; subject: string; created_at: string; sent_at: string | null } & WithCompetitor
  >;

  return (
    <>
      <section className="page-header">
        <div className="container">
          <span className="eyebrow">Panel</span>
          <h1>{client.company_name}</h1>
          <p>
            {competitors.length} {competitors.length === 1 ? "competidor" : "competidores"} en
            el radar · resumen los lunes a las 8:00 ({client.timezone}) ·{" "}
            {client.weekly_digest_enabled ? "activo" : "pausado"}
          </p>
          <form action="/auth/signout" method="post" style={{ marginTop: 20 }}>
            <button type="submit" className="button button--ghost">
              Cerrar sesión
            </button>
          </form>
        </div>
      </section>

      <div className="container stack">
        <section className="panel">
          <header className="panel__header">
            <h2>Competidores</h2>
            <span>{competitors.length} monitoreados</span>
          </header>
          <div className="panel__body">
            {competitors.length === 0 ? (
              <p className="empty">
                Todavía no hay competidores cargados. Escribinos y los agregamos.
              </p>
            ) : (
              competitors.map((competitor) => (
                <div className="row" key={competitor.id}>
                  <div className="row__main">
                    <div className="row__title">{competitor.name}</div>
                    <div className="row__meta">
                      <a href={competitor.url} target="_blank" rel="noreferrer noopener">
                        {competitor.url}
                      </a>
                    </div>
                  </div>
                  <span
                    className={competitor.is_active ? "badge badge--ok" : "badge badge--low"}
                  >
                    {competitor.is_active
                      ? `cada ${competitor.crawl_interval_days} días`
                      : "pausado"}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="panel">
          <header className="panel__header">
            <h2>Últimos hallazgos</h2>
            <span>10 más recientes</span>
          </header>
          <div className="panel__body">
            {analyses.length === 0 ? (
              <p className="empty">
                Sin hallazgos todavía. Después del primer rastreo vas a ver acá lo que cambió.
              </p>
            ) : (
              analyses.map((analysis) => {
                const bullets = [
                  ...analysis.precios,
                  ...analysis.posicionamiento,
                  ...analysis.productos,
                ].slice(0, 4);

                return (
                  <div className="row" key={analysis.id}>
                    <div className="row__main">
                      <div className="row__title">{analysis.headline}</div>
                      <div className="row__meta">
                        {competitorName(analysis)} ·{" "}
                        {formatDate(analysis.created_at, client.timezone)}
                      </div>
                      {bullets.length > 0 ? (
                        <ul className="bullets">
                          {bullets.map((bullet) => (
                            <li key={bullet}>{bullet}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                    <span className={PRIORITY_CLASS[analysis.priority]}>
                      {PRIORITY_LABEL[analysis.priority]}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="panel">
          <header className="panel__header">
            <h2>Alertas inmediatas</h2>
            <span>Últimas 5</span>
          </header>
          <div className="panel__body">
            {alerts.length === 0 ? (
              <p className="empty">No se enviaron alertas de alta prioridad.</p>
            ) : (
              alerts.map((alert) => (
                <div className="row" key={alert.id}>
                  <div className="row__main">
                    <div className="row__title">{alert.subject}</div>
                    <div className="row__meta">
                      {competitorName(alert)} ·{" "}
                      {formatDate(alert.created_at, client.timezone)} ·{" "}
                      {alert.sent_at ? "enviada" : "pendiente"}
                    </div>
                  </div>
                  <span className="badge badge--high">Alta</span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </>
  );
}
