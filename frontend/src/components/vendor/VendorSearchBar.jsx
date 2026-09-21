import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, ShoppingCart, UtensilsCrossed, Package, LayoutGrid, X } from "lucide-react";
import { api } from "../../lib/api.js";

function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}

// Bloque 175 (pedido explícito — "vamos a agregar en el panel de vendedor
// una barra de búsqueda para buscar clientes o pedidos o todo lo que se
// registre, hasta secciones o configuraciones dentro del panel de
// vendedor"): las secciones son una lista fija — no hace falta ir al
// backend por esto, un simple filtro de texto alcanza. Los pedidos/
// productos sí van al backend (searchMyVendor, vendors.controller.js).
// `restaurantOnly` oculta "Mesas / QR" para tiendas que no son restaurante,
// mismo criterio que el menú lateral (VendorLayout.jsx, NAV).
const SECTIONS = [
  { label: "Dashboard", path: "/vendedor" },
  { label: "Productos", path: "/vendedor/productos" },
  { label: "Ofertas", path: "/vendedor/ofertas" },
  // Bloque 232: las 2 de abajo apuntan a la misma página fusionada (con
  // pestañas adentro) — cada una conserva su propio `key` de permiso (no
  // el de SECTION_KEY_BY_PATH, que es por-path y ya no alcanza con 2
  // entradas compartiendo el mismo path) para seguir filtrándose por
  // separado según qué sección tenga de verdad el usuario de sistema.
  { label: "Códigos de descuento", path: "/vendedor/ofertas-tienda", key: "codigos-descuento" },
  { label: "Ofertas de tienda", path: "/vendedor/ofertas-tienda", key: "ofertas-tienda" },
  { label: "Pedidos", path: "/vendedor/pedidos" },
  { label: "Mesas / QR", path: "/vendedor/mesas", restaurantOnly: true },
  { label: "Verificación y plan", path: "/vendedor/verificacion" },
  { label: "Mensajes", path: "/vendedor/mensajes" },
  { label: "Reseñas", path: "/vendedor/resenas" },
  { label: "Reportes de fraude", path: "/vendedor/reportes" },
  { label: "Configuración", path: "/vendedor/configuracion" },
  { label: "Horario de atención", path: "/vendedor/configuracion" },
  { label: "Métodos de pago", path: "/vendedor/configuracion" },
  { label: "Moneda de la tienda", path: "/vendedor/configuracion" },
  { label: "Facturación y garantías", path: "/vendedor/configuracion" },
  { label: "Cobertura y zonas de entrega", path: "/vendedor/configuracion" },
  { label: "Mi perfil", path: "/vendedor/perfil" },
];

// Bloque 185 (bug real reportado en vivo — "si el usuario escribe
//'productos' se muestra como resultado de búsqueda la sección Productos,
// eso no puede pasar ya que está restringida desde esa sección de
// usuario"): cada entrada de SECTIONS que corresponde a una sección
// delegable lleva su `key` (misma clave que allowedSections/
// requireVendorAccess) — las que no la tienen (Mi perfil, y las owner-only
// como Configuración/Verificación) siempre se muestran, un usuario de
// sistema puede ver "Mi perfil" siempre y las owner-only ni se le ocurre
// buscarlas si no sabe que existen, pero por las dudas también se filtran.
// Bloque 232: "codigos-descuento"/"ofertas-tienda" ya NO viven acá — desde
// que comparten un mismo path (/vendedor/ofertas-tienda), cada una lleva su
// propio `key` directo en su entrada de SECTIONS (ver más arriba), este
// dict por-path ya no puede distinguir cuál es cuál.
const SECTION_KEY_BY_PATH = {
  "/vendedor/productos": "productos",
  "/vendedor/ofertas": "ofertas",
  "/vendedor/pedidos": "pedidos",
  "/vendedor/mesas": "mesas",
  "/vendedor/mensajes": "mensajes",
  "/vendedor/resenas": "resenas",
  "/vendedor/reportes": "reportes",
};
const OWNER_ONLY_SEARCH_PATHS = new Set([
  "/vendedor/verificacion",
  "/vendedor/configuracion",
]);

