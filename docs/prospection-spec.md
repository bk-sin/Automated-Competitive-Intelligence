🕵️‍♂️ Playbook: Agente de Prospección y Customer Discovery (El "Tito" Digital)

🎯 Misión Principal

No vender software. Tu objetivo es auditar la fricción operativa del prospecto (el tiempo que pierden mirando a la competencia) y entregar el "Aha Moment" de forma gratuita y asíncrona antes de mencionar un precio.

🛠️ Fase 1.1: Selección de Objetivos (Sniper, no Escopeta)

En B2B no buscamos volumen, buscamos dolor agudo.

Nicho: Startups SaaS B2B o agencias en LATAM/España con equipos de 10 a 50 empleados (son lo suficientemente grandes para tener competidores serios, pero lo suficientemente chicas para que el CEO/Director lea sus propios correos).

La Lista: Selecciona 5 prospectos.

El Mapeo Manual: Para cada uno, entra a Google/G2 y anota las URLs exactas de sus 3 competidores más directos. Específicamente:

URL de Precios (/pricing)

URL de Novedades (/changelog o /blog)

URL de Empleos (/careers)

🎁 Fase 1.2: El "Sobre Rojo" Digital (Valor por Adelantado)

Antes de contactarlos, el Agente Técnico (Firecrawl) ya debe haber extraído los datos de la semana. Vas a enviarles un correo frío corto, directo y con un regalo irrefutable: el trabajo ya hecho.

Plantilla de Email (Directo al grano):

Asunto: Cambios recientes en los precios/estrategia de [Competidor 1] y [Competidor 2]

Hola [Nombre del CEO/Director],

Vengo siguiendo el crecimiento de [Nombre de su Startup]. Construí un motor de inteligencia que rastrea la web profunda para equipos directivos, y decidí poner a prueba a tus 3 principales competidores durante los últimos 7 días.

Encontré estos movimientos silenciosos:

[Competidor 1]: Subió su plan Pro un 15% y cambió su propuesta de valor en la home.

[Competidor 2]: Publicó 2 vacantes para Ventas Outbound (posible expansión comercial).

[Competidor 3]: Sin cambios estratégicos esta semana.

Sé que revisar esto a mano consume horas. Si este nivel de síntesis ejecutiva te sirve, me gustaría hacerte un par de preguntas para entender cómo gestionan hoy la inteligencia competitiva.

¿Tenés 10 minutos el [Día] para una charla rápida de feedback?

Saludos,
[Tu Nombre]

🗣️ Fase 1.3: Customer Discovery (La Llamada "No-Venta")

Si aceptan la llamada o responden, aplica el descubrimiento técnico. No muestres ningún dashboard.

Preguntas a realizar (El framework "Product Engineer"):

"Cuando [Competidor X] cambia sus precios, ¿cuánto tiempo tardan ustedes en enterarse?"

"Hoy en día, ¿quién es la persona de tu equipo que pierde horas entrando a las webs de los competidores para ver qué lanzaron?"

"Si tuvieras un resumen de 1 página en tu Slack todos los lunes a las 8 AM con lo que hizo tu competencia, ¿qué decisión tomarías más rápido?"

🛎️ Fase 1.4: Onboarding "White-Glove" (Guante Blanco)

Si el cliente valida el dolor y está dispuesto a pagar ($350/mes), el onboarding debe tener cero fricción. No le mandes un link para que se cree un usuario.

El flujo del Agente en el Onboarding:

Cobro: Le envías un link de pago directo (Stripe/MercadoPago).

Setup Asistido: "Perfecto. Pasame por acá las URLs de los 5 competidores que más te quiten el sueño. Yo me encargo de armar los scrappers y limpiar los falsos positivos."

El Entregable Cero: "Este lunes a las 8:00 AM recibís el primer reporte ejecutivo en tu correo (o invitame a tu canal de Slack de 'Competencia' y lo enchufo ahí)."

Persistencia: Guardas sus objetivos en tu Google Sheet interno. El cliente no hace absolutamente nada técnico.

📈 Métricas de Éxito de este Agente

