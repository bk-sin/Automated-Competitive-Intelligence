import { runWeeklyDigestCycle } from "../src/lib/jobs/weekly-digest";

/**
 * Local/manual runner: `npm run cron:digest:force`
 * Bypass the Monday 08:00 window to inspect a real email.
 */

function readFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((argument) => argument.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

async function main(): Promise<void> {
  const report = await runWeeklyDigestCycle({
    force: process.argv.includes("--force"),
    clientId: readFlag("client"),
  });

  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.failed > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error("[weekly-digest] falló:", error);
  process.exitCode = 1;
});
