import { describe, expect, it } from "vitest";
import {
  buildDiffContext,
  diffContent,
  hashContent,
  isPriceLine,
  normalizeLines,
  stripMarkdownDecorations,
} from "./diff";

const BEFORE = `# Precios

Plan Pro: USD 99 por mes
Plan Enterprise: a medida

Aceptar cookies
[Inicio](/) | [Productos](/productos) | [Contacto](/contacto)

## Características
- Reportes automáticos
- Integración con Slack
`;

const AFTER = `# Precios

Plan Pro: USD 119 por mes
Plan Enterprise: a medida

Utilizamos cookies para mejorar tu experiencia

## Características
- Reportes automáticos
- Integración con Slack
- Exportación a CSV
`;

describe("stripMarkdownDecorations", () => {
  it("keeps link text and drops the URL and emphasis markers", () => {
    expect(stripMarkdownDecorations("Ver **[planes](https://acme.com/planes)** ahora")).toBe(
      "Ver planes ahora",
    );
  });

  it("removes inline HTML", () => {
    expect(stripMarkdownDecorations("<div>Hola</div> mundo")).toBe("Hola mundo");
  });
});

describe("normalizeLines", () => {
  it("drops navigation bars, cookie banners and separators", () => {
    const lines = normalizeLines(BEFORE);

    expect(lines).not.toContain("Aceptar cookies");
    expect(lines.some((line) => line.includes("Inicio"))).toBe(false);
  });

  it("removes duplicate lines", () => {
    const lines = normalizeLines("Plan Pro: USD 99\nPlan Pro: USD 99\nSoporte 24/7");
    expect(lines).toEqual(["Plan Pro: USD 99", "Soporte 24/7"]);
  });

  it("keeps prices even when the site formats them like a navigation bar", () => {
    // Páginas de reservas (Setmore y similares) publican cada servicio así:
    // tres segmentos y pocas palabras, pero el precio es el dato que buscamos.
    const lines = normalizeLines(
      "Duration:1 hr·Details·. Price:$75,000\nDuración:2h·Detalles·. Precio:30.000 $",
    );

    expect(lines.some((line) => line.includes("75,000"))).toBe(true);
    expect(lines.some((line) => line.includes("30.000 $"))).toBe(true);
  });
});

describe("hashContent", () => {
  it("is stable for formatting-only differences", () => {
    const a = hashContent("**Plan Pro**: USD 99");
    const b = hashContent("Plan Pro: USD 99");
    expect(a).toBe(b);
  });

  it("changes when a price changes", () => {
    expect(hashContent("Plan Pro: USD 99")).not.toBe(hashContent("Plan Pro: USD 119"));
  });
});

describe("diffContent", () => {
  it("reports no change for identical content", () => {
    const diff = diffContent(BEFORE, BEFORE);
    expect(diff.changed).toBe(false);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.similarity).toBe(1);
  });

  it("ignores marketing chrome that only appears on one side", () => {
    const diff = diffContent(BEFORE, BEFORE.replace("Aceptar cookies", ""));
    expect(diff.changed).toBe(false);
  });

  it("captures modified prices as one removal and one addition", () => {
    const diff = diffContent(BEFORE, AFTER);

    expect(diff.changed).toBe(true);
    expect(diff.removed).toContain("Plan Pro: USD 99 por mes");
    expect(diff.added).toContain("Plan Pro: USD 119 por mes");
    expect(diff.added).toContain("- Exportación a CSV");
    expect(diff.similarity).toBeGreaterThan(0.5);
    expect(diff.similarity).toBeLessThan(1);
  });
});

describe("isPriceLine", () => {
  it.each([
    "Plan Pro: USD 99",
    "Desde $12.999",
    "€ 49 por usuario",
    "Precio: consultar",
    // Páginas de reservas: el símbolo viene pegado tras dos puntos.
    "Duration:1 hr·Details·. Price:$75,000",
    "Duración:25min·Detalles·. Precio:20.000 $",
  ])("detects %s", (line) => {
    expect(isPriceLine(line)).toBe(true);
  });

  it("does not flag plain prose", () => {
    expect(isPriceLine("Integración con Slack")).toBe(false);
  });
});

describe("buildDiffContext", () => {
  it("lists price changes before other changes", () => {
    const context = buildDiffContext(diffContent(BEFORE, AFTER));
    const lines = context.text.split("\n");

    expect(context.priceChanges).toBe(2);
    expect(lines[0]).toBe("- Plan Pro: USD 99 por mes");
    expect(lines[1]).toBe("+ Plan Pro: USD 119 por mes");
  });

  it("truncates to the character budget and flags it", () => {
    const before = Array.from({ length: 80 }, (_, index) => `Viejo ${index} descripción`).join("\n");
    const after = Array.from({ length: 80 }, (_, index) => `Nuevo ${index} descripción`).join("\n");

    const context = buildDiffContext(diffContent(before, after), { maxChars: 200, maxLines: 5 });

    expect(context.truncated).toBe(true);
    expect(context.text.length).toBeLessThan(400);
    expect(context.text).toContain("omitidas");
  });
});
