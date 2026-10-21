/**
 * Verifica que Supabase acepte el `redirect_to` del magic link.
 *
 *   npm run check:auth
 *   npm run check:auth -- https://mi-app.vercel.app
 *
 * Supabase no falla cuando el destino no está permitido: lo reemplaza por el
 * Site URL del proyecto, en silencio. El síntoma es un mail que te devuelve a
 * `localhost` aunque lo hayas pedido desde producción. Este script firma el
 * link (no envía email) y compara lo pedido con lo que Supabase emitió.
 *
 * Requiere `SUPABASE_SERVICE_ROLE_KEY` y `ADMIN_EMAIL` (una cuenta que ya exista).
 */

type GenerateLinkResponse = {
  action_link?: string;
  redirect_to?: string;
  message?: string;
};

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const EMAIL = process.env.ADMIN_EMAIL ?? "";

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((value) => value.replace(/\/+$/, "")).filter(Boolean))];
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function emittedRedirectTo(origin: string): Promise<string> {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "magiclink",
      email: EMAIL,
      redirect_to: `${origin}/auth/callback`,
    }),
  });

  const payload = (await response.json()) as GenerateLinkResponse;

  if (!response.ok) {
    fail(`Supabase rechazó generate_link (${response.status}): ${payload.message ?? "sin detalle"}`);
  }

  if (payload.redirect_to) return payload.redirect_to.replace(/\/+$/, "");

  const link = payload.action_link ? new URL(payload.action_link) : null;
  return (link?.searchParams.get("redirect_to") ?? "").replace(/\/+$/, "");
}

async function main(): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    fail("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.");
  }
  if (!EMAIL) {
    fail("Falta ADMIN_EMAIL: se usa como cuenta existente para firmar el link de prueba.");
  }

  const candidates = dedupe([
    ...process.argv.slice(2).filter((argument) => argument.startsWith("http")),
    process.env.NEXT_PUBLIC_APP_URL ?? "",
    "http://localhost:3000",
  ]);

  let rejected = 0;
  let siteUrl = "";

  console.log(`Magic link: ${candidates.length} origen(es) a revisar\n`);

  for (const origin of candidates) {
    const target = `${origin}/auth/callback`;
    const emitted = await emittedRedirectTo(origin);

    if (emitted === target) {
      console.log(`  ok        ${target}`);
      continue;
    }

    rejected += 1;
    siteUrl = emitted;
    console.log(`  rechazado ${target}`);
    console.log(`            Supabase lo cambia por ${emitted} (Site URL del proyecto)\n`);
  }

  if (rejected === 0) {
    console.log("\nTodos los orígenes llegan al callback. Nada que corregir.");
    return;
  }

  console.log(
    [
      "",
      "Cómo arreglarlo: Authentication > URL Configuration.",
      "  Site URL        -> la URL pública de la app (no localhost).",
      "  Redirect URLs   -> agregar cada origen con `/**`:",
      ...candidates.map((origin) => `                     ${origin}/**`),
      "",
      `Hoy el código cae en ${siteUrl || "el Site URL"}. Si esa URL no es la app,`,
      "el link te deja en una máquina local. El middleware rescata el `?code=` en",
      "cualquier ruta, pero no puede cruzar de dominio.",
    ].join("\n"),
  );

  process.exit(1);
}

await main();

export {};
