# Radar Competitivo — Automated Competitive Intelligence (MVP)

Plataforma "done-for-you" de inteligencia competitiva para B2B y e-commerce.
Rastrea los sitios de los competidores con Firecrawl, filtra ruido de marketing con un
LLM y entrega **un email en texto plano**: resumen ejecutivo los lunes 8:00 (hora del
cliente) y alertas inmediatas cuando el cambio es drástico.

Spec funcional: [`docs/competitive-intelligence-saas.spec.md`](docs/competitive-intelligence-saas.spec.md).

## Stack

| Pieza | Tecnología |
| --- | --- |
| Portal + API | Next.js 15 (App Router) + TypeScript, deploy en Vercel |
| Base de datos / Auth | Supabase (Postgres + magic links) con RLS |
| Extracción | Firecrawl `/v2/scrape` (markdown, solo contenido principal) |
| Análisis | LLM vía `/chat/completions` compatible con OpenAI (sin SDK) |
| Emails | Resend (solo `text`, nunca HTML) |
| Cron | GitHub Actions horario + endpoints autoprotegidos |
| Tests | Vitest (lógica pura: diff, parsing LLM, plantillas, timezones) |

## Arranque rápido

```bash
npm install
cp .env.example .env      # completá las claves
```

### 1. Base de datos

En el SQL Editor de Supabase (o con `supabase db push`), ejecutá en orden:

1. `supabase/migrations/20261021000100_init.sql` — tablas, enums, índices y triggers
2. `supabase/migrations/20261021000200_rls.sql` — RLS y la función `current_client_id()`

### 2. Variables de entorno

Ver `.env.example`. Mínimo para el portal: `NEXT_PUBLIC_SUPABASE_URL` y una clave
pública. Para los jobs: una clave de servicio, `FIRECRAWL_API_KEY`,
`LLM_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_EMAIL`, `CRON_SECRET`.

| Nombres aceptados | Cuándo usarlo |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | clave pública del proyecto (`sb_publishable_...` en el dashboard nuevo) |
| `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY` | clave de servicio (`sb_secret_...` en el dashboard nuevo), sólo server-side |
| `FIRECRAWL_API_KEY` / `FIRECLAW_API_KEY` | el segundo es el typo histórico, se acepta como fallback |

`src/lib/env.ts` resuelve los alias en un solo lugar y rechaza claves con forma de
URL (el error clásico de pegar el Project URL en el campo de la key).

Verificá el estado real de la configuración en cualquier momento:

```bash
npm run check:env            # valida formato y prueba Supabase, LLM y Resend en vivo
npm run check:env -- --deep  # además scrapea example.com (gasta 1 crédito)
```

Marca `[FALTA]` cada variable vacía **o que todavía tenga el placeholder del
`.env.example`** (por ejemplo `https://your-project.supabase.co`), valida que las
migraciones estén aplicadas consultando `clients`, `onboarding_requests` y `digests`,
comprueba que el dominio de `EMAIL_FROM` esté verificado en Resend y no gasta tokens
de LLM. Sale con código 1 si hay bloqueos, así que sirve en CI.

Si el portal se despliega sin las claves públicas de Supabase, `/login`, `/onboarding`
y `/dashboard` muestran un aviso de configuración pendiente en lugar de un error 500.

### 3. Primer cliente (setup concierge, semi-manual)

Para demos y pruebas end-to-end hay un atajo idempotente (crea el usuario de auth,
el cliente y los competidores reales del perfil):

```bash
npm run seed:demo                                    # perfil "saas" (Notion + Linear)
SEED_PROFILE=salon-berlin npm run seed:demo          # perfil "salon-berlin"
SEED_EMAIL=persona@empresa.com npm run seed:demo     # cambia la casilla del cliente
```

En PowerShell: `$env:SEED_PROFILE="salon-berlin"; npm run seed:demo`.

Los perfiles viven en `scripts/seed-demo.ts` (`PROFILES`) y cada uno es un caso real:

| Perfil | Empresa | Competidores |
| --- | --- | --- |
| `saas` | Acme SaaS | Notion, Linear (páginas de precios propias) |
| `salon-berlin` | Salón Berlín, barbería en Palermo | El Gran Patrón, Alcatraz Shave Company, Hairhood Studio |

> La URL de un competidor tiene que ser su página, **no un directorio**. En barberías
> el precio suele estar en la página de reservas (Setmore, AgendaPro, Fresha): es
> contenido público, scrapeable, y ahí está la lista de precios completa.

