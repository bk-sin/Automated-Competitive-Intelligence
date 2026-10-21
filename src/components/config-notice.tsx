import Link from "next/link";

/**
 * Rendered instead of a page when Supabase is not configured yet, so a fresh
 * deploy fails with a readable message (and a next step) instead of a 500.
 */
export function ConfigNotice({ title, description }: { title: string; description: string }) {
  return (
    <>
      <section className="page-header">
        <div className="container narrow">
          <span className="eyebrow">Configuración pendiente</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </section>

      <div className="container narrow" style={{ padding: "40px 24px 80px" }}>
        <div className="form-card">
          <p>
            Faltan <code>NEXT_PUBLIC_SUPABASE_URL</code> o{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>. Corré{" "}
            <code>npm run check:env</code> para ver exactamente qué falta y reiniciá el servidor.
          </p>
          <Link href="/" className="button button--ghost">
            Volver al inicio
          </Link>
        </div>
      </div>
    </>
  );
}
