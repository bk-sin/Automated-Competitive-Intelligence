import { describe, expect, it } from "vitest";
import { renderHighPriorityAlert, renderProspectingAudit, renderWeeklyDigest } from "./templates";
import type { Finding } from "../types";

const TZ = "America/Argentina/Buenos_Aires";

const FINDING: Finding = {
  competitorId: "c1",
  competitorName: "Globex",
  competitorUrl: "https://globex.com/precios",
  hasMeaningfulChange: true,
  priority: "ALTA_PRIORIDAD",
  headline: "Globex subió el plan Pro un 20%",
  precios: ["Plan Pro pasó de USD 99 a USD 119"],
  posicionamiento: ["Se presenta como plataforma para equipos de datos"],
  productos: ["Lanzó módulo de reportes"],
  detectedAt: new Date("2026-10-19T11:00:00.000Z"),
};

describe("renderWeeklyDigest", () => {
  it("groups bullets under Precios, Posicionamiento and Productos in that order", () => {
    const { subject, body } = renderWeeklyDigest({
      companyName: "Acme SaaS",
      weekLabel: "13/10 al 19/10",
      timeZone: TZ,
      findings: [FINDING],
      generatedAt: new Date("2026-10-19T11:00:00.000Z"),
    });

    const pricesAt = body.indexOf("PRECIOS");
    const positioningAt = body.indexOf("POSICIONAMIENTO");
    const productsAt = body.indexOf("PRODUCTOS");

    expect(pricesAt).toBeGreaterThan(-1);
    expect(pricesAt).toBeLessThan(positioningAt);
    expect(positioningAt).toBeLessThan(productsAt);

    expect(body).toContain("- Globex: Plan Pro pasó de USD 99 a USD 119");
    expect(body).toContain("- Globex: Se presenta como plataforma para equipos de datos");
    expect(body).toContain("- Globex: Lanzó módulo de reportes");
    expect(subject).toContain("Acme SaaS");
    expect(subject).toContain("13/10 al 19/10");
  });

  it("is plain text: no HTML tags at all", () => {
    const { body } = renderWeeklyDigest({
      companyName: "Acme SaaS",
      weekLabel: "13/10 al 19/10",
      timeZone: TZ,
      findings: [FINDING],
      generatedAt: new Date("2026-10-19T11:00:00.000Z"),
    });

    expect(body).not.toMatch(/<[a-z/][^>]*>/i);
  });

  it("still renders the three sections when there is nothing to report", () => {
    const { body } = renderWeeklyDigest({
      companyName: "Acme SaaS",
      weekLabel: "13/10 al 19/10",
      timeZone: TZ,
      findings: [],
      generatedAt: new Date("2026-10-19T11:00:00.000Z"),
    });

    expect(body).toContain("no detectamos cambios accionables");
    expect(body.match(/Sin cambios relevantes\./g)).toHaveLength(3);
  });

  it("ignores findings flagged as not meaningful", () => {
    const { body } = renderWeeklyDigest({
      companyName: "Acme SaaS",
      weekLabel: "13/10 al 19/10",
      timeZone: TZ,
      findings: [{ ...FINDING, hasMeaningfulChange: false }],
      generatedAt: new Date("2026-10-19T11:00:00.000Z"),
    });

    expect(body).not.toContain("Plan Pro pasó de USD 99 a USD 119");
  });

  it("caps each section at five bullets", () => {
    const many = Array.from({ length: 9 }, (_, index) => `Precio ${index}: USD ${index}`);
    const { body } = renderWeeklyDigest({
      companyName: "Acme SaaS",
      weekLabel: "13/10 al 19/10",
      timeZone: TZ,
      findings: [{ ...FINDING, precios: many, posicionamiento: [], productos: [] }],
      generatedAt: new Date("2026-10-19T11:00:00.000Z"),
    });

    expect(body).toContain("Precio 4: USD 4");
    expect(body).not.toContain("Precio 5: USD 5");
  });

  it("orders the highest priority findings first", () => {
    const medium: Finding = {
      ...FINDING,
      competitorId: "c2",
      competitorName: "Initech",
      priority: "MEDIA",
      precios: ["Ajuste menor de precio"],
    };

    const { body } = renderWeeklyDigest({
      companyName: "Acme SaaS",
      weekLabel: "13/10 al 19/10",
      timeZone: TZ,
      findings: [medium, FINDING],
      generatedAt: new Date("2026-10-19T11:00:00.000Z"),
    });

    expect(body.indexOf("Globex: Plan Pro")).toBeLessThan(body.indexOf("Initech: Ajuste menor"));
  });
});