`clients.user_id` es único (un cliente = un usuario de auth), así que para sumar un
caso nuevo sin pisar el anterior hace falta otra dirección. Cuando el dueño todavía
no tiene casilla propia, `SEED_LOGIN` / `--login` separa la casilla de **acceso** de
la de **entrega**:

```bash
$env:SEED_LOGIN="yo+cliente@gmail.com"; $env:SEED_PROFILE="salon-berlin"; npm run seed:demo
```

> El sandbox de Resend (`onboarding@resend.dev`) solo entrega al dueño **exacto** de la
> cuenta: `yo+cliente@gmail.com` sirve para el login, no como destinatario.

> npm 10 en Windows se queda con `--force` antes de pasar los argumentos al script. Por eso
> los comandos que necesitan flags tienen script propio (`cron:extract:force`,
> `cron:digest:force`) y el seed lee los datos de variables `SEED_*`.

A mano: paso 1 y 2 del bloque SQL de abajo.

1. En Supabase → Authentication → Invite, creá el usuario del cliente.
2. Copiá su `user_id` y ejecutá:

```sql
insert into public.clients (user_id, email, company_name, timezone, tracking_goals, status)
values ('<USER_ID>', 'cliente@empresa.com', 'Acme SaaS', 'America/Argentina/Buenos_Aires',
        'Precios de los planes Pro y Enterprise', 'active');

insert into public.competitors (client_id, name, url, crawl_interval_days)
select id, 'Globex', 'https://globex.com/pricing', 7 from public.clients where email = 'cliente@empresa.com';
```

3. Corré el primer rastreo: `npm run cron:extract:force` (la primera corrida guarda
   la línea base; el análisis aparece a partir de la segunda).

#### Ejemplo comercial con datos reales

Un cliente recién dado de alta solo tiene línea base, así que el primer digest dice
"sin cambios" hasta que un competidor mueva algo (puede tardar semanas). Para mostrar
el producto igual, con datos reales:

```bash
npm run demo:preview                        # imprime el análisis y el email, no envía nada
DEMO_SEND=1 npm run demo:preview            # además lo manda a la casilla del cliente
```

- Parte de la línea base **real** de Firecrawl de ese competidor.
- Construye una "foto previa" con los precios corridos `-10%` (`DEMO_PCT` para cambiarlo)
  y la compara contra la página real de hoy: **solo se simula el pasado**; el contenido
  entrante y el análisis son los reales.
- No escribe en `extractions`, `analyses` ni `alerts`, así que el historial del cliente
  queda limpio y no aparecen alertas de algo que no pasó.
- Selección: `DEMO_COMPANY`, `DEMO_COMPETITOR`, `DEMO_TO`, `DEMO_PCT` (o `--company=`,
  `--competitor=`, `--to=`, `--pct=`).

#### Sobre rojo de prospección (`prospect:audit`)

`demo:preview` simula el pasado: sirve para un cliente que ya confía en vos, nunca para un
prospecto frío que puede abrir la web y ver que ese precio nunca existió. Para prospección el
baseline sale del **archivo público** (Wayback), así que cada afirmación se puede verificar:

```bash
npm run prospect:audit -- prospects/ejemplo.json          # 3 competidores, 5 páginas
npm run prospect:audit -- prospects/prueba-rapida.json    # 1 competidor, 1 página (~30 s)
```

El archivo va como argumento posicional: npm se come `--flag=valor` en Windows, así que
`--file=...` solo funciona invocando `tsx` directo. También acepta `PROSPECT_FILE`, `PROSPECT_DAYS`,
`PROSPECT_TO` y `PROSPECT_SEND=1`:

```bash
PROSPECT_SEND=1 PROSPECT_TO=persona@empresa.com npm run prospect:audit -- prospects/ejemplo.json
```

El archivo del prospecto define `prospect`, `contactName`, `senderName`, `replyTo`, `goals`,
`days` y `competitors[]` con `pricingUrl` / `changelogUrl` / `careersUrl` (hasta 3 páginas por
competidor). Por cada página busca el snapshot más cercano a "hace N días", scrapea snapshot y
página de hoy, y corre el mismo diff + LLM del producto. Tres estados posibles:

| Estado | Significado | Qué dice el correo |
| --- | --- | --- |
| `changed` | Diff con cambios accionables | El movimiento, con cifras |
| `silent` | Comparado, sin cambios | "Sin cambios relevantes" |
| `unavailable` | Sin snapshot, soft-404 o página vacía | "No pude comparar" |

