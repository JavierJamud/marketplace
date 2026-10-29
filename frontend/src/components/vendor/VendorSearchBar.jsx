import { useEffect, useRef, useState } from "react";
import { orderTotalLabel } from "../../lib/shipping.js";
import { searchSections } from "../../lib/sectionSearch.js";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, ShoppingCart, UtensilsCrossed, Package, LayoutGrid, X, ScanBarcode, Contact, Tag, Gift, Star } from "lucide-react";
import { api } from "../../lib/api.js";
import { planIncludesFlag } from "../../lib/planStatus.js";

function fmtCUP(n, currency = "CUP") {
  return `${Number(n).toLocaleString("es-CU", { maximumFractionDigits: 2 })} ${currency}`;
}

// Estado de stock de cada producto encontrado (mismos nombres que la lista de Productos).
const PRODUCT_STATUS = {
  active: { label: "Disponible", cls: "bg-verified/10 text-verified-dark" },
  unlimited: { label: "Siempre disponible", cls: "bg-verified/10 text-verified-dark" },
  low: { label: "Stock bajo", cls: "bg-secondary/10 text-secondary" },
  out: { label: "Sin stock", cls: "bg-error/10 text-error" },
  paused: { label: "Pausado", cls: "bg-surface-container-high text-on-surface-variant" },
  quota: { label: "Fuera del cupo", cls: "bg-surface-container-high text-on-surface-variant" },
};
// Filtro de la lista de Productos que corresponde a cada estado buscado por palabra ("agotados", "stock bajo"...).
const STATUS_TO_TAB = { out: "out", low: "low", paused: "paused", quota: "paused" };

function Group({ title, children }) {
  return (
    <div className="mb-1.5">
      <p className="px-2.5 pb-1 text-[10.5px] font-bold uppercase tracking-wide text-outline">{title}</p>
      {children}
    </div>
  );
}

const rowCls = "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-on-surface hover:bg-surface-container focus-visible:bg-surface-container focus-visible:outline-none";

