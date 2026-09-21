// Bloque 183 (pedido explícito — "saldrán siempre todas las secciones que
// están en el panel de vendedor, para que el vendedor pueda asignar...
// solo va a tener acceso a la sección que se le dio"): mismas claves EXACTAS
// que backend/src/constants/vendorSections.js y que los `path` de las
// rutas hijas de /vendedor en App.jsx — un usuario de sistema con
// allowedSections:["pedidos"] ve solo el link "Pedidos" en el NAV
// (VendorLayout.jsx) y solo puede entrar a /vendedor/pedidos (cualquier
// otra ruta lo manda para ahí, ver VendorLayout.jsx).
export const VENDOR_SECTIONS = [
  // Bloque 194: solo la etiqueta cambia a "Dashboard" — la clave "resumen"
  // se queda igual, es lo que usa requireVendorAccess("resumen") del
  // backend y no hay ninguna necesidad de tocarla por un cambio de nombre
  // visible.
  { key: "resumen", label: "Dashboard" },
  { key: "productos", label: "Productos" },
  { key: "ofertas", label: "Ofertas" },
  { key: "codigos-descuento", label: "Códigos de descuento" },
  { key: "ofertas-tienda", label: "Ofertas de tienda" },
  { key: "pedidos", label: "Pedidos" },
  { key: "mesas", label: "Mesas / QR" },
  { key: "mensajes", label: "Mensajes" },
  { key: "resenas", label: "Reseñas" },
  { key: "reportes", label: "Reportes de fraude" },
  // Bloque 202 (pedido explícito — "no será una sección visible en el
  // panel del... dueño, será una sección que se habilita sola cuando un
  // usuario de venta tiene productos asignados"): sigue siendo una clave
  // válida (rutas, validación del backend), pero YA NO se elige a mano acá
  // — se prende sola la primera vez que el dueño le reasigna stock a
  // alguien (ver reassignAllocation, backend). Por eso está filtrada de
  // MANUALLY_ASSIGNABLE_SECTIONS más abajo, la lista que realmente arma el
  // checklist de SectionAccessPicker.
  { key: "ventas-manuales", label: "Productos Asignados" },
];

export const VENDOR_SECTION_KEYS = VENDOR_SECTIONS.map((s) => s.key);

// Bloque 202: usada por SectionAccessPicker.jsx (dueño y admin editando un
// usuario) — todo VENDOR_SECTIONS excepto "ventas-manuales", que ya no es
// una casilla manual.
export const MANUALLY_ASSIGNABLE_SECTIONS = VENDOR_SECTIONS.filter((s) => s.key !== "ventas-manuales");

export function vendorSectionLabel(key) {
  return VENDOR_SECTIONS.find((s) => s.key === key)?.label ?? key;
}

// Bloque 185 (pedido explícito — "también debe seleccionar qué permisos
// tendrá el usuario en esa sección, si solo lectura o modificar"): mismo
// criterio de "ausente = manage" que el servidor (staffSectionLevel,
// requireVendorAccess.js) — para que un usuario creado antes de este bloque
// no pierda ningún botón de golpe solo porque nunca se le guardó un nivel.
// `permissions` es `null` para dueño/admin (VendorLayout.jsx) — ahí SIEMPRE
// puede escribir, sin excepción.
export function canWriteSection(permissions, section) {
  if (permissions == null) return true;
  return (permissions[section] ?? "manage") === "manage";
}