Un competidor sin archivo **nunca** se cuenta como "sin cambios": si el prospecto entra a la web
y ve un cambio, el mail se quema. Si **ninguna** página se pudo comparar, el script no envía: un
correo que solo dice "no pude comparar" no es una propuesta.

> Cobertura real, medida: `barberiaalcatraz.setmore.com` y `hairhoodstudio.setmore.com` tienen **0
> snapshots** en toda su historia. En servicios locales el local no está archivado; sí la
> plataforma donde publica precios (Fresha, Setmore). Revisar con `curl` al CDX antes de prometerle
> una comparación a alguien.

El borrador queda en `out/prospecto-<slug>-<fecha>.md` con la
tabla de estados, la URL del snapshot y los diffs crudos, para defender cada línea antes de
enviar. No escribe en la base: un prospecto todavía no es cliente.

### 4. Correr

```bash
npm run dev          # http://localhost:3000
npm test             # 102 tests de la lógica pura
npm run typecheck
npm run build
```

## Cómo está implementado

| Requisito | Dónde |
| --- | --- |
| FR-001 Onboarding | `src/app/onboarding/*` + `src/lib/onboarding.ts` (inserta en `onboarding_requests` y notifica al equipo) |
| FR-002 Extracción | `src/lib/firecrawl.ts` + `src/lib/jobs/extract.ts` |
| FR-003 Análisis LLM | `src/lib/prompts.ts` (system prompt) + `src/lib/llm.ts` (parsing defensivo, reintentos) |
| FR-004 Alerta inmediata | `sendAlert()` en `src/lib/jobs/extract.ts` + `renderHighPriorityAlert()` |
| FR-005 Resumen semanal | `src/lib/jobs/weekly-digest.ts` + `renderWeeklyDigest()` + `shouldSendWeeklyDigest()` |
| NFR tokens | `src/lib/diff.ts`: se envía solo el diff normalizado, precios primero, con presupuesto de caracteres |
| NFR aislamiento | `supabase/migrations/20261021000200_rls.sql` |
| AC-003 fallos | Se registra `extractions.status='failed'` + `system_events`, se alerta al admin y **no** al cliente |

### Flujo de una extracción

```
competidor activo y vencido (crawl_interval_days)
  └─ Firecrawl /v2/scrape → markdown
       ├─ error  → extractions(failed) + system_events(error) + email al admin (1/día)
       └─ ok     → normalizar líneas (sin nav/cookies/duplicados) → sha256
            ├─ sin snapshot previo → extractions(success) [línea base]
            ├─ mismo hash          → extractions(unchanged) [sin costo de LLM]
            └─ hash distinto       → diff + buildDiffContext → LLM
                 ├─ error         → system_events(error), extracción igual queda guardada
                 └─ resultado     → analyses(...)
                      └─ priority = ALTA_PRIORIDAD → alerts + email inmediato
```

> Una línea con dinero nunca se descarta como navegación, aunque el sitio la publique
> como `Duration:1 hr·Details·Price:$75.000` (páginas de reservas tipo Setmore). Antes
> se perdía y un cambio de precio real podía pasar inadvertido.

## Cron

Ambos endpoints exigen `Authorization: Bearer $CRON_SECRET` y son idempotentes:

| Endpoint | Cuándo corre de verdad |
| --- | --- |
| `POST /api/cron/extraction` | Cada competidor cuyo `crawl_interval_days` venció (7 por defecto) |
| `POST /api/cron/weekly-digest` | Solo si en la zona horaria del cliente es lunes 08:xx y no hay `digests` previo para esa semana |

