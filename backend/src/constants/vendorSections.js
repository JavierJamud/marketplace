// Bloque 183 (pedido explícito — "saldrán siempre todas las secciones que
// están en el panel de vendedor, para que el vendedor pueda asignar...
// solo va a tener acceso a la sección que se le dio"): lista única de
// claves de sección — el mismo array que usa requireVendorAccess(section)
// en las rutas (backend) y el NAV del panel (VendorLayout.jsx, frontend)
// para decidir qué puede tocar/ver un usuario de sistema. Un solo lugar de
// verdad para las 2 puntas — nunca dos listas separadas que se puedan
// desincronizar.
//
// A propósito, "Configuración", "Verificación y plan" y "Mi perfil" NO
// están acá — son datos de identidad del negocio/pagos/legal (horarios,
// zonas de entrega, KYC, suscripción, cambiar contraseña/correo del
// DUEÑO) que un vendedor normalmente nunca querría delegar a un usuario
// con acceso puntual; "Usuarios" (esta misma función) tampoco es
// delegable — solo el dueño/admin puede crear o gestionar otros usuarios,
// nunca un usuario de sistema entre sí (evita que alguien con acceso cree
// una puerta trasera para sí mismo).
export const VENDOR_SECTIONS = [
  { key: "resumen", label: "Resumen" },
  { key: "productos", label: "Productos" },
  { key: "ofertas", label: "Ofertas" },
  { key: "codigos-descuento", label: "Códigos de descuento" },
  { key: "ofertas-tienda", label: "Ofertas de tienda" },
  { key: "pedidos", label: "Pedidos" },
  { key: "mesas", label: "Mesas / QR" },
  { key: "mensajes", label: "Mensajes" },
  { key: "resenas", label: "Reseñas" },
  { key: "reportes", label: "Reportes de fraude" },
  // Bloque 198 (pedido explícito — "una nueva sección... con el objetivo
  // para darle acceso a los usuarios a ella... podrán controlar su stock
  // por usuario... registrar sus ventas diarias manualmente"): a
  // diferencia de "Usuarios" (nunca delegable), esta SÍ es una sección
  // normal — el dueño decide a quién se la da, igual que cualquier otra.
  { key: "ventas-manuales", label: "Agentes de Ventas" },
];

export const VENDOR_SECTION_KEYS = VENDOR_SECTIONS.map((s) => s.key);

// Bloque 185/187: compartida entre vendorStaff.controller.js (el dueño
// editando su propio equipo) y admin.controller.js (un admin de la
// plataforma editando cualquier usuario de sistema) — nunca confiar en el
// nivel de una sección que ni siquiera está en `allowedSections`: si a
// alguien le sacan una sección pero queda basura vieja en
// `sectionPermissions`, esa clave simplemente no se guarda.
export function pruneSectionPermissions(sections, permissions) {
  return Object.fromEntries(Object.entries(permissions ?? {}).filter(([key]) => sections.includes(key)));
}

// Bloque 200 (pedido explícito — "cuando se crea un usuario con agente de
// ventas, automáticamente se debe habilitar una sección en el perfil del
// usuario... al crear un usuario se debe poder especificar si es un agente
// de venta o un mesero"): qué sección(es) se precargan solas al elegir cada
// tipo — SIEMPRE un atajo (union con lo que el dueño ya haya tildado a
// mano), nunca un reemplazo ni una restricción; el dueño puede sacarlas
// después si quiere. Un mesero necesita tanto Mesas/QR (abrir/gestionar
// cuentas) como Pedidos (ver el estado de cocina de esas mismas cuentas).
export const STAFF_TYPE_DEFAULT_SECTIONS = {
  SALES_AGENT: ["ventas-manuales"],
  WAITER: ["mesas", "pedidos"],
};

// Bloque 200: compartida entre vendorStaff.controller.js (el dueño) y
// admin.controller.js (un admin editando cualquier usuario) — une (sin
// duplicar) las secciones que el tipo elegido precarga con las que ya
// estaban tildadas, nunca resta nada.
export function withStaffTypeSections(sections, staffType) {
  const defaults = staffType ? STAFF_TYPE_DEFAULT_SECTIONS[staffType] ?? [] : [];
  return [...new Set([...sections, ...defaults])];
}
