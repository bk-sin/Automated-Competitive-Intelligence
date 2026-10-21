import { buildDiffContext, diffContent } from "../src/lib/diff";
import { analyzeDiff } from "../src/lib/llm";

/**
 * Live smoke test for the LLM integration (no DB needed):
 *   npm run smoke:llm
 *
 * Feeds a realistic price/positioning change through the same diff context and
 * prompt used by the extraction job, then validates the parsed JSON response.
 * Costs a handful of tokens, so it is not part of `npm test`.
 */

const BEFORE = `# Precios

Plan Starter: USD 29 por mes
Plan Pro: USD 99 por mes
Plan Enterprise: a consultar

## Posicionamiento

La plataforma elegida por equipos de marketing que necesitan rapidez.
`;

const AFTER = `# Precios

Plan Starter: USD 29 por mes
Plan Pro: USD 119 por mes
Plan Enterprise: a consultar

## Posicionamiento

El estándar de la industria para equipos de marketing que necesitan rapidez.
`;

async function main(): Promise<void> {
  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";
  const model = process.env.LLM_MODEL ?? "gpt-4o-mini";

  if (!apiKey) {
    console.error("Falta LLM_API_KEY en el entorno.");
    process.exitCode = 1;
    return;
  }

  const context = buildDiffContext(diffContent(BEFORE, AFTER));

  console.log(`Proveedor: ${baseUrl}`);
  console.log(`Modelo: ${model}`);
  console.log(`Diff a analizar:\n${context.text}\n`);

  const startedAt = Date.now();
  const result = await analyzeDiff(
    {
      competitorName: "Competidor Demo",
      competitorUrl: "https://example.com/pricing",
      clientGoals: "Precios de los planes Pro y Enterprise, y mensajes de posicionamiento",
      diffText: context.text,
      priceChanges: context.priceChanges,
      totalChanges: context.totalChanges,
      truncated: context.truncated,
    },
    { apiKey, baseUrl, model },
  );

  const { analysis } = result;

  console.log(`- Duración: ${Date.now() - startedAt} ms`);
  console.log(`- Modelo respondido: ${result.model}`);
  console.log(`- Tokens: ${result.tokensUsed ?? "n/d"}`);
  console.log(`- Intentos: ${result.attempts}`);
  console.log(`- Cambio significativo: ${analysis.hasMeaningfulChange}`);
  console.log(`- Prioridad: ${analysis.priority}`);
  console.log(`- Titular: ${analysis.headline}`);
  console.log(`- Precios: ${JSON.stringify(analysis.precios)}`);
  console.log(`- Posicionamiento: ${JSON.stringify(analysis.posicionamiento)}`);
  console.log(`- Productos: ${JSON.stringify(analysis.productos)}`);

  const problems: string[] = [];

  if (!analysis.hasMeaningfulChange) {
    problems.push("no detectó el cambio de precio (debería ser significativo)");
  }

  if (analysis.priority !== "ALTA_PRIORIDAD") {
    problems.push(`prioridad ${analysis.priority} en un cambio de precio (esperado: ALTA_PRIORIDAD)`);
  }

  if (!analysis.headline) {
    problems.push("titular vacío");
  }

  if (analysis.precios.length === 0) {
    problems.push("sin viñetas en precios");
  }

  if (problems.length > 0) {
    console.error(`\n[FALLO] ${problems.join("; ")}`);
    process.exitCode = 1;
    return;
  }

  console.log("\nOK: LLM + prompt + parseo funcionando.");
}

main().catch((error) => {
  console.error("[smoke:llm] falló:", error);
  process.exitCode = 1;
});
