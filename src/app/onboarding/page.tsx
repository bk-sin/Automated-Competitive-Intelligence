import type { Metadata } from "next";
import Link from "next/link";
import { submitOnboardingAction } from "./actions";

export const metadata: Metadata = {
  title: "Onboarding — Radar Competitivo",
  description: "Contanos a quién querés vigilar y configuramos tus monitores.",
};

type OnboardingPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const { error } = await searchParams;

  return (
    <>
      <section className="page-header">
        <div className="container narrow">
          <span className="eyebrow">Onboarding</span>
          <h1>Configuramos tus monitores</h1>
          <p>
            Este formulario tarda dos minutos. Con estas URLs dejamos el rastreo funcionando y
            te confirmamos por email cuando el primer relevamiento esté listo.
          </p>
        </div>
      </section>

      <div className="container narrow" style={{ padding: "40px 24px 80px" }}>
        <form action={submitOnboardingAction} className="form-card">
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <label className="field">
            <span>Nombre de la empresa</span>
            <input
              type="text"
              name="companyName"
              required
              minLength={2}
              maxLength={200}
              placeholder="Acme SaaS"
              autoComplete="organization"
            />
          </label>

          <label className="field">
            <span>Email de trabajo</span>
            <input
              type="email"
              name="email"
              required
              maxLength={320}
              placeholder="vos@empresa.com"
              autoComplete="email"
            />
            <span className="hint">
              Acá llegan el resumen semanal y las alertas de alta prioridad.
            </span>
          </label>

          <label className="field">
            <span>Competidores</span>
            <textarea
              name="competitors"
              required
              rows={5}
              placeholder={"https://competidor1.com\nhttps://competidor2.com/precios"}
            />
            <span className="hint">Una URL por línea, hasta 10. Podés empezar con dos.</span>
          </label>

          <label className="field">
            <span>Qué querés vigilar</span>
            <textarea
              name="goals"
              rows={3}
              maxLength={1000}
              placeholder="Ej.: precios de los planes Pro y Enterprise, y lanzamientos de producto."
            />
            <span className="hint">
              Cuanto más concreto, menos ruido en el resumen. Opcional.
            </span>
          </label>

          <button type="submit" className="button">
            Enviar solicitud
          </button>

          <p className="hero-note" style={{ marginTop: 18 }}>
            Al enviar aceptás que te escribamos a ese email. Sin listas de correo ni
            reventa de datos. Ver <Link href="/#precio">precio</Link>.
          </p>
        </form>
      </div>
    </>
  );
}
