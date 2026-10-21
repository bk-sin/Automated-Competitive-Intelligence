-- Rastreo de entrega ------------------------------------------------------
-- `sent_at` solo prueba que Resend acepto el mensaje. Guardando el id que
-- devuelve la API podemos consultar `GET /emails/{id}` y distinguir
-- "aceptado" (sent) de "entregado" (delivered), que es lo unico que
-- garantiza que el email llego a la casilla.

alter table public.alerts
  add column if not exists provider_message_id text;

alter table public.digests
  add column if not exists provider_message_id text;

comment on column public.alerts.provider_message_id is
  'id del mensaje en Resend; usar GET /emails/{id} para auditar la entrega';
comment on column public.digests.provider_message_id is
  'id del mensaje en Resend; usar GET /emails/{id} para auditar la entrega';
