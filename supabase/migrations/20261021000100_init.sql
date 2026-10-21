-- ---------------------------------------------------------------------------
-- Automated Competitive Intelligence - MVP schema
-- Tables: clients, competitors, extractions, analyses, alerts, digests,
--         onboarding_requests, system_events
-- ---------------------------------------------------------------------------

create extension if not exists "pgcrypto";

create type public.client_status as enum ('onboarding', 'active', 'paused');
create type public.extraction_status as enum ('success', 'failed', 'unchanged');
create type public.alert_priority as enum ('ALTA_PRIORIDAD', 'MEDIA', 'BAJA');
create type public.onboarding_status as enum ('received', 'in_setup', 'active', 'rejected');
create type public.event_level as enum ('info', 'warning', 'error');

-- Clientes ---------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  email text not null,
  company_name text not null,
  timezone text not null default 'America/Argentina/Buenos_Aires',
  tracking_goals text not null default '',
  status public.client_status not null default 'onboarding',
  weekly_digest_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Competidores -----------------------------------------------------------
create table public.competitors (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  name text not null,
  url text not null,
  is_active boolean not null default true,
  crawl_interval_days integer not null default 7
    check (crawl_interval_days between 1 and 30),
  last_crawled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (client_id, url)
);

create index competitors_client_idx on public.competitors (client_id);
create index competitors_active_idx on public.competitors (is_active) where is_active;

-- Extracciones (historial) -----------------------------------------------
create table public.extractions (
  id uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references public.competitors (id) on delete cascade,
  status public.extraction_status not null,
  markdown text,
  content_hash text,
  http_status integer,
  error_message text,
  duration_ms integer,
  extracted_at timestamptz not null default now()
);

create index extractions_competitor_idx
  on public.extractions (competitor_id, extracted_at desc);

-- Analisis LLM -----------------------------------------------------------
create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  extraction_id uuid not null unique
    references public.extractions (id) on delete cascade,
  competitor_id uuid not null references public.competitors (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  priority public.alert_priority not null,
  has_meaningful_change boolean not null default false,
  headline text not null default '',
  precios text[] not null default '{}',
  posicionamiento text[] not null default '{}',
  productos text[] not null default '{}',
  reasoning text,
  model text,
  tokens_used integer,
  created_at timestamptz not null default now()
);

create index analyses_client_created_idx
  on public.analyses (client_id, created_at desc);
create index analyses_competitor_created_idx
  on public.analyses (competitor_id, created_at desc);

-- Alertas de alta prioridad (FR-004) -------------------------------------
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  competitor_id uuid not null references public.competitors (id) on delete cascade,
  analysis_id uuid unique references public.analyses (id) on delete set null,
  priority public.alert_priority not null default 'ALTA_PRIORIDAD',
  subject text not null,
  body text not null,
  sent_at timestamptz,
  send_error text,
  created_at timestamptz not null default now()
);

create index alerts_client_created_idx on public.alerts (client_id, created_at desc);

-- Resumen ejecutivo semanal (FR-005) -------------------------------------
create table public.digests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  week_start date not null,
  subject text not null,
  body text not null,
  sent_at timestamptz,
  send_error text,
  created_at timestamptz not null default now(),
  unique (client_id, week_start)
);

-- Solicitudes de onboarding (FR-001) -------------------------------------
create table public.onboarding_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  company_name text not null,
  competitor_urls text[] not null,
  goals text not null default '',
  status public.onboarding_status not null default 'received',
  note text,
  created_at timestamptz not null default now()
);

create index onboarding_requests_created_idx
  on public.onboarding_requests (created_at desc);

-- Eventos internos / errores (AC-003) ------------------------------------
create table public.system_events (
  id uuid primary key default gen_random_uuid(),
  level public.event_level not null default 'info',
  source text not null,
  message text not null,
  context jsonb not null default '{}'::jsonb,
  competitor_id uuid references public.competitors (id) on delete set null,
  created_at timestamptz not null default now()
);

create index system_events_created_idx on public.system_events (created_at desc);

-- updated_at -------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();
