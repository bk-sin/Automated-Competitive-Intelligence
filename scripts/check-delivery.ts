/**
 * Audita la entrega real de los emails en Resend.
 *
 *   npm run check:delivery
 *   npm run check:delivery -- --limit=50
 *   npm run check:delivery -- --id=<id-de-resend>
 *
 * Resend responde `sent` cuando acepta el mensaje y `delivered` recien cuando
 * el servidor del destinatario lo acepto. Un email estancado en `sent` no
 * llego: revisar spam, dominio verificado o el sandbox de `resend.dev`.
 */

type ResendEmail = {
  id: string;
  to: string[] | null;
  from: string;
  subject: string;
  created_at: string;
  last_event: string;
  message_id?: string | null;
};

type ResendList = {
  data?: ResendEmail[];
  has_more?: boolean;
  message?: string;
  name?: string;
};

const BASE_URL = (process.env.RESEND_BASE_URL ?? "https://api.resend.com").replace(
  /\/+$/,
  "",
);

/** Minutos que toleramos un email en `sent` antes de marcarlo sin confirmar. */
const UNCONFIRMED_AFTER_MINUTES = 10;

function readFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((argument) => argument.startsWith(prefix));
  if (match) return match.slice(prefix.length).trim();

  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1]?.trim() : undefined;
}

function ageMinutes(createdAt: string): number {
  // Resend devuelve `2026-10-21 16:15:33.257000+00`: Date.parse necesita la T
  // y el offset con minutos (`+00:00`).
  const normalized = createdAt
    .trim()
    .replace(" ", "T")
    .replace(/([+-]\d{2})$/, "$1:00");
  const created = Date.parse(normalized);
  if (Number.isNaN(created)) return 0;
  return Math.max(0, Math.round((Date.now() - created) / 60_000));
}

function classify(email: ResendEmail): { label: string; note: string } {
  const minutes = ageMinutes(email.created_at);

  if (["delivered", "opened", "clicked"].includes(email.last_event)) {
    return { label: "OK", note: "entregado" };
  }

  if (email.last_event === "sent") {
    return minutes >= UNCONFIRMED_AFTER_MINUTES
      ? {
          label: "SIN CONFIRMAR",
          note: `aceptado hace ${minutes} min y sin evento de entrega`,
        }
      : { label: "EN CURSO", note: `aceptado hace ${minutes} min` };
  }

  return { label: "ATENCION", note: email.last_event };
}

function apiKey(): string {
  const key = (process.env.RESEND_API_KEY ?? "").trim();
  if (!key) {
    console.error("Falta RESEND_API_KEY. Se carga desde .env via `npm run check:delivery`.");
    process.exit(2);
  }
  return key;
}

async function request<T>(path: string, key: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20_000),
  });

  const payload = (await response.json().catch(() => null)) as T & {
    message?: string;
    name?: string;
  };

  if (!response.ok) {
    const detail = payload?.message ?? payload?.name ?? `HTTP ${response.status}`;
    throw new Error(detail);
  }

  return payload;
}

function printRow(columns: string[], widths: number[]): void {
  console.log(
    columns.map((value, index) => value.padEnd(widths[index] ?? 0)).join("  "),
  );
}

async function main(): Promise<void> {
  const key = apiKey();
  const single = readFlag("id");

  if (single) {
    const email = await request<ResendEmail>(`/emails/${single}`, key);
    const { label, note } = classify(email);
    printRow(["ESTADO", "last_event", "creado", "destinatario"], [13, 18, 17, 24]);
    printRow(
      [
        label,
        email.last_event ?? "-",
        email.created_at ?? "-",
        (email.to ?? []).join(", "),
      ],
      [13, 18, 17, 24],
    );
    console.log(`\nAsunto: ${email.subject ?? "-"}`);
    console.log(`Desde:  ${email.from ?? "-"}`);
    console.log(`Detalle: ${note}`);
    return;
  }

  const parsedLimit = Number.parseInt(readFlag("limit") ?? "20", 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), 100)
    : 20;

  const list = await request<ResendList>(
    `/emails?limit=${limit}`,
    key,
  );
  const emails = list.data ?? [];

  if (emails.length === 0) {
    console.log("Resend no tiene emails enviados.");
    return;
  }

  console.log(`Ultimos ${emails.length} emails en Resend\n`);
  printRow(
    ["ESTADO", "last_event", "edad", "destinatario", "asunto"],
    [13, 16, 7, 26, 40],
  );

  const counts = new Map<string, number>();

  for (const email of emails) {
    const { label } = classify(email);
    counts.set(label, (counts.get(label) ?? 0) + 1);

    printRow(
      [
        label,
        email.last_event ?? "-",
        `${ageMinutes(email.created_at)}m`,
        (email.to ?? []).join(", "),
        email.subject.length > 40 ? `${email.subject.slice(0, 39)}…` : email.subject,
      ],
      [13, 16, 7, 26, 40],
    );
  }

  const sandbox = emails.some((email) => /@resend\.dev>?$/i.test(email.from));
  const unconfirmed = counts.get("SIN CONFIRMAR") ?? 0;

  console.log("\nResumen:");
  for (const [label, count] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${label}: ${count}`);
  }

  if (sandbox) {
    console.log(
      "\nAviso: el remitente usa el dominio sandbox `resend.dev`. Solo entrega\n" +
        "a la casilla dueña de la cuenta y suele caer en spam. Verificar un\n" +
        "dominio propio en Resend es el paso pendiente para produccion.",
    );
  }

  if (unconfirmed > 0) {
    console.log(
      `\n${unconfirmed} email(s) aceptados por Resend sin evento de entrega:\n` +
        "revisar spam, o consultar uno puntual con `--id=<id>`.",
    );
  }
}

main().catch((error: unknown) => {
  console.error(`No se pudo consultar Resend: ${(error as Error).message}`);
  process.exit(1);
});
