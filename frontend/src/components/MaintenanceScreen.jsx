import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Wrench, RefreshCw, Store, LayoutGrid, Tag } from "lucide-react";
import { usePlatformSettings } from "../lib/usePlatformSettings.js";

// Aviso de mantenimiento. `variant="full"` ocupa toda la pantalla (todo el sitio en mantenimiento); `variant="home"` va dentro del sitio
// en lugar de la página principal y deja a mano las tiendas, que siguen disponibles. Mientras se ve, se pide a los buscadores que no la
// indexen (es algo pasajero).
function useNoindex() {
  useEffect(() => {
    let tag = document.querySelector('meta[name="robots"]');
    const created = !tag;
    const previous = tag?.getAttribute("content");
    if (!tag) {
      tag = document.createElement("meta");
      tag.setAttribute("name", "robots");
      document.head.appendChild(tag);
    }
    tag.setAttribute("content", "noindex, nofollow");
    return () => {
      if (created) tag.remove();
      else if (previous != null) tag.setAttribute("content", previous);
    };
  }, []);
}

export function MaintenanceScreen({ message, variant = "full" }) {
  const { siteName, logoUrl } = usePlatformSettings();
  useNoindex();

  if (variant === "home") {
    return (
      <section className="container-app flex min-h-[60vh] items-center justify-center py-14" aria-labelledby="mantenimiento-titulo">
        <div className="w-full max-w-[520px] rounded-3xl bg-surface-container-lowest p-7 text-center shadow-[0_8px_24px_-8px_rgba(14,26,40,0.25)] md:p-9">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container" aria-hidden="true">
            <Wrench className="h-6 w-6" />
          </span>
          <h1 id="mantenimiento-titulo" className="mt-4 font-display text-[24px] font-extrabold leading-tight text-on-surface">
            La página principal está en mantenimiento
          </h1>
          <p className="mt-2 text-[14px] leading-[21px] text-on-surface-variant">{message}</p>
          <p className="mt-1 text-[13px] text-outline">Mientras tanto, las tiendas y sus productos siguen disponibles.</p>
          <div className="mt-6 grid gap-2.5 sm:grid-cols-3">
            <Link to="/tiendas" className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-secondary-container px-3 text-[13.5px] font-bold text-on-secondary-container hover:brightness-95">
              <Store className="h-4 w-4" aria-hidden="true" /> Tiendas
            </Link>
            <Link to="/catalogo" className="flex min-h-11 items-center justify-center gap-2 rounded-xl border-[1.5px] border-tertiary-accent px-3 text-[13.5px] font-semibold text-tertiary-accent hover:bg-tertiary-accent/10">
              <LayoutGrid className="h-4 w-4" aria-hidden="true" /> Catálogo
            </Link>
            <Link to="/ventas-rapidas" className="flex min-h-11 items-center justify-center gap-2 rounded-xl border-[1.5px] border-tertiary-accent px-3 text-[13.5px] font-semibold text-tertiary-accent hover:bg-tertiary-accent/10">
              <Tag className="h-4 w-4" aria-hidden="true" /> Ventas rápidas
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center bg-primary px-6 py-10 text-center" aria-labelledby="mantenimiento-titulo">
      <img src={logoUrl} alt={siteName} className="h-12 w-auto" />
      <span className="mt-9 flex h-16 w-16 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container" aria-hidden="true">
        <Wrench className="h-7 w-7" />
      </span>
      <h1 id="mantenimiento-titulo" className="mt-5 max-w-[560px] font-display text-[28px] font-extrabold leading-tight text-white md:text-[36px]">
        Estamos en mantenimiento
      </h1>
      <p className="mt-3 max-w-[460px] text-[15px] leading-[23px] text-white/80">{message}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-8 inline-flex min-h-11 items-center gap-2 rounded-xl border-[1.5px] border-white/30 px-5 text-[14px] font-semibold text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary-container"
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" /> Volver a intentar
      </button>
    </main>
  );
}
