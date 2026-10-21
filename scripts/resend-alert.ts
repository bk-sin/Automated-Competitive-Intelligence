import { createClient } from "@supabase/supabase-js";

import { sendPlainTextEmail } from "../src/lib/email/resend";
import { getServerEnv } from "../src/lib/env";

/**
 * Reenvía una alerta que ya está guardada en la base.
 *
 *   npm run alerts:resend                 # la ultima alerta
 *   npm run alerts:resend -- --id=<uuid>
 *   npm run alerts:resend:preview         # muestra el destinatario y no envia
 *
 * Ojo: npm se queda con `--dry-run`/`--force` antes de pasarlos al script, por
 * eso el preview usa `--preview` (o `DRY_RUN=1`).
 *
 * Sirve cuando el envio original quedo en `sent` sin evento de entrega (ver
 * `npm run check:delivery`): el cuerpo se guarda en `alerts`, asi que se puede
 * reintentar sin volver a correr Firecrawl ni el LLM.
 */

type AlertWithClient = {
  id: string;
  subject: string;
  body: string;
  sent_at: string | null;
  provider_message_id: string | null;
  clients: { email: string } | null;
};

function readFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((argument) => argument.startsWith(prefix));
  if (match) return match.slice(prefix.length).trim();

  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1]?.trim() : undefined;
}

async function main(): Promise<void> {
  const env = getServerEnv();
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // npm en Windows se come `--id=...`, asi que tambien se acepta ALERT_ID.
  const alertId = readFlag("id") ?? process.env.ALERT_ID?.trim();
  const dryRun = process.argv.includes("--preview") || process.env.DRY_RUN === "1";

  const selection = db
    .from("alerts")
    .select("id, subject, body, sent_at, provider_message_id, clients (email)");

  const { data, error } = alertId
    ? await selection.eq("id", alertId).maybeSingle()
    : await selection.order("created_at", { ascending: false }).limit(1).maybeSingle();

  if (error) {
    console.error(`No se pudo leer la alerta: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const alert = data as unknown as AlertWithClient | null;
  if (!alert) {
    console.error(alertId ? `No existe la alerta ${alertId}.` : "No hay alertas guardadas.");
    process.exitCode = 1;
    return;
  }

  const to = alert.clients?.email;
  if (!to) {
    console.error(`La alerta ${alert.id} no tiene cliente asociado.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Alerta:        ${alert.id}`);
  console.log(`Destinatario:  ${to}`);
  console.log(`Asunto:        ${alert.subject}`);
  console.log(`Envio previo:  ${alert.sent_at ?? "nunca"} (id ${alert.provider_message_id ?? "-"})`);

  if (dryRun) {
    console.log("\n--preview: no se envio nada.");
    return;
  }

  const send = await sendPlainTextEmail(
    { to, subject: alert.subject, body: alert.body },
    { apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM },
  );

  if (!send.ok) {
    await db.from("alerts").update({ send_error: send.error }).eq("id", alert.id);
    console.error(`\nFallo el reenvio: ${send.error}`);
    process.exitCode = 1;
    return;
  }

  const sentAt = new Date().toISOString();
  await db
    .from("alerts")
    .update({ sent_at: sentAt, send_error: null, provider_message_id: send.id })
    .eq("id", alert.id);

  console.log(`\nReenviada a las ${sentAt} con id ${send.id}.`);
  console.log("Verificar entrega con: npm run check:delivery");
}

main().catch((error: unknown) => {
  console.error(`[alerts:resend] fallo: ${(error as Error).message}`);
  process.exitCode = 1;
});
