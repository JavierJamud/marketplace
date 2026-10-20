import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";

// Esqueletos de carga (react-loading-skeleton, efecto brillo). Cada tarjeta del sitio (producto, tienda, anuncio) tiene su
// propio modo de carga en su mismo archivo, con su misma estructura: así el esqueleto ocupa exactamente el lugar del contenido
// y nada salta al llegar los datos. Aquí van el tema común y los esqueletos genéricos de los paneles (listas, formularios,
// cifras). Solo se muestran mientras la consulta carga: si falla, la página muestra su aviso de error en su lugar.
export { Skeleton };

const reducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Colores de surface-container-high / surface-container-low (tailwind.config.js): el brillo se nota sin parecer un fallo.
export function AppSkeletonTheme({ children }) {
  return (
    <SkeletonTheme baseColor="#eae7e9" highlightColor="#f8f6f7" duration={1.3} enableAnimation={!reducedMotion}>
      {children}
    </SkeletonTheme>
  );
}

// Contenedor accesible: el lector de pantalla anuncia "Cargando" una sola vez en vez de leer cada hueso.
export function SkeletonGroup({ label = "Cargando", className, children }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={className}>
      {children}
    </div>
  );
}

// Lista de filas (pedidos, clientes, reseñas, registros): avatar opcional, dos líneas y una etiqueta a la derecha.
export function ListSkeleton({ rows = 5, avatar = true, className = "", label }) {
  return (
    <SkeletonGroup label={label} className={`divide-y divide-surface-container-high ${className}`}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 py-3">
          {avatar && <Skeleton circle width={40} height={40} />}
          <div className="min-w-0 flex-1">
            <Skeleton width={`${55 - (i % 3) * 10}%`} height={14} />
            <Skeleton width={`${75 - (i % 2) * 15}%`} height={11} />
          </div>
          <Skeleton width={72} height={24} borderRadius={999} />
        </div>
      ))}
    </SkeletonGroup>
  );
}

// Tarjetas apiladas (ofertas, anuncios, planes, casos de soporte).
export function CardListSkeleton({ cards = 3, className = "", label }) {
  return (
    <SkeletonGroup label={label} className={`grid gap-3 ${className}`}>
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4">
          <Skeleton width="40%" height={16} />
          <Skeleton width="85%" height={12} className="mt-2" />
          <Skeleton width="60%" height={12} />
        </div>
      ))}
    </SkeletonGroup>
  );
}

// Formulario: etiquetas y campos.
export function FormSkeleton({ fields = 4, className = "", label }) {
  return (
    <SkeletonGroup label={label} className={`grid gap-4 ${className}`}>
      {Array.from({ length: fields }, (_, i) => (
        <div key={i}>
          <Skeleton width={120 + (i % 3) * 30} height={12} />
          <Skeleton height={44} borderRadius={8} className="mt-1" />
        </div>
      ))}
      <Skeleton width={150} height={44} borderRadius={12} />
    </SkeletonGroup>
  );
}

// Cifras de resumen (paneles).
export function TilesSkeleton({ tiles = 4, className = "" }) {
  return (
    <div className={`grid grid-cols-2 gap-3 md:grid-cols-4 ${className}`} aria-hidden="true">
      {Array.from({ length: tiles }, (_, i) => (
        <div key={i} className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4">
          <Skeleton width="60%" height={11} />
          <Skeleton width="45%" height={24} className="mt-2" />
        </div>
      ))}
    </div>
  );
}

// Pantalla completa de panel (cuando toda la página depende de una consulta): cifras arriba y una lista.
export function PanelSkeleton({ label }) {
  return (
    <SkeletonGroup label={label} className="grid gap-5">
      <Skeleton width={220} height={26} />
      <TilesSkeleton />
      <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest px-4">
        <ListSkeleton rows={5} />
      </div>
    </SkeletonGroup>
  );
}

// Filas de una tabla (<tbody>): mismas columnas que la tabla real.
export function TableRowsSkeleton({ rows = 5, cols = 4 }) {
  return Array.from({ length: rows }, (_, r) => (
    <tr key={r} aria-hidden="true">
      {Array.from({ length: cols }, (_, c) => (
        <td key={c} className="px-3 py-3">
          <Skeleton height={13} width={c === 0 ? "80%" : "60%"} />
        </td>
      ))}
    </tr>
  ));
}

// Burbujas de un chat mientras llega el historial.
export function ChatSkeleton({ bubbles = 3 }) {
  return (
    <SkeletonGroup label="Cargando conversación" className="grid gap-2 py-2">
      {Array.from({ length: bubbles }, (_, i) => (
        <div key={i} className={i % 2 ? "flex justify-end" : "flex"}>
          <Skeleton width={i % 2 ? 150 : 190} height={34} borderRadius={14} />
        </div>
      ))}
    </SkeletonGroup>
  );
}

// Panel completo mientras se confirma la sesión o se carga la tienda: barra lateral oscura en escritorio y el contenido.
export function AppShellSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Cargando" className="flex min-h-dvh bg-surface-container">
      <div className="hidden w-64 flex-shrink-0 bg-primary p-5 lg:block" aria-hidden="true">
        <Skeleton width={140} height={24} baseColor="rgba(255,255,255,0.12)" highlightColor="rgba(255,255,255,0.24)" className="mb-8" />
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} height={18} width={`${80 - (i % 3) * 12}%`} baseColor="rgba(255,255,255,0.12)" highlightColor="rgba(255,255,255,0.24)" className="mb-4" />
        ))}
      </div>
      <div className="min-w-0 flex-1 p-4 md:p-8">
        <PanelSkeleton />
      </div>
    </div>
  );
}

// Página genérica mientras se descarga el código de una pantalla: título, texto y dos bloques de contenido.
export function PageSkeleton() {
  return (
    <SkeletonGroup label="Cargando" className="container-app py-8">
      <Skeleton width={260} height={28} className="mb-3" />
      <Skeleton width="60%" height={14} className="mb-6" />
      <div className="grid gap-4 md:grid-cols-2" aria-hidden="true">
        <Skeleton height={180} borderRadius={20} />
        <Skeleton height={180} borderRadius={20} />
      </div>
    </SkeletonGroup>
  );
}