`.github/workflows/cron.yml` los llama cada hora. Secrets del repo: `APP_URL`, `CRON_SECRET`.
También aceptan `?force=1` para pruebas manuales:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron/extraction?force=1"
npm run cron:extract:force
npm run cron:digest:force
```

## Deploy en Vercel

```bash
vercel link
vercel env add NEXT_PUBLIC_SUPABASE_URL --environment 'production,preview' --value "https://<ref>.supabase.co" --yes
vercel env add NEXT_PUBLIC_APP_URL --environment 'production,preview,development' --value "https://<proyecto>.vercel.app" --yes
# ... una por variable
vercel --prod
```

Se cargan las mismas variables que `.env`, salvo `SUPABASE_ACCESS_TOKEN` (solo tooling local).
`NEXT_PUBLIC_APP_URL` tiene que ser el dominio de producción, no `localhost`: es el que usan
los magic links.

Dos cosas dejan el portal inutilizable si se olvidan:

- **Deployment Protection**: el default de Vercel es `all_except_custom_domains`, así que el
  `*.vercel.app` queda detrás de Vercel Authentication. `/dashboard` te manda al login de
  Vercel en vez de al del portal y el cron responde 401. Se apaga con
  `vercel project protection disable <proyecto> --sso`.
- **CLI viejo**: los endpoints de deploy exigen Vercel CLI 47.2.2 o superior. Si
  `vercel --version` devuelve 44.x (instalación global de pnpm, por ejemplo), actualizá con
  `pnpm add -g vercel@latest`.

Los secretos del repo para el cron de Actions:

```bash
gh secret set APP_URL --body "https://<proyecto>.vercel.app"
gh secret set CRON_SECRET --body "<el mismo CRON_SECRET>"
```

## Correo y entregabilidad

`sent_at` en `alerts`/`digests` solo prueba que Resend **aceptó** el mensaje. Desde la
migración `20261021000300_message_ids.sql` guardamos también `provider_message_id`, que es
lo que permite auditar la entrega real:

```bash
npm run check:delivery                                          # últimos emails y su last_event
npx tsx --env-file=.env scripts/check-delivery.ts --limit=50
npx tsx --env-file=.env scripts/check-delivery.ts --id=<uuid>  # detalle de uno puntual
```

`--id` también audita envíos que no pasaron por la base (por ejemplo `demo:preview`), porque
consulta Resend directo.

Estados que devuelve Resend: `sent` (aceptado, sin confirmación del destinatario),
`delivered`, `bounced`, `complained`. Un email que sigue en `sent` pasados unos minutos
**no llegó**: revisar spam, reputación del dominio o la restricción del sandbox.

Si la alerta ya está guardada en `alerts` no hace falta volver a scrapear para reenviarla:
`alerts:resend` toma `subject` y `body` de la base, la manda y actualiza `sent_at` y
`provider_message_id`.

```bash
npm run alerts:resend:preview                      # quién lo recibe y qué asunto
npm run alerts:resend                              # reenvía la última alerta
$env:ALERT_ID="<uuid>"; npm run alerts:resend      # una puntual
```

Ojo: npm intercepta los flags antes de pasarlos al script (`--dry-run`, `--force`, `--id`,
`--limit`), por eso el preview es `--preview` (o `DRY_RUN=1`), los forzados son alias propios
(`cron:*:force`), la alerta puntual va por `ALERT_ID` y los scripts de auditoría se invocan
con `npx tsx --env-file=.env scripts/...`.

Los emails llevan el link al dashboard. `NEXT_PUBLIC_APP_URL` es local en desarrollo (lo
necesitan los magic links), así que para que un envío hecho desde tu máquina no lleve
`http://localhost:3000` definí `EMAIL_LINK_BASE_URL` con la URL pública. En Vercel se
omite: cae en `NEXT_PUBLIC_APP_URL`, que ya apunta al dominio de producción.

En una cuenta Resend nueva los primeros envíos suelen quedarse en `sent` aunque después
todo entregue en segundos: el receptor difiere al remitente sin reputación. Si `check:delivery`
muestra ese patrón, el problema es el remitente, no el código.

Mientras `EMAIL_FROM` use `onboarding@resend.dev`, Resend solo entrega a la casilla dueña de
la cuenta y Gmail suele mandarlo a spam. Para producción: verificar un dominio en Resend
(SPF + DKIM + DMARC), cambiar `EMAIL_FROM` en `.env` y en Vercel, y redeployar.

## Verificación rápida sin DB ni LLM

```bash
npm run smoke:firecrawl -- https://firecrawl.dev/pricing
```

Scrapea la URL real, normaliza el markdown y confirma que el motor de diff detecta un
cambio sintético. (Última corrida: HTTP 200, 198 líneas comparables, cambio detectado.)

## Límites conocidos del MVP

- Sin fallback cuando Firecrawl falla (por diseño, AC-003): se registra y se avisa al equipo.
- Los reintentos por fallo se difieren 6 h y el email al admin se manda como máximo 1 vez
  cada 24 h por competidor, para no quemar créditos ni la casilla del equipo.
- El análisis se hace una vez por extracción; si el LLM falla, la extracción queda guardada
  pero sin `analyses` (se puede reprocesar a mano).
- Un precio que cambia dentro del mismo día solo genera un hallazgo por corrida del cron.
- Sin Slack/Notion, sin diff viewer, sin búsqueda histórica (fuera de alcance declarado).
