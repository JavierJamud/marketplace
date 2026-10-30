// Panel de cada tipo de cuenta, con las mismas rutas protegidas de App.jsx: /vendedor admite VENDOR y VENDOR_STAFF,
// /socio solo PARTNER y /cuenta/panel solo CUSTOMER. Cliente y vendedor son cuentas separadas aunque compartan correo
// (backend/src/lib/accountRealm.js), así que cada una tiene un solo panel. Un rol desconocido va a la cuenta de cliente.
export function panelForRole(role) {
  if (role === "ADMIN") return { href: "/admin", label: "Panel de administración" };
  if (role === "VENDOR" || role === "VENDOR_STAFF") return { href: "/vendedor", label: "Panel de vendedor" };
  if (role === "PARTNER") return { href: "/socio", label: "Panel de socio" };
  return { href: "/cuenta/panel", label: "Mi cuenta" };
}

// Nombre del tipo de cuenta para los avisos ("tu cuenta de vendedor").
export function accountKindLabel(role) {
  if (role === "ADMIN") return "administrador";
  if (role === "VENDOR") return "vendedor";
  if (role === "VENDOR_STAFF") return "personal de tienda";
  if (role === "PARTNER") return "socio";
  return "cliente";
}