export function VendorSearchBar({ vendor, staffSections }) {
  // null = dueño/admin, sin recorte. Un array (incluso vacío) = usuario de
  // sistema — se filtra por su lista real.
  const isStaff = staffSections != null;
  const navigate = useNavigate();
  const containerRef = useRef(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(id);
  }, [query]);

  const { data } = useQuery({
    queryKey: ["vendor-search", debounced],
    queryFn: async () => (await api.get("/vendors/me/search", { params: { q: debounced } })).data,
    enabled: debounced.length >= 2,
  });

  useEffect(() => {
    function onClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    function onKeyDown(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const matchingSections =
    query.trim().length >= 1
      ? SECTIONS.filter((s) => {
          if (s.restaurantOnly && !vendor?.isRestaurant) return false;
          if (isStaff) {
            if (OWNER_ONLY_SEARCH_PATHS.has(s.path)) return false;
            const key = s.key ?? SECTION_KEY_BY_PATH[s.path];
            if (key && !staffSections.includes(key)) return false;
          }
          return s.label.toLowerCase().includes(query.trim().toLowerCase());
        }).slice(0, 5)
      : [];
  // Bloque 185: mismo caso — un usuario sin la sección "productos" no debe
  // ver productos como resultado de búsqueda (llevaría a un link a
  // /vendedor/productos que el propio VendorLayout le va a rebotar igual,
  // pero no debe ni aparecer la opción).
  const canSeeProductResults = !isStaff || staffSections.includes("productos");
  const canSeeOrderResults = !isStaff || staffSections.includes("pedidos");

  function goToOrder(rawId, isTable) {
    navigate(`/vendedor/pedidos?ver=${rawId}&tipo=${isTable ? "mesa" : "orden"}`);
    close();
  }
  function goToSection(path) {
    navigate(path);
    close();
  }
  function close() {
    setOpen(false);
    setQuery("");
  }

  const visibleTableOrders = canSeeOrderResults ? data?.tableOrders ?? [] : [];
  const visibleOrders = canSeeOrderResults ? data?.orders ?? [] : [];
  const visibleProducts = canSeeProductResults ? data?.products ?? [] : [];
  const hasResults = matchingSections.length > 0 || visibleOrders.length > 0 || visibleTableOrders.length > 0 || visibleProducts.length > 0;

  return (
    <div ref={containerRef} className="relative w-full max-w-[420px]">
      <div className="flex items-center gap-2 rounded-full border border-outline-variant bg-surface-container-lowest px-3.5 py-2">
        <Search className="h-4 w-4 flex-shrink-0 text-outline" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Buscar pedidos, clientes, productos, secciones..."
          className="w-full min-w-0 bg-transparent text-[13px] text-on-surface outline-none placeholder:text-outline"
        />
        {query && (
          <button onClick={() => setQuery("")} className="flex-shrink-0 text-outline hover:text-on-surface">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && query.trim().length >= 1 && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-[60] max-h-[70vh] overflow-y-auto rounded-lg border border-surface-container-high bg-surface-container-lowest p-2 shadow-lg">
          {!hasResults && (
            <p className="px-2.5 py-2 text-[12.5px] text-outline">
              {query.trim().length < 2 ? "Seguí escribiendo..." : "Sin resultados."}
            </p>
          )}

          {matchingSections.length > 0 && (
            <div className="mb-1.5">
              <p className="px-2.5 pb-1 text-[10.5px] font-bold uppercase tracking-wide text-outline">Secciones</p>
              {matchingSections.map((s) => (
                <button
                  key={s.path + s.label}
                  onClick={() => goToSection(s.path)}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-on-surface hover:bg-surface-container"
                >
                  <LayoutGrid className="h-3.5 w-3.5 flex-shrink-0 text-outline" /> {s.label}
                </button>
              ))}
            </div>
          )}

          {visibleTableOrders.length > 0 && (
            <div className="mb-1.5">
              <p className="px-2.5 pb-1 text-[10.5px] font-bold uppercase tracking-wide text-outline">Pedidos de mesa</p>
              {visibleTableOrders.map((t) => (
                <button
                  key={t.id}
                  onClick={() => goToOrder(t.id, true)}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-on-surface hover:bg-surface-container"
                >
                  <span className="flex items-center gap-2 truncate">
                    <UtensilsCrossed className="h-3.5 w-3.5 flex-shrink-0 text-outline" />
                    {t.table.label || `Mesa ${t.table.tableNumber}`} · Pedido #{t.orderNumber}
                    {t.customerName && ` · ${t.customerName}`}
                  </span>
                  <span className="flex-shrink-0 text-[12px] font-semibold text-outline">{fmtCUP(t.total)}</span>
                </button>
              ))}
            </div>
          )}

          {visibleOrders.length > 0 && (
            <div className="mb-1.5">
              <p className="px-2.5 pb-1 text-[10.5px] font-bold uppercase tracking-wide text-outline">Pedidos</p>
              {visibleOrders.map((o) => (
                <button
                  key={o.id}
                  onClick={() => goToOrder(o.id, false)}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-on-surface hover:bg-surface-container"
                >
                  <span className="flex items-center gap-2 truncate">
                    <ShoppingCart className="h-3.5 w-3.5 flex-shrink-0 text-outline" />
                    {o.code}
                    {o.customerName && ` · ${o.customerName}`}
                  </span>
                  <span className="flex-shrink-0 text-[12px] font-semibold text-outline">{fmtCUP(o.total)}</span>
                </button>
              ))}
            </div>
          )}

          {visibleProducts.length > 0 && (
            <div>
              <p className="px-2.5 pb-1 text-[10.5px] font-bold uppercase tracking-wide text-outline">Productos</p>
              {visibleProducts.map((p) => (
                <button
                  key={p.id}
                  onClick={() => goToSection("/vendedor/productos")}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-on-surface hover:bg-surface-container"
                >
                  <span className="flex items-center gap-2 truncate">
                    <Package className="h-3.5 w-3.5 flex-shrink-0 text-outline" /> {p.name}
                  </span>
                  <span className="flex-shrink-0 text-[12px] font-semibold text-outline">{fmtCUP(p.price)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
