import Link from "next/link";

const SAMPLE = `RESUMEN EJECUTIVO SEMANAL
Acme SaaS
Semana: 13/10 al 19/10

PRECIOS
- Globex: Plan Pro pasó de USD 99 a USD 119 por mes.
- Initech: Nuevo plan anual con 20% de descuento.

POSICIONAMIENTO
- Globex: Ahora se presenta como "plataforma para equipos de datos".

PRODUCTOS
- Initech: Lanzó módulo de reportes automáticos.`;

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="container">
          <span className="eyebrow">Inteligencia competitiva · hecho por nosotros</span>
          <h1>Tu competencia cambia. Enterate por email, no por sorpresa.</h1>
          <p className="lede">
            Rastreamos los sitios de tus competidores, filtramos el ruido de marketing y te
            enviamos un resumen ejecutivo de una página cada lunes. Si algo es drástico, te
            avisamos en el momento.
          </p>
          <div className="hero-actions">
            <Link href="/onboarding" className="button">
              Pedir mi radar competitivo
            </Link>
            <span className="hero-note">Setup asistido · sin tarjeta para empezar</span>
          </div>
        </div>
      </section>

      <section className="section" id="como-funciona">
        <div className="container">
          <h2>Cómo funciona</h2>
          <div className="steps">
            <div className="step">
              <span className="card__index">01</span>
              <h3>Nos contás a quién mirar</h3>
              <p>
                Completás un formulario con las URLs de tus competidores y qué te importa
                vigilar: precios, posicionamiento o catálogo.
              </p>
            </div>
            <div className="step">
              <span className="card__index">02</span>
              <h3>Configuramos el rastreo</h3>
              <p>
                Nuestro equipo deja los monitores funcionando el mismo día. Sin integraciones,
                sin código de tu lado.
              </p>
            </div>
            <div className="step">
              <span className="card__index">03</span>
              <h3>Separamos señal de ruido</h3>
              <p>
                Un modelo de lenguaje compara versiones y descarta banners, blogs y cambios
                cosméticos. Solo queda lo que mueve una decisión.
              </p>
            </div>
            <div className="step">
              <span className="card__index">04</span>
              <h3>Recibís el resumen</h3>
              <p>
                Un email en texto plano, ordenado por Precios, Posicionamiento y Productos.
                Se lee en dos minutos.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>Qué recibís</h2>
          <div className="grid">
            <div className="card">
              <span className="card__index">SEMANAL</span>
              <h3>Resumen ejecutivo</h3>
              <p>
                Cada lunes a las 8:00 de tu zona horaria: qué cambió, en qué competidor y por
                qué importa. Un solo email, sin links obligatorios.
              </p>
            </div>
            <div className="card">
              <span className="card__index">INMEDIATO</span>
              <h3>Alertas de alta prioridad</h3>
              <p>
                Cambios masivos de precios, pivots de negocio o desaparición de secciones
                clave. Te llegan el mismo día, no el lunes siguiente.
              </p>
            </div>
            <div className="card">
              <span className="card__index">CONSULTIVO</span>
              <h3>Criterio, no datos crudos</h3>
              <p>
                Escribimos hallazgos con cifras y contexto. Si querés profundizar, respondés
                el correo y lo revisamos con vos.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>Así se ve el lunes</h2>
          <pre className="sample-email">{SAMPLE}</pre>
        </div>
      </section>

      <section className="section" id="precio">
        <div className="container">
          <h2>Precio</h2>
          <div className="grid">
            <div className="card">
              <span className="card__index">MVP · CUPOS LIMITADOS</span>
              <h3>Plan único, setup asistido</h3>
              <p>
                Un abono mensual acordado durante el onboarding según cuántos competidores
                quieras vigilar y con qué frecuencia. Incluye el resumen semanal, las alertas
                inmediatas y ajustes de foco sin costo.
              </p>
              <p style={{ marginTop: 20 }}>
                <Link href="/onboarding" className="button">
                  Empezar
                </Link>
              </p>
            </div>
            <div className="card">
              <span className="card__index">LO QUE NO HACEMOS</span>
              <h3>Sin promesas infladas</h3>
              <p>
                No vendemos un dashboard que nadie abre, no adivinamos Roadmaps internos y no
                hacemos scraping de datos privados. Solo fuentes públicas, cambios reales y un
                email claro.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
