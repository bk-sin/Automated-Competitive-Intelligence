import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Seeds a demo client with real competitors so the pipeline can be exercised
 * end to end against a live Supabase project:
 *
 *   npm run seed:demo -- --email=demo@empresa.com
 *
 * Idempotent: re-running reuses the auth user, the client row and the
 * competitors (upsert on `(client_id, url)`), and never deletes history.
 * Requires the service role / secret key (it bypasses RLS on purpose).
 */

const DEMO_COMPETITORS = [
  { name: "Notion", url: "https://www.notion.com/pricing", interval: 7 },
  { name: "Linear", url: "https://linear.app/pricing", interval: 7 },
];

function readFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((argument) => argument.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : undefined;
}

function readEnv(name: string, alias?: string): string {
  const value = (process.env[name] ?? (alias ? process.env[alias] : undefined) ?? "").trim();
  if (!value || /^https?:\/\//i.test(value)) return "";
  return value;
}

async function findUserByEmail(admin: SupabaseClient, email: string) {
  const target = email.toLowerCase();

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;

    const found = data.users.find((user) => user.email?.toLowerCase() === target);
    if (found) return found;
    if (data.users.length < 100) return null;
  }

  return null;
}

async function main(): Promise<void> {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const serviceKey = readEnv("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY");

  if (!url || !serviceKey) {
    console.error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o una clave de servicio válida " +
        "(SUPABASE_SERVICE_ROLE_KEY o SUPABASE_SECRET_KEY).",
    );
    process.exitCode = 1;
    return;
  }

  const email = readFlag("email");
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error("Pasá un email real con --email=persona@empresa.com (ahí llega el magic link).");
    process.exitCode = 1;
    return;
  }

  const goals =
    readFlag("goals") ?? "Precios de los planes Pro y Enterprise, y mensajes de posicionamiento";
  const company = readFlag("company") ?? "Acme SaaS";

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`Proyecto: ${url}`);
  console.log(`Cliente demo: ${company} <${email}>\n`);

  let user = await findUserByEmail(admin, email);

  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error) throw new Error(`No se pudo crear el usuario: ${error.message}`);
    user = data.user;
    console.log(`- Usuario auth creado: ${user.id}`);
  } else {
    console.log(`- Usuario auth existente: ${user.id}`);
  }

  const { data: existing, error: lookupError } = await admin
    .from("clients")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (lookupError) throw new Error(`Consulta a clients falló: ${lookupError.message}`);

  let clientId: string;

  if (existing) {
    const { error } = await admin
      .from("clients")
      .update({ company_name: company, tracking_goals: goals, status: "active" })
      .eq("id", existing.id);
    if (error) throw new Error(`Update de clients falló: ${error.message}`);

    clientId = existing.id;
    console.log(`- Cliente existente actualizado: ${clientId}`);
  } else {
    const { data, error } = await admin
      .from("clients")
      .insert({
        user_id: user.id,
        email,
        company_name: company,
        timezone: "America/Argentina/Buenos_Aires",
        tracking_goals: goals,
        status: "active",
        weekly_digest_enabled: true,
      })
      .select("id")
      .single();

    if (error) throw new Error(`Insert en clients falló: ${error.message}`);

    clientId = (data as { id: string }).id;
    console.log(`- Cliente creado: ${clientId}`);
  }

  const { error: competitorError } = await admin.from("competitors").upsert(
    DEMO_COMPETITORS.map((competitor) => ({
      client_id: clientId,
      name: competitor.name,
      url: competitor.url,
      crawl_interval_days: competitor.interval,
      is_active: true,
    })),
    { onConflict: "client_id,url" },
  );

  if (competitorError) throw new Error(`Upsert de competitors falló: ${competitorError.message}`);

  console.log(`- Competidores cargados: ${DEMO_COMPETITORS.map((c) => c.name).join(", ")}`);

  console.log(
    "\nSiguiente paso:\n" +
      "  1. npm run cron:extract -- --force          (línea base, sin análisis)\n" +
      "  2. npm run cron:extract -- --force          (segunda corrida: diff + análisis)\n" +
      "  3. npm run cron:digest -- --force           (envía el digest por Resend)\n" +
      `\nPara entrar al portal: /login con ${email} (magic link).`,
  );
}

main().catch((error) => {
  console.error("[seed:demo] falló:", error);
  process.exitCode = 1;
});
