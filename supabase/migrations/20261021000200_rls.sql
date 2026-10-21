-- ---------------------------------------------------------------------------
-- Row Level Security: cada cliente solo ve sus propios datos.
-- El service role (jobs, cron, onboarding server action) hace bypass de RLS.
-- ---------------------------------------------------------------------------

alter table public.clients enable row level security;
alter table public.competitors enable row level security;
alter table public.extractions enable row level security;
alter table public.analyses enable row level security;
alter table public.alerts enable row level security;
alter table public.digests enable row level security;
alter table public.onboarding_requests enable row level security;
alter table public.system_events enable row level security;

-- Helper: id del cliente asociado al usuario autenticado.
create or replace function public.current_client_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.clients where user_id = auth.uid();
$$;

revoke all on function public.current_client_id() from public;
grant execute on function public.current_client_id() to authenticated;

-- Clientes ---------------------------------------------------------------
create policy "clients_select_own"
  on public.clients for select
  to authenticated
  using (user_id = auth.uid());

create policy "clients_update_own"
  on public.clients for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Competidores -----------------------------------------------------------
create policy "competitors_select_own"
  on public.competitors for select
  to authenticated
  using (client_id = public.current_client_id());

create policy "competitors_insert_own"
  on public.competitors for insert
  to authenticated
  with check (client_id = public.current_client_id());

create policy "competitors_update_own"
  on public.competitors for update
  to authenticated
  using (client_id = public.current_client_id())
  with check (client_id = public.current_client_id());

create policy "competitors_delete_own"
  on public.competitors for delete
  to authenticated
  using (client_id = public.current_client_id());

-- Extracciones -----------------------------------------------------------
create policy "extractions_select_own"
  on public.extractions for select
  to authenticated
  using (
    exists (
      select 1
      from public.competitors c
      where c.id = extractions.competitor_id
        and c.client_id = public.current_client_id()
    )
  );

-- Analisis ---------------------------------------------------------------
create policy "analyses_select_own"
  on public.analyses for select
  to authenticated
  using (client_id = public.current_client_id());

-- Alertas ----------------------------------------------------------------
create policy "alerts_select_own"
  on public.alerts for select
  to authenticated
  using (client_id = public.current_client_id());

-- Digests ----------------------------------------------------------------
create policy "digests_select_own"
  on public.digests for select
  to authenticated
  using (client_id = public.current_client_id());

-- Onboarding: cualquiera puede enviar la solicitud, nadie la lee desde
-- el cliente (el equipo interno usa el service role).
create policy "onboarding_requests_insert_public"
  on public.onboarding_requests for insert
  to anon, authenticated
  with check (
    char_length(email) between 5 and 320
    and char_length(company_name) between 2 and 200
    and array_length(competitor_urls, 1) between 1 and 10
  );

-- system_events: sin politicas -> solo service role.
