import { describe, expect, it } from "vitest";
import {
  AnalysisParseError,
  analyzeDiff,
  extractJsonObject,
  normalizeAnalysis,
  parseAnalysisResponse,
  parsePriority,
} from "./llm";
import type { AnalysisPromptInput } from "./prompts";

const INPUT: AnalysisPromptInput = {
  competitorName: "Globex",
  competitorUrl: "https://globex.com/precios",
  clientGoals: "Precios de los planes Pro y Enterprise",
  diffText: "- Plan Pro: USD 99\n+ Plan Pro: USD 119",
  priceChanges: 2,
  totalChanges: 2,
  truncated: false,
};

describe("extractJsonObject", () => {
  it("reads a fenced JSON block", () => {
    const raw = 'Claro, acá está:\n```json\n{"hasMeaningfulChange":true}\n```\nSaludos';
    expect(extractJsonObject(raw)).toEqual({ hasMeaningfulChange: true });
  });

  it("reads JSON embedded in prose", () => {
    expect(extractJsonObject('{"a":1} y texto')).toEqual({ a: 1 });
  });

  it("throws when there is no JSON", () => {
    expect(() => extractJsonObject("no hay nada")).toThrow(AnalysisParseError);
  });
});

describe("parsePriority", () => {
  it.each([
    ["ALTA_PRIORIDAD", "ALTA_PRIORIDAD"],
    ["alta", "ALTA_PRIORIDAD"],
    ["high", "ALTA_PRIORIDAD"],
    ["MEDIA", "MEDIA"],
    ["medium", "MEDIA"],
    ["BAJA", "BAJA"],
    ["sin_cambio", "BAJA"],
  ])("maps %s -> %s", (input, expected) => {
    expect(parsePriority(input, true)).toBe(expected);
  });

  it("falls back based on meaningful change", () => {
    expect(parsePriority(undefined, true)).toBe("MEDIA");
    expect(parsePriority("raro", false)).toBe("BAJA");
  });
});

describe("normalizeAnalysis", () => {
  it("clamps bullets, dedupes and trims them", () => {
    const result = normalizeAnalysis({
      hasMeaningfulChange: true,
      priority: "ALTA_PRIORIDAD",
      headline: "  Suba general de precios  ",
      precios: [
        "- Plan Pro: USD 119",
        "Plan Pro: USD 119",
        " ",
        "Plan Team: USD 49",
        "a",
        "b",
        "c",
      ],
      posicionamiento: "Ahora apunta a equipos de datos",
      productos: [],
    });

    expect(result.headline).toBe("Suba general de precios");
    expect(result.precios).toHaveLength(5);
    expect(result.precios[0]).toBe("Plan Pro: USD 119");
    expect(result.posicionamiento).toEqual(["Ahora apunta a equipos de datos"]);
    expect(result.priority).toBe("ALTA_PRIORIDAD");
  });

  it("downgrades a contradictory answer (no change but content present)", () => {
    const result = normalizeAnalysis({
      hasMeaningfulChange: false,
      priority: "ALTA_PRIORIDAD",
      precios: ["Plan Pro: USD 119"],
    });

    expect(result.hasMeaningfulChange).toBe(false);
    expect(result.priority).toBe("BAJA");
    expect(result.precios).toEqual([]);
  });

  it("defaults to a neutral headline when the model omits it", () => {
    const result = normalizeAnalysis({
      hasMeaningfulChange: true,
      priority: "MEDIA",
      productos: ["Nuevo módulo de reportes"],
    });

    expect(result.headline).toBe("Cambios detectados en el sitio del competidor");
  });
});

describe("parseAnalysisResponse", () => {
  it("parses a realistic model answer", () => {
    const raw = JSON.stringify({
      hasMeaningfulChange: true,
      priority: "ALTA_PRIORIDAD",
      headline: "Globex subió el plan Pro un 20%",
      precios: ["Plan Pro pasó de USD 99 a USD 119"],
      posicionamiento: [],
      productos: [],
      reasoning: "Aumento general del plan principal",
    });

    const result = parseAnalysisResponse(raw);

    expect(result.priority).toBe("ALTA_PRIORIDAD");
    expect(result.precios).toHaveLength(1);
  });

  it("rejects malformed JSON", () => {
    expect(() => parseAnalysisResponse("{ roto: true }")).toThrow(AnalysisParseError);
  });
});

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const CONFIG = {
  apiKey: "test-key",
  baseUrl: "https://llm.test/v1",
  model: "test-model",
};

describe("analyzeDiff", () => {
  it("returns the parsed analysis and usage metadata", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return jsonResponse({
        model: "test-model-2026",
        choices: [
          {
            message: {
              content: JSON.stringify({
                hasMeaningfulChange: true,
                priority: "ALTA_PRIORIDAD",
                headline: "Suba de precios",
                precios: ["Plan Pro: USD 119"],
              }),
            },
          },
        ],
        usage: { total_tokens: 321 },
      });
    }) as unknown as typeof fetch;

    const result = await analyzeDiff(INPUT, CONFIG, { fetchImpl });

    expect(calls).toEqual(["https://llm.test/v1/chat/completions"]);
    expect(result.analysis.priority).toBe("ALTA_PRIORIDAD");
    expect(result.model).toBe("test-model-2026");
    expect(result.tokensUsed).toBe(321);
    expect(result.attempts).toBe(1);
  });

  it("retries on 429 and then succeeds", async () => {
    let attempt = 0;
    const sleeps: number[] = [];

    const fetchImpl = (async () => {
      attempt += 1;
      if (attempt === 1) {
        return jsonResponse({ error: "rate limit" }, 429, { "retry-after": "2" });
      }
      return jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                hasMeaningfulChange: false,
                priority: "BAJA",
                headline: "Sin cambios",
              }),
            },
          },
        ],
      });
    }) as unknown as typeof fetch;

    const result = await analyzeDiff(INPUT, CONFIG, {
      fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(attempt).toBe(2);
    expect(sleeps).toEqual([2000]);
    expect(result.attempts).toBe(2);
  });

  it("asks again when the model answers with invalid JSON", async () => {
    let attempt = 0;
    const prompts: string[] = [];

    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      attempt += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        messages: Array<{ role: string; content: string }>;
      };
      prompts.push(body.messages.map((message) => message.content).join("\n----\n"));

      if (attempt === 1) {
        return jsonResponse({
          choices: [{ message: { content: "no soy json" } }],
        });
      }

      return jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                hasMeaningfulChange: true,
                priority: "MEDIA",
                headline: "Nuevo producto",
                productos: ["Módulo de reportes"],
              }),
            },
          },
        ],
      });
    }) as unknown as typeof fetch;

    const result = await analyzeDiff(INPUT, { ...CONFIG, maxAttempts: 2 }, { fetchImpl });

    expect(result.attempts).toBe(2);
    expect(prompts[1]).toContain("no fue un JSON válido");
  });

  it("gives up after maxAttempts on server errors", async () => {
    let attempt = 0;
    const fetchImpl = (async () => {
      attempt += 1;
      return jsonResponse({ error: "boom" }, 500);
    }) as unknown as typeof fetch;

    await expect(
      analyzeDiff(INPUT, { ...CONFIG, maxAttempts: 2 }, { fetchImpl, sleep: async () => {} }),
    ).rejects.toThrow(/500/);
    expect(attempt).toBe(2);
  });
});