// Bloque 175 (pedido explícito — "vamos a agregar en el panel de vendedor
// una barra de búsqueda para buscar clientes o pedidos o todo lo que se
// registre, hasta secciones o configuraciones dentro del panel de
// vendedor"): las secciones son una lista fija — no hace falta ir al
// backend por esto, un simple filtro de texto alcanza. Los pedidos/
// productos sí van al backend (searchMyVendor, vendors.controller.js).
// `restaurantOnly` oculta "Mesas / QR" para tiendas que no son restaurante,
// mismo criterio que el menú lateral (VendorLayout.jsx, NAV).
// `planFlag`: interruptor del plan sin el cual la sección no se ofrece, el mismo que usa el menú (NAV de VendorLayout.jsx) con
// la misma regla compartida (planIncludesFlag, lib/planStatus.js). Antes el buscador seguía ofreciendo Caja, Mesas, Usuarios u
// Ofertas a una tienda cuyo plan no las trae, y el enlace terminaba en el aviso de "no está en tu plan".
const SECTIONS = [
  { label: "Dashboard", path: "/vendedor" },
  { label: "Productos", path: "/vendedor/productos" },
  { label: "Caja", path: "/vendedor/caja", keywords: "punto de venta codigo de barras cobrar mostrador", planFlag: "allowPos" },
  { label: "Clientes", path: "/vendedor/clientes", keywords: "compradores contactos" },
  { label: "Programa de fidelidad", path: "/vendedor/puntos", keywords: "puntos recompensas" },
  // Bloque 232: las 2 de abajo apuntan a la misma página fusionada (con
  // pestañas adentro) — cada una conserva su propio `key` de permiso (no
  // el de SECTION_KEY_BY_PATH, que es por-path y ya no alcanza con 2
  // entradas compartiendo el mismo path) para seguir filtrándose por
  // separado según qué sección tenga de verdad el usuario de sistema.
  { label: "Códigos de descuento", path: "/vendedor/ofertas-tienda", key: "codigos-descuento", planFlag: "allowDiscountCodes" },
  { label: "Ofertas de tienda", path: "/vendedor/ofertas-tienda", key: "ofertas-tienda", planFlag: "allowStoreOffers" },
  { label: "Pedidos", path: "/vendedor/pedidos" },
  { label: "Mesas / QR", path: "/vendedor/mesas", restaurantOnly: true, planFlag: "allowQrTables" },
  { label: "Suscripción", path: "/vendedor/verificacion" },
  { label: "Mensajes", path: "/vendedor/mensajes" },
  { label: "Reseñas", path: "/vendedor/resenas" },
  { label: "Reportes", path: "/vendedor/reportes" },
  // Bloque 289: cada subsección lleva a SU pestaña de Configuración (?tab=) y se encuentra también
  // por lo que contiene (`keywords`).
  { label: "Configuración", path: "/vendedor/configuracion", keywords: "ajustes de la tienda" },
  { label: "Configuración: General", path: "/vendedor/configuracion", keywords: "horario de atencion metodos de pago moneda de la tienda destino de los pedidos whatsapp tienda privada restaurante mesas" },
  { label: "Horario de atención", path: "/vendedor/configuracion", keywords: "horas abierto cerrado dias" },
  { label: "Métodos de pago", path: "/vendedor/configuracion", keywords: "efectivo transferencia tarjeta" },
  { label: "Moneda de la tienda", path: "/vendedor/configuracion", keywords: "cup usd precios" },
  { label: "Configuración: Cobertura y visibilidad", path: "/vendedor/configuracion?tab=cobertura", keywords: "zonas de entrega cobertura paises provincias visibilidad" },
  { label: "Cobertura y zonas de entrega", path: "/vendedor/configuracion?tab=cobertura", keywords: "envios provincias paises" },
  { label: "Configuración: Facturación y otros", path: "/vendedor/configuracion?tab=facturacion", keywords: "facturas garantias terminos politicas" },
  { label: "Facturación y garantías", path: "/vendedor/configuracion?tab=facturacion", keywords: "factura garantia dias" },
  { label: "Configuración: Seguridad", path: "/vendedor/configuracion?tab=seguridad", keywords: "contrasena verificacion en dos pasos autenticador sesiones" },
  { label: "Configuración: Equipo y caja", path: "/vendedor/configuracion?tab=equipo", keywords: "usuarios agentes de ventas meseros cierre de caja" },
  { label: "Cierre de caja", path: "/vendedor/configuracion?tab=equipo", keywords: "caja frecuencia semanal mensual" },
  { label: "Usuarios de sistema", path: "/vendedor/usuarios", keywords: "agentes de ventas meseros equipo personal", planFlag: "allowStaffUsers" },
  { label: "Mi perfil", path: "/vendedor/perfil", keywords: "contrasena correo cuenta verificacion en dos pasos" },
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
  "/vendedor/caja": "caja",
  "/vendedor/clientes": "clientes",
  "/vendedor/puntos": "puntos",
  "/vendedor/pedidos": "pedidos",
  "/vendedor/mesas": "mesas",
  "/vendedor/mensajes": "mensajes",
  "/vendedor/resenas": "resenas",
  "/vendedor/reportes": "reportes",
};
const OWNER_ONLY_SEARCH_PATHS = new Set([
  "/vendedor/verificacion",
  "/vendedor/configuracion",
  "/vendedor/usuarios",
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

  // Se filtra primero por lo que esta persona puede ver (tienda restaurante, usuario de sistema) y
  // después se busca sin importar tildes ni mayúsculas (lib/sectionSearch.js).
  const planFeatures = vendor?.planFeatures;
  const allowedSections = SECTIONS.filter((s) => {
    if (s.restaurantOnly && !vendor?.isRestaurant) return false;
    if (!planIncludesFlag(s.planFlag, planFeatures)) return false;
    if (isStaff) {
      const base = s.path.split("?")[0];
      if (OWNER_ONLY_SEARCH_PATHS.has(base)) return false;
      const key = s.key ?? SECTION_KEY_BY_PATH[base];
      if (key && !staffSections.includes(key)) return false;
    }
    return true;
  });
  const matchingSections = query.trim().length >= 1 ? searchSections(allowedSections, query, 7) : [];
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

  const visibleTableOrders = data?.tableOrders ?? [];
  const visibleOrders = canSeeOrderResults ? data?.orders ?? [] : [];
  const visibleProducts = canSeeProductResults ? data?.products ?? [] : [];
  // Ventas de caja, códigos y ofertas viejos siguen en la base aunque el plan ya no traiga la sección (el servidor los devuelve
  // igual): no se listan, porque cada fila lleva a una sección que este plan no abre.
  const posSales = planIncludesFlag("allowPos", planFeatures) ? data?.posSales ?? [] : [];
  const customers = data?.customers ?? [];
  const discountCodes = planIncludesFlag("allowDiscountCodes", planFeatures) ? data?.discountCodes ?? [] : [];
  const storeOffers = planIncludesFlag("allowStoreOffers", planFeatures) ? data?.storeOffers ?? [] : [];
  const reviews = data?.reviews ?? [];
  const statusFilter = data?.statusFilter ?? null;
  const productTotal = data?.productTotal ?? 0;
  const hasResults =
    matchingSections.length + visibleOrders.length + visibleTableOrders.length + visibleProducts.length + posSales.length + customers.length + discountCodes.length + storeOffers.length + reviews.length > 0;
  // "Ver todos" lleva a Productos con el mismo texto (o el filtro de estado) ya aplicado.
  const allProductsPath = statusFilter
    ? `/vendedor/productos?filtro=${STATUS_TO_TAB[statusFilter.status] ?? "all"}`
    : `/vendedor/productos?q=${encodeURIComponent(query.trim())}`;

  return (
    <div ref={containerRef} className="relative w-full max-w-[420px]">
      <div className="flex h-10 items-center gap-2 rounded-full border border-outline-variant bg-surface-container px-3.5">
        <Search className="h-4 w-4 flex-shrink-0 text-outline" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Buscar productos, etiquetas, pedidos, clientes..."
          aria-label="Buscar en tu panel"
          className="w-full min-w-0 bg-transparent text-[13px] text-on-surface outline-none placeholder:text-outline"
        />
        {query && (
          // Área táctil de 44px aunque el icono mida 14px: el margen negativo la come del relleno de la barra para que no la
          // agrande ni empuje el campo.
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Borrar la búsqueda"
            className="-my-1 -mr-3 flex h-11 w-11 flex-shrink-0 items-center justify-center text-outline hover:text-on-surface"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {open && query.trim().length >= 1 && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-[60] max-h-[70vh] overflow-y-auto rounded-lg border border-surface-container-high bg-surface-container-lowest p-2 shadow-lg">
          {!hasResults && (
            <p className="px-2.5 py-2 text-[12.5px] text-outline">
              {query.trim().length < 2 ? "Sigue escribiendo..." : "Sin resultados."}
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
                  <span className="flex-shrink-0 text-[12px] font-semibold text-outline">{orderTotalLabel(o)}</span>
                </button>
              ))}
            </div>
          )}

          {visibleProducts.length > 0 && (
            <Group title={statusFilter ? `Productos: ${statusFilter.label}` : data?.fuzzy ? "Productos parecidos" : "Productos"}>
              {visibleProducts.map((p) => {
                const st = PRODUCT_STATUS[p.status] ?? PRODUCT_STATUS.active;
                return (
                  <button
                    key={p.id}
                    // Bloque 263: abre ESE producto para editarlo, no solo la lista.
                    onClick={() => goToSection(`/vendedor/productos?editar=${p.id}`)}
                    className={rowCls}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Package className="h-3.5 w-3.5 flex-shrink-0 text-outline" />
                      <span className="min-w-0">
                        <span className="block truncate">{p.name}</span>
                        {p.matchedBy && p.matchedBy !== "Parecido" && <span className="block truncate text-[11.5px] text-outline">{p.matchedBy}</span>}
                      </span>
                    </span>
                    <span className="flex flex-shrink-0 flex-col items-end gap-0.5">
                      <span className="text-[12px] font-semibold text-outline">{fmtCUP(p.price, p.currency)}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${st.cls}`}>
                        {st.label}
                        {p.stock != null && p.status !== "paused" ? ` · ${p.stock}` : ""}
                      </span>
                    </span>
                  </button>
                );
              })}
              {productTotal > visibleProducts.length && (
                <button onClick={() => goToSection(allProductsPath)} className={`${rowCls} font-semibold text-tertiary-accent`}>
                  Ver los {productTotal} productos en Productos
                </button>
              )}
            </Group>
          )}

          {posSales.length > 0 && (
            <Group title="Ventas de caja">
              {posSales.map((s) => (
                <button key={s.id} onClick={() => goToSection("/vendedor/caja")} className={rowCls}>
                  <span className="flex items-center gap-2 truncate">
                    <ScanBarcode className="h-3.5 w-3.5 flex-shrink-0 text-outline" /> {s.code}
                    {s.customerName && ` · ${s.customerName}`}
                  </span>
                  <span className="flex-shrink-0 text-[12px] font-semibold text-outline">{fmtCUP(s.total, s.currency)}</span>
                </button>
              ))}
            </Group>
          )}

          {customers.length > 0 && (
            <Group title="Clientes">
              {customers.map((c) => (
                <button key={c.id} onClick={() => goToSection(`/vendedor/clientes?q=${encodeURIComponent(c.name || c.phone || c.email || "")}`)} className={rowCls}>
                  <span className="flex min-w-0 items-center gap-2">
                    <Contact className="h-3.5 w-3.5 flex-shrink-0 text-outline" />
                    <span className="truncate">{c.name || "Cliente"}</span>
                  </span>
                  <span className="truncate text-[12px] text-outline">{c.phone || c.email}</span>
                </button>
              ))}
            </Group>
          )}

          {discountCodes.length > 0 && (
            <Group title="Códigos de descuento">
              {discountCodes.map((c) => (
                <button key={c.id} onClick={() => goToSection("/vendedor/ofertas-tienda")} className={rowCls}>
                  <span className="flex items-center gap-2 truncate">
                    <Tag className="h-3.5 w-3.5 flex-shrink-0 text-outline" /> {c.code}
                  </span>
                  <span className="flex-shrink-0 text-[12px] text-outline">{c.active ? "Activo" : "Inactivo"}</span>
                </button>
              ))}
            </Group>
          )}

          {storeOffers.length > 0 && (
            <Group title="Ofertas de tienda">
              {storeOffers.map((o) => (
                <button key={o.id} onClick={() => goToSection("/vendedor/ofertas-tienda")} className={rowCls}>
                  <span className="flex items-center gap-2 truncate">
                    <Gift className="h-3.5 w-3.5 flex-shrink-0 text-outline" /> {o.title}
                  </span>
                  <span className="flex-shrink-0 text-[12px] text-outline">{o.active ? "Activa" : "Borrador"}</span>
                </button>
              ))}
            </Group>
          )}

          {reviews.length > 0 && (
            <Group title="Reseñas">
              {reviews.map((r) => (
                <button key={r.id} onClick={() => goToSection("/vendedor/resenas")} className={rowCls}>
                  <span className="flex min-w-0 items-center gap-2">
                    <Star className="h-3.5 w-3.5 flex-shrink-0 text-outline" />
                    <span className="min-w-0">
                      <span className="block truncate">{r.authorName}</span>
                      {r.comment && <span className="block truncate text-[11.5px] text-outline">{r.comment}</span>}
                    </span>
                  </span>
                  {r.rating != null && <span className="flex-shrink-0 text-[12px] font-semibold text-outline">{r.rating} ★</span>}
                </button>
              ))}
            </Group>
          )}
        </div>
      )}
    </div>
  );
}
