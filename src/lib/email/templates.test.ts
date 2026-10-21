import { describe, expect, it } from "vitest";
import { renderHighPriorityAlert, renderWeeklyDigest } from "./templates";
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
