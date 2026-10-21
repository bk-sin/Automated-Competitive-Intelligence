import { diffContent, normalizeLines } from "../src/lib/diff";
import { scrapeUrl } from "../src/lib/firecrawl";

/**
 * Live smoke test for the Firecrawl integration (no DB or LLM needed):
 *   npm run smoke:firecrawl -- https://example.com
 *
 * Scrapes the page, checks the markdown survives normalisation and verifies
 * the diff engine detects a synthetic change on real-world content.
 */
async function main(): Promise<void> {
  const apiKey = process.env.FIRECRAWL_API_KEY ?? process.env.FIRECLAW_API_KEY;
  const url = process.argv[2] ?? "https://example.com";

  if (!apiKey) {
    console.error("Falta FIRECRAWL_API_KEY (o el alias FIRECLAW_API_KEY) en el entorno.");
    process.exitCode = 1;
    return;
  }

  console.log(`Scrapeando ${url} ...`);
  const scraped = await scrapeUrl(url, { apiKey });
  const lines = normalizeLines(scraped.markdown);

  console.log(`- HTTP: ${scraped.httpStatus ?? "n/d"}`);
  console.log(`- Duración: ${scraped.durationMs} ms`);
  console.log(`- Markdown: ${scraped.markdown.length} caracteres`);
  console.log(`- Líneas comparables: ${lines.length}`);
  console.log(`- Primeras 5 líneas: ${JSON.stringify(lines.slice(0, 5), null, 2)}`);

  const mutated = `${scraped.markdown}\n\nPlan Enterprise: USD 249 por mes`;
  const diff = diffContent(scraped.markdown, mutated);

  const detected = diff.added.some((line) => line.includes("USD 249"));

  console.log(`- Cambio sintético detectado: ${detected}`);
  console.log(`- Cambios de precio detectados: ${diff.added.filter((line) => /usd/i.test(line)).length}`);

  if (lines.length === 0) {
    console.error("FALLO: la normalización dejó el contenido vacío.");
    process.exitCode = 1;
    return;
  }

  if (!detected) {
    console.error("FALLO: el motor de diff no detectó el cambio sintético.");
    process.exitCode = 1;
    return;
  }

  console.log("\nOK: Firecrawl + normalización + diff funcionando.");
}

main().catch((error) => {
  console.error("[smoke:firecrawl] falló:", error);
  process.exitCode = 1;
});
