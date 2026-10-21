import { runExtractionCycle } from "../src/lib/jobs/extract";

/**
 * Local/manual runner: `npm run cron:extract -- --force --limit=1`
 * Useful to validate Firecrawl + LLM keys without waiting for the cron.
 */

function readFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((argument) => argument.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

async function main(): Promise<void> {
  const limitRaw = readFlag("limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

  const report = await runExtractionCycle({
    force: process.argv.includes("--force"),
    competitorId: readFlag("competitor"),
    limit: Number.isFinite(limit) ? limit : undefined,
  });

  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.failures > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error("[extraction] falló:", error);
  process.exitCode = 1;
});
