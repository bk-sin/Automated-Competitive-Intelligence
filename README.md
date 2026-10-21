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

Ver `.env.example`. Mínimo para el portal: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`. Para los jobs: `SUPABASE_SERVICE_ROLE_KEY`,
`FIRECRAWL_API_KEY`, `LLM_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_EMAIL`,
`CRON_SECRET`.

> El nombre histórico `FIRECLAW_API_KEY` (typo) se acepta como fallback de
> `FIRECRAWL_API_KEY` en `src/lib/env.ts`, para no romper deploys existentes.

### 3. Primer cliente (setup concierge, semi-manual)

1. En Supabase → Authentication → Invite, creá el usuario del cliente.
2. Copiá su `user_id` y ejecutá:

```sql
insert into public.clients (user_id, email, company_name, timezone, tracking_goals, status)
values ('<USER_ID>', 'cliente@empresa.com', 'Acme SaaS', 'America/Argentina/Buenos_Aires',
        'Precios de los planes Pro y Enterprise', 'active');

insert into public.competitors (client_id, name, url, crawl_interval_days)
select id, 'Globex', 'https://globex.com/pricing', 7 from public.clients where email = 'cliente@empresa.com';
```

3. Corré el primer rastreo: `npm run cron:extract -- --force` (la primera corrida guarda
   la línea base; el análisis aparece a partir de la segunda).

### 4. Correr

```bash
npm run dev          # http://localhost:3000
npm test             # 70 tests de la lógica pura
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
npm run cron:digest:force
```

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
