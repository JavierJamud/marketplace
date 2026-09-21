import { Link } from "react-router-dom";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";

// Bloque de auditoría (2026-08-06, Eje 2): esta ruta vive fuera de
// PublicLayout (ver App.jsx, "*" queda al margen del <Route
// element={<PublicLayout />}>) — a propósito, mismo criterio que /cuenta,
// pantalla propia de viewport completo. Rediseño alineado a
// design_references/NotFound.dc.html, con los tokens reales de Tailwind
// (primary/primary-container = el navy del mock, secondary-container = el
// naranja) en vez de los hex sueltos del mock estático.
export default function NotFound() {
  const { siteName, logoUrl } = usePlatformSettings();

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-primary-container to-primary px-6 py-16 text-center">
      <Link to="/" className="mb-9 flex items-center gap-2.5">
        {logoUrl ? (
          <img src={logoUrl} alt={siteName} className="h-10 w-10 flex-shrink-0 rounded-[9px] object-cover" />
        ) : (
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[9px] bg-secondary-container font-display text-xl font-extrabold text-on-secondary-container">
            {siteName.charAt(0).toUpperCase()}
          </div>
        )}
        <span className="font-display text-2xl font-bold text-white">{siteName}</span>
      </Link>

      <p className="font-display text-7xl font-extrabold leading-none text-secondary-container sm:text-8xl">404</p>
      <h1 className="mt-2 font-display text-[26px] font-bold text-white">Esta página no existe</h1>
      <p className="mt-2.5 max-w-[420px] text-body-md leading-[23px] text-white/60">
        Puede que el enlace esté roto o la página se haya movido. Vuelve al inicio y sigue explorando.
      </p>

      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Link
          to="/"
          className="rounded-lg bg-secondary-container px-6 py-3 text-[14px] font-bold text-on-secondary-container hover:brightness-95"
        >
          Ir al inicio
        </Link>
        <Link
          to="/catalogo"
          className="rounded-lg border-[1.5px] border-white/30 px-6 py-3 text-[14px] font-semibold text-white hover:bg-white/5"
        >
          Ver catálogo
        </Link>
      </div>
    </div>
  );
}
