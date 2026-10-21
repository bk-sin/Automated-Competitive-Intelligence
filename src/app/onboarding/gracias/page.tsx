import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Solicitud recibida — Radar Competitivo",
};

export default function OnboardingThanksPage() {
  return (
    <section className="section">
      <div className="container narrow">
        <span className="eyebrow">Solicitud recibida</span>
        <h1>Gracias, estamos configurando tus monitores.</h1>
        <p style={{ marginTop: 20, color: "var(--ink-soft)", fontSize: 18 }}>
          Recibimos tu pedido y ya está en la cola del equipo. Vas a recibir un email de
          confirmación cuando el primer relevamiento esté completo. El primer resumen
          ejecutivo llega el lunes a las 8:00 de tu zona horaria.
        </p>
        <p style={{ marginTop: 16, color: "var(--ink-soft)" }}>
          ¿Falta un competidor o querés ajustar el foco? Respondé el email de confirmación y lo
          cambiamos sin costo.
        </p>
        <p style={{ marginTop: 32 }}>
          <Link href="/" className="button button--ghost">
            Volver al inicio
          </Link>
        </p>
      </div>
    </section>
  );
}
