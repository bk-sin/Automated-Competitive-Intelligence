import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Radar Competitivo — inteligencia competitiva automática",
  description:
    "Monitoreamos a tus competidores, filtramos el ruido de marketing y te enviamos un resumen ejecutivo semanal por email. Más alertas inmediatas cuando el cambio es drástico.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>
        <header className="site-nav">
          <div className="container site-nav__inner">
            <Link href="/" className="brand">
              Radar<span>Competitivo</span>
            </Link>
            <nav className="nav-links">
              <Link href="/#como-funciona">Cómo funciona</Link>
              <Link href="/#precio">Precio</Link>
              <Link href="/login">Acceder</Link>
              <Link href="/onboarding" className="button">
                Pedir mi radar
              </Link>
            </nav>
          </div>
        </header>

        <main>{children}</main>

        <footer className="container site-footer">
          <span>
            Radar Competitivo — inteligencia competitiva para equipos B2B y e-commerce.
          </span>
          <span>Reportes en texto plano. Sin dashboards que nadie mira.</span>
        </footer>
      </body>
    </html>
  );
}
