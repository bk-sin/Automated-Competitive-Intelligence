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
el cliente y dos competidores reales):

```bash
npm run seed:demo                                   # usa ADMIN_EMAIL como casilla del cliente
SEED_EMAIL=persona@empresa.com npm run seed:demo    # macOS / Linux
```

En PowerShell: `$env:SEED_EMAIL="persona@empresa.com"; npm run seed:demo`.

> npm 10 en Windows se queda con `--force` antes de pasar los argumentos al script. Por eso
> los comandos que necesitan flags tienen script propio (`cron:extract:force`,
> `cron:digest:force`) y el seed lee el email de `SEED_EMAIL`.

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

### 4. Correr

```bash
npm run dev          # http://localhost:3000
npm test             # 83 tests de la lógica pura
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
npm run check:delivery                  # últimos 20 emails y su last_event
npm run check:delivery -- --limit=50
npm run check:delivery -- --id=<uuid>   # detalle de uno puntual
```

Estados que devuelve Resend: `sent` (aceptado, sin confirmación del destinatario),
`delivered`, `bounced`, `complained`. Un email que sigue en `sent` pasados unos minutos
**no llegó**: revisar spam, reputación del dominio o la restricción del sandbox.

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
