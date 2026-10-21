import type { Metadata } from "next";
import { signInAction } from "./actions";

export const metadata: Metadata = {
  title: "Acceder — Radar Competitivo",
};

type LoginPageProps = {
  searchParams: Promise<{ error?: string; sent?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error, sent } = await searchParams;

  return (
    <>
      <section className="page-header">
        <div className="container narrow">
          <span className="eyebrow">Portal de clientes</span>
          <h1>Acceder</h1>
          <p>Te enviamos un link de un solo uso. Sin contraseñas que recordar.</p>
        </div>
      </section>

      <div className="container narrow" style={{ padding: "40px 24px 80px" }}>
        <form action={signInAction} className="form-card">
          {sent ? (
            <p className="form-success" role="status">
              Listo. Revisá tu casilla: el link vence en una hora.
            </p>
          ) : null}

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <label className="field">
            <span>Email</span>
            <input
              type="email"
              name="email"
              required
              placeholder="vos@empresa.com"
              autoComplete="email"
            />
          </label>

          <button type="submit" className="button">
            Enviarme el link
          </button>
        </form>
      </div>
    </>
  );
}
