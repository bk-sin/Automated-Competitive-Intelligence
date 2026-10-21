import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Seeds a demo client with real competitors so the pipeline can be exercised
 * end to end against a live Supabase project:
 *
 *   npm run seed:demo -- --email=demo@empresa.com
 *   npm run seed:demo -- --profile=salon-berlin
 *
 * Idempotent: re-running reuses the auth user, the client row and the
 * competitors (upsert on `(client_id, url)`), and never deletes history.
 * Requires the service role / secret key (it bypasses RLS on purpose).
 *
 * Cada perfil es un caso real: la URL tiene que ser la pagina del competidor,
 * no un directorio ni un listado agregado (el diff seria ruido).
 */

type SeedProfile = {
  company: string;
  goals: string;
  competitors: Array<{ name: string; url: string; interval: number }>;
};

const PROFILES: Record<string, SeedProfile> = {
  saas: {
    company: "Acme SaaS",
    goals: "Precios de los planes Pro y Enterprise, y mensajes de posicionamiento",
    competitors: [
      { name: "Notion", url: "https://www.notion.com/pricing", interval: 7 },
      { name: "Linear", url: "https://linear.app/pricing", interval: 7 },
    ],
  },
  // Barberia en Palermo. Ninguno de los tres publica una pagina de precios
  // propia salvo El Gran Patron; Alcatraz y Hairhood los publican en su pagina
  // de reservas (Setmore), que es contenido publico y scrapeable.
  "salon-berlin": {
    company: "Salón Berlín",
    goals:
      "Precios de corte, barba y rituales; combos y promociones; posicionamiento de barbería clásica en Palermo",
    competitors: [
      { name: "El Gran Patrón", url: "https://elgranpatron.com/", interval: 7 },
      { name: "Alcatraz Shave Company", url: "https://barberiaalcatraz.setmore.com/", interval: 7 },
      { name: "Hairhood Studio", url: "https://hairhoodstudio.setmore.com/", interval: 7 },
    ],
  },
};

function readFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((argument) => argument.startsWith(prefix));
  if (match) return match.slice(prefix.length).trim();

  // Also accept the space-separated form (`--email foo@bar.com`).
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1]?.trim() : undefined;
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * npm on Windows does not always forward `--flag=value` to the script, so the
 * recipient can also come from the environment (`SEED_EMAIL`) or fall back to
 * the internal inbox.
 */
function resolveEmail(): string {
  const candidates = [readFlag("email"), process.env.SEED_EMAIL, process.env.ADMIN_EMAIL];

  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value && EMAIL_PATTERN.test(value)) return value;
  }

  return "";
}

/**
 * `clients.user_id` es unico: un cliente = un usuario de auth. Cuando el dueño
 * todavia no tiene casilla propia, la de entrega y la de acceso pueden diferir
 * (`--login`), sin inventar un buzon que rebote.
 */
function resolveLogin(deliveryEmail: string): string {
  const value = (readFlag("login") ?? process.env.SEED_LOGIN ?? "").trim();
  return value && EMAIL_PATTERN.test(value) ? value : deliveryEmail;
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

  const email = resolveEmail();
  if (!email) {
    console.error(
      "Falta el email del cliente demo: usá --email=persona@empresa.com, " +
        "definí SEED_EMAIL o completá ADMIN_EMAIL.",
    );
    process.exitCode = 1;
    return;
  }

  const login = resolveLogin(email);

  const profileName = readFlag("profile") ?? process.env.SEED_PROFILE ?? "saas";
  const profile = PROFILES[profileName];

  if (!profile) {
    console.error(
      `Perfil desconocido: ${profileName}. Disponibles: ${Object.keys(PROFILES).join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }

  const goals = readFlag("goals") ?? profile.goals;
  const company = readFlag("company") ?? profile.company;
  const competitors = profile.competitors;

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`Proyecto: ${url}`);
  console.log(`Cliente demo: ${company} <${email}>`);
  if (login !== email) console.log(`Acceso al portal: ${login}\n`);
  else console.log("");

  let user = await findUserByEmail(admin, login);

  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({ email: login, email_confirm: true });
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
    competitors.map((competitor) => ({
      client_id: clientId,
      name: competitor.name,
      url: competitor.url,
      crawl_interval_days: competitor.interval,
      is_active: true,
    })),
    { onConflict: "client_id,url" },
  );

  if (competitorError) throw new Error(`Upsert de competitors falló: ${competitorError.message}`);

  console.log(`- Competidores cargados: ${competitors.map((c) => `${c.name} <${c.url}>`).join(", ")}`);

  console.log(
    "\nSiguiente paso:\n" +
      "  1. npm run cron:extract -- --force          (línea base, sin análisis)\n" +
      "  2. npm run cron:extract -- --force          (segunda corrida: diff + análisis)\n" +
      "  3. npm run cron:digest -- --force           (envía el digest por Resend)\n" +
      `\nPara entrar al portal: /login con ${login} (magic link).`,
  );
}

main().catch((error) => {
  console.error("[seed:demo] falló:", error);
  process.exitCode = 1;
});