describe("renderHighPriorityAlert", () => {
  it("produces an urgent subject and includes source + reasoning", () => {
    const { subject, body } = renderHighPriorityAlert({
      companyName: "Acme SaaS",
      competitorName: "Globex",
      competitorUrl: "https://globex.com/precios",
      headline: "Suba general de precios",
      priority: "ALTA_PRIORIDAD",
      precios: ["Plan Pro: USD 119"],
      posicionamiento: [],
      productos: [],
      reasoning: "Afecta directamente al plan que compite con el nuestro",
      detectedAt: new Date("2026-10-19T11:00:00.000Z"),
      timeZone: TZ,
    });

    expect(subject).toBe("[ALERTA] Globex: Suba general de precios");
    expect(body).toContain("ALTA PRIORIDAD");
    expect(body).toContain("https://globex.com/precios");
    expect(body).toContain("- Precio: Plan Pro: USD 119");
    expect(body).toContain("Afecta directamente al plan");
    expect(body).not.toMatch(/<[a-z/][^>]*>/i);
  });
});

describe("renderProspectingAudit", () => {
  const BASE = {
    prospectName: "Acme SaaS",
    contactName: "Ana",
    days: 30,
    baselineLabel: "15/09/2026",
    senderName: "Brian",
    generatedAt: new Date("2026-10-21T12:00:00.000Z"),
    timeZone: TZ,
  };

  it("names only the competitors that actually changed", () => {
    const { subject, body } = renderProspectingAudit({
      ...BASE,
      findings: [FINDING],
      silentCompetitors: ["Initech"],
      unavailableCompetitors: [],
    });

    expect(subject).toBe("Lo que movió Globex en los últimos 30 días");
    expect(body).toContain("Hola Ana,");
    expect(body).toContain("contra cómo estaba el 15/09/2026");
    expect(body).toContain("Globex: Globex subió el plan Pro un 20%");
    expect(body).toContain("- Plan Pro pasó de USD 99 a USD 119");
    expect(body).toContain("Sin cambios relevantes: Initech.");
    expect(body).toContain("Brian");
  });

  it("never reports an unarchived competitor as 'sin cambios'", () => {
    const { body } = renderProspectingAudit({
      ...BASE,
      findings: [FINDING],
      silentCompetitors: [],
      unavailableCompetitors: ["Hooli"],
    });

    expect(body).toContain("No pude comparar (sin versión archivada pública): Hooli.");
    expect(body).not.toContain("Sin cambios relevantes");
  });

  it("says 'sin movimientos' when nothing changed, without inventing a movement", () => {
    const { subject, body } = renderProspectingAudit({
      ...BASE,
      findings: [],
      silentCompetitors: ["Globex", "Initech"],
      unavailableCompetitors: ["Hooli"],
    });

    expect(subject).toBe("2 competidores de Acme SaaS: sin movimientos en los últimos 30 días");
    expect(body).toContain("no encontré movimientos relevantes");
    expect(body).toContain("Sin cambios relevantes: Globex, Initech.");
    expect(body).not.toContain("Esto es lo que cambió");
  });

  it("does not claim 'sin movimientos' when nothing could be compared at all", () => {
    const { subject, body } = renderProspectingAudit({
      ...BASE,
      findings: [],
      silentCompetitors: [],
      unavailableCompetitors: ["Hooli"],
    });

    expect(subject).toBe("Sin versión archivada de Hooli: no pude comparar");
    expect(body).not.toContain("no encontré movimientos relevantes");
    expect(body).toContain("no hay versión guardada de esas páginas");
    expect(body).toContain("No pude comparar (sin versión archivada pública): Hooli.");
  });

  it("names the baseline date instead of a long day count", () => {
    const { subject } = renderProspectingAudit({
      ...BASE,
      days: 1785,
      findings: [FINDING],
      silentCompetitors: [],
      unavailableCompetitors: [],
    });

    expect(subject).toBe("Lo que movió Globex desde el 15/09/2026");
  });

  it("keeps a competitor block to two bullets so the email stays short", () => {
    const { body } = renderProspectingAudit({
      ...BASE,
      findings: [
        {
          ...FINDING,
          precios: ["P1", "P2", "P3"],
          posicionamiento: ["Pos1"],
          productos: ["Prod1"],
        },
      ],
      silentCompetitors: [],
      unavailableCompetitors: [],
    });

    for (const bullet of ["- P1", "- P2"]) expect(body).toContain(bullet);
    expect(body).not.toContain("- P3");
    expect(body).not.toContain("- Pos1");
  });

  it("stays below the plain-text body cap and contains no HTML", () => {
    const { body } = renderProspectingAudit({
      ...BASE,
      findings: [FINDING],
      silentCompetitors: [],
      unavailableCompetitors: [],
    });

    expect(body.length).toBeLessThan(2_000);
    expect(body).not.toMatch(/<[a-z/][^>]*>/i);
  });
});