Mapear 5 prospectos y sus 15 competidores totales (Tiempo estimado: 2 horas).

Enviar 5 "Sobres Rojos" digitales.

Objetivo: Agendar 1 o 2 llamadas de Customer Discovery puras.

---

## 🔧 Addendum operativo (cómo se ejecuta con este repo)

El "sobre rojo" no se escribe a mano: `prospect:audit` toma las URLs de los competidores, busca el
snapshot más cercano a "hace N días" en Wayback, lo compara contra la página de hoy con el mismo
diff + LLM del producto y deja un borrador verificable en `out/prospecto-<slug>-<fecha>.md`
(asunto, cuerpo, tabla de estados, URL del snapshot y diffs crudos). No envía nada hasta que se
pase `PROSPECT_SEND=1`. Ver README, sección "Sobre rojo de prospección".

Seis puntos del playbook que no sobreviven al contacto con la realidad:

1. **"Rastrea la web profunda" es humo.** Lo que importa son tres o cuatro páginas concretas:
   `/pricing`, `/changelog` y, en servicios, la página de reservas (Setmore, AgendaPro, Fresha),
   que es donde el competidor publica precios de verdad. Un barbershop no tiene "estrategia" en
   la home: tiene la lista de precios en el turnero.
2. **No se puede afirmar un movimiento sin línea base.** El template dice "subió su plan Pro un
  15%": un escaneo nuevo no puede saberlo, y correr los precios -10% para simular el pasado es
   mentirle a alguien que puede abrir la web en 5 segundos. De ahí Wayback: si hay snapshot, se
   afirma con fecha; si no, el correo dice "no pude comparar", que igual demuestra trabajo.
3. **Google/G2 sirven para descubrir competidores, no para rasparlos.** G2 bloquea, esconde la
   tabla detrás de JS y muestra *sus* competidores, no los del prospecto. La URL tiene que ser la
   del competidor: un directorio de 46.000 barberías no es un competidor.
4. **`/careers` es la señal más frágil.** Muchas veces es un board JS (Greenhouse/Lever) o una
   lista que rota sola: el diff se llena de ruido. Sirve el conteo de vacantes y el área, no el
   texto. Si el board no se deja scrapear, va como "no comparable" y el correo no lo menciona.
5. **El costo real del mapeo es 45 páginas, no 15.** 5 prospectos × 3 competidores × 3 URLs son 90
   scrapes y hasta 45 llamadas al LLM. El script solo analiza las páginas que cambian, pero el
   presupuesto de Firecrawl hay que mirarlo antes de salir a prospectar.
6. **El 20-40% de respuesta es fantasía.** Cold B2B con regalo real ronda 5-15%. Planificá 5
   sobres para 1 llamada, no 5 para 2, y mandá los 5 el mismo día: el mismo motor ya está
   corriendo y el costo marginal del sexto es casi cero.

Y una regla que no está en el playbook: **nunca mandar un sobre rojo desde el sandbox de Resend**
(`algo@resend.dev`). Solo entrega a la casilla dueña de la cuenta; a un prospecto le llega rebotado
y perdés el dominio. Verificar dominio (SPF/DKIM/DMARC) antes del primer envío frío.

### Cobertura medida en servicios locales (importa antes de prometer nada)

| Página | Snapshots |
| --- | --- |
| `barberiaalcatraz.setmore.com` | 0 (nunca) |
| `hairhoodstudio.setmore.com` | 0 (nunca) |
| `elgranpatron.com` | 1, dic-2021, sin código 200 → se descarta |
| `fresha.com/pricing`, `setmore.com/pricing` | sí, oct-2026 |

Para barberías **no se puede afirmar** "tu competidor cambió el precio": la página de reservas de
cada local no está archivada. Lo que sí es comparable es la plataforma donde publican el precio
(Fresha, Setmore, Booksy — Booksy tampoco está, revisar caso por caso). El script lo dice como
"no pude comparar" y, si no comparó **ninguna** página, se niega a enviar: un correo que solo dice
"no pude comparar" no es una propuesta.

