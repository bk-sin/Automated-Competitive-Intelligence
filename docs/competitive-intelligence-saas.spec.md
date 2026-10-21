# Feature Specification: Automated Competitive Intelligence SaaS (MVP)

## Overview

Una plataforma "Done-for-You" que automatiza la inteligencia competitiva para empresas B2B y E-commerce. El MVP utiliza un modelo semi-manual donde el cliente ingresa a sus competidores a través de un portal básico. El sistema utiliza Firecrawl para extraer datos y un LLM para analizar diferencias, filtrar "ruido" de marketing y tomar decisiones sobre la urgencia de los cambios. El valor se entrega íntegramente a través de un Resumen Ejecutivo semanal y alertas de alta prioridad vía Email en texto plano, aportando un trato consultivo.

## Functional Requirements

### FR-001: Onboarding de Cliente

**When** el cliente potencial completa el formulario de onboarding inicial (URLs de competidores y objetivos de rastreo), **the system shall** almacenar la solicitud en Supabase y notificar al equipo interno para el setup semi-manual.

### FR-002: Extracción de Datos

**While** el competidor esté activo en el sistema, **when** se active el cronograma de rastreo, **the system shall** extraer el contenido web (texto visible, precios, listados) utilizando la API de Firecrawl.

### FR-003: Análisis LLM y Limpieza

**When** la extracción de datos se complete, **the system shall** enviar el texto actual y el texto histórico al LLM para identificar diferencias semánticas y filtrar el ruido de marketing.

### FR-004: Detección de Cambios Drásticos (Alertas)

**While** el LLM procesa las diferencias, **when** el LLM clasifique un cambio como "drástico" (ej. cambio masivo de precios, pivot de negocio), **the system shall** enviar una alerta por Email de Alta Prioridad en texto plano de forma inmediata.

### FR-005: Resumen Ejecutivo Semanal

**When** sea Lunes a las 8:00 AM (hora del cliente), **the system shall** compilar todos los hallazgos validados de la semana y enviar un reporte de 1 página vía Email en texto plano.

## Non-Functional Requirements

### Performance & Limits (MVP)

- **Herramientas gratuitas**: Optimizar el uso de tokens del LLM enviando solo diferencias (diffs) o resúmenes en lugar de HTML completo.
- **Frecuencia de rastreo**: Semanal por defecto, configurable manualmente.
- **Base de datos**: Supabase (PostgreSQL) para gestionar perfiles, URLs de competidores e historial de extracciones.

### Security

- Autenticación básica para el portal de clientes manejada vía Supabase Auth.
- Las URLs y datos extraídos no deben compartirse entre diferentes cuentas (Data Isolation mediante RLS en Supabase).

### Scalability (Future-proofing)

- El diseño del sistema debe permitir reemplazar la intervención manual del setup (Concierge) por scripts de automatización total en la V2.

## Acceptance Criteria

### AC-001: Envío del Resumen Ejecutivo

**Given** un cliente con competidores configurados y datos extraídos en los últimos 7 días
**When** el reloj del sistema marca Lunes a las 8:00 AM
**Then** se envía un Email en texto plano al cliente
**And** el email contiene viñetas separadas por: Precios, Posicionamiento y Productos.

### AC-002: Detección de Alerta de Alta Prioridad

**Given** una nueva extracción de datos completada
**When** el modelo LLM evalúa las diferencias y devuelve la etiqueta de "ALTA_PRIORIDAD"
**Then** el sistema genera un Email de alerta inmediata en texto plano
**And** se notifica al usuario sin esperar al reporte semanal.

### AC-003: Manejo de Fallos de Firecrawl (MVP sin Fallback)

**Given** una URL configurada de un competidor
**When** Firecrawl falla al extraer los datos (ej. bloqueo por anti-bot o timeout)
**Then** el sistema registra el error en la tabla correspondiente de Supabase
**And** se alerta al administrador del sistema para revisión manual (sin notificar al cliente).

## Error Handling

| Error Condition            | HTTP Code / Trigger    | Internal Action (MVP)            | User Message                       |
| -------------------------- | ---------------------- | -------------------------------- | ---------------------------------- |
| Error de extracción        | 403 / 500 (Firecrawl)  | Alerta en log interno (Supabase) | N/A (Transparente para el usuario) |
| Límite de Tokens LLM       | 429 (OpenAI/Anthropic) | Reintento con retraso            | N/A                                |
| URL no válida (Onboarding) | 400                    | Rechazo de formulario            | "Por favor ingrese una URL válida" |

## Implementation TODO

### Backend & Core

- [ ] Configurar proyecto en Supabase (Tablas: Clientes, Competidores, Extracciones, Alertas).
- [ ] Crear formulario simple de Onboarding (Typeform, Tally o HTML simple conectado a Supabase).
- [ ] Escribir script de Python/Node.js para llamar a la API de Firecrawl pasándole las URLs extraídas de Supabase.
- [ ] Diseñar el prompt principal ("System Prompt") para que el LLM analice diferencias y decida el nivel de prioridad.
- [ ] Configurar cronjobs (o GitHub Actions en el caso de herramientas gratuitas) para gatillar la extracción y los emails semanales.
- [ ] Integrar un servicio de envío de correos (ej. Resend, SendGrid tier gratuito) para envíos en texto plano.

### Frontend (Portal MVP)

- [ ] Crear _Landing Page_ con la propuesta de valor.
- [ ] Crear pantalla post-onboarding ("Gracias, estamos configurando tus monitores").

## Out of Scope (Para futuras versiones)

- Integración con Slack o Notion.
- Visualizador de diferencias tipo "Diff Viewer" (en el MVP la confianza está en el email).
- Búsqueda Histórica de cambios (el email es transaccional).
- Mapeo automático sin intervención manual inicial.
